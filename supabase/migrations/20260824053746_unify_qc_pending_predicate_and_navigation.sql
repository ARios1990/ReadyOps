-- Imported from the hosted ReadyOp Supabase migration history on 2026-08-28.
-- Schema only: no production table data is included.


-- Canonicalize the "QC needs review" predicate so the Overview dashboard, the
-- Companies & Scheduling overview, and the QC Queue all agree.
--
-- Semantics of "needs review" (umbrella pending): the lead's CURRENT QC status
-- (taken from qc_review_cycles.is_current when present, otherwise from
-- portal_leads.qc_status) is one of:
--     pending, in_review, needs_correction
-- and its appointment is not in a terminal or draft state (draft/cancelled/
-- rescheduled). Manager-approved is a distinct workflow step and does not count
-- as "needs review" for the operator dashboard.

-- 1) Overview dashboard company aggregates: use the same resolved status the
-- queue uses (coalesce(review cycle status, lead status)).
CREATE OR REPLACE FUNCTION public.get_company_operations_overview()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF NOT public.portal_is_admin() THEN RAISE EXCEPTION 'Admin access required';
 END IF;

  RETURN coalesce((
    SELECT jsonb_agg(row_data ORDER BY (row_data->>'active_package')::boolean DESC, row_data->>'company_name')
    FROM (
      SELECT jsonb_build_object(
        'company_id', c.id,
        'company_name', c.name,
        'state', c.state,
        'metro_tag', c.metro_tag,
        'logo_path', c.logo_path,
        'contact_name', c.contact_name,
        'phone', c.phone,
        'email', c.email,
        'account_status', c.account_status,
        'public_slug', s.public_slug,
        'agent_link', CASE WHEN s.public_slug IS NULL THEN NULL ELSE '/book/' || s.public_slug || '?' || public.ready_mode_prefill_query() END,
        'plain_agent_link', CASE WHEN s.public_slug IS NULL THEN NULL ELSE '/book/' || s.public_slug END,
        'company_link', CASE WHEN s.public_slug IS NULL OR s.company_access_token IS NULL THEN NULL ELSE '/company/' || s.public_slug || '/manage/' || s.company_access_token END,
        'teams', coalesce((
          SELECT jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'abbreviation', t.abbreviation) ORDER BY t.name)
          FROM public.company_teams AS ct
          JOIN public.teams AS t ON t.id = ct.team_id
          WHERE ct.company_id = c.id
        ), '[]'::jsonb),
        'total_leads', (
          SELECT count(DISTINCT l.id)
          FROM public.portal_leads AS l
          JOIN public.portal_appointments AS a ON a.lead_id = l.id
          WHERE l.company_id = c.id
            AND l.qc_status = 'approved'
            AND a.company_visible_at IS NOT NULL
            AND a.status NOT IN ('draft', 'qc_pending', 'qc_denied', 'cancelled', 'rescheduled')
        ),
        'approved_leads', (
          SELECT count(DISTINCT l.id)
          FROM public.portal_leads AS l
          JOIN public.portal_appointments AS a ON a.lead_id = l.id
          LEFT JOIN public.qc_review_cycles AS q ON q.lead_id = l.id AND q.is_current
          WHERE l.company_id = c.id
            AND coalesce(q.status, l.qc_status) = 'approved'
            AND a.company_visible_at IS NOT NULL
            AND a.status NOT IN ('draft', 'qc_pending', 'qc_denied', 'cancelled', 'rescheduled')
        ),
        'qc_pending', (
          SELECT count(DISTINCT l.id)
          FROM public.portal_leads AS l
          JOIN public.portal_appointments AS a ON a.lead_id = l.id
          LEFT JOIN public.qc_review_cycles AS q ON q.lead_id = l.id AND q.is_current
          WHERE l.company_id = c.id
            AND l.qc_required
            AND coalesce(q.status, l.qc_status) IN ('pending', 'in_review', 'needs_correction')
            AND a.status NOT IN ('draft', 'cancelled', 'rescheduled')
        ),
        'scheduled_upcoming', (
          SELECT count(DISTINCT a.id)
          FROM public.portal_appointments AS a
          JOIN public.portal_leads AS l ON l.id = a.lead_id
          WHERE a.company_id = c.id
            AND l.qc_status = 'approved'
            AND a.company_visible_at IS NOT NULL
            AND a.appointment_date >= current_date
            AND a.status NOT IN ('draft', 'qc_pending', 'qc_denied', 'cancelled', 'rescheduled')
        ),
        'active_package', (cp.id IS NOT NULL),
        'package', CASE WHEN cp.id IS NULL THEN NULL ELSE to_jsonb(cp) || jsonb_build_object(
          'delivered_leads', (
            SELECT count(DISTINCT l.id)
            FROM public.portal_leads AS l
            JOIN public.portal_appointments AS a ON a.lead_id = l.id
            WHERE l.package_id = cp.id
              AND l.qc_status = 'approved'
              AND a.company_visible_at IS NOT NULL
              AND a.status NOT IN ('draft', 'qc_pending', 'qc_denied', 'cancelled', 'rescheduled')
          ),
          'pending_leads', greatest(cp.lead_target - (
            SELECT count(DISTINCT l.id)
            FROM public.portal_leads AS l
            JOIN public.portal_appointments AS a ON a.lead_id = l.id
            WHERE l.package_id = cp.id
              AND l.qc_status = 'approved'
              AND a.company_visible_at IS NOT NULL
              AND a.status NOT IN ('draft', 'qc_pending', 'qc_denied', 'cancelled', 'rescheduled')
          ), 0)
        ) END
      ) AS row_data
      FROM public.roster_companies AS c
      LEFT JOIN public.company_portal_settings AS s ON s.company_id = c.id
      LEFT JOIN LATERAL (
        SELECT * FROM public.company_packages AS p
        WHERE p.company_id = c.id AND p.status = 'active'
        ORDER BY p.start_date DESC, p.created_at DESC
        LIMIT 1
      ) AS cp ON true
      WHERE c.account_status IN ('Active', 'Pause') OR cp.id IS NOT NULL
    ) AS q
  ), '[]'::jsonb);

