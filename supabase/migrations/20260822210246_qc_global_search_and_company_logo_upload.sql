BEGIN;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'company-logos',
  'company-logos',
  true,
  5242880,
  ARRAY['image/png', 'image/jpeg', 'image/webp']::text[]
)
ON CONFLICT (id) DO UPDATE
SET public = true,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

ALTER TABLE public.portal_appointments
  ADD COLUMN IF NOT EXISTS company_action text NOT NULL DEFAULT 'pending';

CREATE OR REPLACE FUNCTION public.company_update_lead_outcome(
  p_company_id uuid,
  p_access_token uuid,
  p_appointment_id uuid,
  p_client_status text,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_company uuid;
  v_old public.portal_appointments%ROWTYPE;
  v_new public.portal_appointments%ROWTYPE;
  v_action text := lower(trim(coalesce(p_client_status, '')));
  v_client_status text;
BEGIN
  v_company := public.portal_resolve_company_access(p_company_id, p_access_token);

  IF v_action NOT IN (
    'pending', 'contacted', 'confirmed', 'inspected', 'no_show', 'rescheduled',
    'estimate_given', 'claim_filed', 'signed_contract', 'lost',
    'good', 'bad', 'reschedule', 'follow_up'
  ) THEN
    RAISE EXCEPTION 'Invalid company lead status';
  END IF;

  SELECT a.* INTO v_old
  FROM public.portal_appointments AS a
  JOIN public.portal_leads AS l ON l.id = a.lead_id
  WHERE a.id = p_appointment_id
    AND a.company_id = v_company
    AND l.qc_status = 'approved'
  FOR UPDATE OF a;

  IF v_old.id IS NULL THEN
    RAISE EXCEPTION 'QC Approved appointment not found';
  END IF;

  v_client_status := CASE v_action
    WHEN 'inspected' THEN 'good'
    WHEN 'no_show' THEN 'no_show'
    WHEN 'rescheduled' THEN 'reschedule'
    WHEN 'signed_contract' THEN 'signed_contract'
    WHEN 'lost' THEN 'bad'
    WHEN 'good' THEN 'good'
    WHEN 'bad' THEN 'bad'
    WHEN 'reschedule' THEN 'reschedule'
    ELSE 'pending'
  END;

  UPDATE public.portal_appointments
  SET company_action = v_action,
      client_status = v_client_status,
      inspector_notes = CASE
        WHEN nullif(trim(coalesce(p_notes, '')), '') IS NULL THEN inspector_notes
        ELSE trim(p_notes)
      END,
      last_company_update_at = now(),
      status = CASE WHEN v_action = 'confirmed' THEN 'confirmed' ELSE status END,
      attendance_status = CASE WHEN v_action = 'no_show' THEN 'homeowner_no_show' ELSE attendance_status END,
      inspection_status = CASE WHEN v_action = 'inspected' THEN 'completed' ELSE inspection_status END,
      sales_outcome = CASE
        WHEN v_action = 'signed_contract' THEN 'signed_contract'
        WHEN v_action = 'lost' THEN 'lost'
        WHEN v_action IN ('estimate_given', 'claim_filed', 'follow_up') THEN 'follow_up'
        ELSE sales_outcome
      END
  WHERE id = v_old.id
  RETURNING * INTO v_new;

  PERFORM public.portal_write_audit(
    v_company, 'company', NULL, 'Company', 'company_lead_outcome_updated',
    'appointment', v_new.id, to_jsonb(v_old), to_jsonb(v_new),
    jsonb_build_object('company_action', v_action)
  );
  RETURN to_jsonb(v_new);
END;
$function$;

REVOKE ALL ON FUNCTION public.company_update_lead_outcome(uuid, uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.company_update_lead_outcome(uuid, uuid, uuid, text, text)
  TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.search_qc_leads_global(
  p_search text,
  p_company_id uuid DEFAULT NULL,
  p_location_id uuid DEFAULT NULL,
  p_team_id uuid DEFAULT NULL,
  p_agent_id uuid DEFAULT NULL,
  p_qc_status text DEFAULT NULL,
  p_appointment_status text DEFAULT NULL,
  p_state text DEFAULT NULL,
  p_service_area text DEFAULT NULL,
  p_limit integer DEFAULT 100
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_role text := private.readyops_profile_role();
  v_manager_team_id uuid;
  v_term text := trim(coalesce(p_search, ''));
  v_digits text := regexp_replace(coalesce(p_search, ''), '[^0-9]', '', 'g');
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 100);
BEGIN
  IF (SELECT auth.uid()) IS NULL OR v_role NOT IN ('admin', 'qc', 'manager') THEN
    RAISE EXCEPTION 'QC reviewer access required';
  END IF;
  IF length(v_term) < 2 THEN
    RAISE EXCEPTION 'Enter at least 2 characters to search all history';
  END IF;

  SELECT p.team_id INTO v_manager_team_id
  FROM public.profiles AS p
  WHERE p.id = (SELECT auth.uid());

  RETURN (
    WITH filtered AS MATERIALIZED (
      SELECT
        l.id AS lead_id,
        a.id AS appointment_id,
        (l.created_at AT TIME ZONE coalesce(loc.timezone, s.timezone, 'America/Chicago'))::date AS received_date,
        a.appointment_date,
        a.start_time,
        a.canonical_status,
        c.id AS company_id,
        c.name AS company_name,
        to_jsonb(l) || jsonb_build_object(
          'received_date', (l.created_at AT TIME ZONE coalesce(loc.timezone, s.timezone, 'America/Chicago'))::date,
          'received_timezone', coalesce(loc.timezone, s.timezone, 'America/Chicago')
        ) AS lead_json,
        to_jsonb(a) AS appointment_json,
        CASE WHEN q.id IS NULL THEN NULL ELSE to_jsonb(q) END AS qc_review_json,
        jsonb_build_object(
          'id', c.id, 'name', c.name, 'state', c.state, 'metro_tag', c.metro_tag,
          'logo_path', c.logo_path, 'requirements_note', c.requirements_note
        ) AS company_json,
        CASE WHEN loc.id IS NULL THEN NULL ELSE jsonb_build_object(
          'id', loc.id, 'label', loc.location_label, 'state', loc.state,
          'metro_tag', loc.metro_tag, 'timezone', loc.timezone
        ) END AS location_json,
        CASE WHEN ag.id IS NULL THEN NULL ELSE jsonb_build_object(
          'id', ag.id, 'name', ag.name, 'team_id', ag.team_id, 'portal_slug', ag.portal_slug
        ) END AS agent_json,
        CASE WHEN cp.id IS NULL THEN NULL ELSE to_jsonb(cp) END AS package_json,
        jsonb_build_object(
          'public_slug', s.public_slug, 'requirements_short', s.requirements_short,
          'requirements_detail', s.requirements_detail, 'qualification_rules', s.qualification_rules,
          'form_mode', s.form_mode, 'external_form_provider', s.external_form_provider,
          'external_form_url', s.external_form_url, 'external_prefill_map', s.external_prefill_map
        ) AS portal_json,
        coalesce(q.status, l.qc_status) AS current_qc_status
      FROM public.portal_leads AS l
      JOIN public.portal_appointments AS a ON a.lead_id = l.id
      JOIN public.roster_companies AS c ON c.id = l.company_id
      LEFT JOIN public.company_locations AS loc ON loc.id = l.location_id
      LEFT JOIN public.agents AS ag ON ag.id = l.agent_id
      LEFT JOIN public.company_packages AS cp ON cp.id = l.package_id
      LEFT JOIN public.company_portal_settings AS s ON s.company_id = l.company_id
      LEFT JOIN public.qc_review_cycles AS q ON q.lead_id = l.id AND q.is_current
      WHERE a.status <> 'draft'
        AND private.readyops_can_access_company(l.company_id)
        AND (
          v_role IN ('admin', 'qc')
          OR (v_role = 'manager' AND v_manager_team_id IS NOT NULL AND ag.team_id = v_manager_team_id)
        )
        AND (p_company_id IS NULL OR l.company_id = p_company_id)
        AND (p_location_id IS NULL OR l.location_id = p_location_id)
        AND (p_team_id IS NULL OR ag.team_id = p_team_id)
        AND (p_agent_id IS NULL OR l.agent_id = p_agent_id)
        AND (p_qc_status IS NULL OR p_qc_status = 'all' OR coalesce(q.status, l.qc_status) = p_qc_status)
        AND (p_appointment_status IS NULL OR p_appointment_status = 'all' OR a.canonical_status = p_appointment_status OR a.status = p_appointment_status)
        AND (p_state IS NULL OR p_state = 'all' OR coalesce(loc.state, c.state) = p_state)
        AND (p_service_area IS NULL OR p_service_area = 'all' OR coalesce(loc.metro_tag, c.metro_tag) = p_service_area)
        AND (
          concat_ws(' ', l.lead_code, l.full_name, l.phone_number, l.email, l.address,
            l.city, l.state, l.zip_code, l.source, c.name, ag.name)
            ILIKE '%' || v_term || '%'
          OR (length(v_digits) >= 4 AND regexp_replace(coalesce(l.phone_number, ''), '[^0-9]', '', 'g') LIKE '%' || v_digits || '%')
        )
    ),
    totals AS (
      SELECT
        count(*) AS total,
        count(DISTINCT company_id) AS companies,
        count(*) FILTER (WHERE current_qc_status = 'pending') AS pending,
        count(*) FILTER (WHERE current_qc_status = 'in_review') AS in_review,
        count(*) FILTER (WHERE current_qc_status = 'manager_approved') AS manager_approved,
        count(*) FILTER (WHERE current_qc_status = 'approved') AS approved,
        count(*) FILTER (WHERE current_qc_status = 'denied') AS denied,
        count(*) FILTER (WHERE current_qc_status = 'needs_correction') AS needs_correction
      FROM filtered
    ),
    limited AS (
      SELECT * FROM filtered
      ORDER BY received_date DESC, appointment_date DESC, start_time, company_name
      LIMIT v_limit
    )
    SELECT jsonb_build_object(
      'scope', 'all_history',
      'search', v_term,
      'limit', v_limit,
      'total', t.total,
      'truncated', t.total > v_limit,
      'days', '[]'::jsonb,
      'summary', jsonb_build_object(
        'companies', t.companies, 'scheduled', t.total, 'pending', t.pending,
        'in_review', t.in_review, 'manager_approved', t.manager_approved,
        'approved', t.approved, 'denied', t.denied,
        'needs_correction', t.needs_correction
      ),
      'rows', coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'filter_date', f.received_date,
          'lead', f.lead_json,
          'appointment', f.appointment_json,
          'qc_review', f.qc_review_json,
          'company', f.company_json,
          'location', f.location_json,
          'agent', f.agent_json,
          'package', f.package_json,
          'portal', f.portal_json
        ) ORDER BY f.received_date DESC, f.appointment_date DESC, f.start_time, f.company_name)
        FROM limited AS f
      ), '[]'::jsonb)
    )
    FROM totals AS t
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.search_qc_leads_global(
  text, uuid, uuid, uuid, uuid, text, text, text, text, integer
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_qc_leads_global(
  text, uuid, uuid, uuid, uuid, text, text, text, text, integer
) TO authenticated;

COMMENT ON FUNCTION public.search_qc_leads_global(
  text, uuid, uuid, uuid, uuid, text, text, text, text, integer
) IS 'Searches the full QC lead history, including normalized phone numbers, while enforcing company and manager-team access.';

COMMENT ON COLUMN public.portal_appointments.company_action
IS 'Latest quick-action status selected by the company, preserved separately from canonical ReadyOps status.';

COMMIT;
