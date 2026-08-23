BEGIN;

DROP FUNCTION IF EXISTS public.get_company_location_lead_spreadsheet(
  uuid, uuid, uuid, text, text, integer, integer
);

CREATE FUNCTION public.get_company_location_lead_spreadsheet(
  p_company_id uuid,
  p_access_token uuid,
  p_location_id uuid DEFAULT NULL,
  p_filter text DEFAULT 'all',
  p_search text DEFAULT NULL,
  p_limit integer DEFAULT 100,
  p_offset integer DEFAULT 0,
  p_representative_id uuid DEFAULT NULL,
  p_start_date date DEFAULT NULL,
  p_end_date date DEFAULT NULL
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
  v_company_id := public.portal_resolve_company_access(
    p_company_id,
    p_access_token
  );

  IF p_location_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.company_locations AS location
    WHERE location.id = p_location_id
      AND location.company_id = v_company_id
  ) THEN
    RAISE EXCEPTION 'Invalid company location';
  END IF;

  IF p_representative_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.company_representatives AS representative
    WHERE representative.id = p_representative_id
      AND representative.company_id = v_company_id
  ) THEN
    RAISE EXCEPTION 'Invalid company inspector';
  END IF;

  IF p_start_date IS NOT NULL
    AND p_end_date IS NOT NULL
    AND p_end_date < p_start_date
  THEN
    RAISE EXCEPTION 'End date must be on or after start date';
  END IF;

  IF v_filter NOT IN (
    'all',
    'good',
    'no_show',
    'rescheduled',
    'signed_contract',
    'pending'
  ) THEN
    RAISE EXCEPTION 'Invalid company lead filter';
  END IF;

  RETURN (
    WITH base AS MATERIALIZED (
      SELECT
        appointment.*,
        lead.id AS source_lead_id_internal,
        lead.lead_code,
        lead.full_name,
        lead.phone_number,
        lead.email,
        lead.address,
        lead.city,
        lead.state AS lead_state,
        lead.zip_code,
        lead.service_needed,
        lead.language,
        lead.notes,
        lead.form_data,
        lead.qualification_status,
        lead.recording_url,
        lead.share_recording_with_company,
        lead.created_at AS lead_created_at,
        location.location_label,
        representative.name AS representative_name
      FROM public.portal_appointments AS appointment
      JOIN public.portal_leads AS lead ON lead.id = appointment.lead_id
      LEFT JOIN public.company_locations AS location
        ON location.id = appointment.location_id
      LEFT JOIN public.company_representatives AS representative
        ON representative.id = appointment.representative_id
      WHERE appointment.company_id = v_company_id
        AND (
          p_location_id IS NULL
          OR appointment.location_id = p_location_id
        )
        AND (
          p_representative_id IS NULL
          OR appointment.representative_id = p_representative_id
        )
        AND (
          p_start_date IS NULL
          OR appointment.appointment_date >= p_start_date
        )
        AND (
          p_end_date IS NULL
          OR appointment.appointment_date <= p_end_date
        )
        AND lead.qc_status = 'approved'
        AND appointment.company_visible_at IS NOT NULL
    ),
    filtered AS MATERIALIZED (
      SELECT *
      FROM base AS lead_row
      WHERE (
        v_filter = 'all'
        OR (
          v_filter = 'good'
          AND (
            lead_row.canonical_status = 'good_inspected'
            OR lead_row.company_action = 'inspected'
          )
        )
        OR (
          v_filter = 'no_show'
          AND (
            lead_row.canonical_status = 'no_show'
            OR lead_row.client_status = 'no_show'
            OR lead_row.company_action = 'no_show'
          )
        )
        OR (
          v_filter = 'rescheduled'
          AND (
            lead_row.canonical_status = 'rescheduled'
            OR lead_row.client_status = 'reschedule'
            OR lead_row.company_action = 'rescheduled'
          )
        )
        OR (
          v_filter = 'signed_contract'
          AND (
            lead_row.canonical_status = 'signed_contract'
            OR lead_row.sales_outcome = 'signed_contract'
            OR lead_row.company_action = 'signed_contract'
          )
        )
        OR (
          v_filter = 'pending'
          AND coalesce(lead_row.company_action, 'pending') = 'pending'
        )
      )
      AND (
        v_search = ''
        OR concat_ws(
          ' ',
          lead_row.lead_code,
          lead_row.full_name,
          lead_row.phone_number,
          lead_row.email,
          lead_row.address,
          lead_row.city,
          lead_row.lead_state,
          lead_row.zip_code,
          lead_row.service_needed,
          lead_row.location_label,
          lead_row.representative_name
        ) ILIKE '%' || v_search || '%'
        OR (
          length(v_digits) >= 4
          AND regexp_replace(
            coalesce(lead_row.phone_number, ''),
            '[^0-9]',
            '',
            'g'
          ) LIKE '%' || v_digits || '%'
        )
      )
    ),
    paged AS (
      SELECT *
      FROM filtered
      ORDER BY appointment_date DESC, start_time DESC, lead_created_at DESC
      LIMIT v_limit
      OFFSET v_offset
    )
    SELECT jsonb_build_object(
      'total', (SELECT count(*) FROM filtered),
      'limit', v_limit,
      'offset', v_offset,
      'summary', jsonb_build_object(
        'delivered', (SELECT count(*) FROM base),
        'good', (
          SELECT count(*) FROM base
          WHERE canonical_status = 'good_inspected'
            OR company_action = 'inspected'
        ),
        'no_show', (
          SELECT count(*) FROM base
          WHERE canonical_status = 'no_show'
            OR client_status = 'no_show'
            OR company_action = 'no_show'
        ),
        'rescheduled', (
          SELECT count(*) FROM base
          WHERE canonical_status = 'rescheduled'
            OR client_status = 'reschedule'
            OR company_action = 'rescheduled'
        ),
        'signed_contract', (
          SELECT count(*) FROM base
          WHERE canonical_status = 'signed_contract'
            OR sales_outcome = 'signed_contract'
            OR company_action = 'signed_contract'
        ),
        'pending', (
          SELECT count(*) FROM base
          WHERE coalesce(company_action, 'pending') = 'pending'
        )
      ),
      'rows', coalesce((
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', page_row.id,
            'lead_id', page_row.lead_id,
            'company_id', page_row.company_id,
            'location_id', page_row.location_id,
            'representative_id', page_row.representative_id,
            'appointment_date', page_row.appointment_date,
            'start_time', page_row.start_time,
            'end_time', page_row.end_time,
            'timezone', page_row.timezone,
            'status', page_row.status,
            'canonical_status', page_row.canonical_status,
            'rep_status', page_row.rep_status,
            'attendance_status', page_row.attendance_status,
            'inspection_status', page_row.inspection_status,
            'sales_outcome', page_row.sales_outcome,
            'client_status', page_row.client_status,
            'company_action', page_row.company_action,
            'inspector_notes', page_row.inspector_notes,
            'company_visible_at', page_row.company_visible_at,
            'last_company_update_at', page_row.last_company_update_at,
            'lead', jsonb_build_object(
              'id', page_row.source_lead_id_internal,
              'lead_code', page_row.lead_code,
              'full_name', page_row.full_name,
              'phone_number', page_row.phone_number,
              'email', page_row.email,
              'address', page_row.address,
              'city', page_row.city,
              'state', page_row.lead_state,
              'zip_code', page_row.zip_code,
              'service_needed', page_row.service_needed,
              'language', page_row.language,
              'notes', page_row.notes,
              'form_data', coalesce(page_row.form_data, '{}'::jsonb)
                - 'recording_url'
                - 'recording'
                - 'audio_url'
                - 'call_recording'
                - 'recording_link',
              'qualification_status', page_row.qualification_status,
              'recording_url', CASE
                WHEN page_row.share_recording_with_company
                  THEN page_row.recording_url
                ELSE NULL
              END,
              'recording_shared', page_row.share_recording_with_company,
              'created_at', page_row.lead_created_at
            ),
            'location_label', page_row.location_label,
            'representative_name', page_row.representative_name,
            'latest_checkin', NULL
          )
          ORDER BY
            page_row.appointment_date DESC,
            page_row.start_time DESC,
            page_row.lead_created_at DESC
        )
        FROM paged AS page_row
      ), '[]'::jsonb)
    )
  );
END;
$function$;

CREATE INDEX IF NOT EXISTS idx_portal_appointments_company_date
  ON public.portal_appointments (company_id, appointment_date DESC);

CREATE INDEX IF NOT EXISTS idx_portal_appointments_company_rep_date
  ON public.portal_appointments (
    company_id,
    representative_id,
    appointment_date DESC
  );

CREATE INDEX IF NOT EXISTS idx_portal_appointments_company_location_date
  ON public.portal_appointments (
    company_id,
    location_id,
    appointment_date DESC
  );

REVOKE ALL ON FUNCTION public.get_company_location_lead_spreadsheet(
  uuid, uuid, uuid, text, text, integer, integer, uuid, date, date
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_company_location_lead_spreadsheet(
  uuid, uuid, uuid, text, text, integer, integer, uuid, date, date
) TO anon, authenticated;

COMMENT ON FUNCTION public.get_company_location_lead_spreadsheet(
  uuid, uuid, uuid, text, text, integer, integer, uuid, date, date
) IS 'Returns token-authorized company leads filtered by status, location, inspector, and appointment date range.';

COMMIT;
