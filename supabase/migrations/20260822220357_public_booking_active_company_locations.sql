-- Imported from the hosted ReadyOp Supabase migration history on 2026-08-28.
-- Schema only: no production table data is included.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_public_booking_portal_active_locations(
  p_slug text,
  p_location_id uuid,
  p_start_date date,
  p_end_date date
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_result jsonb;
  v_company_id uuid;
BEGIN
  v_result := public.get_public_booking_portal(
    p_slug,
    p_location_id,
    p_start_date,
    p_end_date
  );
  v_company_id := nullif(v_result #>> '{company,id}', '')::uuid;

  IF p_location_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.company_locations AS l
    WHERE l.id = p_location_id
      AND l.company_id = v_company_id
      AND l.active
  ) THEN
    RAISE EXCEPTION 'This service area is inactive or unavailable';
  END IF;

  RETURN jsonb_set(
    v_result,
    '{locations}',
    coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', l.id,
        'label', l.location_label,
        'city', l.city,
        'state', l.state,
        'zip_code', l.zip_code
      ) ORDER BY l.sort_order, l.location_label)
      FROM public.company_locations AS l
      WHERE l.company_id = v_company_id AND l.active
    ), '[]'::jsonb),
    true
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_public_booking_portal_active_locations(text, uuid, date, date)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_booking_portal_active_locations(text, uuid, date, date)
  TO anon, authenticated;

COMMENT ON FUNCTION public.get_public_booking_portal_active_locations(text, uuid, date, date)
IS 'Public booking payload that lists and accepts only active company locations.';

COMMIT;


