-- Imported from the hosted ReadyOp Supabase migration history on 2026-08-28.
-- Schema only: no production table data is included.

BEGIN;

CREATE OR REPLACE FUNCTION public.portal_next_lead_code()
RETURNS text
LANGUAGE plpgsql
VOLATILE
AS $$
DECLARE
  next_value bigint;
BEGIN
  next_value := nextval('public.portal_lead_sequence');
  RETURN 'MR-' || to_char(current_date, 'YYYY') || '-' || lpad(next_value::text, 6, '0');
END;
$$;

CREATE TABLE IF NOT EXISTS public.portal_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_code text NOT NULL UNIQUE DEFAULT public.portal_next_lead_code(),
  company_id uuid NOT NULL REFERENCES public.roster_companies(id) ON DELETE CASCADE,
  location_id uuid REFERENCES public.company_locations(id) ON DELETE SET NULL,
  agent_profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  agent_name text NOT NULL DEFAULT 'Agent',
  session_id uuid,
  service_needed text,
  full_name text NOT NULL,
  phone_number text NOT NULL,
  address text NOT NULL,
  city text,
  state text,
  zip_code text,
  email text,
  language text,
  notes text,
  home_value numeric,
  sq_ft integer,
  web_url text,
  property_latitude double precision,
  property_longitude double precision,
  form_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  qualification_status text NOT NULL DEFAULT 'review_needed' CHECK (qualification_status IN ('qualified','review_needed','do_not_book')),
  qualification_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  external_form_status text NOT NULL DEFAULT 'not_required' CHECK (external_form_status IN ('not_required','pending','opened','submitted','synced','failed')),
  external_submission_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS portal_leads_company_idx ON public.portal_leads(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS portal_leads_phone_idx ON public.portal_leads(phone_number);
CREATE INDEX IF NOT EXISTS portal_leads_address_idx ON public.portal_leads(address);

CREATE TABLE IF NOT EXISTS public.appointment_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_token uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  company_id uuid NOT NULL REFERENCES public.roster_companies(id) ON DELETE CASCADE,
  location_id uuid REFERENCES public.company_locations(id) ON DELETE SET NULL,
  appointment_date date NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL,
  session_id uuid NOT NULL,
  agent_name text NOT NULL DEFAULT 'Agent',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','released','expired','converted')),
  last_action text NOT NULL DEFAULT 'reserve' CHECK (last_action IN ('reserve','move','undo_move')),
  previous_location_id uuid REFERENCES public.company_locations(id) ON DELETE SET NULL,
  previous_appointment_date date,
  previous_start_time time,
  previous_end_time time,
  undo_deadline timestamptz NOT NULL DEFAULT (now() + interval '45 seconds'),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '10 minutes'),
  converted_appointment_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_time > start_time)
);

CREATE INDEX IF NOT EXISTS appointment_reservations_slot_idx
  ON public.appointment_reservations(company_id, location_id, appointment_date, start_time, status);
CREATE INDEX IF NOT EXISTS appointment_reservations_expiry_idx
  ON public.appointment_reservations(status, expires_at);

CREATE TABLE IF NOT EXISTS public.portal_appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL UNIQUE REFERENCES public.portal_leads(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.roster_companies(id) ON DELETE CASCADE,
  location_id uuid REFERENCES public.company_locations(id) ON DELETE SET NULL,
  representative_id uuid REFERENCES public.company_representatives(id) ON DELETE SET NULL,
  appointment_date date NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL,
  timezone text NOT NULL DEFAULT 'America/Chicago',
  status text NOT NULL DEFAULT 'confirmed' CHECK (status IN ('draft','confirmed','assigned','cancelled','rescheduled','completed')),
  rep_status text NOT NULL DEFAULT 'unassigned' CHECK (rep_status IN ('unassigned','assigned','en_route','arrived','inspection_started','inspection_completed','follow_up')),
  attendance_status text NOT NULL DEFAULT 'unknown' CHECK (attendance_status IN ('unknown','verified_show','unverified_show','homeowner_no_show','rep_no_show','cancelled')),
  inspection_status text NOT NULL DEFAULT 'not_started' CHECK (inspection_status IN ('not_started','started','completed','not_completed')),
  sales_outcome text NOT NULL DEFAULT 'pending' CHECK (sales_outcome IN ('pending','signed_contract','lost','follow_up','not_applicable')),
  external_form_status text NOT NULL DEFAULT 'not_required' CHECK (external_form_status IN ('not_required','pending','opened','submitted','synced','failed')),
  manage_token uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_time > start_time)
);

