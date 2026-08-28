-- Imported from the hosted ReadyOp Supabase migration history on 2026-08-28.
-- Schema only: no production table data is included.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION public.portal_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.portal_slugify(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT trim(both '-' FROM regexp_replace(lower(coalesce(value, '')), '[^a-z0-9]+', '-', 'g'));
$$;

CREATE TABLE IF NOT EXISTS public.company_portal_settings (
  company_id uuid PRIMARY KEY REFERENCES public.roster_companies(id) ON DELETE CASCADE,
  public_slug text NOT NULL UNIQUE,
  portal_enabled boolean NOT NULL DEFAULT false,
  allow_public_booking boolean NOT NULL DEFAULT true,
  company_access_enabled boolean NOT NULL DEFAULT true,
  company_access_token uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  timezone text NOT NULL DEFAULT 'America/Chicago',
  requirements_short text NOT NULL DEFAULT '',
  requirements_detail text NOT NULL DEFAULT '',
  form_mode text NOT NULL DEFAULT 'internal' CHECK (form_mode IN ('internal','external','internal_external')),
  external_form_provider text,
  external_form_url text,
  external_prefill_map jsonb NOT NULL DEFAULT '{}'::jsonb,
  qualification_rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  check_in_radius_m integer NOT NULL DEFAULT 152 CHECK (check_in_radius_m BETWEEN 25 AND 5000),
  check_in_before_minutes integer NOT NULL DEFAULT 30 CHECK (check_in_before_minutes BETWEEN 0 AND 1440),
  check_in_after_minutes integer NOT NULL DEFAULT 120 CHECK (check_in_after_minutes BETWEEN 0 AND 2880),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS portal_settings_updated_at ON public.company_portal_settings;
CREATE TRIGGER portal_settings_updated_at
BEFORE UPDATE ON public.company_portal_settings
FOR EACH ROW EXECUTE FUNCTION public.portal_set_updated_at();

INSERT INTO public.company_portal_settings (company_id, public_slug, requirements_short)
SELECT
  c.id,
  public.portal_slugify(c.name) || '-' || left(c.id::text, 6),
  coalesce(c.requirements_note, '')
FROM public.roster_companies c
ON CONFLICT (company_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.company_schedule_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.roster_companies(id) ON DELETE CASCADE,
  location_id uuid REFERENCES public.company_locations(id) ON DELETE CASCADE,
  day_of_week smallint NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  is_open boolean NOT NULL DEFAULT true,
  start_time time NOT NULL DEFAULT '09:00',
  end_time time NOT NULL DEFAULT '18:00',
  slot_minutes integer NOT NULL DEFAULT 60 CHECK (slot_minutes BETWEEN 15 AND 480),
  max_per_slot integer NOT NULL DEFAULT 1 CHECK (max_per_slot BETWEEN 1 AND 50),
  max_per_day integer NOT NULL DEFAULT 8 CHECK (max_per_day BETWEEN 1 AND 250),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_time > start_time)
);

DROP TRIGGER IF EXISTS schedule_rules_updated_at ON public.company_schedule_rules;
CREATE TRIGGER schedule_rules_updated_at
BEFORE UPDATE ON public.company_schedule_rules
FOR EACH ROW EXECUTE FUNCTION public.portal_set_updated_at();

CREATE UNIQUE INDEX IF NOT EXISTS company_schedule_rules_unique_company_day
  ON public.company_schedule_rules(company_id, day_of_week)
  WHERE location_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS company_schedule_rules_unique_location_day
  ON public.company_schedule_rules(company_id, location_id, day_of_week)
  WHERE location_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.company_schedule_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.roster_companies(id) ON DELETE CASCADE,
  location_id uuid REFERENCES public.company_locations(id) ON DELETE CASCADE,
  exception_date date NOT NULL,
  is_closed boolean NOT NULL DEFAULT false,
  start_time time,
  end_time time,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (is_closed OR (start_time IS NOT NULL AND end_time IS NOT NULL AND end_time > start_time))
);
CREATE INDEX IF NOT EXISTS company_schedule_exceptions_lookup
  ON public.company_schedule_exceptions(company_id, location_id, exception_date);

CREATE TABLE IF NOT EXISTS public.company_representatives (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.roster_companies(id) ON DELETE CASCADE,
  location_id uuid REFERENCES public.company_locations(id) ON DELETE SET NULL,
  name text NOT NULL,
  phone text,
  email text,
  access_token uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
DROP TRIGGER IF EXISTS representatives_updated_at ON public.company_representatives;
CREATE TRIGGER representatives_updated_at
BEFORE UPDATE ON public.company_representatives
FOR EACH ROW EXECUTE FUNCTION public.portal_set_updated_at();
CREATE INDEX IF NOT EXISTS company_representatives_company_idx
  ON public.company_representatives(company_id, active);

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES public.roster_companies(id) ON DELETE SET NULL,
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_label text,
  actor_role text,
  entity_type text NOT NULL,
  entity_id text,
  action text NOT NULL,
  field_name text,
  old_value jsonb,
  new_value jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_logs_company_created_idx ON public.audit_logs(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_entity_idx ON public.audit_logs(entity_type, entity_id, created_at DESC);

ALTER TABLE public.company_portal_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_schedule_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_schedule_exceptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_representatives ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS portal_settings_admin_all ON public.company_portal_settings;
CREATE POLICY portal_settings_admin_all ON public.company_portal_settings FOR ALL TO authenticated
USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS schedule_rules_admin_all ON public.company_schedule_rules;
CREATE POLICY schedule_rules_admin_all ON public.company_schedule_rules FOR ALL TO authenticated
USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS schedule_exceptions_admin_all ON public.company_schedule_exceptions;
CREATE POLICY schedule_exceptions_admin_all ON public.company_schedule_exceptions FOR ALL TO authenticated
USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS representatives_admin_all ON public.company_representatives;
CREATE POLICY representatives_admin_all ON public.company_representatives FOR ALL TO authenticated
USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS audit_logs_admin_select ON public.audit_logs;
CREATE POLICY audit_logs_admin_select ON public.audit_logs FOR SELECT TO authenticated
USING (public.is_admin());
DROP POLICY IF EXISTS audit_logs_authenticated_insert ON public.audit_logs;
CREATE POLICY audit_logs_authenticated_insert ON public.audit_logs FOR INSERT TO authenticated
WITH CHECK (actor_user_id IS NULL OR actor_user_id = auth.uid() OR public.is_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.company_portal_settings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.company_schedule_rules TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.company_schedule_exceptions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.company_representatives TO authenticated;
GRANT SELECT, INSERT ON public.audit_logs TO authenticated;

COMMIT;
