-- Imported from the hosted ReadyOp Supabase migration history on 2026-08-28.
-- Schema only: no production table data is included.

BEGIN;

CREATE OR REPLACE FUNCTION public.portal_next_lead_code()
RETURNS text
LANGUAGE plpgsql
VOLATILE
AS $$
DECLARE
  v_number bigint;
BEGIN
  v_number := nextval('public.portal_lead_sequence');
  RETURN 'MR-' || to_char(current_date, 'YYYY') || '-' || lpad(v_number::text, 6, '0');
END;
$$;

CREATE TABLE IF NOT EXISTS public.portal_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_code text NOT NULL UNIQUE DEFAULT public.portal_next_lead_code(),
  manage_token uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  company_id uuid NOT NULL REFERENCES public.roster_companies(id) ON DELETE CASCADE,
  location_id uuid REFERENCES public.company_locations(id) ON DELETE SET NULL,
  created_by_profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_by_name text,
  service_needed text,
  full_name text NOT NULL,
  phone_number text NOT NULL,
  email text,
  language text,
  address text NOT NULL,
  city text,
  state text,
  zip_code text,
  property_latitude double precision,
  property_longitude double precision,
  fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  qualification_status text NOT NULL DEFAULT 'review_needed' CHECK (qualification_status IN ('qualified','review_needed','do_not_book')),
  qualification_details jsonb NOT NULL DEFAULT '{}'::jsonb,
  form_mode text NOT NULL DEFAULT 'internal' CHECK (form_mode IN ('internal','external','internal_external')),
  external_form_status text NOT NULL DEFAULT 'not_required' CHECK (external_form_status IN ('not_required','pending','opened','submitted','synced','failed')),
  external_submission_id text,
  external_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.portal_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.roster_companies(id) ON DELETE CASCADE,
  location_id uuid REFERENCES public.company_locations(id) ON DELETE CASCADE,
  appointment_date date NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL,
  session_token uuid NOT NULL,
  created_by_profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_by_name text,
  status text NOT NULL DEFAULT 'temporary' CHECK (status IN ('temporary','released','expired','converted')),
  undo_until timestamptz NOT NULL DEFAULT (now() + interval '45 seconds'),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '10 minutes'),
  released_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_time > start_time)
);

CREATE UNIQUE INDEX IF NOT EXISTS portal_reservations_active_no_location
  ON public.portal_reservations(company_id, appointment_date, start_time)
  WHERE location_id IS NULL AND status IN ('temporary','converted');

CREATE UNIQUE INDEX IF NOT EXISTS portal_reservations_active_location
  ON public.portal_reservations(company_id, location_id, appointment_date, start_time)
  WHERE location_id IS NOT NULL AND status IN ('temporary','converted');

CREATE INDEX IF NOT EXISTS portal_reservations_expiration_idx
  ON public.portal_reservations(status, expires_at);

CREATE TABLE IF NOT EXISTS public.portal_appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  manage_token uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  reservation_id uuid UNIQUE REFERENCES public.portal_reservations(id) ON DELETE SET NULL,
  lead_id uuid NOT NULL UNIQUE REFERENCES public.portal_leads(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.roster_companies(id) ON DELETE CASCADE,
  location_id uuid REFERENCES public.company_locations(id) ON DELETE SET NULL,
  representative_id uuid REFERENCES public.company_representatives(id) ON DELETE SET NULL,
  appointment_date date NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL,
  timezone text NOT NULL DEFAULT 'America/Chicago',
  appointment_status text NOT NULL DEFAULT 'confirmed' CHECK (appointment_status IN ('draft','confirmed','assigned','cancelled','rescheduled','completed')),
  rep_status text NOT NULL DEFAULT 'unassigned' CHECK (rep_status IN ('unassigned','assigned','en_route','arrived','inspection_started','inspection_completed','no_show','homeowner_cancelled','reschedule_requested','follow_up')),
  attendance_status text NOT NULL DEFAULT 'unknown' CHECK (attendance_status IN ('unknown','verified_show','unverified_show','homeowner_no_show','rep_no_show','cancelled')),
  inspection_status text NOT NULL DEFAULT 'pending' CHECK (inspection_status IN ('pending','started','completed','not_completed')),
  sales_outcome text NOT NULL DEFAULT 'pending' CHECK (sales_outcome IN ('pending','signed_contract','follow_up','lost','no_sale')),
  rescheduled_from_date date,
  rescheduled_from_time time,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_time > start_time)
);

CREATE INDEX IF NOT EXISTS portal_appointments_company_date_idx
  ON public.portal_appointments(company_id, appointment_date, start_time);
CREATE INDEX IF NOT EXISTS portal_appointments_rep_date_idx
  ON public.portal_appointments(representative_id, appointment_date, start_time);

CREATE TABLE IF NOT EXISTS public.portal_checkins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id uuid NOT NULL REFERENCES public.portal_appointments(id) ON DELETE CASCADE,
  representative_id uuid NOT NULL REFERENCES public.company_representatives(id) ON DELETE CASCADE,
  latitude double precision NOT NULL,
  longitude double precision NOT NULL,
  accuracy_m double precision,
  property_latitude double precision,
  property_longitude double precision,
  distance_m double precision,
  verification_status text NOT NULL CHECK (verification_status IN ('verified','unverified','property_coordinates_missing','poor_accuracy','outside_window')),
  explanation text,
  checked_in_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS portal_checkins_appointment_idx
  ON public.portal_checkins(appointment_id, checked_in_at DESC);

