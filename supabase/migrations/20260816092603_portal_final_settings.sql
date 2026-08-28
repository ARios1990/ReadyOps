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

CREATE OR REPLACE FUNCTION public.portal_default_form_schema()
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT jsonb_build_array(
    jsonb_build_object(
      'id', 'appointment',
      'title', 'Appointment',
      'fields', jsonb_build_array(
        jsonb_build_object('key','service_needed','label','Services Needed','type','select','required',true,'options',jsonb_build_array('Roof Inspection','Roof Inspection With a Drone','Solar Evaluation','Tree Removal','Real Estate','PDR','Home Improvement Estimate','Repair Job Estimate','Siding Estimate','Window Estimate'))
      )
    ),
    jsonb_build_object(
      'id', 'customer',
      'title', 'Customer Information',
      'fields', jsonb_build_array(
        jsonb_build_object('key','full_name','label','Full Name','type','text','required',true),
        jsonb_build_object('key','phone_number','label','Phone Number','type','phone','required',true),
        jsonb_build_object('key','address','label','Address','type','address','required',true),
        jsonb_build_object('key','city','label','City','type','text','required',false),
        jsonb_build_object('key','state','label','State','type','text','required',false),
        jsonb_build_object('key','zip_code','label','ZIP Code','type','text','required',false),
        jsonb_build_object('key','email','label','Email','type','email','required',false),
        jsonb_build_object('key','language','label','Language','type','select','required',true,'options',jsonb_build_array('English','Spanish','Other'))
      )
    ),
    jsonb_build_object(
      'id', 'property',
      'title', 'Property Details',
      'fields', jsonb_build_array(
        jsonb_build_object('key','last_checked_on','label','Last Checked On','type','select','required',false,'options',jsonb_build_array('Never','Less Than 1 Year','1–2 Years','3–5 Years','5+ Years','Not Sure')),
        jsonb_build_object('key','home_type','label','Home Type','type','select','required',true,'options',jsonb_build_array('Single Family','Townhome','Duplex','Condo','Mobile Home','Other')),
        jsonb_build_object('key','roof_type','label','Roof Type','type','select','required',true,'options',jsonb_build_array('Shingles','Metal','Tile','Flat','Other','Not Sure')),
        jsonb_build_object('key','roof_age','label','Roof Age','type','select','required',true,'options',jsonb_build_array('0–3 Years','4–6 Years','7–10 Years','11–15 Years','16–20 Years','20+ Years','Not Sure')),
        jsonb_build_object('key','stories','label','Stories','type','select','required',false,'options',jsonb_build_array('1 Story','2 Stories','3+ Stories')),
        jsonb_build_object('key','insurance','label','Insurance','type','select','required',false,'options',jsonb_build_array('Yes','No','Not Sure')),
        jsonb_build_object('key','insurance_name','label','Insurance Name','type','text','required',false,'showWhen',jsonb_build_object('field','insurance','equals','Yes')),
        jsonb_build_object('key','claim_filed','label','File Claim','type','select','required',false,'options',jsonb_build_array('Yes','No','Not Yet','Not Sure')),
        jsonb_build_object('key','contract','label','Contract','type','select','required',false,'defaultValue','No','options',jsonb_build_array('No','Yes','Not Sure')),
        jsonb_build_object('key','hail_size','label','Size of Hail','type','select','required',false,'options',jsonb_build_array('None Known','Pea','Dime','Nickel','Quarter','Half Dollar','Golf Ball','2+ Inches','Not Sure')),
        jsonb_build_object('key','visible_damage','label','Visible Damage','type','select','required',false,'options',jsonb_build_array('Yes','No','Not Sure')),
        jsonb_build_object('key','damage_type','label','Type of Damage','type','multiselect','required',false,'options',jsonb_build_array('Missing Shingles','Lifted Shingles','Leaks','Water Stains','Hail Damage','Wind Damage','Granule Loss','Dents','Tree Damage','Other'),'showWhen',jsonb_build_object('field','visible_damage','equals','Yes')),
        jsonb_build_object('key','drone_approved','label','Drone Inspection Approved','type','select','required',false,'options',jsonb_build_array('Yes','No'),'showWhen',jsonb_build_object('field','service_needed','equals','Roof Inspection With a Drone')),
        jsonb_build_object('key','property_access','label','Property Access','type','select','required',false,'options',jsonb_build_array('Clear Access','Gated','Restricted','Not Sure'),'showWhen',jsonb_build_object('field','service_needed','equals','Roof Inspection With a Drone'))
      )
    ),
    jsonb_build_object(
      'id', 'additional',
      'title', 'Additional Information',
      'fields', jsonb_build_array(
        jsonb_build_object('key','notes','label','Notes','type','textarea','required',false),
        jsonb_build_object('key','home_value','label','Home Value','type','currency','required',false),
        jsonb_build_object('key','sq_ft','label','SQ FT','type','number','required',false),
        jsonb_build_object('key','web_url','label','Web URL','type','url','required',false),
        jsonb_build_object('key','additional_properties','label','Additional Properties','type','select','required',false,'options',jsonb_build_array('No','Yes')),
        jsonb_build_object('key','second_address','label','Second Address','type','address','required',false,'showWhen',jsonb_build_object('field','additional_properties','equals','Yes'))
      )
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.portal_default_qualification_rules()
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT jsonb_build_object(
    'minimum_roof_age', null,
    'minimum_sq_ft', null,
    'allowed_home_types', jsonb_build_array(),
    'allowed_roof_types', jsonb_build_array(),
    'allowed_languages', jsonb_build_array(),
    'contract_must_be_no', false,
    'block_disqualified', false
  );
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
  qualification_rules jsonb NOT NULL DEFAULT public.portal_default_qualification_rules(),
  form_mode text NOT NULL DEFAULT 'internal' CHECK (form_mode IN ('internal','external','internal_external')),
  form_schema jsonb NOT NULL DEFAULT public.portal_default_form_schema(),
  external_form_provider text,
  external_form_url text,
  external_prefill_map jsonb NOT NULL DEFAULT '{}'::jsonb,
  external_submission_map jsonb NOT NULL DEFAULT '{}'::jsonb,
  external_webhook_secret uuid NOT NULL DEFAULT gen_random_uuid(),
  check_in_radius_m integer NOT NULL DEFAULT 152 CHECK (check_in_radius_m BETWEEN 25 AND 5000),
  check_in_before_minutes integer NOT NULL DEFAULT 30 CHECK (check_in_before_minutes BETWEEN 0 AND 1440),
  check_in_after_minutes integer NOT NULL DEFAULT 120 CHECK (check_in_after_minutes BETWEEN 0 AND 2880),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.company_portal_settings
  ADD COLUMN IF NOT EXISTS form_schema jsonb NOT NULL DEFAULT public.portal_default_form_schema(),
  ADD COLUMN IF NOT EXISTS external_submission_map jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS external_webhook_secret uuid NOT NULL DEFAULT gen_random_uuid();

ALTER TABLE public.company_portal_settings
  ALTER COLUMN qualification_rules SET DEFAULT public.portal_default_qualification_rules();

UPDATE public.company_portal_settings
SET
  qualification_rules = CASE
    WHEN qualification_rules IS NULL OR qualification_rules = '{}'::jsonb
      THEN public.portal_default_qualification_rules()
    ELSE qualification_rules
  END,
  form_schema = CASE
    WHEN form_schema IS NULL OR form_schema = '[]'::jsonb
      THEN public.portal_default_form_schema()
    ELSE form_schema
  END,
  external_submission_map = coalesce(external_submission_map, '{}'::jsonb);

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
  CHECK (
    is_closed
    OR (start_time IS NOT NULL AND end_time IS NOT NULL AND end_time > start_time)
  )
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

CREATE INDEX IF NOT EXISTS company_representatives_company_idx
  ON public.company_representatives(company_id, active);

CREATE SEQUENCE IF NOT EXISTS public.portal_lead_sequence START 1;

COMMIT;
