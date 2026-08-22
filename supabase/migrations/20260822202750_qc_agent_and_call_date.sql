BEGIN;

DROP FUNCTION IF EXISTS public.get_qc_calendar_queue(
  date, date, uuid, uuid, uuid, text, text, text, text, text
);

CREATE FUNCTION public.get_qc_calendar_queue(
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
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_role text := private.readyops_profile_role();
  v_team_id uuid;
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
          'received_timezone', coalesce(loc.timezone, s.timezone, 'America/Chicago')
        ) AS lead_json,
        to_jsonb(a) AS appointment_json,
        CASE WHEN q.id IS NULL THEN NULL ELSE to_jsonb(q) END AS qc_review_json,
        jsonb_build_object(
          'id', c.id,
          'name', c.name,
          'state', c.state,
          'metro_tag', c.metro_tag,
          'logo_path', c.logo_path,
          'requirements_note', c.requirements_note
        ) AS company_json,
        CASE WHEN loc.id IS NULL THEN NULL ELSE jsonb_build_object(
          'id', loc.id,
          'label', loc.location_label,
          'state', loc.state,
          'metro_tag', loc.metro_tag,
          'timezone', loc.timezone
        ) END AS location_json,
        CASE WHEN ag.id IS NULL THEN NULL ELSE jsonb_build_object(
          'id', ag.id,
          'name', ag.name,
          'team_id', ag.team_id,
          'portal_slug', ag.portal_slug
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
        AND (p_qc_status IS NULL OR p_qc_status = 'all' OR coalesce(q.status, l.qc_status) = p_qc_status)
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
          WHERE f.current_qc_status IN ('pending', 'in_review', 'manager_approved')
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

REVOKE ALL ON FUNCTION public.get_qc_calendar_queue(
  date, date, uuid, uuid, uuid, text, text, text, text, text, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_qc_calendar_queue(
  date, date, uuid, uuid, uuid, text, text, text, text, text, text
) TO authenticated;

COMMENT ON FUNCTION public.get_qc_calendar_queue(
  date, date, uuid, uuid, uuid, text, text, text, text, text, text
) IS 'Returns the QC queue by appointment date or the company-local lead received/call date, with manager team scoping enforced.';

CREATE OR REPLACE FUNCTION public.qc_reassign_lead_agent(
  p_lead_id uuid,
  p_agent_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_role text := private.readyops_profile_role();
  v_actor_id uuid := (SELECT auth.uid());
  v_actor_name text;
  v_lead public.portal_leads%ROWTYPE;
  v_agent public.agents%ROWTYPE;
  v_agent_profile_id uuid;
  v_old_agent public.agents%ROWTYPE;
BEGIN
  IF v_actor_id IS NULL OR v_role NOT IN ('admin', 'qc') THEN
    RAISE EXCEPTION 'Admin or Main QC access required';
  END IF;

  SELECT * INTO v_lead
  FROM public.portal_leads
  WHERE id = p_lead_id
  FOR UPDATE;
  IF v_lead.id IS NULL THEN
    RAISE EXCEPTION 'Lead not found';
  END IF;

  SELECT * INTO v_agent
  FROM public.agents
  WHERE id = p_agent_id AND active;
  IF v_agent.id IS NULL THEN
    RAISE EXCEPTION 'Select an active agent';
  END IF;

  SELECT * INTO v_old_agent
  FROM public.agents
  WHERE id = v_lead.agent_id;

  SELECT p.id INTO v_agent_profile_id
  FROM public.profiles AS p
  WHERE p.agent_id = v_agent.id
    AND p.role = 'agent'
  ORDER BY p.created_at NULLS LAST, p.id
  LIMIT 1;

  SELECT coalesce(nullif(trim(p.display_name), ''), nullif(trim(p.email), ''), v_role)
  INTO v_actor_name
  FROM public.profiles AS p
  WHERE p.id = v_actor_id;

  UPDATE public.portal_leads
  SET agent_id = v_agent.id,
      agent_profile_id = v_agent_profile_id,
      agent_name = v_agent.name,
      updated_at = now()
  WHERE id = v_lead.id;

  PERFORM public.portal_write_audit(
    v_lead.company_id,
    v_role,
    v_actor_id,
    v_actor_name,
    'qc_agent_reassigned',
    'lead',
    v_lead.id,
    jsonb_build_object(
      'agent_id', v_lead.agent_id,
      'agent_profile_id', v_lead.agent_profile_id,
      'agent_name', v_lead.agent_name
    ),
    jsonb_build_object(
      'agent_id', v_agent.id,
      'agent_profile_id', v_agent_profile_id,
      'agent_name', v_agent.name
    ),
    jsonb_build_object(
      'old_team_id', v_old_agent.team_id,
      'new_team_id', v_agent.team_id
    )
  );

  RETURN jsonb_build_object(
    'lead_id', v_lead.id,
    'agent_id', v_agent.id,
    'agent_profile_id', v_agent_profile_id,
    'agent_name', v_agent.name,
    'team_id', v_agent.team_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.qc_reassign_lead_agent(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.qc_reassign_lead_agent(uuid, uuid) TO authenticated;

COMMENT ON FUNCTION public.qc_reassign_lead_agent(uuid, uuid)
IS 'Allows only Admin or Main QC to atomically correct the assigned agent and linked profile for a lead.';

COMMIT;
