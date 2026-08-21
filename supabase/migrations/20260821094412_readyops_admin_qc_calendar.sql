-- ReadyOps Main Admin QC Calendar and company-grouped queue.
-- Extends the canonical portal_leads / portal_appointments workflow; it does
-- not create a parallel booking system and it does not change Company Link
-- routing or token-based company portal access.

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO authenticated;

ALTER TABLE public.portal_leads
  ADD COLUMN IF NOT EXISTS qc_required boolean NOT NULL DEFAULT true;

ALTER TABLE public.portal_leads
  DROP CONSTRAINT IF EXISTS portal_leads_qc_status_check;
ALTER TABLE public.portal_leads
  ADD CONSTRAINT portal_leads_qc_status_check
  CHECK (qc_status = ANY (ARRAY[
    'pending'::text,
    'in_review'::text,
    'approved'::text,
    'denied'::text,
    'needs_correction'::text
  ]));

ALTER TABLE public.portal_audit_logs
  DROP CONSTRAINT IF EXISTS portal_audit_logs_actor_type_check;
ALTER TABLE public.portal_audit_logs
  ADD CONSTRAINT portal_audit_logs_actor_type_check
  CHECK (actor_type = ANY (ARRAY[
    'masters_admin'::text,
    'company_admin'::text,
    'representative'::text,
    'agent'::text,
    'system'::text,
    'external_form'::text,
    'admin'::text,
    'manager'::text,
    'qc'::text,
    'company'::text
  ]));

CREATE TABLE IF NOT EXISTS public.qc_review_cycles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.portal_leads(id) ON DELETE CASCADE,
  appointment_id uuid NOT NULL REFERENCES public.portal_appointments(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.roster_companies(id) ON DELETE CASCADE,
  location_id uuid REFERENCES public.company_locations(id) ON DELETE SET NULL,
  cycle_number integer NOT NULL CHECK (cycle_number > 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status = ANY (ARRAY[
    'pending'::text,
    'in_review'::text,
    'approved'::text,
    'denied'::text,
    'needs_correction'::text
  ])),
  is_current boolean NOT NULL DEFAULT true,
  assigned_to uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewer_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  correction_assignee_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  correction_attempt integer NOT NULL DEFAULT 0 CHECK (correction_attempt >= 0),
  started_at timestamptz,
  completed_at timestamptz,
  reason text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (lead_id, cycle_number)
);

CREATE UNIQUE INDEX IF NOT EXISTS qc_review_cycles_one_current_per_lead
  ON public.qc_review_cycles (lead_id)
  WHERE is_current;
CREATE INDEX IF NOT EXISTS qc_review_cycles_calendar_lookup
  ON public.qc_review_cycles (company_id, status, is_current, appointment_id);
CREATE INDEX IF NOT EXISTS qc_review_cycles_assignment_lookup
  ON public.qc_review_cycles (assigned_to, correction_assignee_id, status)
  WHERE is_current;

