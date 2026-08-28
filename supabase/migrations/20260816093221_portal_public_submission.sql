-- Imported from the hosted ReadyOp Supabase migration history on 2026-08-28.
-- Schema only: no production table data is included.

BEGIN;

CREATE OR REPLACE FUNCTION public.move_public_reservation_slot(
  p_reservation_token uuid,
  p_session_id uuid,
  p_location_id uuid,
  p_date date,
  p_start_time text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_res public.appointment_reservations%ROWTYPE;
  v_old jsonb;
  v_rule public.company_schedule_rules%ROWTYPE;
  v_start time;
BEGIN
  SELECT * INTO v_res
  FROM public.appointment_reservations r
  WHERE r.reservation_token = p_reservation_token
  FOR UPDATE;

  IF v_res.id IS NULL OR v_res.session_id <> p_session_id THEN
    RAISE EXCEPTION 'Reservation was not found for this agent session';
  END IF;
  IF v_res.status <> 'active' OR v_res.expires_at <= now() THEN
    RAISE EXCEPTION 'This reservation is no longer active';
  END IF;

  v_start := p_start_time::time;
  v_rule := public.portal_assert_slot_capacity(v_res.company_id, p_location_id, p_date, v_start, v_res.id, NULL);
  v_old := jsonb_build_object('date',v_res.appointment_date,'start_time',v_res.start_time,'location_id',v_res.location_id);

  UPDATE public.appointment_reservations
  SET
    previous_location_id = location_id,
    previous_appointment_date = appointment_date,
    previous_start_time = start_time,
    previous_end_time = end_time,
    location_id = p_location_id,
    appointment_date = p_date,
    start_time = v_start,
    end_time = (v_start + make_interval(mins => v_rule.slot_minutes))::time,
    last_action = 'move',
    undo_deadline = now() + interval '45 seconds',
    expires_at = now() + interval '10 minutes'
  WHERE id = v_res.id
  RETURNING * INTO v_res;

  PERFORM public.portal_write_audit(
    v_res.company_id, 'agent', NULL, v_res.agent_name,
    'reservation_moved', 'reservation', v_res.id,
    v_old,
    jsonb_build_object('date',v_res.appointment_date,'start_time',v_res.start_time,'location_id',v_res.location_id),
    '{}'::jsonb
  );

  RETURN jsonb_build_object(
    'id', v_res.id,
    'reservation_token', v_res.reservation_token,
    'appointment_date', v_res.appointment_date,
    'start_time', to_char(v_res.start_time, 'HH24:MI'),
    'end_time', to_char(v_res.end_time, 'HH24:MI'),
    'location_id', v_res.location_id,
    'last_action', v_res.last_action,
    'undo_deadline', v_res.undo_deadline,
    'expires_at', v_res.expires_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.portal_evaluate_qualification(
  p_rules jsonb,
  p_form_data jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_reasons jsonb := '[]'::jsonb;
  v_status text := 'qualified';
  v_min_roof integer;
  v_actual_roof integer;
  v_min_sqft integer;
  v_actual_sqft integer;
  v_value text;
  v_allowed jsonb;
BEGIN
  v_min_roof := nullif(p_rules->>'minimum_roof_age','')::integer;
  v_actual_roof := nullif(substring(coalesce(p_form_data->>'roof_age','') FROM '([0-9]+)'), '')::integer;
  IF v_min_roof IS NOT NULL THEN
    IF v_actual_roof IS NULL THEN
      v_status := 'review_needed';
      v_reasons := v_reasons || jsonb_build_array('Roof age needs review');
    ELSIF v_actual_roof < v_min_roof THEN
      v_status := 'do_not_book';
      v_reasons := v_reasons || jsonb_build_array('Roof age is below the company minimum of ' || v_min_roof || ' years');
    END IF;
  END IF;

  v_min_sqft := nullif(p_rules->>'minimum_sq_ft','')::integer;
  v_actual_sqft := nullif(regexp_replace(coalesce(p_form_data->>'sq_ft',''), '[^0-9]', '', 'g'), '')::integer;
  IF v_min_sqft IS NOT NULL THEN
    IF v_actual_sqft IS NULL THEN
      IF v_status = 'qualified' THEN v_status := 'review_needed'; END IF;
      v_reasons := v_reasons || jsonb_build_array('Square footage needs review');
    ELSIF v_actual_sqft < v_min_sqft THEN
      v_status := 'do_not_book';
      v_reasons := v_reasons || jsonb_build_array('Property is below the company minimum of ' || v_min_sqft || ' SQ FT');
    END IF;
  END IF;

  FOREACH v_value IN ARRAY ARRAY['home_type','roof_type','language'] LOOP
    v_allowed := p_rules -> (CASE v_value
      WHEN 'home_type' THEN 'allowed_home_types'
      WHEN 'roof_type' THEN 'allowed_roof_types'
      ELSE 'allowed_languages'
    END);
    IF jsonb_typeof(v_allowed) = 'array' AND jsonb_array_length(v_allowed) > 0 THEN
      IF NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(v_allowed) x
        WHERE lower(x) = lower(coalesce(p_form_data->>v_value,''))
      ) THEN
        v_status := 'do_not_book';
        v_reasons := v_reasons || jsonb_build_array(replace(initcap(v_value), '_', ' ') || ' is not accepted by this company');
      END IF;
    END IF;
  END LOOP;

  IF coalesce((p_rules->>'contract_must_be_no')::boolean, false)
     AND lower(coalesce(p_form_data->>'contract','')) NOT IN ('no','') THEN
    v_status := 'do_not_book';
    v_reasons := v_reasons || jsonb_build_array('Property is already under contract');
  END IF;

  RETURN jsonb_build_object('status',v_status,'reasons',v_reasons);
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_public_appointment(
  p_reservation_token uuid,
  p_session_id uuid,
  p_form_data jsonb,
  p_agent_name text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_res public.appointment_reservations%ROWTYPE;
  v_settings public.company_portal_settings%ROWTYPE;
  v_qualification jsonb;
  v_lead public.portal_leads%ROWTYPE;
  v_appt public.portal_appointments%ROWTYPE;
  v_sqft integer;
  v_home_value numeric;
BEGIN
  SELECT * INTO v_res
  FROM public.appointment_reservations r
  WHERE r.reservation_token = p_reservation_token
  FOR UPDATE;

  IF v_res.id IS NULL OR v_res.session_id <> p_session_id THEN
    RAISE EXCEPTION 'Reservation was not found for this agent session';
  END IF;
  IF v_res.status <> 'active' OR v_res.expires_at <= now() THEN
    RAISE EXCEPTION 'The reservation expired. Please select the time again.';
  END IF;

  SELECT * INTO v_settings FROM public.company_portal_settings WHERE company_id = v_res.company_id;
  v_qualification := public.portal_evaluate_qualification(v_settings.qualification_rules, p_form_data);

  IF coalesce((v_settings.qualification_rules->>'block_disqualified')::boolean, false)
     AND v_qualification->>'status' = 'do_not_book' THEN
    RAISE EXCEPTION 'This lead does not meet the company qualification requirements';
  END IF;

  IF nullif(trim(coalesce(p_form_data->>'full_name','')), '') IS NULL
     OR nullif(trim(coalesce(p_form_data->>'phone_number','')), '') IS NULL
     OR nullif(trim(coalesce(p_form_data->>'address','')), '') IS NULL THEN
    RAISE EXCEPTION 'Full name, phone number and address are required';
  END IF;

  v_sqft := nullif(regexp_replace(coalesce(p_form_data->>'sq_ft',''), '[^0-9]', '', 'g'), '')::integer;
  v_home_value := nullif(regexp_replace(coalesce(p_form_data->>'home_value',''), '[^0-9.]', '', 'g'), '')::numeric;

  INSERT INTO public.portal_leads(
    company_id, location_id, agent_profile_id, agent_name, session_id,
    service_needed, full_name, phone_number, address, city, state, zip_code,
    email, language, notes, home_value, sq_ft, web_url,
    property_latitude, property_longitude, form_data,
    qualification_status, qualification_reasons, external_form_status
  ) VALUES (
    v_res.company_id, v_res.location_id, auth.uid(), coalesce(nullif(trim(p_agent_name),''),v_res.agent_name), p_session_id,
    p_form_data->>'service_needed', trim(p_form_data->>'full_name'), trim(p_form_data->>'phone_number'), trim(p_form_data->>'address'),
    nullif(trim(coalesce(p_form_data->>'city','')),''), nullif(trim(coalesce(p_form_data->>'state','')),''), nullif(trim(coalesce(p_form_data->>'zip_code','')),''),
    nullif(lower(trim(coalesce(p_form_data->>'email',''))),''), nullif(trim(coalesce(p_form_data->>'language','')),''), nullif(trim(coalesce(p_form_data->>'notes','')),''),
    v_home_value, v_sqft, nullif(trim(coalesce(p_form_data->>'web_url','')),''),
    nullif(p_form_data->>'property_latitude','')::double precision, nullif(p_form_data->>'property_longitude','')::double precision,
    p_form_data,
    v_qualification->>'status', v_qualification->'reasons',
    CASE WHEN v_settings.form_mode = 'internal' THEN 'not_required' ELSE 'pending' END
  ) RETURNING * INTO v_lead;

  INSERT INTO public.portal_appointments(
    lead_id, company_id, location_id, appointment_date, start_time, end_time,
    timezone, status, external_form_status
  ) VALUES (
    v_lead.id, v_res.company_id, v_res.location_id, v_res.appointment_date, v_res.start_time, v_res.end_time,
    v_settings.timezone, 'confirmed',
    CASE WHEN v_settings.form_mode = 'internal' THEN 'not_required' ELSE 'pending' END
  ) RETURNING * INTO v_appt;

  UPDATE public.appointment_reservations
  SET status = 'converted', converted_appointment_id = v_appt.id
  WHERE id = v_res.id;

  PERFORM public.portal_write_audit(
    v_res.company_id, 'agent', auth.uid(), v_lead.agent_name,
    'appointment_confirmed', 'appointment', v_appt.id,
    NULL,
    jsonb_build_object(
      'lead_code',v_lead.lead_code,
      'date',v_appt.appointment_date,
      'start_time',v_appt.start_time,
      'qualification_status',v_lead.qualification_status
    ),
    jsonb_build_object('reservation_id',v_res.id)
  );

  RETURN jsonb_build_object(
    'appointment_id', v_appt.id,
    'manage_token', v_appt.manage_token,
    'lead_id', v_lead.id,
    'lead_code', v_lead.lead_code,
    'appointment_date', v_appt.appointment_date,
    'start_time', to_char(v_appt.start_time,'HH24:MI'),
    'end_time', to_char(v_appt.end_time,'HH24:MI'),
    'qualification_status', v_lead.qualification_status,
    'qualification_reasons', v_lead.qualification_reasons,
    'form_mode', v_settings.form_mode,
    'external_form_provider', v_settings.external_form_provider,
    'external_form_url', v_settings.external_form_url,
    'external_prefill_map', v_settings.external_prefill_map,
    'form_data', v_lead.form_data
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.reschedule_public_appointment(
  p_manage_token uuid,
  p_location_id uuid,
  p_date date,
  p_start_time text,
  p_actor_name text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_appt public.portal_appointments%ROWTYPE;
  v_old jsonb;
  v_rule public.company_schedule_rules%ROWTYPE;
  v_start time;
BEGIN
  SELECT * INTO v_appt
  FROM public.portal_appointments a
  WHERE a.manage_token = p_manage_token
  FOR UPDATE;

  IF v_appt.id IS NULL OR v_appt.status IN ('cancelled','rescheduled') THEN
    RAISE EXCEPTION 'Appointment was not found or cannot be rescheduled';
  END IF;

  v_start := p_start_time::time;
  v_rule := public.portal_assert_slot_capacity(v_appt.company_id, p_location_id, p_date, v_start, NULL, v_appt.id);
  v_old := jsonb_build_object('date',v_appt.appointment_date,'start_time',v_appt.start_time,'location_id',v_appt.location_id);

  UPDATE public.portal_appointments
  SET
    location_id = p_location_id,
    appointment_date = p_date,
    start_time = v_start,
    end_time = (v_start + make_interval(mins => v_rule.slot_minutes))::time,
    status = CASE WHEN representative_id IS NULL THEN 'confirmed' ELSE 'assigned' END
  WHERE id = v_appt.id
  RETURNING * INTO v_appt;

  PERFORM public.portal_write_audit(
    v_appt.company_id, 'agent', NULL, coalesce(nullif(trim(p_actor_name),''),'Agent'),
    'appointment_rescheduled', 'appointment', v_appt.id,
    v_old,
    jsonb_build_object('date',v_appt.appointment_date,'start_time',v_appt.start_time,'location_id',v_appt.location_id),
    '{}'::jsonb
  );

  RETURN jsonb_build_object(
    'appointment_id',v_appt.id,
    'manage_token',v_appt.manage_token,
    'appointment_date',v_appt.appointment_date,
    'start_time',to_char(v_appt.start_time,'HH24:MI'),
    'end_time',to_char(v_appt.end_time,'HH24:MI'),
    'location_id',v_appt.location_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_external_form_opened(
  p_manage_token uuid
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_appt public.portal_appointments%ROWTYPE;
BEGIN
  UPDATE public.portal_appointments
  SET external_form_status = 'opened'
  WHERE manage_token = p_manage_token
    AND external_form_status IN ('pending','failed')
  RETURNING * INTO v_appt;

  IF v_appt.id IS NULL THEN RETURN false; END IF;

  UPDATE public.portal_leads SET external_form_status = 'opened' WHERE id = v_appt.lead_id;
  PERFORM public.portal_write_audit(v_appt.company_id,'agent',NULL,'Agent','external_form_opened','appointment',v_appt.id,NULL,NULL,'{}'::jsonb);
  RETURN true;
END;
$$;

COMMIT;
