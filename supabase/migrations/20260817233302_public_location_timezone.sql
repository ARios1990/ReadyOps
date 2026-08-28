-- Imported from the hosted ReadyOp Supabase migration history on 2026-08-28.
-- Schema only: no production table data is included.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_public_location_timezone(
  p_slug text,
  p_location_id uuid
)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT coalesce(l.timezone, s.timezone, 'America/Chicago')
  FROM public.company_portal_settings s
  JOIN public.roster_companies c ON c.id = s.company_id
  LEFT JOIN public.company_locations l
    ON l.id = p_location_id
   AND l.company_id = s.company_id
  WHERE s.public_slug = p_slug
    AND s.portal_enabled
    AND c.account_status = 'Active'
    AND (p_location_id IS NULL OR l.id IS NOT NULL)
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_public_location_timezone(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_location_timezone(text, uuid) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.get_public_location_timezone(text, uuid)
IS 'Returns the effective IANA timezone for a public booking page, preferring the selected company location timezone and falling back to the company portal timezone.';

COMMIT;
