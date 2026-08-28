-- Imported from the hosted ReadyOp Supabase migration history on 2026-08-28.
-- Schema only: no production table data is included.

-- Give the public booking form enough location detail to resolve an accurate
-- forecast. The function remains stable, security-definer, and read-only.
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
SET search_path TO 'public', 'pg_temp'
AS $function$
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
        'city', l.city,
        'state', l.state,
        'zip_code', l.zip_code
      ) ORDER BY l.sort_order, l.location_label)
      FROM public.company_locations l
      WHERE l.company_id = v_company.id
    ), '[]'::jsonb),
    'selected_location_id', p_location_id,
    'days', v_days
  );
END;
$function$;


