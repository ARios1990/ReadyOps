-- Imported from the hosted ReadyOp Supabase migration history on 2026-08-28.
-- Schema only: no production table data is included.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_public_booking_portal(
  p_slug text,
  p_location_id uuid,
  p_start_date date,
  p_end_date date
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_company public.roster_companies%ROWTYPE;
  v_settings public.company_portal_settings%ROWTYPE;
  v_date date;
  v_rule public.company_schedule_rules%ROWTYPE;
  v_slot_ts timestamp;
  v_slot_end time;
  v_slot_used integer;
  v_day_booked integer;
  v_day_reserved integer;
  v_daily_remaining integer;
  v_slot_open integer;
  v_open_sum integer;
  v_slots jsonb;
  v_days jsonb := '[]'::jsonb;
  v_day_closed boolean;
  v_location_valid boolean;
BEGIN
  IF p_end_date < p_start_date OR p_end_date > p_start_date + 31 THEN
    RAISE EXCEPTION 'Availability range must be between 1 and 32 days';
  END IF;

  SELECT c.*
  INTO v_company
  FROM public.roster_companies c
  JOIN public.company_portal_settings s ON s.company_id = c.id
  WHERE s.public_slug = p_slug
    AND s.portal_enabled
    AND c.account_status = 'Active';

  IF v_company.id IS NOT NULL THEN
    SELECT s.* INTO v_settings
    FROM public.company_portal_settings s
    WHERE s.company_id = v_company.id;
  END IF;

  IF v_company.id IS NULL THEN
    RAISE EXCEPTION 'Company booking page was not found or is disabled';
  END IF;

  IF p_location_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.company_locations l
      WHERE l.id = p_location_id AND l.company_id = v_company.id
    ) INTO v_location_valid;
    IF NOT v_location_valid THEN
      RAISE EXCEPTION 'Invalid service area';
    END IF;
  END IF;

  FOR v_date IN SELECT generate_series(p_start_date, p_end_date, interval '1 day')::date LOOP
    v_rule := public.portal_find_rule(v_company.id, p_location_id, extract(dow FROM v_date)::integer);
    v_slots := '[]'::jsonb;
    v_open_sum := 0;
    v_day_closed := v_rule.id IS NULL OR NOT v_rule.is_open OR EXISTS (
      SELECT 1 FROM public.company_schedule_exceptions e
      WHERE e.company_id = v_company.id
        AND e.exception_date = v_date
        AND (e.location_id IS NULL OR e.location_id = p_location_id)
        AND e.is_closed
    );

    SELECT count(*) INTO v_day_booked
    FROM public.portal_appointments a
    WHERE a.company_id = v_company.id
      AND a.location_id IS NOT DISTINCT FROM p_location_id
      AND a.appointment_date = v_date
      AND a.status NOT IN ('cancelled','rescheduled');

    SELECT count(*) INTO v_day_reserved
    FROM public.appointment_reservations r
    WHERE r.company_id = v_company.id
      AND r.location_id IS NOT DISTINCT FROM p_location_id
      AND r.appointment_date = v_date
      AND r.status = 'active'
      AND r.expires_at > now();

    IF NOT v_day_closed THEN
      v_daily_remaining := greatest(v_rule.max_per_day - v_day_booked - v_day_reserved, 0);

      FOR v_slot_ts IN
        SELECT generate_series(
          v_date + v_rule.start_time,
          v_date + v_rule.end_time - make_interval(mins => v_rule.slot_minutes),
          make_interval(mins => v_rule.slot_minutes)
        )
      LOOP
        v_slot_end := (v_slot_ts::time + make_interval(mins => v_rule.slot_minutes))::time;

        SELECT
          (
            SELECT count(*) FROM public.portal_appointments a
            WHERE a.company_id = v_company.id
              AND a.location_id IS NOT DISTINCT FROM p_location_id
              AND a.appointment_date = v_date
              AND a.start_time = v_slot_ts::time
              AND a.status NOT IN ('cancelled','rescheduled')
          )
          +
          (
            SELECT count(*) FROM public.appointment_reservations r
            WHERE r.company_id = v_company.id
              AND r.location_id IS NOT DISTINCT FROM p_location_id
              AND r.appointment_date = v_date
              AND r.start_time = v_slot_ts::time
              AND r.status = 'active'
              AND r.expires_at > now()
          )
        INTO v_slot_used;

        IF public.portal_slot_is_blocked(v_company.id, p_location_id, v_date, v_slot_ts::time, v_slot_end) THEN
          v_slot_open := 0;
          v_slots := v_slots || jsonb_build_array(jsonb_build_object(
            'start_time', to_char(v_slot_ts, 'HH24:MI'),
            'end_time', to_char(v_slot_end, 'HH24:MI'),
            'status', 'blocked',
            'openings', 0
          ));
        ELSE
          v_slot_open := greatest(v_rule.max_per_slot - v_slot_used, 0);
          IF v_daily_remaining = 0 THEN
            v_slot_open := 0;
          END IF;
          v_open_sum := v_open_sum + v_slot_open;
          v_slots := v_slots || jsonb_build_array(jsonb_build_object(
            'start_time', to_char(v_slot_ts, 'HH24:MI'),
            'end_time', to_char(v_slot_end, 'HH24:MI'),
            'status', CASE WHEN v_slot_open > 0 THEN 'available' ELSE 'booked' END,
            'openings', v_slot_open
          ));
        END IF;
      END LOOP;

      v_open_sum := least(v_open_sum, v_daily_remaining);
    ELSE
      v_daily_remaining := 0;
      v_open_sum := 0;
    END IF;

    v_days := v_days || jsonb_build_array(jsonb_build_object(
      'date', v_date,
      'day_name', trim(to_char(v_date, 'Day')),
      'closed', v_day_closed,
      'openings', v_open_sum,
      'booked', v_day_booked,
      'reserved', v_day_reserved,
      'capacity', CASE WHEN v_rule.id IS NULL THEN 0 ELSE v_rule.max_per_day END,
      'slots', v_slots
    ));
  END LOOP;

  RETURN jsonb_build_object(
    'company', jsonb_build_object(
      'id', v_company.id,
      'name', v_company.name,
      'state', v_company.state,
      'website', v_company.website,
      'phone', v_company.phone,
      'public_slug', v_settings.public_slug
    ),
    'settings', jsonb_build_object(
      'timezone', v_settings.timezone,
      'requirements_short', v_settings.requirements_short,
      'requirements_detail', v_settings.requirements_detail,
      'qualification_rules', v_settings.qualification_rules,
      'form_mode', v_settings.form_mode,
      'form_schema', v_settings.form_schema,
      'external_form_provider', v_settings.external_form_provider,
      'external_form_url', v_settings.external_form_url,
      'external_prefill_map', v_settings.external_prefill_map,
      'allow_public_booking', v_settings.allow_public_booking
    ),
    'locations', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', l.id,
        'label', l.location_label,
        'state', l.state
      ) ORDER BY l.sort_order, l.location_label)
      FROM public.company_locations l
      WHERE l.company_id = v_company.id
    ), '[]'::jsonb),
    'selected_location_id', p_location_id,
    'days', v_days
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.reserve_public_appointment_slot(
  p_slug text,
  p_location_id uuid,
  p_date date,
  p_start_time text,
  p_session_id uuid,
  p_agent_name text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_company_id uuid;
  v_settings public.company_portal_settings%ROWTYPE;
  v_rule public.company_schedule_rules%ROWTYPE;
  v_res public.appointment_reservations%ROWTYPE;
  v_start time;
BEGIN
  SELECT s.* INTO v_settings
  FROM public.company_portal_settings s
  JOIN public.roster_companies c ON c.id = s.company_id
  WHERE s.public_slug = p_slug
    AND s.portal_enabled
    AND s.allow_public_booking
    AND c.account_status = 'Active';

  v_company_id := v_settings.company_id;

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Public booking is disabled for this company';
  END IF;

  IF p_session_id IS NULL THEN
    RAISE EXCEPTION 'A valid booking session is required';
  END IF;

  v_start := p_start_time::time;
  v_rule := public.portal_assert_slot_capacity(v_company_id, p_location_id, p_date, v_start, NULL, NULL);

  INSERT INTO public.appointment_reservations(
    company_id, location_id, appointment_date, start_time, end_time,
    session_id, agent_name, status, last_action, undo_deadline, expires_at
  ) VALUES (
    v_company_id, p_location_id, p_date, v_start,
    (v_start + make_interval(mins => v_rule.slot_minutes))::time,
    p_session_id, coalesce(nullif(trim(p_agent_name), ''), 'Agent'),
    'active', 'reserve', now() + interval '45 seconds', now() + interval '10 minutes'
  ) RETURNING * INTO v_res;

  PERFORM public.portal_write_audit(
    v_company_id, 'agent', NULL, v_res.agent_name,
    'reservation_created', 'reservation', v_res.id,
    NULL,
    jsonb_build_object('date', v_res.appointment_date, 'start_time', v_res.start_time, 'location_id', v_res.location_id),
    jsonb_build_object('reservation_token', v_res.reservation_token)
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

CREATE OR REPLACE FUNCTION public.undo_public_reservation_action(
  p_reservation_token uuid,
  p_session_id uuid
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
  IF v_res.undo_deadline < now() THEN
    RAISE EXCEPTION 'The 45-second undo window has expired';
  END IF;

  v_old := jsonb_build_object(
    'date', v_res.appointment_date,
    'start_time', v_res.start_time,
    'location_id', v_res.location_id,
    'last_action', v_res.last_action
  );

  IF v_res.last_action = 'reserve' THEN
    UPDATE public.appointment_reservations
    SET status = 'released'
    WHERE id = v_res.id
    RETURNING * INTO v_res;

    PERFORM public.portal_write_audit(
      v_res.company_id, 'agent', NULL, v_res.agent_name,
      'reservation_undone', 'reservation', v_res.id,
      v_old, jsonb_build_object('status','released'), '{}'::jsonb
    );

    RETURN jsonb_build_object('status','released','id',v_res.id);
  END IF;

  IF v_res.last_action = 'move' AND v_res.previous_appointment_date IS NOT NULL AND v_res.previous_start_time IS NOT NULL THEN
    v_rule := public.portal_assert_slot_capacity(
      v_res.company_id,
      v_res.previous_location_id,
      v_res.previous_appointment_date,
      v_res.previous_start_time,
      v_res.id,
      NULL
    );

    UPDATE public.appointment_reservations
    SET
      location_id = previous_location_id,
      appointment_date = previous_appointment_date,
      start_time = previous_start_time,
      end_time = previous_end_time,
      previous_location_id = NULL,
      previous_appointment_date = NULL,
      previous_start_time = NULL,
      previous_end_time = NULL,
      last_action = 'undo_move',
      undo_deadline = now(),
      expires_at = greatest(expires_at, now() + interval '10 minutes')
    WHERE id = v_res.id
    RETURNING * INTO v_res;

    PERFORM public.portal_write_audit(
      v_res.company_id, 'agent', NULL, v_res.agent_name,
      'reservation_move_undone', 'reservation', v_res.id,
      v_old,
      jsonb_build_object('date',v_res.appointment_date,'start_time',v_res.start_time,'location_id',v_res.location_id),
      '{}'::jsonb
    );

    RETURN jsonb_build_object(
      'status','active',
      'id',v_res.id,
      'reservation_token',v_res.reservation_token,
      'appointment_date',v_res.appointment_date,
      'start_time',to_char(v_res.start_time,'HH24:MI'),
      'end_time',to_char(v_res.end_time,'HH24:MI'),
      'location_id',v_res.location_id,
      'last_action',v_res.last_action,
      'undo_deadline',v_res.undo_deadline,
      'expires_at',v_res.expires_at
    );
  END IF;

  RAISE EXCEPTION 'There is no reversible reservation action';
END;
$$;

COMMIT;