END;

$function$;


-- 2) QC Queue calendar: accept 'needs_review' as an umbrella qc_status filter
-- so a single click from the dashboard reveals every lead that needs review.
CREATE OR REPLACE FUNCTION public.get_qc_calendar_queue(
  p_start_date date,
  p_end_date date,
  p_company_id uuid DEFAULT NULL,
  p_location_id uuid DEFAULT NULL,
  p_agent_id uuid DEFAULT NULL,
  p_qc_status text DEFAULT NULL,
  p_appointment_status text DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_state text DEFAULT NULL,
  p_service_area text DEFAULT NULL,
  p_date_basis text DEFAULT 'appointment'
)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_role text := private.readyops_profile_role();

  v_team_id uuid;

  v_needs_review_states text[] := ARRAY['pending','in_review','needs_correction'];

BEGIN
  IF v_role NOT IN ('admin', 'qc', 'manager') THEN
    RAISE EXCEPTION 'QC reviewer access required';

  END IF;

  IF p_start_date IS NULL OR p_end_date IS NULL OR p_end_date < p_start_date OR p_end_date > p_start_date + 31 THEN
    RAISE EXCEPTION 'Select a valid date range of 32 days or less';

  END IF;

  IF p_date_basis NOT IN ('appointment', 'call') THEN
    RAISE EXCEPTION 'Date basis must be appointment or call';

  END IF;


  SELECT p.team_id INTO v_team_id
  FROM public.profiles AS p
  WHERE p.id = (SELECT auth.uid());


  RETURN (
    WITH filtered AS (
      SELECT
        l.id AS lead_id,
        a.id AS appointment_id,
        CASE
          WHEN p_date_basis = 'call' THEN
            (l.created_at AT TIME ZONE coalesce(loc.timezone, s.timezone, 'America/Chicago'))::date
          ELSE a.appointment_date
        END AS filter_date,
        a.appointment_date,
        a.start_time,
        a.canonical_status,
        c.id AS company_id,
        c.name AS company_name,
        to_jsonb(l) || jsonb_build_object(
          'received_date',
          (l.created_at AT TIME ZONE coalesce(loc.timezone, s.timezone, 'America/Chicago'))::date,
          'received_timezone',
          coalesce(loc.timezone, s.timezone, 'America/Chicago')
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
          'public_slug', s.public_slug,
          'requirements_short', s.requirements_short,
          'requirements_detail', s.requirements_detail,
          'qualification_rules', s.qualification_rules,
          'form_mode', s.form_mode,
          'external_form_provider', s.external_form_provider,
          'external_form_url', s.external_form_url,
          'external_prefill_map', s.external_prefill_map
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
      WHERE (
          CASE
            WHEN p_date_basis = 'call' THEN
              (l.created_at AT TIME ZONE coalesce(loc.timezone, s.timezone, 'America/Chicago'))::date
            ELSE a.appointment_date
          END
        ) BETWEEN p_start_date AND p_end_date
        AND l.qc_required
        AND a.status NOT IN ('draft', 'cancelled', 'rescheduled')
        AND private.readyops_can_access_company(l.company_id)
        AND (
          v_role IN ('admin', 'qc')
          OR (v_role = 'manager' AND v_team_id IS NOT NULL AND ag.team_id = v_team_id)
        )
        AND (p_company_id IS NULL OR l.company_id = p_company_id)
        AND (p_location_id IS NULL OR l.location_id = p_location_id)
        AND (p_agent_id IS NULL OR l.agent_id = p_agent_id)
        AND (
          p_qc_status IS NULL
          OR p_qc_status = 'all'
          OR (p_qc_status = 'needs_review' AND coalesce(q.status, l.qc_status) = ANY (v_needs_review_states))
          OR coalesce(q.status, l.qc_status) = p_qc_status
        )
        AND (p_appointment_status IS NULL OR p_appointment_status = 'all' OR a.canonical_status = p_appointment_status OR a.status = p_appointment_status)
        AND (p_state IS NULL OR p_state = 'all' OR coalesce(loc.state, c.state) = p_state)
        AND (p_service_area IS NULL OR p_service_area = 'all' OR coalesce(loc.metro_tag, c.metro_tag) = p_service_area)
        AND (
          nullif(trim(coalesce(p_search, '')), '') IS NULL
          OR concat_ws(' ', l.full_name, l.phone_number, l.address, l.city, l.state, l.zip_code, c.name, ag.name)
            ILIKE '%' || trim(p_search) || '%'
        )
    ),
    day_series AS (
      SELECT generate_series(p_start_date, p_end_date, interval '1 day')::date AS day
    ),
    daily AS (
      SELECT
        d.day,
        count(DISTINCT f.appointment_id) AS scheduled,
        count(DISTINCT f.appointment_id) FILTER (
          WHERE f.current_qc_status = ANY (v_needs_review_states)
        ) AS pending_qc
      FROM day_series AS d
      LEFT JOIN filtered AS f ON f.filter_date = d.day
      GROUP BY d.day
      ORDER BY d.day
    ),
    summary AS (
      SELECT
        count(DISTINCT f.company_id) AS companies,
        count(DISTINCT f.appointment_id) AS scheduled,
        count(DISTINCT f.appointment_id) FILTER (WHERE f.current_qc_status = 'pending') AS pending,
        count(DISTINCT f.appointment_id) FILTER (WHERE f.current_qc_status = 'in_review') AS in_review,
        count(DISTINCT f.appointment_id) FILTER (WHERE f.current_qc_status = 'manager_approved') AS manager_approved,
        count(DISTINCT f.appointment_id) FILTER (WHERE f.current_qc_status = 'approved') AS approved,
        count(DISTINCT f.appointment_id) FILTER (WHERE f.current_qc_status = 'denied') AS denied,
        count(DISTINCT f.appointment_id) FILTER (WHERE f.current_qc_status = 'needs_correction') AS needs_correction,
        count(DISTINCT f.appointment_id) FILTER (WHERE f.current_qc_status = ANY (v_needs_review_states)) AS needs_review,
        count(DISTINCT f.appointment_id) FILTER (WHERE f.canonical_status = 'rescheduled') AS rescheduled
      FROM filtered AS f
    )
    SELECT jsonb_build_object(
      'date_basis', p_date_basis,
      'days', coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'date', d.day,
          'scheduled', d.scheduled,
          'pending_qc', d.pending_qc
        ) ORDER BY d.day)
        FROM daily AS d
      ), '[]'::jsonb),
      'summary', (
        SELECT jsonb_build_object(
          'companies', s2.companies,
          'scheduled', s2.scheduled,
          'pending', s2.pending,
          'in_review', s2.in_review,
          'manager_approved', s2.manager_approved,
          'approved', s2.approved,
          'denied', s2.denied,
          'needs_correction', s2.needs_correction,
          'needs_review', s2.needs_review,
          'rescheduled', s2.rescheduled,
          'completion_percentage', CASE
            WHEN s2.scheduled = 0 THEN 0
            ELSE round(((s2.approved + s2.denied)::numeric / s2.scheduled::numeric) * 100, 1)
          END
        )
        FROM summary AS s2
      ),
      'rows', coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'filter_date', f.filter_date,
          'lead', f.lead_json,
          'appointment', f.appointment_json,
          'qc_review', f.qc_review_json,
          'company', f.company_json,
          'location', f.location_json,
          'agent', f.agent_json,
          'package', f.package_json,
          'portal', f.portal_json
        ) ORDER BY
          CASE f.current_qc_status
            WHEN 'pending' THEN 0
            WHEN 'in_review' THEN 1
            WHEN 'manager_approved' THEN 2
            WHEN 'needs_correction' THEN 3
            WHEN 'approved' THEN 4
            ELSE 5
          END,
          f.filter_date,
          f.start_time,
          f.company_name
        )
        FROM filtered AS f
      ), '[]'::jsonb)
    )
  );