ALTER TABLE public.appointment_reschedule_history
  ADD COLUMN IF NOT EXISTS old_company_id uuid REFERENCES public.roster_companies(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS new_company_id uuid REFERENCES public.roster_companies(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS old_location_id uuid REFERENCES public.company_locations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS new_location_id uuid REFERENCES public.company_locations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS qc_review_id uuid REFERENCES public.qc_review_cycles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS appointment_reschedule_history_qc_review_idx
  ON public.appointment_reschedule_history (qc_review_id, changed_at DESC);

CREATE OR REPLACE FUNCTION private.readyops_profile_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT p.role
  FROM public.profiles AS p
  WHERE p.id = (SELECT auth.uid())
$function$;

CREATE OR REPLACE FUNCTION private.readyops_can_access_company(p_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles AS p
    WHERE p.id = (SELECT auth.uid())
      AND (
        p.role IN ('admin', 'qc')
        OR (
          p.role = 'manager'
          AND p.team_id IS NOT NULL
          AND (
            EXISTS (
              SELECT 1
              FROM public.roster_companies AS c
              WHERE c.id = p_company_id
                AND c.team_id = p.team_id
            )
            OR EXISTS (
              SELECT 1
              FROM public.company_teams AS ct
              WHERE ct.company_id = p_company_id
                AND ct.team_id = p.team_id
            )
          )
        )
        OR (
          p.role = 'company'
          AND EXISTS (
            SELECT 1
            FROM public.company_user_access AS cua
            WHERE cua.company_id = p_company_id
              AND cua.user_id = p.id
          )
        )
      )
  )
$function$;

CREATE OR REPLACE FUNCTION private.readyops_can_review_company(p_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT private.readyops_profile_role() IN ('admin', 'qc', 'manager')
    AND private.readyops_can_access_company(p_company_id)
$function$;

REVOKE ALL ON FUNCTION private.readyops_profile_role() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.readyops_can_access_company(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.readyops_can_review_company(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.readyops_profile_role() TO authenticated;
GRANT EXECUTE ON FUNCTION private.readyops_can_access_company(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.readyops_can_review_company(uuid) TO authenticated;

INSERT INTO public.qc_review_cycles (
  lead_id,
  appointment_id,
  company_id,
  location_id,
  cycle_number,
  status,
  reviewer_id,
  started_at,
  completed_at,
  reason,
  notes
)
SELECT
  l.id,
  a.id,
  l.company_id,
  l.location_id,
  1,
  l.qc_status,
  l.qc_reviewed_by,
  CASE WHEN l.qc_reviewed_at IS NOT NULL THEN l.qc_reviewed_at END,
  CASE WHEN l.qc_status IN ('approved', 'denied') THEN l.qc_reviewed_at END,
  l.qc_reason,
  l.qc_notes
FROM public.portal_leads AS l
JOIN public.portal_appointments AS a ON a.lead_id = l.id
WHERE l.qc_required
  AND NOT EXISTS (
    SELECT 1
    FROM public.qc_review_cycles AS q
    WHERE q.lead_id = l.id
  );

ALTER TABLE public.qc_review_cycles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.qc_review_cycles FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.qc_review_cycles FROM authenticated;
GRANT SELECT ON TABLE public.qc_review_cycles TO authenticated;

DROP POLICY IF EXISTS qc_review_cycles_authorized_select ON public.qc_review_cycles;
CREATE POLICY qc_review_cycles_authorized_select
ON public.qc_review_cycles
FOR SELECT
TO authenticated
USING (
  private.readyops_can_access_company(company_id)
  OR EXISTS (
    SELECT 1
    FROM public.portal_leads AS l
    JOIN public.profiles AS p ON p.id = (SELECT auth.uid())
    WHERE l.id = qc_review_cycles.lead_id
      AND p.role = 'agent'
      AND (
        l.agent_profile_id = p.id
        OR (p.agent_id IS NOT NULL AND l.agent_id = p.agent_id)
      )
  )
);

CREATE OR REPLACE FUNCTION public.readyops_create_qc_cycle_for_appointment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_lead public.portal_leads%ROWTYPE;
  v_cycle_id uuid;
BEGIN
  SELECT * INTO v_lead
  FROM public.portal_leads
  WHERE id = NEW.lead_id;

  IF v_lead.id IS NULL OR NOT v_lead.qc_required THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.qc_review_cycles (
    lead_id,
    appointment_id,
    company_id,
    location_id,
    cycle_number,
    status
  )
  VALUES (
    v_lead.id,
    NEW.id,
    NEW.company_id,
    NEW.location_id,
    1,
    v_lead.qc_status
  )
  ON CONFLICT (lead_id, cycle_number) DO NOTHING
  RETURNING id INTO v_cycle_id;

  IF v_cycle_id IS NOT NULL THEN
    INSERT INTO public.portal_audit_logs (
      company_id,
      actor_type,
      actor_id,
      actor_name,
      action,
      entity_type,
      entity_id,
      new_value,
      metadata
    ) VALUES (
      NEW.company_id,
      CASE WHEN (SELECT auth.uid()) IS NULL THEN 'system' ELSE 'agent' END,
      (SELECT auth.uid()),
      coalesce(nullif(v_lead.agent_name, ''), 'Agent Booking'),
      'appointment_added_to_qc',
      'lead',
      v_lead.id,
      jsonb_build_object('qc_status', v_lead.qc_status),
      jsonb_build_object(
        'appointment_id', NEW.id,
        'qc_review_id', v_cycle_id,
        'location_id', NEW.location_id,
        'appointment_date', NEW.appointment_date,
        'start_time', NEW.start_time
      )
    );
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.readyops_create_qc_cycle_for_appointment() FROM PUBLIC;

DROP TRIGGER IF EXISTS readyops_create_qc_cycle_after_appointment ON public.portal_appointments;
CREATE TRIGGER readyops_create_qc_cycle_after_appointment
AFTER INSERT ON public.portal_appointments
FOR EACH ROW
EXECUTE FUNCTION public.readyops_create_qc_cycle_for_appointment();

CREATE OR REPLACE FUNCTION public.get_qc_reference_data()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_role text := private.readyops_profile_role();
BEGIN
  IF v_role NOT IN ('admin', 'qc', 'manager') THEN
    RAISE EXCEPTION 'QC reviewer access required';
  END IF;

  RETURN jsonb_build_object(
    'companies', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', c.id,
        'name', c.name,
        'state', c.state,
        'metro_tag', c.metro_tag,
        'logo_path', c.logo_path,
        'public_slug', s.public_slug,
        'requirements_short', s.requirements_short,
        'requirements_detail', s.requirements_detail,
        'qualification_rules', s.qualification_rules,
        'form_mode', s.form_mode,
        'external_form_provider', s.external_form_provider,
        'external_form_url', s.external_form_url,
        'external_prefill_map', s.external_prefill_map
      ) ORDER BY c.name)
      FROM public.roster_companies AS c
      JOIN public.company_portal_settings AS s ON s.company_id = c.id
      WHERE c.account_status = 'Active'
        AND private.readyops_can_access_company(c.id)
    ), '[]'::jsonb),
    'locations', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', l.id,
        'company_id', l.company_id,
        'label', l.location_label,
        'state', l.state,
        'metro_tag', l.metro_tag,
        'timezone', l.timezone
      ) ORDER BY l.location_label)
      FROM public.company_locations AS l
      JOIN public.roster_companies AS c ON c.id = l.company_id
      WHERE c.account_status = 'Active'
        AND l.active
        AND private.readyops_can_access_company(c.id)
    ), '[]'::jsonb),
    'teams', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'abbreviation', t.abbreviation) ORDER BY t.name)
      FROM public.teams AS t
      WHERE v_role IN ('admin', 'qc')
        OR t.id = (SELECT p.team_id FROM public.profiles AS p WHERE p.id = (SELECT auth.uid()))
    ), '[]'::jsonb),
    'agents', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', a.id,
        'name', a.name,
        'team_id', a.team_id,
        'email', a.email
      ) ORDER BY a.name)
      FROM public.agents AS a
      WHERE a.active
        AND (
          v_role IN ('admin', 'qc')
          OR a.team_id = (SELECT p.team_id FROM public.profiles AS p WHERE p.id = (SELECT auth.uid()))
        )
    ), '[]'::jsonb)
  );