ALTER TABLE public.appointment_reservations
  DROP CONSTRAINT IF EXISTS appointment_reservations_converted_appointment_id_fkey;
ALTER TABLE public.appointment_reservations
  ADD CONSTRAINT appointment_reservations_converted_appointment_id_fkey
  FOREIGN KEY (converted_appointment_id) REFERENCES public.portal_appointments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS portal_appointments_company_date_idx
  ON public.portal_appointments(company_id, appointment_date, start_time);
CREATE INDEX IF NOT EXISTS portal_appointments_rep_date_idx
  ON public.portal_appointments(representative_id, appointment_date, start_time);

CREATE TABLE IF NOT EXISTS public.appointment_checkins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id uuid NOT NULL REFERENCES public.portal_appointments(id) ON DELETE CASCADE,
  representative_id uuid NOT NULL REFERENCES public.company_representatives(id) ON DELETE CASCADE,
  latitude double precision NOT NULL,
  longitude double precision NOT NULL,
  accuracy_m double precision,
  distance_m double precision,
  verified boolean NOT NULL DEFAULT false,
  timing_status text NOT NULL DEFAULT 'within_window' CHECK (timing_status IN ('within_window','too_early','too_late')),
  note text,
  checked_in_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS appointment_checkins_appointment_idx
  ON public.appointment_checkins(appointment_id, checked_in_at DESC);