END;

$function$;


-- 3) Global search: accept 'needs_review' the same way.
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
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_role text := private.readyops_profile_role();

  v_manager_team_id uuid;

  v_term text := trim(coalesce(p_search, ''));

  v_digits text := regexp_replace(coalesce(p_search, ''), '[^0-9]', '', 'g');

  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 100);

  v_needs_review_states text[] := ARRAY['pending','in_review','needs_correction'];

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
        AND (
          p_qc_status IS NULL
          OR p_qc_status = 'all'
          OR (p_qc_status = 'needs_review' AND coalesce(q.status, l.qc_status) = ANY (v_needs_review_states))
          OR coalesce(q.status, l.qc_status) = p_qc_status
        )
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
        count(*) FILTER (WHERE current_qc_status = 'needs_correction') AS needs_correction,
        count(*) FILTER (WHERE current_qc_status = ANY (v_needs_review_states)) AS needs_review
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
        'needs_correction', t.needs_correction, 'needs_review', t.needs_review
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


-- 4) Helper: return the earliest appointment_date (>= today or in the recent
-- past, if that is the only home for a lead needing review) so the client can
-- auto-focus the QC Queue on the correct week when a user clicks the "QC
-- Pending" dashboard card. NULLs and legacy rows are preserved: if the earliest
-- date is NULL, the client keeps today's week.
CREATE OR REPLACE FUNCTION public.get_qc_needs_review_focus()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_role text := private.readyops_profile_role();

  v_team_id uuid;

  v_needs_review_states text[] := ARRAY['pending','in_review','needs_correction'];

  v_focus_date date;

  v_total integer;

