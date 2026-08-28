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
      'form_data', 'agent_id'
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

  v_form := coalesce(v_old_lead.form_data, '{}'::jsonb) || coalesce(p_lead_patch->'form_data', '{}'::jsonb);
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
  SET full_name = CASE WHEN p_lead_patch ? 'full_name' THEN trim(p_lead_patch->>'full_name') ELSE full_name END,
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
      form_data = v_form,
      agent_id = CASE WHEN p_lead_patch ? 'agent_id' THEN v_agent_id ELSE agent_id END,
      agent_profile_id = CASE WHEN p_lead_patch ? 'agent_id' THEN v_agent_profile_id ELSE agent_profile_id END,
      agent_name = CASE WHEN p_lead_patch ? 'agent_id' THEN v_agent.name ELSE agent_name END,
      updated_at = now()
  WHERE id = p_lead_id
  RETURNING * INTO v_new_lead;

  IF p_appointment_patch <> '{}'::jsonb THEN
    IF v_old_appt.id IS NULL THEN RAISE EXCEPTION 'This lead does not have an appointment to edit'; END IF;
    v_new_date := CASE WHEN p_appointment_patch ? 'appointment_date' THEN (p_appointment_patch->>'appointment_date')::date ELSE v_old_appt.appointment_date END;
    v_new_start := CASE WHEN p_appointment_patch ? 'start_time' THEN (p_appointment_patch->>'start_time')::time ELSE v_old_appt.start_time END;
    v_duration := v_old_appt.end_time - v_old_appt.start_time;
    IF v_duration <= interval '0 minutes' THEN v_duration := interval '60 minutes'; END IF;
    v_new_end := (v_new_start + v_duration)::time;

    IF v_new_date IS DISTINCT FROM v_old_appt.appointment_date OR v_new_start IS DISTINCT FROM v_old_appt.start_time THEN
      INSERT INTO public.appointment_reschedule_history (
        company_id, appointment_id, lead_id,
        old_appointment_date, old_start_time, old_end_time,
        new_appointment_date, new_start_time, new_end_time,
        reason, changed_by, old_company_id, new_company_id,
        old_location_id, new_location_id
      ) VALUES (
        v_old_lead.company_id, v_old_appt.id, v_old_lead.id,
        v_old_appt.appointment_date, v_old_appt.start_time, v_old_appt.end_time,
        v_new_date, v_new_start, v_new_end,
        'Admin CRM correction', v_actor_id, v_old_lead.company_id, v_old_lead.company_id,
        v_old_lead.location_id, v_old_lead.location_id
      );
    END IF;

    UPDATE public.portal_appointments
    SET appointment_date = v_new_date,
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
  ELSE
    v_new_appt := v_old_appt;
  END IF;

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
    jsonb_build_object('lead_fields', coalesce(p_lead_patch, '{}'::jsonb), 'appointment_fields', coalesce(p_appointment_patch, '{}'::jsonb))
  );

  RETURN jsonb_build_object('lead', to_jsonb(v_new_lead), 'appointment', CASE WHEN v_new_appt.id IS NULL THEN NULL ELSE to_jsonb(v_new_appt) END);
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_update_lead_crm(uuid, jsonb, jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_lead_crm(uuid, jsonb, jsonb)
  TO authenticated;

COMMENT ON FUNCTION public.admin_update_lead_crm(uuid, jsonb, jsonb)
IS 'Admin-only audited update of the shared canonical lead and appointment records used by QC and company portals.';

CREATE OR REPLACE FUNCTION public.get_company_lead_spreadsheet(
  p_company_id uuid,
  p_access_token uuid,
  p_filter text DEFAULT 'all',
  p_search text DEFAULT NULL,
  p_limit integer DEFAULT 100,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_company_id uuid;
  v_filter text := lower(trim(coalesce(p_filter, 'all')));
  v_search text := trim(coalesce(p_search, ''));
  v_digits text := regexp_replace(coalesce(p_search, ''), '[^0-9]', '', 'g');
  v_limit integer := least(greatest(coalesce(p_limit, 100), 10), 200);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
BEGIN
  v_company_id := public.portal_resolve_company_access(p_company_id, p_access_token);
  IF v_filter NOT IN ('all', 'good', 'no_show', 'rescheduled', 'signed_contract', 'pending') THEN
    RAISE EXCEPTION 'Invalid company lead filter';
  END IF;

  RETURN (
    WITH base AS MATERIALIZED (
      SELECT a.*, l.id AS source_lead_id_internal, l.lead_code, l.full_name, l.phone_number,
        l.email, l.address, l.city, l.state AS lead_state, l.zip_code, l.service_needed,
        l.language, l.notes, l.form_data, l.qualification_status, l.recording_url,
        l.share_recording_with_company, l.created_at AS lead_created_at,
        loc.location_label, rep.name AS representative_name
      FROM public.portal_appointments AS a
      JOIN public.portal_leads AS l ON l.id = a.lead_id
      LEFT JOIN public.company_locations AS loc ON loc.id = a.location_id
      LEFT JOIN public.company_representatives AS rep ON rep.id = a.representative_id
      WHERE a.company_id = v_company_id
        AND l.qc_status = 'approved'
        AND a.company_visible_at IS NOT NULL
    ),
    filtered AS MATERIALIZED (
      SELECT * FROM base AS b
      WHERE (
        v_filter = 'all'
        OR (v_filter = 'good' AND (b.canonical_status = 'good_inspected' OR b.company_action = 'inspected'))
        OR (v_filter = 'no_show' AND (b.canonical_status = 'no_show' OR b.client_status = 'no_show' OR b.company_action = 'no_show'))
        OR (v_filter = 'rescheduled' AND (b.canonical_status = 'rescheduled' OR b.client_status = 'reschedule' OR b.company_action = 'rescheduled'))
        OR (v_filter = 'signed_contract' AND (b.canonical_status = 'signed_contract' OR b.sales_outcome = 'signed_contract' OR b.company_action = 'signed_contract'))
        OR (v_filter = 'pending' AND coalesce(b.company_action, 'pending') = 'pending')
      )
      AND (
        v_search = ''
        OR concat_ws(' ', b.lead_code, b.full_name, b.phone_number, b.email, b.address,
          b.city, b.lead_state, b.zip_code, b.service_needed, b.representative_name)
          ILIKE '%' || v_search || '%'
        OR (length(v_digits) >= 4 AND regexp_replace(coalesce(b.phone_number, ''), '[^0-9]', '', 'g') LIKE '%' || v_digits || '%')
      )
    ),
    paged AS (
      SELECT * FROM filtered
      ORDER BY appointment_date DESC, start_time DESC, lead_created_at DESC
      LIMIT v_limit OFFSET v_offset
    )
    SELECT jsonb_build_object(
      'total', (SELECT count(*) FROM filtered),
      'limit', v_limit,
      'offset', v_offset,
      'summary', jsonb_build_object(
        'delivered', (SELECT count(*) FROM base),
        'good', (SELECT count(*) FROM base WHERE canonical_status = 'good_inspected' OR company_action = 'inspected'),
        'no_show', (SELECT count(*) FROM base WHERE canonical_status = 'no_show' OR client_status = 'no_show' OR company_action = 'no_show'),
        'rescheduled', (SELECT count(*) FROM base WHERE canonical_status = 'rescheduled' OR client_status = 'reschedule' OR company_action = 'rescheduled'),
        'signed_contract', (SELECT count(*) FROM base WHERE canonical_status = 'signed_contract' OR sales_outcome = 'signed_contract' OR company_action = 'signed_contract'),
        'pending', (SELECT count(*) FROM base WHERE coalesce(company_action, 'pending') = 'pending')
      ),
      'rows', coalesce((
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', p.id, 'lead_id', p.lead_id, 'company_id', p.company_id,
            'location_id', p.location_id, 'representative_id', p.representative_id,
            'appointment_date', p.appointment_date, 'start_time', p.start_time,
            'end_time', p.end_time, 'timezone', p.timezone, 'status', p.status,
            'canonical_status', p.canonical_status, 'rep_status', p.rep_status,
            'attendance_status', p.attendance_status, 'inspection_status', p.inspection_status,
            'sales_outcome', p.sales_outcome, 'client_status', p.client_status,
            'company_action', p.company_action, 'inspector_notes', p.inspector_notes,
            'company_visible_at', p.company_visible_at, 'last_company_update_at', p.last_company_update_at,
            'lead', jsonb_build_object(
              'id', p.source_lead_id_internal, 'lead_code', p.lead_code, 'full_name', p.full_name,
              'phone_number', p.phone_number, 'email', p.email, 'address', p.address,
              'city', p.city, 'state', p.lead_state, 'zip_code', p.zip_code,
              'service_needed', p.service_needed, 'language', p.language, 'notes', p.notes,
              'form_data', coalesce(p.form_data, '{}'::jsonb) - 'recording_url' - 'recording' - 'audio_url' - 'call_recording' - 'recording_link',
              'qualification_status', p.qualification_status,
              'recording_url', CASE WHEN p.share_recording_with_company THEN p.recording_url ELSE NULL END,
              'recording_shared', p.share_recording_with_company,
              'created_at', p.lead_created_at
            ),
            'location_label', p.location_label,
            'representative_name', p.representative_name,
            'latest_checkin', NULL
          )
          ORDER BY p.appointment_date DESC, p.start_time DESC, p.lead_created_at DESC
        ) FROM paged AS p
      ), '[]'::jsonb)
    )
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_company_lead_spreadsheet(uuid, uuid, text, text, integer, integer)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_company_lead_spreadsheet(uuid, uuid, text, text, integer, integer)
  TO anon, authenticated;

COMMENT ON FUNCTION public.get_company_lead_spreadsheet(uuid, uuid, text, text, integer, integer)
IS 'Token-scoped all-history spreadsheet of only the approved leads delivered to one company.';

COMMIT;