CREATE TABLE IF NOT EXISTS public.portal_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES public.roster_companies(id) ON DELETE CASCADE,
  actor_type text NOT NULL CHECK (actor_type IN ('masters_admin','company_admin','representative','agent','system','external_form')),
  actor_id uuid,
  actor_name text NOT NULL DEFAULT 'System',
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  old_value jsonb,
  new_value jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS portal_audit_logs_company_idx
  ON public.portal_audit_logs(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS portal_audit_logs_entity_idx
  ON public.portal_audit_logs(entity_type, entity_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.external_form_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.roster_companies(id) ON DELETE CASCADE,
  lead_id uuid REFERENCES public.portal_leads(id) ON DELETE SET NULL,
  appointment_id uuid REFERENCES public.portal_appointments(id) ON DELETE SET NULL,
  provider text,
  provider_submission_id text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'received' CHECK (status IN ('received','synced','failed','duplicate')),
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS external_form_events_provider_submission_unique
  ON public.external_form_events(company_id, provider_submission_id)
  WHERE provider_submission_id IS NOT NULL;

DROP TRIGGER IF EXISTS company_portal_settings_updated_at ON public.company_portal_settings;
CREATE TRIGGER company_portal_settings_updated_at
BEFORE UPDATE ON public.company_portal_settings
FOR EACH ROW EXECUTE FUNCTION public.portal_set_updated_at();

DROP TRIGGER IF EXISTS company_schedule_rules_updated_at ON public.company_schedule_rules;
CREATE TRIGGER company_schedule_rules_updated_at
BEFORE UPDATE ON public.company_schedule_rules
FOR EACH ROW EXECUTE FUNCTION public.portal_set_updated_at();

DROP TRIGGER IF EXISTS company_representatives_updated_at ON public.company_representatives;
CREATE TRIGGER company_representatives_updated_at
BEFORE UPDATE ON public.company_representatives
FOR EACH ROW EXECUTE FUNCTION public.portal_set_updated_at();

DROP TRIGGER IF EXISTS portal_leads_updated_at ON public.portal_leads;
CREATE TRIGGER portal_leads_updated_at
BEFORE UPDATE ON public.portal_leads
FOR EACH ROW EXECUTE FUNCTION public.portal_set_updated_at();

DROP TRIGGER IF EXISTS appointment_reservations_updated_at ON public.appointment_reservations;
CREATE TRIGGER appointment_reservations_updated_at
BEFORE UPDATE ON public.appointment_reservations
FOR EACH ROW EXECUTE FUNCTION public.portal_set_updated_at();

DROP TRIGGER IF EXISTS portal_appointments_updated_at ON public.portal_appointments;
CREATE TRIGGER portal_appointments_updated_at
BEFORE UPDATE ON public.portal_appointments
FOR EACH ROW EXECUTE FUNCTION public.portal_set_updated_at();

WITH base AS (
  SELECT
    c.id,
    CASE
      WHEN public.portal_slugify(c.name) = '' THEN 'company-' || left(c.id::text, 8)
      ELSE public.portal_slugify(c.name)
    END AS base_slug,
    row_number() OVER (
      PARTITION BY CASE
        WHEN public.portal_slugify(c.name) = '' THEN 'company'
        ELSE public.portal_slugify(c.name)
      END
      ORDER BY c.id
    ) AS slug_rank
  FROM public.roster_companies c
)
INSERT INTO public.company_portal_settings (
  company_id,
  public_slug,
  requirements_short,
  requirements_detail
)
SELECT
  b.id,
  CASE WHEN b.slug_rank = 1 THEN b.base_slug ELSE b.base_slug || '-' || left(b.id::text, 6) END,
  coalesce(c.requirements_note, ''),
  coalesce(c.notes, '')
FROM base b
JOIN public.roster_companies c ON c.id = b.id
ON CONFLICT (company_id) DO NOTHING;

INSERT INTO public.company_schedule_rules (
  company_id, location_id, day_of_week, is_open, start_time, end_time, slot_minutes, max_per_slot, max_per_day
)
SELECT
  c.id,
  NULL,
  d.day_of_week,
  CASE WHEN d.day_of_week = 0 THEN false ELSE true END,
  '09:00'::time,
  '18:00'::time,
  60,
  1,
  8
FROM public.roster_companies c
CROSS JOIN generate_series(0, 6) AS d(day_of_week)
WHERE NOT EXISTS (
  SELECT 1
  FROM public.company_schedule_rules r
  WHERE r.company_id = c.id
    AND r.location_id IS NULL
    AND r.day_of_week = d.day_of_week
);

CREATE OR REPLACE FUNCTION public.portal_create_company_defaults()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_slug text;
  v_try integer := 0;
BEGIN
  v_slug := public.portal_slugify(NEW.name);
  IF v_slug = '' THEN
    v_slug := 'company-' || left(NEW.id::text, 8);
  END IF;

  WHILE EXISTS (SELECT 1 FROM public.company_portal_settings s WHERE s.public_slug = v_slug) LOOP
    v_try := v_try + 1;
    v_slug := public.portal_slugify(NEW.name) || '-' || left(NEW.id::text, 6) || CASE WHEN v_try > 1 THEN '-' || v_try::text ELSE '' END;
  END LOOP;

  INSERT INTO public.company_portal_settings(company_id, public_slug, requirements_short, requirements_detail)
  VALUES (NEW.id, v_slug, coalesce(NEW.requirements_note, ''), coalesce(NEW.notes, ''));

  INSERT INTO public.company_schedule_rules(
    company_id, day_of_week, is_open, start_time, end_time, slot_minutes, max_per_slot, max_per_day
  )
  SELECT NEW.id, d, (d <> 0), '09:00'::time, '18:00'::time, 60, 1, 8
  FROM generate_series(0, 6) AS d;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS roster_companies_create_portal_defaults ON public.roster_companies;
CREATE TRIGGER roster_companies_create_portal_defaults
AFTER INSERT ON public.roster_companies
FOR EACH ROW EXECUTE FUNCTION public.portal_create_company_defaults();

COMMIT;
