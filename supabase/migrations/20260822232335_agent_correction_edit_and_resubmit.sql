-- Imported from the hosted ReadyOp Supabase migration history on 2026-08-28.
-- Schema only: no production table data is included.

-- Allow an agent using their private portal link to reopen only their own lead
-- while its current QC cycle is in Needs Correction, edit the original form,
-- and resubmit the same lead/appointment to QC.

CREATE OR REPLACE FUNCTION public.get_agent_correction(
  p_access_token uuid,
  p_lead_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_agent public.agents%ROWTYPE;
  v_lead public.portal_leads%ROWTYPE;
  v_appointment public.portal_appointments%ROWTYPE;
  v_cycle public.qc_review_cycles%ROWTYPE;
  v_company public.roster_companies%ROWTYPE;
  v_settings public.company_portal_settings%ROWTYPE;
  v_values jsonb;
BEGIN
  SELECT *
  INTO v_agent
  FROM public.agents AS agent
  WHERE agent.access_token = p_access_token
    AND agent.active;

  IF v_agent.id IS NULL THEN
    RAISE EXCEPTION 'Agent link is invalid or disabled';
  END IF;

  SELECT *
  INTO v_lead
  FROM public.portal_leads AS lead
  WHERE lead.id = p_lead_id
    AND lead.agent_id = v_agent.id;

  SELECT *
  INTO v_cycle
  FROM public.qc_review_cycles AS cycle
  WHERE cycle.lead_id = p_lead_id
    AND cycle.is_current;

  IF v_lead.id IS NULL
     OR v_cycle.id IS NULL
     OR v_lead.qc_status <> 'needs_correction'
     OR v_cycle.status <> 'needs_correction' THEN
    RAISE EXCEPTION 'This lead is not available for correction';
  END IF;

  SELECT *
  INTO v_appointment
  FROM public.portal_appointments AS appointment
  WHERE appointment.lead_id = p_lead_id;

  SELECT *
  INTO v_company
  FROM public.roster_companies AS company
  WHERE company.id = v_lead.company_id;

  SELECT *
  INTO v_settings
  FROM public.company_portal_settings AS settings
  WHERE settings.company_id = v_lead.company_id;

  v_values := coalesce(v_lead.form_data, '{}'::jsonb)
    || jsonb_strip_nulls(jsonb_build_object(
      'service_needed', v_lead.service_needed,
      'full_name', v_lead.full_name,
      'phone_number', v_lead.phone_number,
      'address', v_lead.address,
      'city', v_lead.city,
      'state', v_lead.state,
      'zip_code', v_lead.zip_code,
      'email', v_lead.email,
      'language', v_lead.language,
      'notes', v_lead.notes,
      'home_value', v_lead.home_value,
      'sq_ft', v_lead.sq_ft,
      'web_url', v_lead.web_url,
      'property_latitude', v_lead.property_latitude,
      'property_longitude', v_lead.property_longitude,
      'recording_url', v_lead.recording_url
    ));

  RETURN jsonb_build_object(
    'lead_id', v_lead.id,
    'lead_code', v_lead.lead_code,
    'company_id', v_company.id,
    'company_name', v_company.name,
    'company_slug', v_settings.public_slug,
    'appointment_id', v_appointment.id,
    'appointment_date', v_appointment.appointment_date,
    'start_time', to_char(v_appointment.start_time, 'HH24:MI'),
    'end_time', to_char(v_appointment.end_time, 'HH24:MI'),
    'correction_reason', coalesce(v_cycle.reason, v_lead.qc_reason),
    'correction_attempt', v_cycle.correction_attempt,
    'form_schema', coalesce(v_settings.form_schema, public.portal_default_form_schema()),
    'values', v_values
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.agent_resubmit_correction(
  p_access_token uuid,
  p_lead_id uuid,
  p_form_data jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_agent public.agents%ROWTYPE;
  v_lead public.portal_leads%ROWTYPE;
  v_appointment public.portal_appointments%ROWTYPE;
  v_cycle public.qc_review_cycles%ROWTYPE;
  v_settings public.company_portal_settings%ROWTYPE;
  v_qualification jsonb;
  v_form_data jsonb;
  v_sq_ft integer;
  v_home_value numeric;
  v_recording_url text;
BEGIN
  IF jsonb_typeof(p_form_data) <> 'object' THEN
    RAISE EXCEPTION 'Correction form data must be a JSON object';
  END IF;

  SELECT *
  INTO v_agent
  FROM public.agents AS agent
  WHERE agent.access_token = p_access_token
    AND agent.active;

  IF v_agent.id IS NULL THEN
    RAISE EXCEPTION 'Agent link is invalid or disabled';
  END IF;

  SELECT *
  INTO v_lead
  FROM public.portal_leads AS lead
  WHERE lead.id = p_lead_id
    AND lead.agent_id = v_agent.id
  FOR UPDATE;

  SELECT *
  INTO v_cycle
  FROM public.qc_review_cycles AS cycle
  WHERE cycle.lead_id = p_lead_id
    AND cycle.is_current
  FOR UPDATE;

  IF v_lead.id IS NULL
     OR v_cycle.id IS NULL
     OR v_lead.qc_status <> 'needs_correction'
     OR v_cycle.status <> 'needs_correction' THEN
    RAISE EXCEPTION 'This lead is not available for correction';
  END IF;

  IF nullif(trim(coalesce(p_form_data->>'full_name', '')), '') IS NULL
     OR nullif(trim(coalesce(p_form_data->>'phone_number', '')), '') IS NULL
     OR nullif(trim(coalesce(p_form_data->>'address', '')), '') IS NULL THEN
    RAISE EXCEPTION 'Full name, phone number and address are required';
  END IF;

  SELECT *
  INTO v_settings
  FROM public.company_portal_settings AS settings
  WHERE settings.company_id = v_lead.company_id;

  v_form_data := coalesce(v_lead.form_data, '{}'::jsonb) || p_form_data;
  v_qualification := public.portal_evaluate_qualification(v_settings.qualification_rules, v_form_data);
  v_sq_ft := nullif(regexp_replace(coalesce(p_form_data->>'sq_ft', ''), '[^0-9]', '', 'g'), '')::integer;
  v_home_value := nullif(regexp_replace(coalesce(p_form_data->>'home_value', ''), '[^0-9.]', '', 'g'), '')::numeric;
  v_recording_url := nullif(trim(coalesce(
    p_form_data->>'recording_url',
    p_form_data->>'recording',
    p_form_data->>'audio_url',
    p_form_data->>'call_recording',
    p_form_data->>'recording_link',
    ''
  )), '');

  UPDATE public.portal_leads
  SET service_needed = nullif(trim(coalesce(p_form_data->>'service_needed', '')), ''),
      full_name = trim(p_form_data->>'full_name'),
      phone_number = trim(p_form_data->>'phone_number'),
      address = trim(p_form_data->>'address'),
      city = nullif(trim(coalesce(p_form_data->>'city', '')), ''),
      state = nullif(trim(coalesce(p_form_data->>'state', '')), ''),
      zip_code = nullif(trim(coalesce(p_form_data->>'zip_code', '')), ''),
      email = nullif(lower(trim(coalesce(p_form_data->>'email', ''))), ''),
      language = nullif(trim(coalesce(p_form_data->>'language', '')), ''),
      notes = nullif(trim(coalesce(p_form_data->>'notes', '')), ''),
      home_value = v_home_value,
      sq_ft = v_sq_ft,
      web_url = nullif(trim(coalesce(p_form_data->>'web_url', '')), ''),
      property_latitude = nullif(p_form_data->>'property_latitude', '')::double precision,
      property_longitude = nullif(p_form_data->>'property_longitude', '')::double precision,
      recording_url = v_recording_url,
      form_data = v_form_data,
      qualification_status = v_qualification->>'status',
      qualification_reasons = v_qualification->'reasons',
      qc_status = 'pending',
      qc_reviewed_by = NULL,
      qc_reviewed_at = NULL,
      updated_at = now()
  WHERE id = p_lead_id;

  UPDATE public.qc_review_cycles
  SET status = 'pending',
      assigned_to = NULL,
      reviewer_id = NULL,
      correction_assignee_id = NULL,
      started_at = NULL,
      completed_at = NULL,
      updated_at = now()
  WHERE id = v_cycle.id
  RETURNING * INTO v_cycle;

  UPDATE public.portal_appointments
  SET status = 'qc_pending',
      representative_id = NULL,
      company_visible_at = NULL,
      updated_at = now()
  WHERE lead_id = p_lead_id
  RETURNING * INTO v_appointment;

  INSERT INTO public.portal_audit_logs (
    company_id,
    actor_type,
    actor_id,
    actor_name,
    action,
    entity_type,
    entity_id,
    old_value,
    new_value,
    metadata
  ) VALUES (
    v_lead.company_id,
    'agent',
    NULL,
    v_agent.name,
    'qc_correction_resubmitted',
    'lead',
    p_lead_id,
    jsonb_build_object('qc_status', 'needs_correction', 'form_data', v_lead.form_data),
    jsonb_build_object('qc_status', 'pending', 'form_data', v_form_data),
    jsonb_build_object(
      'appointment_id', v_appointment.id,
      'qc_review_id', v_cycle.id,
      'correction_attempt', v_cycle.correction_attempt,
      'agent_id', v_agent.id,
      'source', 'agent_portal'
    )
  );

  RETURN jsonb_build_object(
    'lead_id', p_lead_id,
    'lead_code', v_lead.lead_code,
    'appointment_id', v_appointment.id,
    'qc_status', 'pending',
    'appointment_status', 'qc_pending',
    'correction_attempt', v_cycle.correction_attempt,
    'message', 'Correction submitted to QC'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_agent_correction(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_agent_correction(uuid, uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_agent_correction(uuid, uuid) TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.agent_resubmit_correction(uuid, uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.agent_resubmit_correction(uuid, uuid, jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent_resubmit_correction(uuid, uuid, jsonb) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.get_agent_correction(uuid, uuid)
IS 'Returns the original editable company form for an agent-owned lead that is currently in Needs Correction.';

COMMENT ON FUNCTION public.agent_resubmit_correction(uuid, uuid, jsonb)
IS 'Updates the same agent-owned lead through a private portal token and returns its current QC cycle to Pending.';

-- QC approval and client delivery are deliberately separate. A manager can
-- submit to final QC, and Admin/Main QC can approve, but approval alone never
-- makes the appointment company-visible or count as delivered.
CREATE OR REPLACE FUNCTION public.qc_review_lead(
  p_lead_id uuid,
  p_decision text,
  p_reason text DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_lead public.portal_leads%ROWTYPE;
  v_appt public.portal_appointments%ROWTYPE;
  v_cycle public.qc_review_cycles%ROWTYPE;
  v_role text := private.readyops_profile_role();
  v_effective_decision text;
  v_correction_assignee uuid;
BEGIN
  IF p_decision NOT IN ('approved', 'denied', 'needs_correction') THEN
    RAISE EXCEPTION 'Decision must be approved, denied, or needs_correction';
  END IF;
  IF p_decision IN ('denied', 'needs_correction')
     AND nullif(trim(coalesce(p_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'A reason is required for this QC decision';
  END IF;
  IF v_role NOT IN ('admin', 'qc', 'manager') THEN
    RAISE EXCEPTION 'QC reviewer access required';
  END IF;
  IF NOT private.readyops_can_review_lead(p_lead_id) THEN
    RAISE EXCEPTION 'QC reviewer access required for this team';
  END IF;

  v_effective_decision := CASE
    WHEN v_role = 'manager' AND p_decision = 'approved' THEN 'manager_approved'
    ELSE p_decision
  END;

  SELECT * INTO v_lead
  FROM public.portal_leads
  WHERE id = p_lead_id
  FOR UPDATE;
  IF v_lead.id IS NULL THEN RAISE EXCEPTION 'Lead not found'; END IF;

  SELECT * INTO v_appt
  FROM public.portal_appointments
  WHERE lead_id = p_lead_id
  FOR UPDATE;

  SELECT * INTO v_cycle
  FROM public.qc_review_cycles
  WHERE lead_id = p_lead_id AND is_current
  FOR UPDATE;

  IF v_appt.id IS NULL OR v_cycle.id IS NULL THEN
    RAISE EXCEPTION 'Appointment or active QC cycle not found';
  END IF;
  IF v_role = 'manager' AND v_cycle.status = 'manager_approved' THEN
    RAISE EXCEPTION 'This lead is already waiting for final QC';
  END IF;

  v_correction_assignee := v_lead.agent_profile_id;
  IF v_correction_assignee IS NULL THEN
    SELECT profile.id
    INTO v_correction_assignee
    FROM public.profiles AS profile
    WHERE profile.agent_id = v_lead.agent_id
    LIMIT 1;
  END IF;

  UPDATE public.qc_review_cycles
  SET status = v_effective_decision,
      reviewer_id = (SELECT auth.uid()),
      started_at = coalesce(started_at, now()),
      completed_at = CASE WHEN v_effective_decision IN ('approved', 'denied') THEN now() ELSE NULL END,
      correction_assignee_id = CASE WHEN v_effective_decision = 'needs_correction' THEN v_correction_assignee ELSE NULL END,
      correction_attempt = correction_attempt + CASE WHEN v_effective_decision = 'needs_correction' THEN 1 ELSE 0 END,
      reason = nullif(trim(coalesce(p_reason, '')), ''),
      notes = nullif(trim(coalesce(p_notes, '')), ''),
      updated_at = now()
  WHERE id = v_cycle.id
  RETURNING * INTO v_cycle;

  UPDATE public.portal_leads
  SET qc_status = v_effective_decision,
      qc_reason = nullif(trim(coalesce(p_reason, '')), ''),
      qc_notes = nullif(trim(coalesce(p_notes, '')), ''),
      qc_reviewed_by = (SELECT auth.uid()),
      qc_reviewed_at = now(),
      updated_at = now()
  WHERE id = p_lead_id
  RETURNING * INTO v_lead;

  IF v_effective_decision = 'denied' THEN
    UPDATE public.portal_appointments
    SET status = 'qc_denied',
        company_visible_at = NULL,
        representative_id = NULL,
        rep_status = 'unassigned',
        updated_at = now()
    WHERE id = v_appt.id
    RETURNING * INTO v_appt;
  ELSE
    UPDATE public.portal_appointments
    SET status = 'qc_pending',
        company_visible_at = NULL,
        updated_at = now()
    WHERE id = v_appt.id
    RETURNING * INTO v_appt;
  END IF;

  PERFORM public.portal_write_audit(
    v_lead.company_id,
    v_role,
    (SELECT auth.uid()),
    public.portal_actor_name_for_management(),
    CASE v_effective_decision
      WHEN 'manager_approved' THEN 'manager_qc_submitted'
      WHEN 'approved' THEN 'qc_approved_awaiting_send'
      WHEN 'denied' THEN 'qc_denied'
      ELSE 'qc_correction_requested'
    END,
    'lead',
    v_lead.id,
    NULL,
    jsonb_build_object(
      'qc_status', v_effective_decision,
      'reason', p_reason,
      'appointment_status', v_appt.status
    ),
    jsonb_build_object(
      'appointment_id', v_appt.id,
      'qc_review_id', v_cycle.id,
      'correction_assignee_id', v_cycle.correction_assignee_id,
      'correction_attempt', v_cycle.correction_attempt,
      'released_to_company', false,
      'awaiting_admin_send', v_effective_decision = 'approved'
    )
  );

  RETURN jsonb_build_object(
    'lead', to_jsonb(v_lead),
    'appointment', to_jsonb(v_appt),
    'qc_review', to_jsonb(v_cycle),
    'released_to_company', false,
    'awaiting_admin_send', v_effective_decision = 'approved',
    'same_day_notification_queued', false
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.qc_send_lead_to_client(p_lead_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_lead public.portal_leads%ROWTYPE;
  v_appt public.portal_appointments%ROWTYPE;
  v_cycle public.qc_review_cycles%ROWTYPE;
  v_today date;
  v_same_day boolean := false;
  v_role text := private.readyops_profile_role();
BEGIN
  IF v_role <> 'admin' THEN
    RAISE EXCEPTION 'Only an Admin can send approved leads to clients';
  END IF;

  SELECT * INTO v_lead
  FROM public.portal_leads
  WHERE id = p_lead_id
  FOR UPDATE;

  SELECT * INTO v_appt
  FROM public.portal_appointments
  WHERE lead_id = p_lead_id
  FOR UPDATE;

  SELECT * INTO v_cycle
  FROM public.qc_review_cycles
  WHERE lead_id = p_lead_id AND is_current
  FOR UPDATE;

  IF v_lead.id IS NULL OR v_appt.id IS NULL OR v_cycle.id IS NULL THEN
    RAISE EXCEPTION 'Lead, appointment, or active QC cycle not found';
  END IF;
  IF v_lead.qc_status <> 'approved' OR v_cycle.status <> 'approved' THEN
    RAISE EXCEPTION 'The lead must be QC Approved before it can be sent';
  END IF;

  IF v_appt.company_visible_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'lead_id', v_lead.id,
      'appointment_id', v_appt.id,
      'released_to_company', true,
      'already_sent', true,
      'same_day_notification_queued', false
    );
  END IF;

  IF v_lead.package_id IS NULL THEN
    UPDATE public.portal_leads
    SET package_id = public.portal_active_package(v_lead.company_id),
        updated_at = now()
    WHERE id = v_lead.id
    RETURNING * INTO v_lead;
  END IF;

  UPDATE public.portal_appointments
  SET status = CASE WHEN representative_id IS NULL THEN 'confirmed' ELSE 'assigned' END,
      company_visible_at = now(),
      updated_at = now()
  WHERE id = v_appt.id
  RETURNING * INTO v_appt;

  PERFORM public.portal_complete_package_if_filled(v_lead.package_id);

  SELECT (now() AT TIME ZONE coalesce((
    SELECT settings.timezone
    FROM public.company_portal_settings AS settings
    WHERE settings.company_id = v_lead.company_id
  ), 'America/Chicago'))::date
  INTO v_today;

  v_same_day := v_appt.appointment_date = v_today;
  IF v_same_day AND NOT EXISTS (
    SELECT 1
    FROM public.company_notification_batches AS batch
    WHERE batch.notification_type = 'same_day'
      AND v_lead.id = ANY (batch.lead_ids)
      AND batch.status IN ('queued', 'sent')
  ) THEN
    INSERT INTO public.company_notification_batches (
      company_id,
      notification_date,
      notification_type,
      status,
      recipient_email,
      lead_ids,
      lead_count,
      created_by
    )
    SELECT v_lead.company_id,
      v_today,
      'same_day',
      'queued',
      company.email,
      ARRAY[v_lead.id],
      1,
      (SELECT auth.uid())
    FROM public.roster_companies AS company
    WHERE company.id = v_lead.company_id;
  END IF;

  PERFORM public.portal_write_audit(
    v_lead.company_id,
    v_role,
    (SELECT auth.uid()),
    public.portal_actor_name_for_management(),
    'lead_sent_to_client',
    'lead',
    v_lead.id,
    jsonb_build_object('company_visible_at', NULL, 'appointment_status', 'qc_pending'),
    jsonb_build_object('company_visible_at', v_appt.company_visible_at, 'appointment_status', v_appt.status),
    jsonb_build_object(
      'appointment_id', v_appt.id,
      'qc_review_id', v_cycle.id,
      'package_id', v_lead.package_id,
      'same_day_notification_queued', v_same_day
    )
  );

  RETURN jsonb_build_object(
    'lead_id', v_lead.id,
    'appointment_id', v_appt.id,
    'released_to_company', true,
    'already_sent', false,
    'same_day_notification_queued', v_same_day,
    'company_visible_at', v_appt.company_visible_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.qc_send_lead_to_client(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.qc_send_lead_to_client(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.qc_send_lead_to_client(uuid)
IS 'Admin-only delivery action that makes an already QC-approved lead company-visible and billable.';