BEGIN
  IF v_role NOT IN ('admin', 'qc', 'manager') THEN
    RAISE EXCEPTION 'QC reviewer access required';

  END IF;


  SELECT p.team_id INTO v_team_id
  FROM public.profiles AS p
  WHERE p.id = (SELECT auth.uid());


  SELECT count(DISTINCT l.id) INTO v_total
  FROM public.portal_leads AS l
  JOIN public.portal_appointments AS a ON a.lead_id = l.id
  LEFT JOIN public.agents AS ag ON ag.id = l.agent_id
  LEFT JOIN public.qc_review_cycles AS q ON q.lead_id = l.id AND q.is_current
  WHERE l.qc_required
    AND coalesce(q.status, l.qc_status) = ANY (v_needs_review_states)
    AND a.status NOT IN ('draft', 'cancelled', 'rescheduled')
    AND private.readyops_can_access_company(l.company_id)
    AND (
      v_role IN ('admin', 'qc')
      OR (v_role = 'manager' AND v_team_id IS NOT NULL AND ag.team_id = v_team_id)
    );


  -- Prefer the soonest FUTURE appointment; fall back to the most recent past.
  SELECT COALESCE(
    (
      SELECT min(a.appointment_date)
      FROM public.portal_leads AS l
      JOIN public.portal_appointments AS a ON a.lead_id = l.id
      LEFT JOIN public.agents AS ag ON ag.id = l.agent_id
      LEFT JOIN public.qc_review_cycles AS q ON q.lead_id = l.id AND q.is_current
      WHERE l.qc_required
        AND coalesce(q.status, l.qc_status) = ANY (v_needs_review_states)
        AND a.status NOT IN ('draft', 'cancelled', 'rescheduled')
        AND a.appointment_date >= current_date
        AND private.readyops_can_access_company(l.company_id)
        AND (
          v_role IN ('admin', 'qc')
          OR (v_role = 'manager' AND v_team_id IS NOT NULL AND ag.team_id = v_team_id)
        )
    ),
    (
      SELECT max(a.appointment_date)
      FROM public.portal_leads AS l
      JOIN public.portal_appointments AS a ON a.lead_id = l.id
      LEFT JOIN public.agents AS ag ON ag.id = l.agent_id
      LEFT JOIN public.qc_review_cycles AS q ON q.lead_id = l.id AND q.is_current
      WHERE l.qc_required
        AND coalesce(q.status, l.qc_status) = ANY (v_needs_review_states)
        AND a.status NOT IN ('draft', 'cancelled', 'rescheduled')
        AND a.appointment_date < current_date
        AND private.readyops_can_access_company(l.company_id)
        AND (
          v_role IN ('admin', 'qc')
          OR (v_role = 'manager' AND v_team_id IS NOT NULL AND ag.team_id = v_team_id)
        )
    )
  ) INTO v_focus_date;


  RETURN jsonb_build_object(
    'total_needs_review', coalesce(v_total, 0),
    'focus_date', v_focus_date
  );

END;

$function$;


REVOKE ALL ON FUNCTION public.get_qc_needs_review_focus() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_qc_needs_review_focus() TO authenticated;

;
