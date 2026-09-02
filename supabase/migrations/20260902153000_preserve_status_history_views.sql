BEGIN;

CREATE OR REPLACE FUNCTION public.get_representative_portal(
  p_access_token uuid,
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
  v_rep public.company_representatives%ROWTYPE;
BEGIN
  SELECT representative.* INTO v_rep
  FROM public.company_representatives AS representative
  WHERE representative.access_token = p_access_token
    AND representative.active;

  IF v_rep.id IS NULL THEN
    RAISE EXCEPTION 'Representative link is invalid or disabled';
  END IF;

  RETURN jsonb_build_object(
    'representative', to_jsonb(v_rep) - 'access_token',
    'company', (
      SELECT to_jsonb(company)
      FROM public.roster_companies AS company
      WHERE company.id = v_rep.company_id
    ),
    'settings', (
      SELECT jsonb_build_object('timezone', settings.timezone)
      FROM public.company_portal_settings AS settings
      WHERE settings.company_id = v_rep.company_id
    ),
    'appointments', coalesce((
      SELECT jsonb_agg(
        to_jsonb(appointment) || jsonb_build_object(
          'lead',
            (to_jsonb(lead) - 'recording_url' - 'share_recording_with_company' - 'form_data') ||
            jsonb_build_object(
              'form_data', coalesce(lead.form_data, '{}'::jsonb)
                - 'recording_url' - 'recording' - 'audio_url'
                - 'call_recording' - 'recording_link',
              'recording_url', CASE
                WHEN lead.share_recording_with_company THEN lead.recording_url
                ELSE NULL
              END,
              'recording_shared', lead.share_recording_with_company
            )
        )
        ORDER BY appointment.appointment_date, appointment.start_time
      )
      FROM public.portal_appointments AS appointment
      JOIN public.portal_leads AS lead ON lead.id = appointment.lead_id
      WHERE appointment.representative_id = v_rep.id
        AND appointment.appointment_date BETWEEN p_start_date AND p_end_date
        AND appointment.status <> 'qc_denied'
        AND lead.qc_status = 'approved'
        AND appointment.company_visible_at IS NOT NULL
    ), '[]'::jsonb)
  );
END;
$function$;

COMMENT ON FUNCTION public.get_representative_portal(uuid, date, date)
  IS 'Returns representative appointments including completed, canceled, and rescheduled history without GPS check-in data.';

REVOKE ALL ON FUNCTION public.get_representative_portal(uuid, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_representative_portal(uuid, date, date) TO anon, authenticated;

-- Keep the existing spreadsheet query topology while extending each returned
-- row with the separately persisted receipt acknowledgement fields. The
-- explicit guard makes this migration fail loudly if the prior function shape
-- changes instead of silently leaving the portal inconsistent.
DO $migration$
DECLARE
  v_definition text;
  v_needle text := '''company_action'', page_row.company_action,';
  v_replacement text := '''company_action'', page_row.company_action,
            ''client_received'', page_row.client_received,
            ''received_at'', page_row.received_at,
            ''received_by'', page_row.received_by,';
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_definition
  FROM pg_proc AS p
  JOIN pg_namespace AS n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'get_company_location_lead_spreadsheet'
    AND pg_get_function_identity_arguments(p.oid) =
      'p_company_id uuid, p_access_token uuid, p_location_id uuid, p_filter text, p_search text, p_limit integer, p_offset integer, p_representative_id uuid, p_start_date date, p_end_date date';

  IF v_definition IS NULL OR position(v_needle IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Company lead spreadsheet function shape was not recognized';
  END IF;

  v_definition := replace(v_definition, v_needle, v_replacement);
  v_definition := replace(
    v_definition,
    'lead_row.company_action = ''inspected''',
    'lead_row.company_action IN (''good'', ''inspected'', ''good_inspected'')'
  );
  v_definition := replace(
    v_definition,
    'company_action = ''inspected''',
    'company_action IN (''good'', ''inspected'', ''good_inspected'')'
  );

  EXECUTE v_definition;
END;
$migration$;

REVOKE ALL ON FUNCTION public.get_company_location_lead_spreadsheet(
  uuid, uuid, uuid, text, text, integer, integer, uuid, date, date
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_company_location_lead_spreadsheet(
  uuid, uuid, uuid, text, text, integer, integer, uuid, date, date
) TO anon, authenticated;

COMMIT;
