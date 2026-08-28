-- Imported from the hosted ReadyOp Supabase migration history on 2026-08-28.
-- Schema only: no production table data is included.

BEGIN;

CREATE OR REPLACE FUNCTION public.portal_is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.role = 'admin'
  );
$$;

CREATE OR REPLACE FUNCTION public.portal_resolve_company_access(
  p_company_id uuid,
  p_access_token uuid
)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_company_id uuid;
BEGIN
  IF p_company_id IS NOT NULL AND public.portal_is_admin() THEN
    RETURN p_company_id;
  END IF;

  SELECT s.company_id
  INTO v_company_id
  FROM public.company_portal_settings s
  WHERE s.company_access_enabled
    AND s.company_access_token = p_access_token;

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Invalid or disabled company access link';
  END IF;

  RETURN v_company_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.portal_write_audit(
  p_company_id uuid,
  p_actor_type text,
  p_actor_id uuid,
  p_actor_name text,
  p_action text,
  p_entity_type text,
  p_entity_id uuid,
  p_old_value jsonb DEFAULT NULL,
  p_new_value jsonb DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  INSERT INTO public.portal_audit_logs(
    company_id, actor_type, actor_id, actor_name, action,
    entity_type, entity_id, old_value, new_value, metadata
  ) VALUES (
    p_company_id, p_actor_type, p_actor_id, coalesce(nullif(p_actor_name, ''), 'System'), p_action,
    p_entity_type, p_entity_id, p_old_value, p_new_value, coalesce(p_metadata, '{}'::jsonb)
  );
$$;

CREATE OR REPLACE FUNCTION public.portal_actor_type_for_management(p_access_token uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE WHEN public.portal_is_admin() AND p_access_token IS NULL THEN 'masters_admin' ELSE 'company_admin' END;
$$;

CREATE OR REPLACE FUNCTION public.portal_actor_name_for_management()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT coalesce(
    (SELECT nullif(p.display_name, '') FROM public.profiles p WHERE p.id = auth.uid()),
    'Company Admin'
  );
$$;

CREATE OR REPLACE FUNCTION public.portal_find_rule(
  p_company_id uuid,
  p_location_id uuid,
  p_day_of_week integer
)
RETURNS public.company_schedule_rules
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_rule public.company_schedule_rules%ROWTYPE;
BEGIN
  IF p_location_id IS NOT NULL THEN
    SELECT * INTO v_rule
    FROM public.company_schedule_rules r
    WHERE r.company_id = p_company_id
      AND r.location_id = p_location_id
      AND r.day_of_week = p_day_of_week
    LIMIT 1;
  END IF;

  IF v_rule.id IS NULL THEN
    SELECT * INTO v_rule
    FROM public.company_schedule_rules r
    WHERE r.company_id = p_company_id
      AND r.location_id IS NULL
      AND r.day_of_week = p_day_of_week
    LIMIT 1;
  END IF;

  RETURN v_rule;
END;
$$;

CREATE OR REPLACE FUNCTION public.portal_slot_is_blocked(
  p_company_id uuid,
  p_location_id uuid,
  p_date date,
  p_start time,
  p_end time
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.company_schedule_exceptions e
    WHERE e.company_id = p_company_id
      AND e.exception_date = p_date
      AND (e.location_id IS NULL OR e.location_id = p_location_id)
      AND (
        e.is_closed
        OR (e.start_time IS NOT NULL AND e.end_time IS NOT NULL AND p_start < e.end_time AND p_end > e.start_time)
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.portal_validate_slot(
  p_company_id uuid,
  p_location_id uuid,
  p_date date,
  p_start time
)
RETURNS public.company_schedule_rules
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_rule public.company_schedule_rules%ROWTYPE;
  v_end time;
  v_start_minutes integer;
  v_rule_start_minutes integer;
BEGIN
  IF p_date < current_date THEN
    RAISE EXCEPTION 'Past appointment dates are not available';
  END IF;

  v_rule := public.portal_find_rule(p_company_id, p_location_id, extract(dow FROM p_date)::integer);
  IF v_rule.id IS NULL OR NOT v_rule.is_open THEN
    RAISE EXCEPTION 'The company is closed on this date';
  END IF;

  v_end := (p_start + make_interval(mins => v_rule.slot_minutes))::time;
  IF p_start < v_rule.start_time OR v_end > v_rule.end_time THEN
    RAISE EXCEPTION 'The requested time is outside company hours';
  END IF;

  v_start_minutes := extract(hour FROM p_start)::integer * 60 + extract(minute FROM p_start)::integer;
  v_rule_start_minutes := extract(hour FROM v_rule.start_time)::integer * 60 + extract(minute FROM v_rule.start_time)::integer;
  IF mod(v_start_minutes - v_rule_start_minutes, v_rule.slot_minutes) <> 0 THEN
    RAISE EXCEPTION 'The requested time does not match the company appointment interval';
  END IF;

  IF public.portal_slot_is_blocked(p_company_id, p_location_id, p_date, p_start, v_end) THEN
    RAISE EXCEPTION 'The requested time is blocked';
  END IF;

  RETURN v_rule;
END;
$$;

CREATE OR REPLACE FUNCTION public.portal_expire_reservations()
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE public.appointment_reservations
  SET status = 'expired'
  WHERE status = 'active' AND expires_at <= now();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.portal_assert_slot_capacity(
  p_company_id uuid,
  p_location_id uuid,
  p_date date,
  p_start time,
  p_exclude_reservation_id uuid DEFAULT NULL,
  p_exclude_appointment_id uuid DEFAULT NULL
)
RETURNS public.company_schedule_rules
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_rule public.company_schedule_rules%ROWTYPE;
  v_slot_used integer;
  v_day_used integer;
  v_lock_key text;
BEGIN
  v_rule := public.portal_validate_slot(p_company_id, p_location_id, p_date, p_start);

  v_lock_key := p_company_id::text || ':' || coalesce(p_location_id::text, 'all') || ':' || p_date::text || ':' || p_start::text;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_lock_key, 0));
  PERFORM public.portal_expire_reservations();

  SELECT
    (
      SELECT count(*)
      FROM public.portal_appointments a
      WHERE a.company_id = p_company_id
        AND a.location_id IS NOT DISTINCT FROM p_location_id
        AND a.appointment_date = p_date
        AND a.start_time = p_start
        AND a.status NOT IN ('cancelled','rescheduled')
        AND (p_exclude_appointment_id IS NULL OR a.id <> p_exclude_appointment_id)
    )
    +
    (
      SELECT count(*)
      FROM public.appointment_reservations r
      WHERE r.company_id = p_company_id
        AND r.location_id IS NOT DISTINCT FROM p_location_id
        AND r.appointment_date = p_date
        AND r.start_time = p_start
        AND r.status = 'active'
        AND r.expires_at > now()
        AND (p_exclude_reservation_id IS NULL OR r.id <> p_exclude_reservation_id)
    )
  INTO v_slot_used;

  SELECT
    (
      SELECT count(*)
      FROM public.portal_appointments a
      WHERE a.company_id = p_company_id
        AND a.location_id IS NOT DISTINCT FROM p_location_id
        AND a.appointment_date = p_date
        AND a.status NOT IN ('cancelled','rescheduled')
        AND (p_exclude_appointment_id IS NULL OR a.id <> p_exclude_appointment_id)
    )
    +
    (
      SELECT count(*)
      FROM public.appointment_reservations r
      WHERE r.company_id = p_company_id
        AND r.location_id IS NOT DISTINCT FROM p_location_id
        AND r.appointment_date = p_date
        AND r.status = 'active'
        AND r.expires_at > now()
        AND (p_exclude_reservation_id IS NULL OR r.id <> p_exclude_reservation_id)
    )
  INTO v_day_used;

  IF v_slot_used >= v_rule.max_per_slot THEN
    RAISE EXCEPTION 'This appointment time was just taken. Please select another opening.';
  END IF;

  IF v_day_used >= v_rule.max_per_day THEN
    RAISE EXCEPTION 'This day has reached its appointment capacity.';
  END IF;

  RETURN v_rule;
END;
$$;

COMMIT;
