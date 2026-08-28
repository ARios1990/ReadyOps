-- Imported from the hosted ReadyOp Supabase migration history on 2026-08-28.
-- Schema only: no production table data is included.

BEGIN;

CREATE OR REPLACE FUNCTION public.admin_update_lead_crm(
  p_lead_id uuid,
  p_lead_patch jsonb DEFAULT '{}'::jsonb,
  p_appointment_patch jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor_id uuid := (SELECT auth.uid());
  v_role text := private.readyops_profile_role();
  v_old_lead public.portal_leads%ROWTYPE;
  v_new_lead public.portal_leads%ROWTYPE;
  v_old_appt public.portal_appointments%ROWTYPE;
  v_new_appt public.portal_appointments%ROWTYPE;
  v_form jsonb;
  v_agent public.agents%ROWTYPE;
  v_agent_id uuid;
  v_agent_profile_id uuid;
  v_company_id uuid;
  v_location_id uuid;
  v_company_changed boolean;
  v_location_changed boolean;
  v_new_date date;
  v_new_start time;
  v_new_end time;
  v_duration interval;
BEGIN
  IF v_actor_id IS NULL OR v_role <> 'admin' THEN
    RAISE EXCEPTION 'Main Admin access required';
  END IF;
  IF p_lead_id IS NULL THEN RAISE EXCEPTION 'Lead ID is required'; END IF;
  IF jsonb_typeof(coalesce(p_lead_patch, '{}'::jsonb)) <> 'object'
     OR jsonb_typeof(coalesce(p_appointment_patch, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'Lead and appointment patches must be JSON objects';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_object_keys(coalesce(p_lead_patch, '{}'::jsonb)) AS key
    WHERE key NOT IN (
      'full_name', 'phone_number', 'email', 'address', 'city', 'state', 'zip_code',
      'service_needed', 'language', 'notes', 'home_value', 'sq_ft', 'web_url',
      'source', 'source_lead_id', 'source_disposition', 'qualification_status',
      'qualification_reasons', 'form_data', 'company_id', 'location_id', 'agent_id',
      'qc_status', 'qc_reason', 'qc_notes', 'recording_url',
      'share_recording_with_company'
    )
  ) THEN RAISE EXCEPTION 'Lead patch contains a field that cannot be edited from Admin CRM'; END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_object_keys(coalesce(p_appointment_patch, '{}'::jsonb)) AS key
    WHERE key NOT IN (
      'appointment_date', 'start_time', 'status', 'client_status', 'attendance_status',
      'inspection_status', 'sales_outcome', 'inspector_notes', 'company_action'
    )
  ) THEN RAISE EXCEPTION 'Appointment patch contains a field that cannot be edited from Admin CRM'; END IF;

  SELECT * INTO v_old_lead
  FROM public.portal_leads
  WHERE id = p_lead_id
  FOR UPDATE;
  IF v_old_lead.id IS NULL THEN RAISE EXCEPTION 'Lead not found'; END IF;

  SELECT * INTO v_old_appt
  FROM public.portal_appointments
  WHERE lead_id = p_lead_id
  ORDER BY created_at DESC, id
  LIMIT 1
  FOR UPDATE;

  IF p_lead_patch ? 'full_name' AND nullif(trim(p_lead_patch->>'full_name'), '') IS NULL THEN
    RAISE EXCEPTION 'Homeowner name is required';
  END IF;
  IF p_lead_patch ? 'phone_number' AND nullif(trim(p_lead_patch->>'phone_number'), '') IS NULL THEN
    RAISE EXCEPTION 'Phone number is required';
  END IF;
  IF p_lead_patch ? 'address' AND nullif(trim(p_lead_patch->>'address'), '') IS NULL THEN
    RAISE EXCEPTION 'Property address is required';
  END IF;
  IF p_lead_patch ? 'form_data' AND jsonb_typeof(p_lead_patch->'form_data') <> 'object' THEN
    RAISE EXCEPTION 'Qualification details must be a JSON object';
  END IF;
  IF p_lead_patch ? 'qualification_reasons'
     AND jsonb_typeof(p_lead_patch->'qualification_reasons') <> 'array' THEN
    RAISE EXCEPTION 'Qualification reasons must be a JSON array';
  END IF;
  IF p_lead_patch ? 'share_recording_with_company'
     AND jsonb_typeof(p_lead_patch->'share_recording_with_company') <> 'boolean' THEN
    RAISE EXCEPTION 'Share recording must be true or false';
  END IF;

  v_company_id := CASE
    WHEN p_lead_patch ? 'company_id'
      THEN nullif(trim(coalesce(p_lead_patch->>'company_id', '')), '')::uuid
    ELSE v_old_lead.company_id
  END;
  IF v_company_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.roster_companies AS c WHERE c.id = v_company_id
  ) THEN
    RAISE EXCEPTION 'Select a valid company';
  END IF;

  v_location_id := CASE
    WHEN p_lead_patch ? 'location_id'
      THEN nullif(trim(coalesce(p_lead_patch->>'location_id', '')), '')::uuid
    ELSE v_old_lead.location_id
  END;
  IF v_location_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.company_locations AS loc
    WHERE loc.id = v_location_id AND loc.company_id = v_company_id
  ) THEN
    RAISE EXCEPTION 'Select a location that belongs to the selected company';
  END IF;
  v_company_changed := v_company_id IS DISTINCT FROM v_old_lead.company_id;
  v_location_changed := v_location_id IS DISTINCT FROM v_old_lead.location_id;

  v_form := coalesce(v_old_lead.form_data, '{}'::jsonb)
    || coalesce(p_lead_patch->'form_data', '{}'::jsonb);
  IF p_lead_patch ? 'agent_id' THEN
    v_agent_id := nullif(trim(coalesce(p_lead_patch->>'agent_id', '')), '')::uuid;
    IF v_agent_id IS NOT NULL THEN
      SELECT * INTO v_agent FROM public.agents WHERE id = v_agent_id AND active;
      IF v_agent.id IS NULL THEN RAISE EXCEPTION 'Select an active agent'; END IF;
      SELECT p.id INTO v_agent_profile_id
      FROM public.profiles AS p
      WHERE p.agent_id = v_agent.id AND p.role = 'agent'
      ORDER BY p.created_at NULLS LAST, p.id
      LIMIT 1;
    END IF;
  END IF;

  UPDATE public.portal_leads
  SET company_id = v_company_id,
      location_id = v_location_id,
      package_id = CASE WHEN v_company_changed THEN NULL ELSE package_id END,
      full_name = CASE WHEN p_lead_patch ? 'full_name' THEN trim(p_lead_patch->>'full_name') ELSE full_name END,
      phone_number = CASE WHEN p_lead_patch ? 'phone_number' THEN trim(p_lead_patch->>'phone_number') ELSE phone_number END,
      email = CASE WHEN p_lead_patch ? 'email' THEN nullif(lower(trim(p_lead_patch->>'email')), '') ELSE email END,
      address = CASE WHEN p_lead_patch ? 'address' THEN trim(p_lead_patch->>'address') ELSE address END,
      city = CASE WHEN p_lead_patch ? 'city' THEN nullif(trim(p_lead_patch->>'city'), '') ELSE city END,
      state = CASE WHEN p_lead_patch ? 'state' THEN nullif(upper(trim(p_lead_patch->>'state')), '') ELSE state END,
      zip_code = CASE WHEN p_lead_patch ? 'zip_code' THEN nullif(trim(p_lead_patch->>'zip_code'), '') ELSE zip_code END,
      service_needed = CASE WHEN p_lead_patch ? 'service_needed' THEN nullif(trim(p_lead_patch->>'service_needed'), '') ELSE service_needed END,
      language = CASE WHEN p_lead_patch ? 'language' THEN nullif(trim(p_lead_patch->>'language'), '') ELSE language END,
      notes = CASE WHEN p_lead_patch ? 'notes' THEN nullif(trim(p_lead_patch->>'notes'), '') ELSE notes END,
      home_value = CASE WHEN p_lead_patch ? 'home_value' THEN nullif(regexp_replace(coalesce(p_lead_patch->>'home_value', ''), '[^0-9.]', '', 'g'), '')::numeric ELSE home_value END,
      sq_ft = CASE WHEN p_lead_patch ? 'sq_ft' THEN nullif(regexp_replace(coalesce(p_lead_patch->>'sq_ft', ''), '[^0-9]', '', 'g'), '')::integer ELSE sq_ft END,
      web_url = CASE WHEN p_lead_patch ? 'web_url' THEN nullif(trim(p_lead_patch->>'web_url'), '') ELSE web_url END,
      source = CASE WHEN p_lead_patch ? 'source' THEN nullif(trim(p_lead_patch->>'source'), '') ELSE source END,
      source_lead_id = CASE WHEN p_lead_patch ? 'source_lead_id' THEN nullif(trim(p_lead_patch->>'source_lead_id'), '') ELSE source_lead_id END,
      source_disposition = CASE WHEN p_lead_patch ? 'source_disposition' THEN nullif(trim(p_lead_patch->>'source_disposition'), '') ELSE source_disposition END,
      qualification_status = CASE WHEN p_lead_patch ? 'qualification_status' THEN nullif(trim(p_lead_patch->>'qualification_status'), '') ELSE qualification_status END,
      qualification_reasons = CASE WHEN p_lead_patch ? 'qualification_reasons' THEN p_lead_patch->'qualification_reasons' ELSE qualification_reasons END,
      form_data = v_form,
      agent_id = CASE WHEN p_lead_patch ? 'agent_id' THEN v_agent_id ELSE agent_id END,
      agent_profile_id = CASE WHEN p_lead_patch ? 'agent_id' THEN v_agent_profile_id ELSE agent_profile_id END,
      agent_name = CASE WHEN p_lead_patch ? 'agent_id' THEN coalesce(v_agent.name, 'Unassigned') ELSE agent_name END,
      qc_status = CASE WHEN p_lead_patch ? 'qc_status' THEN trim(p_lead_patch->>'qc_status') ELSE qc_status END,
      qc_reason = CASE WHEN p_lead_patch ? 'qc_reason' THEN nullif(trim(p_lead_patch->>'qc_reason'), '') ELSE qc_reason END,
      qc_notes = CASE WHEN p_lead_patch ? 'qc_notes' THEN nullif(trim(p_lead_patch->>'qc_notes'), '') ELSE qc_notes END,
      qc_reviewed_by = CASE WHEN p_lead_patch ? 'qc_status' THEN v_actor_id ELSE qc_reviewed_by END,
      qc_reviewed_at = CASE WHEN p_lead_patch ? 'qc_status' THEN now() ELSE qc_reviewed_at END,
      recording_url = CASE WHEN p_lead_patch ? 'recording_url' THEN nullif(trim(p_lead_patch->>'recording_url'), '') ELSE recording_url END,
      share_recording_with_company = CASE WHEN p_lead_patch ? 'share_recording_with_company' THEN (p_lead_patch->>'share_recording_with_company')::boolean ELSE share_recording_with_company END,
      updated_at = now()
  WHERE id = p_lead_id
  RETURNING * INTO v_new_lead;

  IF v_old_appt.id IS NOT NULL
     AND (p_appointment_patch <> '{}'::jsonb OR v_company_changed OR v_location_changed) THEN
    v_new_date := CASE WHEN p_appointment_patch ? 'appointment_date' THEN (p_appointment_patch->>'appointment_date')::date ELSE v_old_appt.appointment_date END;
    v_new_start := CASE WHEN p_appointment_patch ? 'start_time' THEN (p_appointment_patch->>'start_time')::time ELSE v_old_appt.start_time END;
    v_duration := v_old_appt.end_time - v_old_appt.start_time;
    IF v_duration <= interval '0 minutes' THEN v_duration := interval '60 minutes'; END IF;
    v_new_end := (v_new_start + v_duration)::time;

    IF v_new_date IS DISTINCT FROM v_old_appt.appointment_date
       OR v_new_start IS DISTINCT FROM v_old_appt.start_time
       OR v_company_changed OR v_location_changed THEN
      INSERT INTO public.appointment_reschedule_history (
        company_id, appointment_id, lead_id,
        old_appointment_date, old_start_time, old_end_time,
        new_appointment_date, new_start_time, new_end_time,
        reason, changed_by, old_company_id, new_company_id,
        old_location_id, new_location_id
      ) VALUES (
        v_company_id, v_old_appt.id, v_old_lead.id,
        v_old_appt.appointment_date, v_old_appt.start_time, v_old_appt.end_time,
        v_new_date, v_new_start, v_new_end,
        'Admin CRM correction', v_actor_id, v_old_lead.company_id, v_company_id,
        v_old_lead.location_id, v_location_id
      );
    END IF;

    UPDATE public.portal_appointments
    SET company_id = v_company_id,
        location_id = v_location_id,
        representative_id = CASE WHEN v_company_changed OR v_location_changed THEN NULL ELSE representative_id END,
        company_visible_at = CASE WHEN v_company_changed THEN NULL ELSE company_visible_at END,
        appointment_date = v_new_date,
        start_time = v_new_start,
        end_time = v_new_end,
        status = CASE WHEN p_appointment_patch ? 'status' THEN nullif(trim(p_appointment_patch->>'status'), '') ELSE status END,
        client_status = CASE WHEN p_appointment_patch ? 'client_status' THEN nullif(trim(p_appointment_patch->>'client_status'), '') ELSE client_status END,
        attendance_status = CASE WHEN p_appointment_patch ? 'attendance_status' THEN nullif(trim(p_appointment_patch->>'attendance_status'), '') ELSE attendance_status END,
        inspection_status = CASE WHEN p_appointment_patch ? 'inspection_status' THEN nullif(trim(p_appointment_patch->>'inspection_status'), '') ELSE inspection_status END,
        sales_outcome = CASE WHEN p_appointment_patch ? 'sales_outcome' THEN nullif(trim(p_appointment_patch->>'sales_outcome'), '') ELSE sales_outcome END,
        inspector_notes = CASE WHEN p_appointment_patch ? 'inspector_notes' THEN nullif(trim(p_appointment_patch->>'inspector_notes'), '') ELSE inspector_notes END,
        company_action = CASE WHEN p_appointment_patch ? 'company_action' THEN nullif(trim(p_appointment_patch->>'company_action'), '') ELSE company_action END,
        updated_at = now()
    WHERE id = v_old_appt.id
    RETURNING * INTO v_new_appt;
  ELSIF p_appointment_patch <> '{}'::jsonb THEN
    RAISE EXCEPTION 'This lead does not have an appointment to edit';
  ELSE
    v_new_appt := v_old_appt;
  END IF;

  UPDATE public.qc_review_cycles
  SET company_id = v_company_id,
      location_id = v_location_id,
      status = CASE WHEN p_lead_patch ? 'qc_status' THEN trim(p_lead_patch->>'qc_status') ELSE status END,
      reason = CASE WHEN p_lead_patch ? 'qc_reason' THEN nullif(trim(p_lead_patch->>'qc_reason'), '') ELSE reason END,
      notes = CASE WHEN p_lead_patch ? 'qc_notes' THEN nullif(trim(p_lead_patch->>'qc_notes'), '') ELSE notes END,
      reviewer_id = CASE WHEN p_lead_patch ? 'qc_status' THEN v_actor_id ELSE reviewer_id END,
      completed_at = CASE
        WHEN p_lead_patch->>'qc_status' IN ('approved', 'denied') THEN now()
        WHEN p_lead_patch ? 'qc_status' THEN NULL
        ELSE completed_at
      END,
      updated_at = now()
  WHERE lead_id = p_lead_id AND is_current;

  PERFORM public.portal_write_audit(
    v_new_lead.company_id,
    'admin',
    v_actor_id,
    public.portal_actor_name_for_management(),
    'admin_lead_crm_edited',
    'lead',
    v_new_lead.id,
    jsonb_build_object('lead', to_jsonb(v_old_lead), 'appointment', CASE WHEN v_old_appt.id IS NULL THEN NULL ELSE to_jsonb(v_old_appt) END),
    jsonb_build_object('lead', to_jsonb(v_new_lead), 'appointment', CASE WHEN v_new_appt.id IS NULL THEN NULL ELSE to_jsonb(v_new_appt) END),
    jsonb_build_object(
      'lead_fields', coalesce(p_lead_patch, '{}'::jsonb),
      'appointment_fields', coalesce(p_appointment_patch, '{}'::jsonb),
      'company_reassigned', v_company_changed
    )
  );

  RETURN jsonb_build_object(
    'lead', to_jsonb(v_new_lead),
    'appointment', CASE WHEN v_new_appt.id IS NULL THEN NULL ELSE to_jsonb(v_new_appt) END
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_update_lead_crm(uuid, jsonb, jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_lead_crm(uuid, jsonb, jsonb)
  TO authenticated;

COMMENT ON FUNCTION public.admin_update_lead_crm(uuid, jsonb, jsonb)
IS 'Admin-only audited editing of all shared lead business fields, including denied leads and safe company reassignment.';

COMMIT;


