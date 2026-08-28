-- Imported from the hosted ReadyOp Supabase migration history on 2026-08-28.
-- Schema only: no production table data is included.

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
  WHERE r.company_id = v_company_id AND r.location_id IS NULL
  ON CONFLICT (company_id, location_id, day_of_week) DO NOTHING;

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

CREATE OR REPLACE FUNCTION public.update_company_portal_location(
  p_company_id uuid,
  p_access_token uuid,
  p_location_id uuid,
  p_patch jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_company_id uuid;
  v_old public.company_locations%ROWTYPE;
  v_new public.company_locations%ROWTYPE;
BEGIN
  v_company_id := public.portal_resolve_company_access(p_company_id, p_access_token);
  IF jsonb_typeof(coalesce(p_patch, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'Location changes must be an object';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_object_keys(coalesce(p_patch, '{}'::jsonb)) AS key
    WHERE key NOT IN (
      'location_label', 'office_name', 'address', 'city', 'state', 'zip_code',
      'service_cities', 'service_zips', 'phone', 'email', 'manager_name',
      'timezone', 'notes', 'active'
    )
  ) THEN RAISE EXCEPTION 'Location changes contain an unsupported field'; END IF;
  IF p_patch ? 'location_label' AND nullif(trim(p_patch->>'location_label'), '') IS NULL THEN
    RAISE EXCEPTION 'Location or service-area name is required';
  END IF;
  IF p_patch ? 'service_cities' AND jsonb_typeof(p_patch->'service_cities') <> 'array' THEN
    RAISE EXCEPTION 'Service cities must be a list';
  END IF;
  IF p_patch ? 'service_zips' AND jsonb_typeof(p_patch->'service_zips') <> 'array' THEN
    RAISE EXCEPTION 'Service ZIP codes must be a list';
  END IF;

  SELECT * INTO v_old
  FROM public.company_locations AS l
  WHERE l.id = p_location_id AND l.company_id = v_company_id
  FOR UPDATE;
  IF v_old.id IS NULL THEN RAISE EXCEPTION 'Company location was not found'; END IF;

  UPDATE public.company_locations
  SET location_label = CASE WHEN p_patch ? 'location_label' THEN trim(p_patch->>'location_label') ELSE location_label END,
      office_name = CASE WHEN p_patch ? 'office_name' THEN nullif(trim(p_patch->>'office_name'), '') ELSE office_name END,
      address = CASE WHEN p_patch ? 'address' THEN nullif(trim(p_patch->>'address'), '') ELSE address END,
      city = CASE WHEN p_patch ? 'city' THEN nullif(trim(p_patch->>'city'), '') ELSE city END,
      state = CASE WHEN p_patch ? 'state' THEN nullif(upper(trim(p_patch->>'state')), '') ELSE state END,
      zip_code = CASE WHEN p_patch ? 'zip_code' THEN nullif(trim(p_patch->>'zip_code'), '') ELSE zip_code END,
      service_cities = CASE WHEN p_patch ? 'service_cities' THEN ARRAY(
        SELECT DISTINCT trim(value)
        FROM jsonb_array_elements_text(p_patch->'service_cities')
        WHERE nullif(trim(value), '') IS NOT NULL
      ) ELSE service_cities END,
      service_zips = CASE WHEN p_patch ? 'service_zips' THEN ARRAY(
        SELECT DISTINCT trim(value)
        FROM jsonb_array_elements_text(p_patch->'service_zips')
        WHERE nullif(trim(value), '') IS NOT NULL
      ) ELSE service_zips END,
      phone = CASE WHEN p_patch ? 'phone' THEN nullif(trim(p_patch->>'phone'), '') ELSE phone END,
      email = CASE WHEN p_patch ? 'email' THEN nullif(lower(trim(p_patch->>'email')), '') ELSE email END,
      manager_name = CASE WHEN p_patch ? 'manager_name' THEN nullif(trim(p_patch->>'manager_name'), '') ELSE manager_name END,
      timezone = CASE WHEN p_patch ? 'timezone' THEN coalesce(nullif(trim(p_patch->>'timezone'), ''), timezone) ELSE timezone END,
      notes = CASE WHEN p_patch ? 'notes' THEN nullif(trim(p_patch->>'notes'), '') ELSE notes END,
      active = CASE WHEN p_patch ? 'active' THEN (p_patch->>'active')::boolean ELSE active END,
      updated_at = now()
  WHERE id = v_old.id
  RETURNING * INTO v_new;

  PERFORM public.portal_write_audit(
    v_company_id,
    public.portal_actor_type_for_management(p_access_token),
    (SELECT auth.uid()),
    public.portal_actor_name_for_management(),
    'company_location_updated',
    'company_location',
    v_new.id,
    to_jsonb(v_old),
    to_jsonb(v_new),
    '{}'::jsonb
  );

  RETURN to_jsonb(v_new);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_company_location_lead_spreadsheet(
  p_company_id uuid,
  p_access_token uuid,
  p_location_id uuid DEFAULT NULL,
  p_filter text DEFAULT 'all',
  p_search text DEFAULT NULL,
  p_limit integer DEFAULT 100,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_company_id uuid;
  v_filter text := lower(trim(coalesce(p_filter, 'all')));
  v_search text := trim(coalesce(p_search, ''));
  v_digits text := regexp_replace(coalesce(p_search, ''), '[^0-9]', '', 'g');
  v_limit integer := least(greatest(coalesce(p_limit, 100), 10), 200);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
BEGIN
  v_company_id := public.portal_resolve_company_access(p_company_id, p_access_token);
  IF p_location_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.company_locations AS l
    WHERE l.id = p_location_id AND l.company_id = v_company_id
  ) THEN RAISE EXCEPTION 'Invalid company location'; END IF;
  IF v_filter NOT IN ('all', 'good', 'no_show', 'rescheduled', 'signed_contract', 'pending') THEN
    RAISE EXCEPTION 'Invalid company lead filter';
  END IF;

  RETURN (
    WITH base AS MATERIALIZED (
      SELECT a.*, l.id AS source_lead_id_internal, l.lead_code, l.full_name, l.phone_number,
        l.email, l.address, l.city, l.state AS lead_state, l.zip_code, l.service_needed,
        l.language, l.notes, l.form_data, l.qualification_status, l.recording_url,
        l.share_recording_with_company, l.created_at AS lead_created_at,
        loc.location_label, rep.name AS representative_name
      FROM public.portal_appointments AS a
      JOIN public.portal_leads AS l ON l.id = a.lead_id
      LEFT JOIN public.company_locations AS loc ON loc.id = a.location_id
      LEFT JOIN public.company_representatives AS rep ON rep.id = a.representative_id
      WHERE a.company_id = v_company_id
        AND (p_location_id IS NULL OR a.location_id = p_location_id)
        AND l.qc_status = 'approved'
        AND a.company_visible_at IS NOT NULL
    ),
    filtered AS MATERIALIZED (
      SELECT * FROM base AS b
      WHERE (
        v_filter = 'all'
        OR (v_filter = 'good' AND (b.canonical_status = 'good_inspected' OR b.company_action = 'inspected'))
        OR (v_filter = 'no_show' AND (b.canonical_status = 'no_show' OR b.client_status = 'no_show' OR b.company_action = 'no_show'))
        OR (v_filter = 'rescheduled' AND (b.canonical_status = 'rescheduled' OR b.client_status = 'reschedule' OR b.company_action = 'rescheduled'))
        OR (v_filter = 'signed_contract' AND (b.canonical_status = 'signed_contract' OR b.sales_outcome = 'signed_contract' OR b.company_action = 'signed_contract'))
        OR (v_filter = 'pending' AND coalesce(b.company_action, 'pending') = 'pending')
      )
      AND (
        v_search = ''
        OR concat_ws(' ', b.lead_code, b.full_name, b.phone_number, b.email, b.address,
          b.city, b.lead_state, b.zip_code, b.service_needed, b.location_label,
          b.representative_name) ILIKE '%' || v_search || '%'
        OR (length(v_digits) >= 4 AND regexp_replace(coalesce(b.phone_number, ''), '[^0-9]', '', 'g') LIKE '%' || v_digits || '%')
      )
    ),
    paged AS (
      SELECT * FROM filtered
      ORDER BY appointment_date DESC, start_time DESC, lead_created_at DESC
      LIMIT v_limit OFFSET v_offset
    )
    SELECT jsonb_build_object(
      'total', (SELECT count(*) FROM filtered),
      'limit', v_limit,
      'offset', v_offset,
      'summary', jsonb_build_object(
        'delivered', (SELECT count(*) FROM base),
        'good', (SELECT count(*) FROM base WHERE canonical_status = 'good_inspected' OR company_action = 'inspected'),
        'no_show', (SELECT count(*) FROM base WHERE canonical_status = 'no_show' OR client_status = 'no_show' OR company_action = 'no_show'),
        'rescheduled', (SELECT count(*) FROM base WHERE canonical_status = 'rescheduled' OR client_status = 'reschedule' OR company_action = 'rescheduled'),
        'signed_contract', (SELECT count(*) FROM base WHERE canonical_status = 'signed_contract' OR sales_outcome = 'signed_contract' OR company_action = 'signed_contract'),
        'pending', (SELECT count(*) FROM base WHERE coalesce(company_action, 'pending') = 'pending')
      ),
      'rows', coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'id', p.id, 'lead_id', p.lead_id, 'company_id', p.company_id,
          'location_id', p.location_id, 'representative_id', p.representative_id,
          'appointment_date', p.appointment_date, 'start_time', p.start_time,
          'end_time', p.end_time, 'timezone', p.timezone, 'status', p.status,
          'canonical_status', p.canonical_status, 'rep_status', p.rep_status,
          'attendance_status', p.attendance_status, 'inspection_status', p.inspection_status,
          'sales_outcome', p.sales_outcome, 'client_status', p.client_status,
          'company_action', p.company_action, 'inspector_notes', p.inspector_notes,
          'company_visible_at', p.company_visible_at, 'last_company_update_at', p.last_company_update_at,
          'lead', jsonb_build_object(
            'id', p.source_lead_id_internal, 'lead_code', p.lead_code, 'full_name', p.full_name,
            'phone_number', p.phone_number, 'email', p.email, 'address', p.address,
            'city', p.city, 'state', p.lead_state, 'zip_code', p.zip_code,
            'service_needed', p.service_needed, 'language', p.language, 'notes', p.notes,
            'form_data', coalesce(p.form_data, '{}'::jsonb) - 'recording_url' - 'recording' - 'audio_url' - 'call_recording' - 'recording_link',
            'qualification_status', p.qualification_status,
            'recording_url', CASE WHEN p.share_recording_with_company THEN p.recording_url ELSE NULL END,
            'recording_shared', p.share_recording_with_company,
            'created_at', p.lead_created_at
          ),
          'location_label', p.location_label,
          'representative_name', p.representative_name,
          'latest_checkin', NULL
        ) ORDER BY p.appointment_date DESC, p.start_time DESC, p.lead_created_at DESC)
        FROM paged AS p
      ), '[]'::jsonb)
    )
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.create_company_portal_location(uuid, uuid, jsonb)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_company_portal_location(uuid, uuid, uuid, jsonb)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_company_location_lead_spreadsheet(uuid, uuid, uuid, text, text, integer, integer)
  FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.create_company_portal_location(uuid, uuid, jsonb)
  TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_company_portal_location(uuid, uuid, uuid, jsonb)
  TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_company_location_lead_spreadsheet(uuid, uuid, uuid, text, text, integer, integer)
  TO anon, authenticated;

COMMENT ON FUNCTION public.create_company_portal_location(uuid, uuid, jsonb)
IS 'Creates a location for the token-authorized company and copies its company-wide schedule defaults.';
COMMENT ON FUNCTION public.update_company_portal_location(uuid, uuid, uuid, jsonb)
IS 'Updates or deactivates a location owned by the token-authorized company.';
COMMENT ON FUNCTION public.get_company_location_lead_spreadsheet(uuid, uuid, uuid, text, text, integer, integer)
IS 'Returns the token-authorized company lead spreadsheet and status counts scoped to an optional company location.';

COMMIT;