END;
$function$;

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
  p_service_area text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_role text := private.readyops_profile_role();
BEGIN
  IF v_role NOT IN ('admin', 'qc', 'manager') THEN
    RAISE EXCEPTION 'QC reviewer access required';
  END IF;
  IF p_start_date IS NULL OR p_end_date IS NULL OR p_end_date < p_start_date OR p_end_date > p_start_date + 31 THEN
    RAISE EXCEPTION 'Select a valid date range of 32 days or less';
  END IF;

  RETURN (
    WITH filtered AS (
      SELECT
        l.id AS lead_id,
        a.id AS appointment_id,
        a.appointment_date,
        a.start_time,
        a.canonical_status,
        c.id AS company_id,
        c.name AS company_name,
        to_jsonb(l) AS lead_json,
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
      WHERE a.appointment_date BETWEEN p_start_date AND p_end_date
        AND l.qc_required
        AND a.status NOT IN ('draft', 'cancelled', 'rescheduled')
        AND private.readyops_can_access_company(l.company_id)
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
        count(DISTINCT f.appointment_id) FILTER (WHERE f.current_qc_status IN ('pending', 'in_review')) AS pending_qc
      FROM day_series AS d
      LEFT JOIN filtered AS f ON f.appointment_date = d.day
      GROUP BY d.day
      ORDER BY d.day
    ),
    summary AS (
      SELECT
        count(DISTINCT f.company_id) AS companies,
        count(DISTINCT f.appointment_id) AS scheduled,
        count(DISTINCT f.appointment_id) FILTER (WHERE f.current_qc_status = 'pending') AS pending,
        count(DISTINCT f.appointment_id) FILTER (WHERE f.current_qc_status = 'in_review') AS in_review,
        count(DISTINCT f.appointment_id) FILTER (WHERE f.current_qc_status = 'approved') AS approved,
        count(DISTINCT f.appointment_id) FILTER (WHERE f.current_qc_status = 'denied') AS denied,
        count(DISTINCT f.appointment_id) FILTER (WHERE f.current_qc_status = 'needs_correction') AS needs_correction,
        count(DISTINCT f.appointment_id) FILTER (WHERE f.canonical_status = 'rescheduled') AS rescheduled
      FROM filtered AS f
    )
    SELECT jsonb_build_object(
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
            WHEN 'needs_correction' THEN 2
            WHEN 'approved' THEN 3
            ELSE 4
          END,
          f.appointment_date,
          f.start_time,
          f.company_name
        )
        FROM filtered AS f
      ), '[]'::jsonb)
    )
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.qc_start_review(p_lead_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_lead public.portal_leads%ROWTYPE;
  v_cycle public.qc_review_cycles%ROWTYPE;
  v_actor_type text;
BEGIN
  SELECT * INTO v_lead FROM public.portal_leads WHERE id = p_lead_id FOR UPDATE;
  IF v_lead.id IS NULL THEN RAISE EXCEPTION 'Lead not found'; END IF;
  IF NOT private.readyops_can_review_company(v_lead.company_id) THEN RAISE EXCEPTION 'QC reviewer access required'; END IF;

  SELECT * INTO v_cycle
  FROM public.qc_review_cycles
  WHERE lead_id = p_lead_id AND is_current
  FOR UPDATE;

  IF v_cycle.id IS NULL THEN RAISE EXCEPTION 'Active QC review cycle not found'; END IF;
  IF v_cycle.status IN ('approved', 'denied') THEN RAISE EXCEPTION 'Reopen the completed QC review before editing it'; END IF;

  UPDATE public.qc_review_cycles
  SET status = 'in_review', reviewer_id = (SELECT auth.uid()), started_at = coalesce(started_at, now()), updated_at = now()
  WHERE id = v_cycle.id
  RETURNING * INTO v_cycle;

  UPDATE public.portal_leads
  SET qc_status = 'in_review', updated_at = now()
  WHERE id = p_lead_id;

  v_actor_type := private.readyops_profile_role();
  PERFORM public.portal_write_audit(
    v_lead.company_id,
    v_actor_type,
    (SELECT auth.uid()),
    public.portal_actor_name_for_management(),
    'qc_review_started',
    'lead',
    p_lead_id,
    NULL,
    jsonb_build_object('qc_status', 'in_review'),
    jsonb_build_object('qc_review_id', v_cycle.id, 'appointment_id', v_cycle.appointment_id)
  );

  RETURN to_jsonb(v_cycle);
END;
$function$;

CREATE OR REPLACE FUNCTION public.qc_review_lead(
  p_lead_id uuid,
  p_decision text,
  p_reason text DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_lead public.portal_leads%ROWTYPE;
  v_appt public.portal_appointments%ROWTYPE;
  v_cycle public.qc_review_cycles%ROWTYPE;
  v_today date;
  v_same_day boolean := false;
  v_actor_type text;
  v_correction_assignee uuid;
BEGIN
  IF p_decision NOT IN ('approved', 'denied', 'needs_correction') THEN
    RAISE EXCEPTION 'Decision must be approved, denied, or needs_correction';
  END IF;
  IF p_decision IN ('denied', 'needs_correction') AND nullif(trim(coalesce(p_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'A reason is required for this QC decision';
  END IF;

  SELECT * INTO v_lead FROM public.portal_leads WHERE id = p_lead_id FOR UPDATE;
  IF v_lead.id IS NULL THEN RAISE EXCEPTION 'Lead not found'; END IF;
  IF NOT private.readyops_can_review_company(v_lead.company_id) THEN RAISE EXCEPTION 'QC reviewer access required'; END IF;

  SELECT * INTO v_appt FROM public.portal_appointments WHERE lead_id = p_lead_id FOR UPDATE;
  SELECT * INTO v_cycle FROM public.qc_review_cycles WHERE lead_id = p_lead_id AND is_current FOR UPDATE;
  IF v_appt.id IS NULL OR v_cycle.id IS NULL THEN RAISE EXCEPTION 'Appointment or active QC cycle not found'; END IF;

  v_correction_assignee := v_lead.agent_profile_id;
  IF v_correction_assignee IS NULL THEN
    SELECT p.id
    INTO v_correction_assignee
    FROM public.profiles AS p
    WHERE p.agent_id = v_lead.agent_id
    LIMIT 1;
  END IF;

  UPDATE public.qc_review_cycles
  SET
    status = p_decision,
    reviewer_id = (SELECT auth.uid()),
    started_at = coalesce(started_at, now()),
    completed_at = CASE WHEN p_decision IN ('approved', 'denied') THEN now() ELSE NULL END,
    correction_assignee_id = CASE WHEN p_decision = 'needs_correction' THEN v_correction_assignee ELSE NULL END,
    correction_attempt = correction_attempt + CASE WHEN p_decision = 'needs_correction' THEN 1 ELSE 0 END,
    reason = nullif(trim(coalesce(p_reason, '')), ''),
    notes = nullif(trim(coalesce(p_notes, '')), ''),
    updated_at = now()
  WHERE id = v_cycle.id
  RETURNING * INTO v_cycle;

  UPDATE public.portal_leads
  SET
    qc_status = p_decision,
    qc_reason = nullif(trim(coalesce(p_reason, '')), ''),
    qc_notes = nullif(trim(coalesce(p_notes, '')), ''),
    qc_reviewed_by = (SELECT auth.uid()),
    qc_reviewed_at = now(),
    updated_at = now()
  WHERE id = p_lead_id
  RETURNING * INTO v_lead;

  IF p_decision = 'approved' THEN
    IF v_lead.package_id IS NULL THEN
      UPDATE public.portal_leads
      SET package_id = public.portal_active_package(v_lead.company_id)
      WHERE id = v_lead.id
      RETURNING * INTO v_lead;
    END IF;
    UPDATE public.portal_appointments
    SET
      status = CASE WHEN representative_id IS NULL THEN 'confirmed' ELSE 'assigned' END,
      company_visible_at = now(),
      updated_at = now()
    WHERE id = v_appt.id
    RETURNING * INTO v_appt;
    PERFORM public.portal_complete_package_if_filled(v_lead.package_id);
    SELECT (now() AT TIME ZONE coalesce((
      SELECT timezone FROM public.company_portal_settings WHERE company_id = v_lead.company_id
    ), 'America/Chicago'))::date INTO v_today;
    v_same_day := v_appt.appointment_date = v_today;
    IF v_same_day AND NOT EXISTS (
      SELECT 1 FROM public.company_notification_batches AS b
      WHERE b.notification_type = 'same_day'
        AND v_lead.id = ANY (b.lead_ids)
        AND b.status IN ('queued', 'sent')
    ) THEN
      INSERT INTO public.company_notification_batches (
        company_id, notification_date, notification_type, status,
        recipient_email, lead_ids, lead_count, created_by
      )
      SELECT v_lead.company_id, v_today, 'same_day', 'queued', c.email,
        ARRAY[v_lead.id], 1, (SELECT auth.uid())
      FROM public.roster_companies AS c
      WHERE c.id = v_lead.company_id;
    END IF;
  ELSIF p_decision = 'denied' THEN
    UPDATE public.portal_appointments
    SET status = 'qc_denied', company_visible_at = NULL, representative_id = NULL,
      rep_status = 'unassigned', updated_at = now()
    WHERE id = v_appt.id
    RETURNING * INTO v_appt;
  ELSE
    UPDATE public.portal_appointments
    SET status = 'qc_pending', company_visible_at = NULL, updated_at = now()
    WHERE id = v_appt.id
    RETURNING * INTO v_appt;
  END IF;

  v_actor_type := private.readyops_profile_role();
  PERFORM public.portal_write_audit(
    v_lead.company_id,
    v_actor_type,
    (SELECT auth.uid()),
    public.portal_actor_name_for_management(),
    CASE p_decision
      WHEN 'approved' THEN 'qc_approved'
      WHEN 'denied' THEN 'qc_denied'
      ELSE 'qc_correction_requested'
    END,
    'lead',
    v_lead.id,
    NULL,
    jsonb_build_object('qc_status', p_decision, 'reason', p_reason, 'appointment_status', v_appt.status),
    jsonb_build_object(
      'appointment_id', v_appt.id,
      'qc_review_id', v_cycle.id,
      'correction_assignee_id', v_cycle.correction_assignee_id,
      'correction_attempt', v_cycle.correction_attempt
    )
  );

  RETURN jsonb_build_object(
    'lead', to_jsonb(v_lead),
    'appointment', to_jsonb(v_appt),
    'qc_review', to_jsonb(v_cycle),
    'same_day_notification_queued', v_same_day AND p_decision = 'approved'
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.qc_reopen_review(p_lead_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_lead public.portal_leads%ROWTYPE;
  v_appt public.portal_appointments%ROWTYPE;
  v_old public.qc_review_cycles%ROWTYPE;
  v_new public.qc_review_cycles%ROWTYPE;
  v_role text := private.readyops_profile_role();
BEGIN
  IF v_role NOT IN ('admin', 'qc') THEN RAISE EXCEPTION 'Admin or QC access required'; END IF;
  IF nullif(trim(coalesce(p_reason, '')), '') IS NULL THEN RAISE EXCEPTION 'A reopen reason is required'; END IF;
  SELECT * INTO v_lead FROM public.portal_leads WHERE id = p_lead_id FOR UPDATE;
  IF v_lead.id IS NULL OR NOT private.readyops_can_access_company(v_lead.company_id) THEN RAISE EXCEPTION 'Lead not found or access denied'; END IF;
  SELECT * INTO v_appt FROM public.portal_appointments WHERE lead_id = p_lead_id FOR UPDATE;
  SELECT * INTO v_old FROM public.qc_review_cycles WHERE lead_id = p_lead_id AND is_current FOR UPDATE;
  IF v_old.id IS NULL OR v_old.status NOT IN ('approved', 'denied') THEN RAISE EXCEPTION 'Only a completed QC review can be reopened'; END IF;

  UPDATE public.qc_review_cycles SET is_current = false, updated_at = now() WHERE id = v_old.id;
  INSERT INTO public.qc_review_cycles (
    lead_id, appointment_id, company_id, location_id, cycle_number, status, reason
  ) VALUES (
    p_lead_id, v_appt.id, v_lead.company_id, v_lead.location_id, v_old.cycle_number + 1, 'pending', trim(p_reason)
  ) RETURNING * INTO v_new;

  UPDATE public.portal_leads SET qc_status = 'pending', qc_reason = trim(p_reason),
    qc_notes = NULL, qc_reviewed_by = NULL, qc_reviewed_at = NULL, updated_at = now()
  WHERE id = p_lead_id;
  UPDATE public.portal_appointments SET status = 'qc_pending', company_visible_at = NULL, updated_at = now()
  WHERE id = v_appt.id;

  PERFORM public.portal_write_audit(
    v_lead.company_id, v_role, (SELECT auth.uid()), public.portal_actor_name_for_management(),
    'qc_reopened', 'lead', p_lead_id,
    jsonb_build_object('qc_status', v_old.status, 'qc_review_id', v_old.id),
    jsonb_build_object('qc_status', 'pending', 'qc_review_id', v_new.id),
    jsonb_build_object('appointment_id', v_appt.id, 'reason', p_reason)
  );
  RETURN to_jsonb(v_new);
END;
$function$;

CREATE OR REPLACE FUNCTION public.qc_resubmit_correction(p_lead_id uuid, p_notes text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_lead public.portal_leads%ROWTYPE;
  v_cycle public.qc_review_cycles%ROWTYPE;
  v_profile public.profiles%ROWTYPE;
BEGIN
  SELECT * INTO v_profile FROM public.profiles WHERE id = (SELECT auth.uid());
  SELECT * INTO v_lead FROM public.portal_leads WHERE id = p_lead_id FOR UPDATE;
  SELECT * INTO v_cycle FROM public.qc_review_cycles WHERE lead_id = p_lead_id AND is_current FOR UPDATE;
  IF v_lead.id IS NULL OR v_cycle.id IS NULL OR v_cycle.status <> 'needs_correction' THEN
    RAISE EXCEPTION 'A Needs Correction review was not found';
  END IF;
  IF NOT (
    private.readyops_can_review_company(v_lead.company_id)
    OR (
      v_profile.role = 'agent'
      AND (v_lead.agent_profile_id = v_profile.id OR (v_profile.agent_id IS NOT NULL AND v_lead.agent_id = v_profile.agent_id))
    )
  ) THEN RAISE EXCEPTION 'Correction resubmission access denied'; END IF;

  UPDATE public.qc_review_cycles
  SET status = 'pending', assigned_to = NULL, reviewer_id = NULL, started_at = NULL,
    completed_at = NULL, notes = coalesce(nullif(trim(p_notes), ''), notes), updated_at = now()
  WHERE id = v_cycle.id
  RETURNING * INTO v_cycle;
  UPDATE public.portal_leads SET qc_status = 'pending', qc_notes = coalesce(nullif(trim(p_notes), ''), qc_notes),
    qc_reviewed_by = NULL, qc_reviewed_at = NULL, updated_at = now()
  WHERE id = p_lead_id;

  INSERT INTO public.portal_audit_logs (
    company_id, actor_type, actor_id, actor_name, action, entity_type, entity_id, new_value, metadata
  ) VALUES (
    v_lead.company_id,
    v_profile.role,
    v_profile.id,
    coalesce(nullif(v_profile.display_name, ''), 'ReadyOps User'),
    'qc_correction_resubmitted',
    'lead',
    p_lead_id,
    jsonb_build_object('qc_status', 'pending', 'notes', p_notes),
    jsonb_build_object('appointment_id', v_cycle.appointment_id, 'qc_review_id', v_cycle.id, 'correction_attempt', v_cycle.correction_attempt)
  );
  RETURN to_jsonb(v_cycle);
END;
$function$;

CREATE OR REPLACE FUNCTION public.qc_log_export(p_filters jsonb, p_row_count integer)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_role text := private.readyops_profile_role();
  v_id uuid;
BEGIN
  IF v_role NOT IN ('admin', 'qc', 'manager') THEN RAISE EXCEPTION 'QC export access required'; END IF;
  INSERT INTO public.portal_audit_logs (
    actor_type, actor_id, actor_name, action, entity_type, new_value, metadata
  ) VALUES (
    v_role,
    (SELECT auth.uid()),
    public.portal_actor_name_for_management(),
    'qc_export_created',
    'qc_queue',
    jsonb_build_object('row_count', greatest(coalesce(p_row_count, 0), 0)),
    jsonb_build_object('filters', coalesce(p_filters, '{}'::jsonb))
  ) RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.qc_move_lead(
  p_lead_id uuid,
  p_company_id uuid,
  p_location_id uuid,
  p_date date,
  p_start_time text,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_lead public.portal_leads%ROWTYPE;
  v_appt public.portal_appointments%ROWTYPE;
  v_rule public.company_schedule_rules%ROWTYPE;
  v_start time;
  v_settings public.company_portal_settings%ROWTYPE;
  v_old jsonb;
  v_cycle public.qc_review_cycles%ROWTYPE;
  v_next_cycle public.qc_review_cycles%ROWTYPE;
  v_actor_type text := private.readyops_profile_role();
  v_is_reschedule boolean;
BEGIN
  SELECT * INTO v_lead FROM public.portal_leads WHERE id = p_lead_id FOR UPDATE;
  SELECT * INTO v_appt FROM public.portal_appointments WHERE lead_id = p_lead_id FOR UPDATE;
  IF v_lead.id IS NULL OR v_appt.id IS NULL THEN RAISE EXCEPTION 'Lead or appointment not found'; END IF;
  IF NOT private.readyops_can_review_company(v_lead.company_id) OR NOT private.readyops_can_review_company(p_company_id) THEN
    RAISE EXCEPTION 'QC reviewer access required for both companies';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.roster_companies WHERE id = p_company_id AND account_status = 'Active') THEN
    RAISE EXCEPTION 'Target company is not active';
  END IF;
  IF p_location_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.company_locations WHERE id = p_location_id AND company_id = p_company_id AND active
  ) THEN RAISE EXCEPTION 'Target service area does not belong to the company'; END IF;

  v_start := p_start_time::time;
  v_rule := public.portal_assert_slot_capacity(
    p_company_id, p_location_id, p_date, v_start, NULL,
    CASE WHEN v_appt.company_id = p_company_id THEN v_appt.id ELSE NULL END,
    true
  );
  SELECT * INTO v_settings FROM public.company_portal_settings WHERE company_id = p_company_id;
  SELECT * INTO v_cycle FROM public.qc_review_cycles WHERE lead_id = p_lead_id AND is_current FOR UPDATE;
  v_is_reschedule := v_appt.appointment_date <> p_date OR v_appt.start_time <> v_start;
  v_old := jsonb_build_object(
    'company_id', v_lead.company_id,
    'location_id', v_lead.location_id,
    'date', v_appt.appointment_date,
    'start_time', v_appt.start_time
  );

  INSERT INTO public.appointment_reschedule_history (
    company_id, appointment_id, lead_id,
    old_appointment_date, old_start_time, old_end_time,
    new_appointment_date, new_start_time, new_end_time,
    reason, changed_by, old_company_id, new_company_id,
    old_location_id, new_location_id, qc_review_id
  ) VALUES (
    v_lead.company_id, v_appt.id, v_lead.id,
    v_appt.appointment_date, v_appt.start_time, v_appt.end_time,
    p_date, v_start, (v_start + make_interval(mins => v_rule.slot_minutes))::time,
    p_reason, (SELECT auth.uid()), v_lead.company_id, p_company_id,
    v_lead.location_id, p_location_id, v_cycle.id
  );

  IF v_cycle.id IS NOT NULL AND v_cycle.status IN ('approved', 'denied') THEN
    UPDATE public.qc_review_cycles SET is_current = false, updated_at = now() WHERE id = v_cycle.id;
    INSERT INTO public.qc_review_cycles (
      lead_id, appointment_id, company_id, location_id, cycle_number, status, reason
    ) VALUES (
      v_lead.id, v_appt.id, p_company_id, p_location_id, v_cycle.cycle_number + 1, 'pending', p_reason
    ) RETURNING * INTO v_next_cycle;
  ELSIF v_cycle.id IS NOT NULL THEN
    UPDATE public.qc_review_cycles
    SET company_id = p_company_id, location_id = p_location_id, status = 'pending',
      assigned_to = NULL, reviewer_id = NULL, started_at = NULL, completed_at = NULL,
      reason = nullif(trim(coalesce(p_reason, '')), ''), updated_at = now()
    WHERE id = v_cycle.id
    RETURNING * INTO v_next_cycle;
  ELSE
    INSERT INTO public.qc_review_cycles (
      lead_id, appointment_id, company_id, location_id, cycle_number, status, reason
    ) VALUES (
      v_lead.id, v_appt.id, p_company_id, p_location_id, 1, 'pending', p_reason
    ) RETURNING * INTO v_next_cycle;
  END IF;

  UPDATE public.portal_leads
  SET company_id = p_company_id, location_id = p_location_id,
    package_id = public.portal_active_package(p_company_id), qc_status = 'pending',
    qc_reason = nullif(trim(coalesce(p_reason, '')), ''), qc_notes = NULL,
    qc_reviewed_by = NULL, qc_reviewed_at = NULL, updated_at = now()
  WHERE id = p_lead_id
  RETURNING * INTO v_lead;

  UPDATE public.portal_appointments
  SET company_id = p_company_id, location_id = p_location_id,
    appointment_date = p_date, start_time = v_start,
    end_time = (v_start + make_interval(mins => v_rule.slot_minutes))::time,
    timezone = coalesce(v_settings.timezone, 'America/Chicago'), status = 'qc_pending',
    representative_id = NULL, rep_status = 'unassigned', company_visible_at = NULL,
    updated_at = now()
  WHERE id = v_appt.id
  RETURNING * INTO v_appt;

  PERFORM public.portal_write_audit(
    p_company_id,
    v_actor_type,
    (SELECT auth.uid()),
    public.portal_actor_name_for_management(),
    CASE WHEN v_is_reschedule THEN 'appointment_rescheduled' ELSE 'qc_assignment_changed' END,
    'lead',
    v_lead.id,
    v_old,
    jsonb_build_object('company_id', p_company_id, 'location_id', p_location_id, 'date', p_date, 'start_time', v_start),
    jsonb_build_object('reason', p_reason, 'appointment_id', v_appt.id, 'qc_review_id', v_next_cycle.id)
  );

  RETURN jsonb_build_object('lead', to_jsonb(v_lead), 'appointment', to_jsonb(v_appt), 'qc_review', to_jsonb(v_next_cycle));
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_company_operations_overview()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF NOT public.portal_is_admin() THEN RAISE EXCEPTION 'Admin access required'; END IF;
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
          WHERE l.company_id = c.id
            AND l.qc_status = 'approved'
            AND a.company_visible_at IS NOT NULL
            AND a.status NOT IN ('draft', 'qc_pending', 'qc_denied', 'cancelled', 'rescheduled')
        ),
        'qc_pending', (
          SELECT count(DISTINCT l.id)
          FROM public.portal_leads AS l
          JOIN public.portal_appointments AS a ON a.lead_id = l.id
          WHERE l.company_id = c.id
            AND l.qc_required
            AND l.qc_status IN ('pending', 'in_review', 'needs_correction')
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

REVOKE ALL ON FUNCTION public.get_qc_reference_data() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_qc_calendar_queue(date, date, uuid, uuid, uuid, text, text, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.qc_start_review(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.qc_review_lead(uuid, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.qc_reopen_review(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.qc_resubmit_correction(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.qc_log_export(jsonb, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.qc_move_lead(uuid, uuid, uuid, date, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_company_operations_overview() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_qc_reference_data() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_qc_calendar_queue(date, date, uuid, uuid, uuid, text, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.qc_start_review(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.qc_review_lead(uuid, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.qc_reopen_review(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.qc_resubmit_correction(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.qc_log_export(jsonb, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.qc_move_lead(uuid, uuid, uuid, date, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_company_operations_overview() TO authenticated;

DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
    AND NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'qc_review_cycles'
    ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.qc_review_cycles;
  END IF;
END
$do$;

-- Token-scoped dashboard summary for the separate Company Management route.
-- The private company link is intentionally usable without a ReadyOps login,
-- so the UUID access token is verified before any company data is returned.
CREATE OR REPLACE FUNCTION public.get_company_management_dashboard_summary(
  p_company_id uuid,
  p_access_token uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_company public.roster_companies%ROWTYPE;
  v_package public.company_packages%ROWTYPE;
  v_total integer := 0;
  v_good integer := 0;
  v_signed integer := 0;
  v_no_show integer := 0;
  v_bad integer := 0;
  v_delivered integer := 0;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.company_portal_settings AS s
    WHERE s.company_id = p_company_id
      AND s.company_access_enabled
      AND s.company_access_token = p_access_token
  ) THEN
    RAISE EXCEPTION 'Invalid or disabled company management link';
  END IF;

  SELECT * INTO v_company
  FROM public.roster_companies
  WHERE id = p_company_id;

  SELECT
    count(DISTINCT a.id),
    count(DISTINCT a.id) FILTER (WHERE a.canonical_status = 'good_inspected'),
    count(DISTINCT a.id) FILTER (WHERE a.canonical_status = 'signed_contract'),
    count(DISTINCT a.id) FILTER (WHERE a.canonical_status = 'no_show'),
    count(DISTINCT a.id) FILTER (WHERE a.canonical_status = 'bad')
  INTO v_total, v_good, v_signed, v_no_show, v_bad
  FROM public.portal_appointments AS a
  JOIN public.portal_leads AS l ON l.id = a.lead_id
  WHERE a.company_id = p_company_id
    AND l.qc_status = 'approved'
    AND a.company_visible_at IS NOT NULL
    AND a.status NOT IN ('draft', 'qc_pending', 'qc_denied', 'cancelled', 'rescheduled');

  SELECT * INTO v_package
  FROM public.company_packages AS p
  WHERE p.company_id = p_company_id
    AND p.status = 'active'
    AND p.archived_at IS NULL
  ORDER BY p.package_number DESC NULLS LAST, p.start_date DESC, p.created_at DESC
  LIMIT 1;

  IF v_package.id IS NOT NULL THEN
    SELECT count(DISTINCT a.id) INTO v_delivered
    FROM public.portal_appointments AS a
    JOIN public.portal_leads AS l ON l.id = a.lead_id
    WHERE l.package_id = v_package.id
      AND l.qc_status = 'approved'
      AND a.company_visible_at IS NOT NULL
      AND a.status NOT IN ('draft', 'qc_pending', 'qc_denied', 'cancelled', 'rescheduled');
  END IF;

  RETURN jsonb_build_object(
    'company', jsonb_build_object(
      'id', v_company.id,
      'name', v_company.name,
      'state', v_company.state,
      'logo_path', v_company.logo_path
    ),
    'performance', jsonb_build_object(
      'total_leads', v_total,
      'good_inspected', v_good,
      'signed_contracts', v_signed,
      'no_shows', v_no_show,
      'bad_leads', v_bad,
      'inspection_rate', CASE WHEN v_total = 0 THEN 0 ELSE round(((v_good + v_signed)::numeric / v_total::numeric) * 100, 1) END,
      'close_rate', CASE WHEN (v_good + v_signed) = 0 THEN 0 ELSE round((v_signed::numeric / (v_good + v_signed)::numeric) * 100, 1) END
    ),
    'active_package', CASE WHEN v_package.id IS NULL THEN NULL ELSE to_jsonb(v_package) || jsonb_build_object(
      'delivered_leads', v_delivered,
      'remaining_leads', greatest(v_package.lead_target - v_delivered, 0),
      'completion_percentage', CASE WHEN v_package.lead_target = 0 THEN 0 ELSE round((v_delivered::numeric / v_package.lead_target::numeric) * 100, 1) END
    ) END,
    'package_history', coalesce((
      SELECT jsonb_agg(to_jsonb(p) || jsonb_build_object(
        'delivered_leads', (
          SELECT count(DISTINCT a.id)
          FROM public.portal_appointments AS a
          JOIN public.portal_leads AS l ON l.id = a.lead_id
          WHERE l.package_id = p.id
            AND l.qc_status = 'approved'
            AND a.company_visible_at IS NOT NULL
            AND a.status NOT IN ('draft', 'qc_pending', 'qc_denied', 'cancelled', 'rescheduled')
        )
      ) ORDER BY p.package_number DESC NULLS LAST, p.created_at DESC)
      FROM public.company_packages AS p
      WHERE p.company_id = p_company_id
        AND p.archived_at IS NULL
    ), '[]'::jsonb),
    'last_updated_at', greatest(
      coalesce((SELECT max(a.updated_at) FROM public.portal_appointments AS a WHERE a.company_id = p_company_id), '-infinity'::timestamptz),
      coalesce((SELECT max(p.updated_at) FROM public.company_packages AS p WHERE p.company_id = p_company_id), now())
    )
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_company_management_dashboard_summary(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_company_management_dashboard_summary(uuid, uuid) TO anon, authenticated;
