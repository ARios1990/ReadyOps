BEGIN;

ALTER TABLE public.company_locations
  ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_company_locations_company_active
  ON public.company_locations(company_id, active, sort_order);

CREATE TABLE IF NOT EXISTS public.company_package_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id uuid NOT NULL REFERENCES public.company_packages(id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES public.company_locations(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(package_id, location_id)
);

ALTER TABLE public.company_package_locations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS company_package_locations_admin_all ON public.company_package_locations;
CREATE POLICY company_package_locations_admin_all
ON public.company_package_locations
FOR ALL TO authenticated
USING (public.portal_is_admin())
WITH CHECK (public.portal_is_admin());

DROP POLICY IF EXISTS company_package_locations_qc_select ON public.company_package_locations;
CREATE POLICY company_package_locations_qc_select
ON public.company_package_locations
FOR SELECT TO authenticated
USING (public.portal_is_qc_or_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.company_package_locations TO authenticated;

CREATE INDEX IF NOT EXISTS idx_company_package_locations_package
  ON public.company_package_locations(package_id);
CREATE INDEX IF NOT EXISTS idx_company_package_locations_location
  ON public.company_package_locations(location_id);

CREATE OR REPLACE FUNCTION public.portal_active_package_for_location(
  p_company_id uuid,
  p_location_id uuid
)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT cp.id
  FROM public.company_packages AS cp
  WHERE cp.company_id = p_company_id
    AND cp.status = 'active'
    AND (
      NOT EXISTS (
        SELECT 1
        FROM public.company_package_locations AS any_scope
        WHERE any_scope.package_id = cp.id
      )
      OR EXISTS (
        SELECT 1
        FROM public.company_package_locations AS selected_scope
        WHERE selected_scope.package_id = cp.id
          AND selected_scope.location_id = p_location_id
      )
    )
  ORDER BY cp.start_date DESC, cp.created_at DESC
  LIMIT 1;
$function$;

REVOKE ALL ON FUNCTION public.portal_active_package_for_location(uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.apply_location_package_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF NEW.package_id IS NULL THEN
    NEW.package_id := public.portal_active_package_for_location(NEW.company_id, NEW.location_id);
  ELSIF NOT EXISTS (
    SELECT 1
    FROM public.company_packages AS cp
    WHERE cp.id = NEW.package_id
      AND cp.company_id = NEW.company_id
      AND (
        NOT EXISTS (
          SELECT 1 FROM public.company_package_locations AS any_scope
          WHERE any_scope.package_id = cp.id
        )
        OR EXISTS (
          SELECT 1 FROM public.company_package_locations AS selected_scope
          WHERE selected_scope.package_id = cp.id
            AND selected_scope.location_id = NEW.location_id
        )
      )
  ) THEN
    NEW.package_id := public.portal_active_package_for_location(NEW.company_id, NEW.location_id);
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.apply_location_package_scope() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS portal_leads_apply_location_package_scope ON public.portal_leads;
CREATE TRIGGER portal_leads_apply_location_package_scope
BEFORE INSERT OR UPDATE OF company_id, location_id, package_id
ON public.portal_leads
FOR EACH ROW
EXECUTE FUNCTION public.apply_location_package_scope();

CREATE OR REPLACE FUNCTION public.create_location_scoped_company_package(
  p_company_id uuid,
  p_lead_target integer,
  p_amount_per_lead numeric,
  p_package_total numeric,
  p_payment_date date,
  p_payment_status text,
  p_package_name text,
  p_location_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_package jsonb;
  v_package_id uuid;
BEGIN
  IF NOT public.portal_is_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  IF EXISTS (
    SELECT requested.location_id
    FROM unnest(coalesce(p_location_ids, '{}'::uuid[])) AS requested(location_id)
    EXCEPT
    SELECT location.id
    FROM public.company_locations AS location
    WHERE location.company_id = p_company_id
      AND location.active
  ) THEN
    RAISE EXCEPTION 'Every selected location must be active and belong to the company';
  END IF;

  v_package := public.create_company_package(
    p_company_id,
    p_lead_target,
    p_amount_per_lead,
    p_package_total,
    p_payment_date,
    p_payment_status,
    p_package_name
  );
  v_package_id := (v_package->>'id')::uuid;

  INSERT INTO public.company_package_locations(package_id, location_id)
  SELECT v_package_id, selected.location_id
  FROM (
    SELECT DISTINCT unnest(coalesce(p_location_ids, '{}'::uuid[])) AS location_id
  ) AS selected;

  RETURN v_package || jsonb_build_object(
    'location_ids', coalesce(to_jsonb(p_location_ids), '[]'::jsonb),
    'all_locations', cardinality(coalesce(p_location_ids, '{}'::uuid[])) = 0
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.create_location_scoped_company_package(uuid, integer, numeric, numeric, date, text, text, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_location_scoped_company_package(uuid, integer, numeric, numeric, date, text, text, uuid[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.portal_slot_is_blocked(
  p_company_id uuid,
  p_location_id uuid,
  p_date date,
  p_start time without time zone,
  p_end time without time zone
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT
    EXISTS (
      SELECT 1
      FROM public.company_locations AS l
      WHERE l.id = p_location_id
        AND l.company_id = p_company_id
        AND (
          NOT l.active
          OR NOT (trim(to_char(p_date, 'Day')) = ANY(l.available_days))
          OR p_start < l.start_time
          OR p_end > l.end_time
        )
    )
    OR EXISTS (
      SELECT 1
      FROM public.company_schedule_exceptions AS e
      WHERE e.company_id = p_company_id
        AND e.exception_date = p_date
        AND (e.location_id IS NULL OR e.location_id = p_location_id)
        AND (
          e.is_closed
          OR (
            e.start_time IS NOT NULL
            AND e.end_time IS NOT NULL
            AND p_start < e.end_time
            AND p_end > e.start_time
          )
        )
    )
    OR EXISTS (
      SELECT 1
      FROM public.company_bookings AS b
      WHERE b.company_id = p_company_id
        AND b.day = trim(to_char(p_date, 'Day'))
        AND b.time_slot = to_char(p_start, 'FMHH12')
        AND extract(minute FROM p_start) = 0
        AND (b.location_id IS NULL OR b.location_id = p_location_id)
    );
$function$;

CREATE OR REPLACE FUNCTION public.portal_assert_slot_capacity(
  p_company_id uuid,
  p_location_id uuid,
  p_date date,
  p_start time without time zone,
  p_exclude_reservation_id uuid DEFAULT NULL,
  p_exclude_appointment_id uuid DEFAULT NULL
)
RETURNS public.company_schedule_rules
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'pg_temp'
AS $function$
DECLARE
  v_rule public.company_schedule_rules%ROWTYPE;
  v_slot_used integer;
  v_hour_used integer;
  v_day_used integer;
  v_location_max_hour integer;
  v_location_max_day integer;
  v_lock_key text;
BEGIN
  v_rule := public.portal_validate_slot(p_company_id, p_location_id, p_date, p_start);
  v_lock_key := p_company_id::text || ':' || coalesce(p_location_id::text, 'all') || ':' || p_date::text || ':' || p_start::text;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_lock_key, 0));
  PERFORM public.portal_expire_reservations();

  SELECT location.max_per_hour, location.max_per_day
  INTO v_location_max_hour, v_location_max_day
  FROM public.company_locations AS location
  WHERE location.id = p_location_id
    AND location.company_id = p_company_id
    AND location.active;

  SELECT
    (SELECT count(*) FROM public.portal_appointments AS appointment
      WHERE appointment.company_id = p_company_id
        AND appointment.location_id IS NOT DISTINCT FROM p_location_id
        AND appointment.appointment_date = p_date
        AND appointment.start_time = p_start
        AND appointment.status NOT IN ('cancelled', 'rescheduled', 'qc_denied')
        AND (p_exclude_appointment_id IS NULL OR appointment.id <> p_exclude_appointment_id))
    +
    (SELECT count(*) FROM public.appointment_reservations AS reservation
      WHERE reservation.company_id = p_company_id
        AND reservation.location_id IS NOT DISTINCT FROM p_location_id
        AND reservation.appointment_date = p_date
        AND reservation.start_time = p_start
        AND reservation.status = 'active'
        AND reservation.expires_at > now()
        AND (p_exclude_reservation_id IS NULL OR reservation.id <> p_exclude_reservation_id))
  INTO v_slot_used;

  SELECT
    (SELECT count(*) FROM public.portal_appointments AS appointment
      WHERE appointment.company_id = p_company_id
        AND appointment.location_id IS NOT DISTINCT FROM p_location_id
        AND appointment.appointment_date = p_date
        AND extract(hour FROM appointment.start_time) = extract(hour FROM p_start)
        AND appointment.status NOT IN ('cancelled', 'rescheduled', 'qc_denied')
        AND (p_exclude_appointment_id IS NULL OR appointment.id <> p_exclude_appointment_id))
    +
    (SELECT count(*) FROM public.appointment_reservations AS reservation
      WHERE reservation.company_id = p_company_id
        AND reservation.location_id IS NOT DISTINCT FROM p_location_id
        AND reservation.appointment_date = p_date
        AND extract(hour FROM reservation.start_time) = extract(hour FROM p_start)
        AND reservation.status = 'active'
        AND reservation.expires_at > now()
        AND (p_exclude_reservation_id IS NULL OR reservation.id <> p_exclude_reservation_id))
  INTO v_hour_used;

  SELECT
    (SELECT count(*) FROM public.portal_appointments AS appointment
      WHERE appointment.company_id = p_company_id
        AND appointment.location_id IS NOT DISTINCT FROM p_location_id
        AND appointment.appointment_date = p_date
        AND appointment.status NOT IN ('cancelled', 'rescheduled', 'qc_denied')
        AND (p_exclude_appointment_id IS NULL OR appointment.id <> p_exclude_appointment_id))
    +
    (SELECT count(*) FROM public.appointment_reservations AS reservation
      WHERE reservation.company_id = p_company_id
        AND reservation.location_id IS NOT DISTINCT FROM p_location_id
        AND reservation.appointment_date = p_date
        AND reservation.status = 'active'
        AND reservation.expires_at > now()
        AND (p_exclude_reservation_id IS NULL OR reservation.id <> p_exclude_reservation_id))
  INTO v_day_used;

  IF v_slot_used >= v_rule.max_per_slot THEN
    RAISE EXCEPTION 'This appointment time was just taken. Please select another opening.';
  END IF;
  IF v_location_max_hour IS NOT NULL AND v_hour_used >= v_location_max_hour THEN
    RAISE EXCEPTION 'This location has reached its hourly appointment capacity.';
  END IF;
  IF v_day_used >= coalesce(v_location_max_day, v_rule.max_per_day) THEN
    RAISE EXCEPTION 'This day has reached its appointment capacity.';
  END IF;
  RETURN v_rule;
END;
$function$;

COMMENT ON TABLE public.company_package_locations IS
  'Optional package scope. No rows means all company locations; rows mean only the selected locations.';

COMMIT;
