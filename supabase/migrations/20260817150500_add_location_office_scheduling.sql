BEGIN;

ALTER TABLE public.company_locations
  ADD COLUMN IF NOT EXISTS office_name text,
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS zip_code text,
  ADD COLUMN IF NOT EXISTS service_cities text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS service_zips text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS manager_name text,
  ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'America/Chicago',
  ADD COLUMN IF NOT EXISTS available_days text[] NOT NULL DEFAULT ARRAY['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']::text[],
  ADD COLUMN IF NOT EXISTS start_time time without time zone NOT NULL DEFAULT '09:00',
  ADD COLUMN IF NOT EXISTS end_time time without time zone NOT NULL DEFAULT '18:00',
  ADD COLUMN IF NOT EXISTS slot_interval_minutes integer NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS max_per_hour integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS max_per_day integer NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.company_locations
  DROP CONSTRAINT IF EXISTS company_locations_slot_interval_minutes_check,
  ADD CONSTRAINT company_locations_slot_interval_minutes_check CHECK (slot_interval_minutes BETWEEN 15 AND 240),
  DROP CONSTRAINT IF EXISTS company_locations_max_per_hour_check,
  ADD CONSTRAINT company_locations_max_per_hour_check CHECK (max_per_hour > 0),
  DROP CONSTRAINT IF EXISTS company_locations_max_per_day_check,
  ADD CONSTRAINT company_locations_max_per_day_check CHECK (max_per_day > 0),
  DROP CONSTRAINT IF EXISTS company_locations_hours_check,
  ADD CONSTRAINT company_locations_hours_check CHECK (end_time > start_time);

CREATE TABLE IF NOT EXISTS public.company_location_agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id uuid NOT NULL REFERENCES public.company_locations(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(location_id, agent_id)
);

ALTER TABLE public.company_location_agents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS company_location_agents_admin_select ON public.company_location_agents;
CREATE POLICY company_location_agents_admin_select
ON public.company_location_agents
FOR SELECT TO authenticated
USING (
  public.get_user_role() = 'admin'
  OR agent_id = public.get_user_agent_id()
);

DROP POLICY IF EXISTS company_location_agents_admin_insert ON public.company_location_agents;
CREATE POLICY company_location_agents_admin_insert
ON public.company_location_agents
FOR INSERT TO authenticated
WITH CHECK (public.get_user_role() = 'admin');

DROP POLICY IF EXISTS company_location_agents_admin_update ON public.company_location_agents;
CREATE POLICY company_location_agents_admin_update
ON public.company_location_agents
FOR UPDATE TO authenticated
USING (public.get_user_role() = 'admin')
WITH CHECK (public.get_user_role() = 'admin');

DROP POLICY IF EXISTS company_location_agents_admin_delete ON public.company_location_agents;
CREATE POLICY company_location_agents_admin_delete
ON public.company_location_agents
FOR DELETE TO authenticated
USING (public.get_user_role() = 'admin');

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.company_location_agents TO authenticated;

CREATE INDEX IF NOT EXISTS idx_company_location_agents_location
  ON public.company_location_agents(location_id);
CREATE INDEX IF NOT EXISTS idx_company_location_agents_agent
  ON public.company_location_agents(agent_id);

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
          NOT (trim(to_char(p_date, 'Day')) = ANY(l.available_days))
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

COMMENT ON FUNCTION public.portal_slot_is_blocked(uuid, uuid, date, time without time zone, time without time zone)
IS 'Returns true when a location is outside its office hours/days, a schedule exception applies, or a recurring company/location slot is blocked.';

COMMIT;
