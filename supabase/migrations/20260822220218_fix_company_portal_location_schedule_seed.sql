BEGIN;

CREATE OR REPLACE FUNCTION public.create_company_portal_location(
  p_company_id uuid,
  p_access_token uuid,
  p_location jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_company_id uuid;
  v_saved public.company_locations%ROWTYPE;
  v_timezone text;
  v_sort integer;
BEGIN
  v_company_id := public.portal_resolve_company_access(p_company_id, p_access_token);
  IF jsonb_typeof(coalesce(p_location, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'Location details must be an object';
  END IF;
  IF nullif(trim(p_location->>'location_label'), '') IS NULL THEN
    RAISE EXCEPTION 'Location or service-area name is required';
  END IF;
  IF p_location ? 'service_cities' AND jsonb_typeof(p_location->'service_cities') <> 'array' THEN
    RAISE EXCEPTION 'Service cities must be a list';
  END IF;
  IF p_location ? 'service_zips' AND jsonb_typeof(p_location->'service_zips') <> 'array' THEN
    RAISE EXCEPTION 'Service ZIP codes must be a list';
  END IF;

  SELECT coalesce(nullif(trim(p_location->>'timezone'), ''), s.timezone, 'America/Chicago')
  INTO v_timezone
  FROM public.company_portal_settings AS s
  WHERE s.company_id = v_company_id;

  SELECT coalesce(max(l.sort_order), 0) + 10
  INTO v_sort
  FROM public.company_locations AS l
  WHERE l.company_id = v_company_id;

  INSERT INTO public.company_locations (
    company_id, location_label, office_name, address, city, state, zip_code,
    service_cities, service_zips, phone, email, manager_name, timezone,
    notes, active, sort_order
  ) VALUES (
    v_company_id,
    trim(p_location->>'location_label'),
    nullif(trim(p_location->>'office_name'), ''),
    nullif(trim(p_location->>'address'), ''),
    nullif(trim(p_location->>'city'), ''),
    nullif(upper(trim(p_location->>'state')), ''),
    nullif(trim(p_location->>'zip_code'), ''),
    CASE WHEN p_location ? 'service_cities' THEN ARRAY(
      SELECT DISTINCT trim(value)
      FROM jsonb_array_elements_text(p_location->'service_cities')
      WHERE nullif(trim(value), '') IS NOT NULL
    ) ELSE '{}'::text[] END,
    CASE WHEN p_location ? 'service_zips' THEN ARRAY(
      SELECT DISTINCT trim(value)
      FROM jsonb_array_elements_text(p_location->'service_zips')
      WHERE nullif(trim(value), '') IS NOT NULL
    ) ELSE '{}'::text[] END,
    nullif(trim(p_location->>'phone'), ''),
    nullif(lower(trim(p_location->>'email')), ''),
    nullif(trim(p_location->>'manager_name'), ''),
    v_timezone,
    nullif(trim(p_location->>'notes'), ''),
    coalesce((p_location->>'active')::boolean, true),
    v_sort
  )
  RETURNING * INTO v_saved;

  INSERT INTO public.company_schedule_rules (
    company_id, location_id, day_of_week, is_open, start_time, end_time,
    slot_minutes, max_per_slot, max_per_day
  )
  SELECT r.company_id, v_saved.id, r.day_of_week, r.is_open, r.start_time,
    r.end_time, r.slot_minutes, r.max_per_slot, r.max_per_day
  FROM public.company_schedule_rules AS r
  WHERE r.company_id = v_company_id AND r.location_id IS NULL;

  PERFORM public.portal_write_audit(
    v_company_id,
    public.portal_actor_type_for_management(p_access_token),
    (SELECT auth.uid()),
    public.portal_actor_name_for_management(),
    'company_location_created',
    'company_location',
    v_saved.id,
    NULL,
    to_jsonb(v_saved),
    '{}'::jsonb
  );

  RETURN to_jsonb(v_saved);
END;
$function$;

REVOKE ALL ON FUNCTION public.create_company_portal_location(uuid, uuid, jsonb)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_company_portal_location(uuid, uuid, jsonb)
  TO anon, authenticated;

COMMIT;