CREATE TABLE IF NOT EXISTS public.portal_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES public.roster_companies(id) ON DELETE CASCADE,
  actor_profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  actor_role text NOT NULL,
  actor_name text,
  entity_type text NOT NULL,
  entity_id uuid,
  action text NOT NULL,
  field_name text,
  old_value jsonb,
  new_value jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS portal_audit_company_created_idx
  ON public.portal_audit_logs(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS portal_audit_entity_idx
  ON public.portal_audit_logs(entity_type, entity_id, created_at DESC);

DROP TRIGGER IF EXISTS set_portal_leads_updated_at ON public.portal_leads;
CREATE TRIGGER set_portal_leads_updated_at BEFORE UPDATE ON public.portal_leads
FOR EACH ROW EXECUTE FUNCTION public.portal_set_updated_at();
DROP TRIGGER IF EXISTS set_portal_reservations_updated_at ON public.portal_reservations;
CREATE TRIGGER set_portal_reservations_updated_at BEFORE UPDATE ON public.portal_reservations
FOR EACH ROW EXECUTE FUNCTION public.portal_set_updated_at();
DROP TRIGGER IF EXISTS set_portal_appointments_updated_at ON public.portal_appointments;
CREATE TRIGGER set_portal_appointments_updated_at BEFORE UPDATE ON public.portal_appointments
FOR EACH ROW EXECUTE FUNCTION public.portal_set_updated_at();
DROP TRIGGER IF EXISTS set_company_representatives_updated_at ON public.company_representatives;
CREATE TRIGGER set_company_representatives_updated_at BEFORE UPDATE ON public.company_representatives
FOR EACH ROW EXECUTE FUNCTION public.portal_set_updated_at();
DROP TRIGGER IF EXISTS set_company_portal_settings_updated_at ON public.company_portal_settings;
CREATE TRIGGER set_company_portal_settings_updated_at BEFORE UPDATE ON public.company_portal_settings
FOR EACH ROW EXECUTE FUNCTION public.portal_set_updated_at();
DROP TRIGGER IF EXISTS set_company_schedule_rules_updated_at ON public.company_schedule_rules;
CREATE TRIGGER set_company_schedule_rules_updated_at BEFORE UPDATE ON public.company_schedule_rules
FOR EACH ROW EXECUTE FUNCTION public.portal_set_updated_at();

ALTER TABLE public.portal_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_checkins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS portal_leads_admin_all ON public.portal_leads;
CREATE POLICY portal_leads_admin_all ON public.portal_leads FOR ALL TO authenticated
USING (public.is_admin()) WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS portal_reservations_admin_all ON public.portal_reservations;
CREATE POLICY portal_reservations_admin_all ON public.portal_reservations FOR ALL TO authenticated
USING (public.is_admin()) WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS portal_appointments_admin_all ON public.portal_appointments;
CREATE POLICY portal_appointments_admin_all ON public.portal_appointments FOR ALL TO authenticated
USING (public.is_admin()) WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS portal_checkins_admin_all ON public.portal_checkins;
CREATE POLICY portal_checkins_admin_all ON public.portal_checkins FOR ALL TO authenticated
USING (public.is_admin()) WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS portal_audit_admin_select ON public.portal_audit_logs;
CREATE POLICY portal_audit_admin_select ON public.portal_audit_logs FOR SELECT TO authenticated
USING (public.is_admin());
DROP POLICY IF EXISTS portal_audit_admin_insert ON public.portal_audit_logs;
CREATE POLICY portal_audit_admin_insert ON public.portal_audit_logs FOR INSERT TO authenticated
WITH CHECK (public.is_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.portal_leads TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.portal_reservations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.portal_appointments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.portal_checkins TO authenticated;
GRANT SELECT, INSERT ON public.portal_audit_logs TO authenticated;

INSERT INTO public.company_schedule_rules (
  company_id, location_id, day_of_week, is_open, start_time, end_time, slot_minutes, max_per_slot, max_per_day
)
SELECT c.id, NULL, dow, dow <> 0, '09:00'::time, '18:00'::time, 60, 1, 9
FROM public.roster_companies c
CROSS JOIN generate_series(0, 6) AS dow
ON CONFLICT DO NOTHING;

UPDATE public.company_portal_settings s
SET portal_enabled = true,
    requirements_short = COALESCE(NULLIF(s.requirements_short, ''), NULLIF(c.requirements_note, ''), NULLIF(c.notes, ''), '')
FROM public.roster_companies c
WHERE c.id = s.company_id
  AND c.account_status = 'Active';

CREATE OR REPLACE FUNCTION public.portal_expire_reservations()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE public.portal_reservations
  SET status = 'expired', released_at = now()
  WHERE status = 'temporary' AND expires_at <= now();
$$;

CREATE OR REPLACE FUNCTION public.portal_slot_statuses(
  p_company_id uuid,
  p_location_id uuid,
  p_date date
)
RETURNS TABLE (
  slot_start time,
  slot_end time,
  status text,
  booked_count integer,
  capacity integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_rule public.company_schedule_rules%ROWTYPE;
  v_exception public.company_schedule_exceptions%ROWTYPE;
  v_start time;
  v_end time;
  v_daily_count integer := 0;
  v_day_name text;
BEGIN
  PERFORM public.portal_expire_reservations();

  IF p_location_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.company_locations l
    WHERE l.id = p_location_id AND l.company_id = p_company_id
  ) THEN
    RETURN;
  END IF;

  SELECT * INTO v_rule
  FROM public.company_schedule_rules r
  WHERE r.company_id = p_company_id
    AND r.day_of_week = extract(dow FROM p_date)::smallint
    AND (r.location_id = p_location_id OR r.location_id IS NULL)
  ORDER BY (r.location_id IS NOT NULL) DESC
  LIMIT 1;

  IF NOT FOUND OR NOT v_rule.is_open THEN
    RETURN;
  END IF;

  SELECT * INTO v_exception
  FROM public.company_schedule_exceptions e
  WHERE e.company_id = p_company_id
    AND e.exception_date = p_date
    AND (e.location_id = p_location_id OR e.location_id IS NULL)
  ORDER BY (e.location_id IS NOT NULL) DESC
  LIMIT 1;

  IF FOUND AND v_exception.is_closed THEN
    RETURN;
  END IF;

  v_start := COALESCE(v_exception.start_time, v_rule.start_time);
  v_end := COALESCE(v_exception.end_time, v_rule.end_time);
  v_day_name := trim(to_char(p_date, 'Day'));

  SELECT
    (SELECT count(*) FROM public.portal_appointments a
      WHERE a.company_id = p_company_id
        AND a.location_id IS NOT DISTINCT FROM p_location_id
        AND a.appointment_date = p_date
        AND a.appointment_status NOT IN ('cancelled','rescheduled'))
    +
    (SELECT count(*) FROM public.portal_reservations r
      WHERE r.company_id = p_company_id
        AND r.location_id IS NOT DISTINCT FROM p_location_id
        AND r.appointment_date = p_date
        AND r.status = 'temporary'
        AND r.expires_at > now())
  INTO v_daily_count;

  RETURN QUERY
  WITH generated AS (
    SELECT gs::time AS s,
           (gs + make_interval(mins => v_rule.slot_minutes))::time AS e
    FROM generate_series(
      p_date::timestamp + v_start,
      p_date::timestamp + v_end - make_interval(mins => v_rule.slot_minutes),
      make_interval(mins => v_rule.slot_minutes)
    ) AS gs
  ), counts AS (
    SELECT g.s, g.e,
      (
        SELECT count(*) FROM public.portal_appointments a
        WHERE a.company_id = p_company_id
          AND a.location_id IS NOT DISTINCT FROM p_location_id
          AND a.appointment_date = p_date
          AND a.start_time = g.s
          AND a.appointment_status NOT IN ('cancelled','rescheduled')
      )
      +
      (
        SELECT count(*) FROM public.portal_reservations r
        WHERE r.company_id = p_company_id
          AND r.location_id IS NOT DISTINCT FROM p_location_id
          AND r.appointment_date = p_date
          AND r.start_time = g.s
          AND r.status = 'temporary'
          AND r.expires_at > now()
      )
      +
      CASE WHEN EXISTS (
        SELECT 1 FROM public.company_bookings b
        WHERE b.company_id = p_company_id
          AND b.location_id IS NOT DISTINCT FROM p_location_id
          AND b.day = v_day_name
          AND b.time_slot = extract(hour FROM g.s)::integer::text
      ) THEN 1 ELSE 0 END AS cnt
    FROM generated g
  )
  SELECT c.s, c.e,
    CASE
      WHEN p_date < current_date THEN 'past'
      WHEN v_daily_count >= v_rule.max_per_day THEN 'full'
      WHEN c.cnt >= v_rule.max_per_slot THEN 'booked'
      ELSE 'available'
    END,
    c.cnt::integer,
    v_rule.max_per_slot
  FROM counts c
  ORDER BY c.s;
END;
$$;

CREATE OR REPLACE FUNCTION public.portal_get_public_company(p_slug text)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'company', jsonb_build_object(
      'id', c.id,
      'name', c.name,
      'state', c.state,
      'website', c.website,
      'slug', s.public_slug
    ),
    'settings', jsonb_build_object(
      'timezone', s.timezone,
      'requirementsShort', s.requirements_short,
      'requirementsDetail', s.requirements_detail,
      'allowPublicBooking', s.allow_public_booking,
      'formMode', s.form_mode,
      'formSchema', s.form_schema,
      'qualificationRules', s.qualification_rules,
      'externalFormProvider', s.external_form_provider,
      'externalFormUrl', s.external_form_url,
      'externalPrefillMap', s.external_prefill_map
    ),
    'locations', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', l.id,
        'label', l.location_label,
        'state', l.state
      ) ORDER BY l.sort_order, l.location_label)
      FROM public.company_locations l
      WHERE l.company_id = c.id
    ), '[]'::jsonb)
  )
  FROM public.company_portal_settings s
  JOIN public.roster_companies c ON c.id = s.company_id
  WHERE s.public_slug = p_slug
    AND s.portal_enabled = true
    AND c.account_status = 'Active'
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.portal_get_public_week(
  p_slug text,
  p_location_id uuid DEFAULT NULL,
  p_week_start date DEFAULT current_date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_company_id uuid;
  v_week_start date;
  v_result jsonb;
BEGIN
  SELECT s.company_id INTO v_company_id
  FROM public.company_portal_settings s
  JOIN public.roster_companies c ON c.id = s.company_id
  WHERE s.public_slug = p_slug AND s.portal_enabled AND c.account_status = 'Active';

  IF v_company_id IS NULL THEN RETURN NULL; END IF;

  IF p_location_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.company_locations l WHERE l.id = p_location_id AND l.company_id = v_company_id
  ) THEN
    RAISE EXCEPTION 'Invalid service area';
  END IF;

  v_week_start := p_week_start - (extract(isodow FROM p_week_start)::integer - 1);

  SELECT jsonb_agg(
    jsonb_build_object(
      'date', d.day_date,
      'day', trim(to_char(d.day_date, 'Day')),
      'openings', (SELECT count(*) FROM public.portal_slot_statuses(v_company_id, p_location_id, d.day_date) ss WHERE ss.status = 'available'),
      'booked', (SELECT count(*) FROM public.portal_slot_statuses(v_company_id, p_location_id, d.day_date) ss WHERE ss.status IN ('booked','full')),
      'closed', NOT EXISTS (SELECT 1 FROM public.portal_slot_statuses(v_company_id, p_location_id, d.day_date)),
      'slots', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'start', to_char(ss.slot_start, 'HH24:MI'),
          'end', to_char(ss.slot_end, 'HH24:MI'),
          'status', ss.status,
          'bookedCount', ss.booked_count,
          'capacity', ss.capacity
        ) ORDER BY ss.slot_start)
        FROM public.portal_slot_statuses(v_company_id, p_location_id, d.day_date) ss
      ), '[]'::jsonb)
    ) ORDER BY d.day_date
  ) INTO v_result
  FROM (
    SELECT (v_week_start + i)::date AS day_date FROM generate_series(0, 6) i
  ) d;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.portal_reserve_slot(
  p_slug text,
  p_location_id uuid,
  p_date date,
  p_start_time time,
  p_session_token uuid,
  p_created_by_name text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_company_id uuid;
  v_slot record;
  v_reservation public.portal_reservations%ROWTYPE;
  v_profile_id uuid := auth.uid();
BEGIN
  SELECT s.company_id INTO v_company_id
  FROM public.company_portal_settings s
  JOIN public.roster_companies c ON c.id = s.company_id
  WHERE s.public_slug = p_slug
    AND s.portal_enabled
    AND s.allow_public_booking
    AND c.account_status = 'Active';
  IF v_company_id IS NULL THEN RAISE EXCEPTION 'Booking is not available'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_company_id::text || ':' || coalesce(p_location_id::text,'none') || ':' || p_date::text || ':' || p_start_time::text, 0));
  PERFORM public.portal_expire_reservations();

  SELECT * INTO v_slot FROM public.portal_slot_statuses(v_company_id, p_location_id, p_date)
  WHERE slot_start = p_start_time;
  IF NOT FOUND OR v_slot.status <> 'available' THEN
    RAISE EXCEPTION 'This appointment time is no longer available';
  END IF;

  INSERT INTO public.portal_reservations(
    company_id, location_id, appointment_date, start_time, end_time,
    session_token, created_by_profile_id, created_by_name
  ) VALUES (
    v_company_id, p_location_id, p_date, v_slot.slot_start, v_slot.slot_end,
    p_session_token, v_profile_id, nullif(trim(p_created_by_name), '')
  ) RETURNING * INTO v_reservation;

  INSERT INTO public.portal_audit_logs(company_id, actor_profile_id, actor_role, actor_name, entity_type, entity_id, action, new_value)
  VALUES (v_company_id, v_profile_id, 'agent', p_created_by_name, 'reservation', v_reservation.id, 'reservation_created',
    jsonb_build_object('date', p_date, 'startTime', p_start_time, 'undoUntil', v_reservation.undo_until, 'expiresAt', v_reservation.expires_at));

  RETURN jsonb_build_object(
    'reservationId', v_reservation.id,
    'date', v_reservation.appointment_date,
    'start', to_char(v_reservation.start_time, 'HH24:MI'),
    'end', to_char(v_reservation.end_time, 'HH24:MI'),
    'undoUntil', v_reservation.undo_until,
    'expiresAt', v_reservation.expires_at,
    'status', v_reservation.status
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.portal_undo_reservation(
  p_reservation_id uuid,
  p_session_token uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_res public.portal_reservations%ROWTYPE;
BEGIN
  SELECT * INTO v_res FROM public.portal_reservations
  WHERE id = p_reservation_id AND session_token = p_session_token
  FOR UPDATE;
  IF NOT FOUND OR v_res.status <> 'temporary' OR v_res.undo_until < now() THEN RETURN false; END IF;

  UPDATE public.portal_reservations SET status = 'released', released_at = now() WHERE id = v_res.id;
  INSERT INTO public.portal_audit_logs(company_id, actor_profile_id, actor_role, actor_name, entity_type, entity_id, action, old_value, new_value)
  VALUES (v_res.company_id, auth.uid(), 'agent', v_res.created_by_name, 'reservation', v_res.id, 'reservation_undone',
    jsonb_build_object('status','temporary'), jsonb_build_object('status','released'));
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.portal_change_reservation(
  p_reservation_id uuid,
  p_session_token uuid,
  p_new_date date,
  p_new_start_time time
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_old public.portal_reservations%ROWTYPE;
  v_slot record;
  v_new public.portal_reservations%ROWTYPE;
BEGIN
  SELECT * INTO v_old FROM public.portal_reservations
  WHERE id = p_reservation_id AND session_token = p_session_token
  FOR UPDATE;
  IF NOT FOUND OR v_old.status <> 'temporary' OR v_old.expires_at <= now() THEN
    RAISE EXCEPTION 'Reservation is no longer active';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_old.company_id::text || ':' || coalesce(v_old.location_id::text,'none') || ':' || p_new_date::text || ':' || p_new_start_time::text, 0));
  SELECT * INTO v_slot FROM public.portal_slot_statuses(v_old.company_id, v_old.location_id, p_new_date)
  WHERE slot_start = p_new_start_time;
  IF NOT FOUND OR v_slot.status <> 'available' THEN RAISE EXCEPTION 'The new appointment time is unavailable'; END IF;

  INSERT INTO public.portal_reservations(company_id, location_id, appointment_date, start_time, end_time, session_token, created_by_profile_id, created_by_name)
  VALUES (v_old.company_id, v_old.location_id, p_new_date, v_slot.slot_start, v_slot.slot_end, p_session_token, v_old.created_by_profile_id, v_old.created_by_name)
  RETURNING * INTO v_new;

  UPDATE public.portal_reservations SET status='released', released_at=now() WHERE id=v_old.id;
  INSERT INTO public.portal_audit_logs(company_id, actor_profile_id, actor_role, actor_name, entity_type, entity_id, action, old_value, new_value)
  VALUES (v_old.company_id, auth.uid(), 'agent', v_old.created_by_name, 'reservation', v_new.id, 'reservation_time_changed',
    jsonb_build_object('reservationId',v_old.id,'date',v_old.appointment_date,'startTime',v_old.start_time),
    jsonb_build_object('reservationId',v_new.id,'date',v_new.appointment_date,'startTime',v_new.start_time));

  RETURN jsonb_build_object('reservationId',v_new.id,'date',v_new.appointment_date,'start',to_char(v_new.start_time,'HH24:MI'),'end',to_char(v_new.end_time,'HH24:MI'),'undoUntil',v_new.undo_until,'expiresAt',v_new.expires_at,'status',v_new.status);
END;
$$;

CREATE OR REPLACE FUNCTION public.portal_calculate_qualification(p_rules jsonb, p_fields jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_reasons jsonb := '[]'::jsonb;
  v_result text := 'qualified';
  v_roof_age integer;
  v_sq_ft integer;
BEGIN
  v_roof_age := CASE
    WHEN coalesce(p_fields->>'roof_age','') ~ '^\d+' THEN substring(p_fields->>'roof_age' from '^\d+')::integer
    ELSE NULL END;
  v_sq_ft := CASE WHEN coalesce(p_fields->>'sq_ft','') ~ '^\d+' THEN regexp_replace(p_fields->>'sq_ft','[^0-9]','','g')::integer ELSE NULL END;

  IF (p_rules->>'minimum_roof_age') IS NOT NULL AND (p_rules->>'minimum_roof_age') <> ''
     AND (v_roof_age IS NULL OR v_roof_age < (p_rules->>'minimum_roof_age')::integer) THEN
    v_result := 'do_not_book'; v_reasons := v_reasons || jsonb_build_array('Roof age is below the company minimum');
  END IF;
  IF (p_rules->>'minimum_sq_ft') IS NOT NULL AND (p_rules->>'minimum_sq_ft') <> ''
     AND (v_sq_ft IS NULL OR v_sq_ft < (p_rules->>'minimum_sq_ft')::integer) THEN
    v_result := 'do_not_book'; v_reasons := v_reasons || jsonb_build_array('Square footage is below the company minimum');
  END IF;
  IF jsonb_array_length(coalesce(p_rules->'allowed_home_types','[]'::jsonb)) > 0
     AND NOT coalesce(p_rules->'allowed_home_types','[]'::jsonb) ? coalesce(p_fields->>'home_type','') THEN
    v_result := 'do_not_book'; v_reasons := v_reasons || jsonb_build_array('Home type is not accepted');
  END IF;
  IF jsonb_array_length(coalesce(p_rules->'allowed_roof_types','[]'::jsonb)) > 0
     AND NOT coalesce(p_rules->'allowed_roof_types','[]'::jsonb) ? coalesce(p_fields->>'roof_type','') THEN
    v_result := 'do_not_book'; v_reasons := v_reasons || jsonb_build_array('Roof type is not accepted');
  END IF;
  IF jsonb_array_length(coalesce(p_rules->'allowed_languages','[]'::jsonb)) > 0
     AND NOT coalesce(p_rules->'allowed_languages','[]'::jsonb) ? coalesce(p_fields->>'language','') THEN
    v_result := 'do_not_book'; v_reasons := v_reasons || jsonb_build_array('Language is not accepted');
  END IF;
  IF coalesce((p_rules->>'contract_must_be_no')::boolean,false) AND coalesce(p_fields->>'contract','No') <> 'No' THEN
    v_result := 'do_not_book'; v_reasons := v_reasons || jsonb_build_array('Property is already under contract');
  END IF;
  IF v_result = 'qualified' AND (
    coalesce(p_fields->>'roof_age','') = '' OR coalesce(p_fields->>'home_type','') = '' OR coalesce(p_fields->>'roof_type','') = ''
  ) THEN v_result := 'review_needed'; END IF;
  RETURN jsonb_build_object('status',v_result,'reasons',v_reasons);
END;
$$;

CREATE OR REPLACE FUNCTION public.portal_submit_lead(
  p_reservation_id uuid,
  p_session_token uuid,
  p_fields jsonb,
  p_agent_name text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_res public.portal_reservations%ROWTYPE;
  v_settings public.company_portal_settings%ROWTYPE;
  v_qualification jsonb;
  v_lead public.portal_leads%ROWTYPE;
  v_appointment public.portal_appointments%ROWTYPE;
BEGIN
  SELECT * INTO v_res FROM public.portal_reservations
  WHERE id=p_reservation_id AND session_token=p_session_token
  FOR UPDATE;
  IF NOT FOUND OR v_res.status <> 'temporary' OR v_res.expires_at <= now() THEN RAISE EXCEPTION 'Reservation expired'; END IF;

  SELECT * INTO v_settings FROM public.company_portal_settings WHERE company_id=v_res.company_id;
  v_qualification := public.portal_calculate_qualification(v_settings.qualification_rules, p_fields);

  INSERT INTO public.portal_leads(
    company_id, location_id, created_by_profile_id, created_by_name, service_needed,
    full_name, phone_number, email, language, address, city, state, zip_code,
    property_latitude, property_longitude, fields, qualification_status, qualification_details,
    form_mode, external_form_status
  ) VALUES (
    v_res.company_id, v_res.location_id, auth.uid(), coalesce(nullif(trim(p_agent_name),''),v_res.created_by_name),
    p_fields->>'service_needed', nullif(trim(p_fields->>'full_name'),''), nullif(trim(p_fields->>'phone_number'),''),
    nullif(trim(p_fields->>'email'),''), nullif(trim(p_fields->>'language'),''), nullif(trim(p_fields->>'address'),''),
    nullif(trim(p_fields->>'city'),''), nullif(trim(p_fields->>'state'),''), nullif(trim(p_fields->>'zip_code'),''),
    nullif(p_fields->>'property_latitude','')::double precision, nullif(p_fields->>'property_longitude','')::double precision,
    p_fields, v_qualification->>'status', v_qualification, v_settings.form_mode,
    CASE WHEN v_settings.form_mode='internal' THEN 'not_required' ELSE 'pending' END
  ) RETURNING * INTO v_lead;

  IF v_lead.full_name IS NULL OR v_lead.phone_number IS NULL OR v_lead.address IS NULL THEN
    RAISE EXCEPTION 'Full name, phone number, and address are required';
  END IF;

  INSERT INTO public.portal_appointments(
    reservation_id, lead_id, company_id, location_id, appointment_date, start_time, end_time, timezone
  ) VALUES (
    v_res.id, v_lead.id, v_res.company_id, v_res.location_id, v_res.appointment_date, v_res.start_time, v_res.end_time, v_settings.timezone
  ) RETURNING * INTO v_appointment;

  UPDATE public.portal_reservations SET status='converted', expires_at=now() WHERE id=v_res.id;
  INSERT INTO public.portal_audit_logs(company_id, actor_profile_id, actor_role, actor_name, entity_type, entity_id, action, new_value, metadata)
  VALUES (v_res.company_id, auth.uid(), 'agent', coalesce(p_agent_name,v_res.created_by_name), 'appointment', v_appointment.id, 'appointment_confirmed',
    jsonb_build_object('date',v_appointment.appointment_date,'startTime',v_appointment.start_time,'leadCode',v_lead.lead_code),
    jsonb_build_object('qualification',v_qualification,'formMode',v_settings.form_mode));

  RETURN jsonb_build_object(
    'leadId',v_lead.id,'leadCode',v_lead.lead_code,'leadManageToken',v_lead.manage_token,
    'appointmentId',v_appointment.id,'appointmentManageToken',v_appointment.manage_token,
    'date',v_appointment.appointment_date,'start',to_char(v_appointment.start_time,'HH24:MI'),
    'qualification',v_qualification,'formMode',v_settings.form_mode,
    'externalFormProvider',v_settings.external_form_provider,'externalFormUrl',v_settings.external_form_url,
    'externalPrefillMap',v_settings.external_prefill_map
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.portal_get_appointment(p_manage_token uuid)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'appointmentId',a.id,'manageToken',a.manage_token,'date',a.appointment_date,
    'start',to_char(a.start_time,'HH24:MI'),'end',to_char(a.end_time,'HH24:MI'),
    'status',a.appointment_status,'companyName',c.name,'location',l.location_label,
    'leadCode',le.lead_code,'fullName',le.full_name,'phone',le.phone_number,'address',le.address
  )
  FROM public.portal_appointments a
  JOIN public.portal_leads le ON le.id=a.lead_id
  JOIN public.roster_companies c ON c.id=a.company_id
  LEFT JOIN public.company_locations l ON l.id=a.location_id
  WHERE a.manage_token=p_manage_token
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.portal_reschedule_appointment(
  p_manage_token uuid,
  p_new_date date,
  p_new_start_time time
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_appt public.portal_appointments%ROWTYPE;
  v_old_res public.portal_reservations%ROWTYPE;
  v_slot record;
  v_new_res public.portal_reservations%ROWTYPE;
  v_old_date date;
  v_old_time time;
BEGIN
  SELECT * INTO v_appt FROM public.portal_appointments WHERE manage_token=p_manage_token FOR UPDATE;
  IF NOT FOUND OR v_appt.appointment_status IN ('cancelled','completed') THEN RAISE EXCEPTION 'Appointment cannot be rescheduled'; END IF;
  SELECT * INTO v_old_res FROM public.portal_reservations WHERE id=v_appt.reservation_id FOR UPDATE;
  v_old_date := v_appt.appointment_date;
  v_old_time := v_appt.start_time;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_appt.company_id::text || ':' || coalesce(v_appt.location_id::text,'none') || ':' || p_new_date::text || ':' || p_new_start_time::text,0));
  SELECT * INTO v_slot FROM public.portal_slot_statuses(v_appt.company_id,v_appt.location_id,p_new_date) WHERE slot_start=p_new_start_time;
  IF NOT FOUND OR v_slot.status <> 'available' THEN RAISE EXCEPTION 'The selected time is unavailable'; END IF;

  INSERT INTO public.portal_reservations(company_id,location_id,appointment_date,start_time,end_time,session_token,status,expires_at,created_by_profile_id,created_by_name)
  VALUES(v_appt.company_id,v_appt.location_id,p_new_date,v_slot.slot_start,v_slot.slot_end,gen_random_uuid(),'converted',now(),v_old_res.created_by_profile_id,v_old_res.created_by_name)
  RETURNING * INTO v_new_res;

  UPDATE public.portal_reservations SET status='released',released_at=now() WHERE id=v_old_res.id;
  UPDATE public.portal_appointments
  SET reservation_id=v_new_res.id,rescheduled_from_date=v_old_date,rescheduled_from_time=v_old_time,
      appointment_date=p_new_date,start_time=v_slot.slot_start,end_time=v_slot.slot_end,appointment_status='confirmed'
  WHERE id=v_appt.id RETURNING * INTO v_appt;

  INSERT INTO public.portal_audit_logs(company_id,actor_role,actor_name,entity_type,entity_id,action,old_value,new_value)
  VALUES(v_appt.company_id,'agent',v_old_res.created_by_name,'appointment',v_appt.id,'appointment_rescheduled',
    jsonb_build_object('date',v_old_date,'startTime',v_old_time),
    jsonb_build_object('date',v_appt.appointment_date,'startTime',v_appt.start_time));

  RETURN jsonb_build_object('appointmentId',v_appt.id,'date',v_appt.appointment_date,'start',to_char(v_appt.start_time,'HH24:MI'),'end',to_char(v_appt.end_time,'HH24:MI'),'status',v_appt.appointment_status);
END;
$$;

CREATE OR REPLACE FUNCTION public.portal_get_company_admin(p_access_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_company_id uuid; v_result jsonb;
BEGIN
  SELECT company_id INTO v_company_id FROM public.company_portal_settings
  WHERE company_access_token=p_access_token AND company_access_enabled;
  IF v_company_id IS NULL THEN RETURN NULL; END IF;

  SELECT jsonb_build_object(
    'company',jsonb_build_object('id',c.id,'name',c.name,'state',c.state,'phone',c.phone,'email',c.email,'website',c.website),
    'settings',to_jsonb(s) - 'company_access_token' - 'external_webhook_secret',
    'agentLink','/book/'||s.public_slug,
    'locations',COALESCE((SELECT jsonb_agg(to_jsonb(l) ORDER BY l.sort_order,l.location_label) FROM public.company_locations l WHERE l.company_id=v_company_id),'[]'::jsonb),
    'scheduleRules',COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.location_id NULLS FIRST,r.day_of_week) FROM public.company_schedule_rules r WHERE r.company_id=v_company_id),'[]'::jsonb),
    'representatives',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',r.id,'name',r.name,'phone',r.phone,'email',r.email,'locationId',r.location_id,'active',r.active,'accessToken',r.access_token) ORDER BY r.name) FROM public.company_representatives r WHERE r.company_id=v_company_id),'[]'::jsonb),
    'appointments',COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id',a.id,'date',a.appointment_date,'start',to_char(a.start_time,'HH24:MI'),'end',to_char(a.end_time,'HH24:MI'),
      'appointmentStatus',a.appointment_status,'repStatus',a.rep_status,'attendanceStatus',a.attendance_status,
      'inspectionStatus',a.inspection_status,'salesOutcome',a.sales_outcome,'representativeId',a.representative_id,
      'lead',jsonb_build_object('leadCode',le.lead_code,'fullName',le.full_name,'phone',le.phone_number,'address',le.address,'email',le.email,'language',le.language,'fields',le.fields,'qualificationStatus',le.qualification_status),
      'location',l.location_label
    ) ORDER BY a.appointment_date,a.start_time) FROM public.portal_appointments a JOIN public.portal_leads le ON le.id=a.lead_id LEFT JOIN public.company_locations l ON l.id=a.location_id WHERE a.company_id=v_company_id AND a.appointment_date >= current_date-interval '7 days'),'[]'::jsonb),
    'audit',COALESCE((SELECT jsonb_agg(to_jsonb(al) ORDER BY al.created_at DESC) FROM (SELECT * FROM public.portal_audit_logs WHERE company_id=v_company_id ORDER BY created_at DESC LIMIT 100) al),'[]'::jsonb)
  ) INTO v_result
  FROM public.roster_companies c JOIN public.company_portal_settings s ON s.company_id=c.id WHERE c.id=v_company_id;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.portal_update_company_settings(
  p_access_token uuid,
  p_updates jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_company_id uuid; v_old jsonb; v_new jsonb;
BEGIN
  SELECT company_id,to_jsonb(s) INTO v_company_id,v_old FROM public.company_portal_settings s
  WHERE company_access_token=p_access_token AND company_access_enabled FOR UPDATE;
  IF v_company_id IS NULL THEN RAISE EXCEPTION 'Invalid company access'; END IF;

  UPDATE public.company_portal_settings SET
    portal_enabled=COALESCE((p_updates->>'portal_enabled')::boolean,portal_enabled),
    allow_public_booking=COALESCE((p_updates->>'allow_public_booking')::boolean,allow_public_booking),
    timezone=COALESCE(NULLIF(p_updates->>'timezone',''),timezone),
    requirements_short=COALESCE(p_updates->>'requirements_short',requirements_short),
    requirements_detail=COALESCE(p_updates->>'requirements_detail',requirements_detail),
    form_mode=COALESCE(NULLIF(p_updates->>'form_mode',''),form_mode),
    external_form_provider=CASE WHEN p_updates ? 'external_form_provider' THEN NULLIF(p_updates->>'external_form_provider','') ELSE external_form_provider END,
    external_form_url=CASE WHEN p_updates ? 'external_form_url' THEN NULLIF(p_updates->>'external_form_url','') ELSE external_form_url END,
    external_prefill_map=COALESCE(p_updates->'external_prefill_map',external_prefill_map),
    form_schema=COALESCE(p_updates->'form_schema',form_schema),
    qualification_rules=COALESCE(p_updates->'qualification_rules',qualification_rules),
    check_in_radius_m=COALESCE((p_updates->>'check_in_radius_m')::integer,check_in_radius_m),
    check_in_before_minutes=COALESCE((p_updates->>'check_in_before_minutes')::integer,check_in_before_minutes),
    check_in_after_minutes=COALESCE((p_updates->>'check_in_after_minutes')::integer,check_in_after_minutes)
  WHERE company_id=v_company_id RETURNING to_jsonb(company_portal_settings) INTO v_new;

  INSERT INTO public.portal_audit_logs(company_id,actor_role,actor_name,entity_type,entity_id,action,old_value,new_value)
  VALUES(v_company_id,'company_admin','Company Portal','company_settings',v_company_id,'company_settings_updated',v_old-'company_access_token'-'external_webhook_secret',v_new-'company_access_token'-'external_webhook_secret');
  RETURN v_new-'company_access_token'-'external_webhook_secret';
END;
$$;

CREATE OR REPLACE FUNCTION public.portal_upsert_schedule_rule(
  p_access_token uuid,
  p_location_id uuid,
  p_day_of_week smallint,
  p_is_open boolean,
  p_start_time time,
  p_end_time time,
  p_slot_minutes integer,
  p_max_per_slot integer,
  p_max_per_day integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_company_id uuid; v_rule public.company_schedule_rules%ROWTYPE;
BEGIN
  SELECT company_id INTO v_company_id FROM public.company_portal_settings WHERE company_access_token=p_access_token AND company_access_enabled;
  IF v_company_id IS NULL THEN RAISE EXCEPTION 'Invalid company access'; END IF;
  IF p_location_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.company_locations WHERE id=p_location_id AND company_id=v_company_id) THEN RAISE EXCEPTION 'Invalid service area'; END IF;

  SELECT * INTO v_rule FROM public.company_schedule_rules WHERE company_id=v_company_id AND location_id IS NOT DISTINCT FROM p_location_id AND day_of_week=p_day_of_week FOR UPDATE;
  IF FOUND THEN
    UPDATE public.company_schedule_rules SET is_open=p_is_open,start_time=p_start_time,end_time=p_end_time,slot_minutes=p_slot_minutes,max_per_slot=p_max_per_slot,max_per_day=p_max_per_day
    WHERE id=v_rule.id RETURNING * INTO v_rule;
  ELSE
    INSERT INTO public.company_schedule_rules(company_id,location_id,day_of_week,is_open,start_time,end_time,slot_minutes,max_per_slot,max_per_day)
    VALUES(v_company_id,p_location_id,p_day_of_week,p_is_open,p_start_time,p_end_time,p_slot_minutes,p_max_per_slot,p_max_per_day)
    RETURNING * INTO v_rule;
  END IF;
  INSERT INTO public.portal_audit_logs(company_id,actor_role,actor_name,entity_type,entity_id,action,new_value)
  VALUES(v_company_id,'company_admin','Company Portal','schedule_rule',v_rule.id,'schedule_rule_saved',to_jsonb(v_rule));
  RETURN to_jsonb(v_rule);
END;
$$;

CREATE OR REPLACE FUNCTION public.portal_add_representative(
  p_access_token uuid,p_name text,p_phone text DEFAULT NULL,p_email text DEFAULT NULL,p_location_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_company_id uuid; v_rep public.company_representatives%ROWTYPE;
BEGIN
  SELECT company_id INTO v_company_id FROM public.company_portal_settings WHERE company_access_token=p_access_token AND company_access_enabled;
  IF v_company_id IS NULL THEN RAISE EXCEPTION 'Invalid company access'; END IF;
  IF p_location_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.company_locations WHERE id=p_location_id AND company_id=v_company_id) THEN RAISE EXCEPTION 'Invalid service area'; END IF;
  INSERT INTO public.company_representatives(company_id,location_id,name,phone,email)
  VALUES(v_company_id,p_location_id,trim(p_name),nullif(trim(p_phone),''),lower(nullif(trim(p_email),''))) RETURNING * INTO v_rep;
  INSERT INTO public.portal_audit_logs(company_id,actor_role,actor_name,entity_type,entity_id,action,new_value)
  VALUES(v_company_id,'company_admin','Company Portal','representative',v_rep.id,'representative_created',jsonb_build_object('name',v_rep.name,'email',v_rep.email));
  RETURN jsonb_build_object('id',v_rep.id,'name',v_rep.name,'phone',v_rep.phone,'email',v_rep.email,'locationId',v_rep.location_id,'active',v_rep.active,'accessToken',v_rep.access_token);
END;
$$;

CREATE OR REPLACE FUNCTION public.portal_assign_representative(p_access_token uuid,p_appointment_id uuid,p_representative_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_company_id uuid;
BEGIN
  SELECT company_id INTO v_company_id FROM public.company_portal_settings WHERE company_access_token=p_access_token AND company_access_enabled;
  IF v_company_id IS NULL THEN RETURN false; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.company_representatives WHERE id=p_representative_id AND company_id=v_company_id AND active) THEN RETURN false; END IF;
  UPDATE public.portal_appointments SET representative_id=p_representative_id,rep_status='assigned',appointment_status='assigned'
  WHERE id=p_appointment_id AND company_id=v_company_id;
  IF NOT FOUND THEN RETURN false; END IF;
  INSERT INTO public.portal_audit_logs(company_id,actor_role,actor_name,entity_type,entity_id,action,new_value)
  VALUES(v_company_id,'company_admin','Company Portal','appointment',p_appointment_id,'representative_assigned',jsonb_build_object('representativeId',p_representative_id));
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.portal_get_rep_portal(p_access_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_rep public.company_representatives%ROWTYPE; v_result jsonb;
BEGIN
  SELECT * INTO v_rep FROM public.company_representatives WHERE access_token=p_access_token AND active;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT jsonb_build_object(
    'representative',jsonb_build_object('id',v_rep.id,'name',v_rep.name,'phone',v_rep.phone,'email',v_rep.email),
    'company',jsonb_build_object('id',c.id,'name',c.name,'state',c.state),
    'appointments',COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id',a.id,'date',a.appointment_date,'start',to_char(a.start_time,'HH24:MI'),'end',to_char(a.end_time,'HH24:MI'),
      'appointmentStatus',a.appointment_status,'repStatus',a.rep_status,'attendanceStatus',a.attendance_status,
      'inspectionStatus',a.inspection_status,'salesOutcome',a.sales_outcome,'location',l.location_label,
      'lead',jsonb_build_object('leadCode',le.lead_code,'fullName',le.full_name,'phone',le.phone_number,'email',le.email,'address',le.address,'city',le.city,'state',le.state,'zipCode',le.zip_code,'language',le.language,'fields',le.fields)
    ) ORDER BY a.appointment_date,a.start_time) FROM public.portal_appointments a JOIN public.portal_leads le ON le.id=a.lead_id LEFT JOIN public.company_locations l ON l.id=a.location_id WHERE a.representative_id=v_rep.id AND a.appointment_date >= current_date-interval '7 days'),'[]'::jsonb)
  ) INTO v_result FROM public.roster_companies c WHERE c.id=v_rep.company_id;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.portal_rep_update_status(
  p_access_token uuid,p_appointment_id uuid,p_action text,p_notes text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_rep public.company_representatives%ROWTYPE; v_old public.portal_appointments%ROWTYPE; v_new public.portal_appointments%ROWTYPE;
BEGIN
  SELECT * INTO v_rep FROM public.company_representatives WHERE access_token=p_access_token AND active;
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT * INTO v_old FROM public.portal_appointments WHERE id=p_appointment_id AND representative_id=v_rep.id FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;

  UPDATE public.portal_appointments SET
    rep_status=CASE p_action
      WHEN 'en_route' THEN 'en_route' WHEN 'arrived' THEN 'arrived' WHEN 'inspection_started' THEN 'inspection_started'
      WHEN 'inspection_completed' THEN 'inspection_completed' WHEN 'no_show' THEN 'no_show'
      WHEN 'homeowner_cancelled' THEN 'homeowner_cancelled' WHEN 'reschedule_requested' THEN 'reschedule_requested'
      WHEN 'follow_up' THEN 'follow_up' WHEN 'signed_contract' THEN rep_status ELSE rep_status END,
    attendance_status=CASE p_action
      WHEN 'arrived' THEN CASE WHEN attendance_status='unknown' THEN 'unverified_show' ELSE attendance_status END
      WHEN 'no_show' THEN 'homeowner_no_show' WHEN 'homeowner_cancelled' THEN 'cancelled' ELSE attendance_status END,
    inspection_status=CASE p_action WHEN 'inspection_started' THEN 'started' WHEN 'inspection_completed' THEN 'completed' ELSE inspection_status END,
    sales_outcome=CASE p_action WHEN 'signed_contract' THEN 'signed_contract' WHEN 'follow_up' THEN 'follow_up' WHEN 'lost' THEN 'lost' WHEN 'no_sale' THEN 'no_sale' ELSE sales_outcome END,
    appointment_status=CASE p_action WHEN 'inspection_completed' THEN 'completed' WHEN 'homeowner_cancelled' THEN 'cancelled' ELSE appointment_status END
  WHERE id=p_appointment_id RETURNING * INTO v_new;

  IF p_action='homeowner_cancelled' THEN
    UPDATE public.portal_reservations SET status='released',released_at=now() WHERE id=v_old.reservation_id AND status='converted';
  END IF;

  INSERT INTO public.portal_audit_logs(company_id,actor_role,actor_name,entity_type,entity_id,action,old_value,new_value,metadata)
  VALUES(v_rep.company_id,'representative',v_rep.name,'appointment',p_appointment_id,'rep_'||p_action,to_jsonb(v_old),to_jsonb(v_new),jsonb_build_object('notes',p_notes));
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.portal_rep_check_in(
  p_access_token uuid,p_appointment_id uuid,p_latitude double precision,p_longitude double precision,p_accuracy_m double precision DEFAULT NULL,p_explanation text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_rep public.company_representatives%ROWTYPE; v_appt public.portal_appointments%ROWTYPE; v_lead public.portal_leads%ROWTYPE; v_settings public.company_portal_settings%ROWTYPE; v_distance double precision; v_status text; v_check public.portal_checkins%ROWTYPE; v_appt_at timestamptz;
BEGIN
  SELECT * INTO v_rep FROM public.company_representatives WHERE access_token=p_access_token AND active;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invalid representative access'; END IF;
  SELECT * INTO v_appt FROM public.portal_appointments WHERE id=p_appointment_id AND representative_id=v_rep.id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Appointment not assigned to representative'; END IF;
  SELECT * INTO v_lead FROM public.portal_leads WHERE id=v_appt.lead_id;
  SELECT * INTO v_settings FROM public.company_portal_settings WHERE company_id=v_rep.company_id;
  v_appt_at := (v_appt.appointment_date + v_appt.start_time) AT TIME ZONE v_appt.timezone;

  IF now() < v_appt_at - make_interval(mins=>v_settings.check_in_before_minutes)
     OR now() > v_appt_at + make_interval(mins=>v_settings.check_in_after_minutes) THEN
    v_status := 'outside_window';
  ELSIF p_accuracy_m IS NOT NULL AND p_accuracy_m > 500 THEN
    v_status := 'poor_accuracy';
  ELSIF v_lead.property_latitude IS NULL OR v_lead.property_longitude IS NULL THEN
    v_status := 'property_coordinates_missing';
  ELSE
    v_distance := 6371000 * 2 * asin(sqrt(
      power(sin(radians(p_latitude-v_lead.property_latitude)/2),2)
      + cos(radians(v_lead.property_latitude))*cos(radians(p_latitude))*power(sin(radians(p_longitude-v_lead.property_longitude)/2),2)
    ));
    v_status := CASE WHEN v_distance <= v_settings.check_in_radius_m THEN 'verified' ELSE 'unverified' END;
  END IF;

  INSERT INTO public.portal_checkins(appointment_id,representative_id,latitude,longitude,accuracy_m,property_latitude,property_longitude,distance_m,verification_status,explanation)
  VALUES(v_appt.id,v_rep.id,p_latitude,p_longitude,p_accuracy_m,v_lead.property_latitude,v_lead.property_longitude,v_distance,v_status,p_explanation) RETURNING * INTO v_check;

  UPDATE public.portal_appointments SET rep_status='arrived',attendance_status=CASE WHEN v_status='verified' THEN 'verified_show' ELSE 'unverified_show' END WHERE id=v_appt.id;
  INSERT INTO public.portal_audit_logs(company_id,actor_role,actor_name,entity_type,entity_id,action,new_value)
  VALUES(v_rep.company_id,'representative',v_rep.name,'appointment',v_appt.id,'rep_check_in',jsonb_build_object('checkinId',v_check.id,'verificationStatus',v_status,'distanceM',v_distance,'accuracyM',p_accuracy_m));
  RETURN jsonb_build_object('checkinId',v_check.id,'verificationStatus',v_status,'distanceM',v_distance,'checkedInAt',v_check.checked_in_at);
END;
$$;

REVOKE ALL ON FUNCTION public.portal_slot_statuses(uuid,uuid,date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.portal_expire_reservations() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.portal_get_public_company(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_get_public_week(text,uuid,date) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_reserve_slot(text,uuid,date,time,uuid,text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_undo_reservation(uuid,uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_change_reservation(uuid,uuid,date,time) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_submit_lead(uuid,uuid,jsonb,text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_get_appointment(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_reschedule_appointment(uuid,date,time) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_get_company_admin(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_update_company_settings(uuid,jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_upsert_schedule_rule(uuid,uuid,smallint,boolean,time,time,integer,integer,integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_add_representative(uuid,text,text,text,uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_assign_representative(uuid,uuid,uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_get_rep_portal(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_rep_update_status(uuid,uuid,text,text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_rep_check_in(uuid,uuid,double precision,double precision,double precision,text) TO anon, authenticated;

COMMIT;
