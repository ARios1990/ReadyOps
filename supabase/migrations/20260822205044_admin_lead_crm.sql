BEGIN;

CREATE OR REPLACE FUNCTION public.get_admin_lead_crm(
  p_search text DEFAULT NULL,
  p_company_id uuid DEFAULT NULL,
  p_qc_status text DEFAULT NULL,
  p_client_status text DEFAULT NULL,
  p_source text DEFAULT NULL,
  p_date_basis text DEFAULT 'received',
  p_start_date date DEFAULT NULL,
  p_end_date date DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_role text := private.readyops_profile_role();
  v_limit integer := least(greatest(coalesce(p_limit, 50), 10), 200);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
BEGIN
  IF (SELECT auth.uid()) IS NULL OR v_role <> 'admin' THEN
    RAISE EXCEPTION 'Main Admin access required';
  END IF;
  IF p_date_basis NOT IN ('received', 'appointment') THEN
    RAISE EXCEPTION 'Date basis must be received or appointment';
  END IF;
  IF p_start_date IS NOT NULL AND p_end_date IS NOT NULL AND p_end_date < p_start_date THEN
    RAISE EXCEPTION 'End date must be on or after start date';
  END IF;

  RETURN (
    WITH base AS MATERIALIZED (
      SELECT
        l.id,
        l.lead_code,
        l.full_name,
        l.phone_number,
        l.email,
        l.address,
        l.city,
        l.state,
        l.zip_code,
        l.service_needed,
        l.language,
        l.notes,
        l.home_value,
        l.sq_ft,
        l.web_url,
        l.form_data,
        l.qualification_status,
        l.qualification_reasons,
        l.qc_status,
        l.qc_reason,
        l.qc_notes,
        l.source,
        l.source_lead_id,
        l.source_disposition,
        l.recording_url,
        l.share_recording_with_company,
        l.created_at,
        l.updated_at,
        (l.created_at AT TIME ZONE coalesce(loc.timezone, cps.timezone, 'America/Chicago'))::date AS received_date,
        coalesce(loc.timezone, cps.timezone, 'America/Chicago') AS received_timezone,
        c.id AS company_id,
        c.name AS company_name,
        loc.id AS location_id,
        loc.location_label,
        ag.id AS agent_id,
        coalesce(ag.name, l.agent_name) AS agent_name,
        ag.team_id AS agent_team_id,
        a.id AS appointment_id,
        a.appointment_date,
        a.start_time,
        a.end_time,
        a.timezone AS appointment_timezone,
        a.status AS appointment_status,
        a.canonical_status,
        a.rep_status,
        a.attendance_status,
        a.inspection_status,
        a.sales_outcome,
        a.client_status,
        a.company_visible_at,
        a.inspector_notes,
        rep.id AS inspector_id,
        rep.name AS inspector_name,
        cp.id AS package_id,
        cp.package_name,
        cp.amount_per_lead,
        cp.package_total,
        cp.payment_status,
        coalesce(q.status, l.qc_status) AS current_qc_status,
        q.cycle_number AS qc_cycle_number,
        q.reason AS current_qc_reason,
        q.notes AS current_qc_notes,
        fin.invoice_id,
        fin.invoice_number,
        fin.invoice_status,
        fin.invoice_unit_rate,
        fin.invoice_line_total,
        CASE
          WHEN p_date_basis = 'appointment' THEN a.appointment_date
          ELSE (l.created_at AT TIME ZONE coalesce(loc.timezone, cps.timezone, 'America/Chicago'))::date
        END AS filter_date
      FROM public.portal_leads AS l
      JOIN public.roster_companies AS c ON c.id = l.company_id
      LEFT JOIN public.company_locations AS loc ON loc.id = l.location_id
      LEFT JOIN public.company_portal_settings AS cps ON cps.company_id = l.company_id
      LEFT JOIN public.agents AS ag ON ag.id = l.agent_id
      LEFT JOIN public.company_packages AS cp ON cp.id = l.package_id
      LEFT JOIN LATERAL (
        SELECT ap.*
        FROM public.portal_appointments AS ap
        WHERE ap.lead_id = l.id
        ORDER BY ap.created_at DESC, ap.id
        LIMIT 1
      ) AS a ON true
      LEFT JOIN public.company_representatives AS rep ON rep.id = a.representative_id
      LEFT JOIN public.qc_review_cycles AS q ON q.lead_id = l.id AND q.is_current
      LEFT JOIN LATERAL (
        SELECT
          i.id AS invoice_id,
          i.invoice_number,
          i.status AS invoice_status,
          max(ii.unit_rate) AS invoice_unit_rate,
          sum(ii.line_total) AS invoice_line_total
        FROM public.invoice_items AS ii
        JOIN public.invoices AS i ON i.id = ii.invoice_id
        WHERE ii.lead_id = l.id
        GROUP BY i.id, i.invoice_number, i.status
        ORDER BY i.created_at DESC
        LIMIT 1
      ) AS fin ON true
      WHERE (p_company_id IS NULL OR l.company_id = p_company_id)
        AND (p_qc_status IS NULL OR p_qc_status = 'all' OR coalesce(q.status, l.qc_status) = p_qc_status)
        AND (
          p_client_status IS NULL OR p_client_status = 'all'
          OR coalesce(a.client_status, a.canonical_status, a.status, 'unassigned') = p_client_status
        )
        AND (p_source IS NULL OR p_source = 'all' OR coalesce(l.source, 'Unknown') = p_source)
        AND (
          nullif(trim(coalesce(p_search, '')), '') IS NULL
          OR concat_ws(
            ' ', l.lead_code, l.full_name, l.phone_number, l.email, l.address,
            l.city, l.state, l.zip_code, c.name, ag.name, l.source_lead_id
          ) ILIKE '%' || trim(p_search) || '%'
        )
        AND (
          p_start_date IS NULL
          OR CASE
            WHEN p_date_basis = 'appointment' THEN a.appointment_date
            ELSE (l.created_at AT TIME ZONE coalesce(loc.timezone, cps.timezone, 'America/Chicago'))::date
          END >= p_start_date
        )
        AND (
          p_end_date IS NULL
          OR CASE
            WHEN p_date_basis = 'appointment' THEN a.appointment_date
            ELSE (l.created_at AT TIME ZONE coalesce(loc.timezone, cps.timezone, 'America/Chicago'))::date
          END <= p_end_date
        )
    ),
    paged AS (
      SELECT *
      FROM base
      ORDER BY filter_date DESC NULLS LAST, created_at DESC, id
      LIMIT v_limit OFFSET v_offset
    )
    SELECT jsonb_build_object(
      'total', (SELECT count(*) FROM base),
      'limit', v_limit,
      'offset', v_offset,
      'summary', (
        SELECT jsonb_build_object(
          'total', count(*),
          'pending_qc', count(*) FILTER (WHERE current_qc_status IN ('pending', 'in_review', 'manager_approved')),
          'approved', count(*) FILTER (WHERE current_qc_status = 'approved'),
          'sent_to_client', count(*) FILTER (WHERE company_visible_at IS NOT NULL),
          'signed_contracts', count(*) FILTER (WHERE sales_outcome = 'signed_contract' OR canonical_status = 'signed_contract'),
          'revenue', coalesce(sum(coalesce(invoice_line_total, amount_per_lead, 0)), 0)
        ) FROM base
      ),
      'companies', coalesce((
        SELECT jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name) ORDER BY c.name)
        FROM public.roster_companies AS c
      ), '[]'::jsonb),
      'sources', coalesce((
        SELECT jsonb_agg(s.source ORDER BY s.source)
        FROM (
          SELECT DISTINCT coalesce(l.source, 'Unknown') AS source
          FROM public.portal_leads AS l
        ) AS s
      ), '[]'::jsonb),
      'rows', coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'filter_date', p.filter_date,
          'lead', jsonb_build_object(
            'id', p.id, 'lead_code', p.lead_code, 'full_name', p.full_name,
            'phone_number', p.phone_number, 'email', p.email, 'address', p.address,
            'city', p.city, 'state', p.state, 'zip_code', p.zip_code,
            'service_needed', p.service_needed, 'language', p.language, 'notes', p.notes,
            'home_value', p.home_value, 'sq_ft', p.sq_ft, 'web_url', p.web_url,
            'form_data', p.form_data, 'qualification_status', p.qualification_status,
            'qualification_reasons', p.qualification_reasons, 'qc_status', p.current_qc_status,
            'qc_reason', coalesce(p.current_qc_reason, p.qc_reason),
            'qc_notes', coalesce(p.current_qc_notes, p.qc_notes),
            'source', p.source, 'source_lead_id', p.source_lead_id,
            'source_disposition', p.source_disposition, 'recording_url', p.recording_url,
            'share_recording_with_company', p.share_recording_with_company,
            'created_at', p.created_at, 'updated_at', p.updated_at,
            'received_date', p.received_date, 'received_timezone', p.received_timezone
          ),
          'appointment', jsonb_build_object(
            'id', p.appointment_id, 'appointment_date', p.appointment_date,
            'start_time', p.start_time, 'end_time', p.end_time,
            'timezone', p.appointment_timezone, 'status', p.appointment_status,
            'canonical_status', p.canonical_status, 'rep_status', p.rep_status,
            'attendance_status', p.attendance_status, 'inspection_status', p.inspection_status,
            'sales_outcome', p.sales_outcome, 'client_status', p.client_status,
            'company_visible_at', p.company_visible_at, 'inspector_notes', p.inspector_notes
          ),
          'company', jsonb_build_object(
            'id', p.company_id, 'name', p.company_name,
            'location_id', p.location_id, 'location_label', p.location_label
          ),
          'agent', jsonb_build_object('id', p.agent_id, 'name', p.agent_name, 'team_id', p.agent_team_id),
          'inspector', jsonb_build_object('id', p.inspector_id, 'name', p.inspector_name),
          'package', jsonb_build_object(
            'id', p.package_id, 'name', p.package_name, 'amount_per_lead', p.amount_per_lead,
            'package_total', p.package_total, 'payment_status', p.payment_status
          ),
          'financial', jsonb_build_object(
            'invoice_id', p.invoice_id, 'invoice_number', p.invoice_number,
            'invoice_status', p.invoice_status, 'unit_rate', p.invoice_unit_rate,
            'line_total', p.invoice_line_total
          ),
          'qc_cycle_number', p.qc_cycle_number
        ) ORDER BY p.filter_date DESC NULLS LAST, p.created_at DESC, p.id)
        FROM paged AS p
      ), '[]'::jsonb)
    )
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_admin_lead_crm_detail(p_lead_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_role text := private.readyops_profile_role();
  v_company_id uuid;
  v_appointment_id uuid;
  v_record jsonb;
BEGIN
  IF (SELECT auth.uid()) IS NULL OR v_role <> 'admin' THEN
    RAISE EXCEPTION 'Main Admin access required';
  END IF;

  SELECT l.company_id, a.id,
    jsonb_build_object(
      'lead', to_jsonb(l) - 'session_id' - 'import_dedupe_key',
      'appointment', CASE WHEN a.id IS NULL THEN NULL ELSE to_jsonb(a) - 'manage_token' END,
      'company', jsonb_build_object('id', c.id, 'name', c.name, 'state', c.state),
      'location', CASE WHEN loc.id IS NULL THEN NULL ELSE jsonb_build_object(
        'id', loc.id, 'label', loc.location_label, 'timezone', loc.timezone
      ) END,
      'agent', CASE WHEN ag.id IS NULL THEN NULL ELSE jsonb_build_object(
        'id', ag.id, 'name', ag.name, 'team_id', ag.team_id, 'email', ag.email
      ) END,
      'inspector', CASE WHEN rep.id IS NULL THEN NULL ELSE jsonb_build_object(
        'id', rep.id, 'name', rep.name, 'phone', rep.phone, 'email', rep.email
      ) END,
      'package', CASE WHEN cp.id IS NULL THEN NULL ELSE to_jsonb(cp) END,
      'invoice', CASE WHEN inv.id IS NULL THEN NULL ELSE jsonb_build_object(
        'id', inv.id, 'invoice_number', inv.invoice_number, 'status', inv.status,
        'unit_rate', ii.unit_rate, 'line_total', ii.line_total,
        'amount_paid', inv.amount_paid, 'balance', inv.balance, 'due_date', inv.due_date
      ) END
    )
  INTO v_company_id, v_appointment_id, v_record
  FROM public.portal_leads AS l
  JOIN public.roster_companies AS c ON c.id = l.company_id
  LEFT JOIN public.company_locations AS loc ON loc.id = l.location_id
  LEFT JOIN public.agents AS ag ON ag.id = l.agent_id
  LEFT JOIN public.company_packages AS cp ON cp.id = l.package_id
  LEFT JOIN LATERAL (
    SELECT ap.* FROM public.portal_appointments AS ap
    WHERE ap.lead_id = l.id ORDER BY ap.created_at DESC, ap.id LIMIT 1
  ) AS a ON true
  LEFT JOIN public.company_representatives AS rep ON rep.id = a.representative_id
  LEFT JOIN LATERAL (
    SELECT item.* FROM public.invoice_items AS item
    WHERE item.lead_id = l.id ORDER BY item.created_at DESC LIMIT 1
  ) AS ii ON true
  LEFT JOIN public.invoices AS inv ON inv.id = ii.invoice_id
  WHERE l.id = p_lead_id;

  IF v_record IS NULL THEN
    RAISE EXCEPTION 'Lead not found';
  END IF;

  RETURN v_record || jsonb_build_object(
    'qc_history', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'cycle_number', q.cycle_number, 'status', q.status, 'reason', q.reason,
        'notes', q.notes, 'started_at', q.started_at, 'completed_at', q.completed_at,
        'created_at', q.created_at
      ) ORDER BY q.cycle_number DESC)
      FROM public.qc_review_cycles AS q
      WHERE q.lead_id = p_lead_id
    ), '[]'::jsonb),
    'reschedule_history', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'old_date', h.old_appointment_date, 'old_time', h.old_start_time,
        'new_date', h.new_appointment_date, 'new_time', h.new_start_time,
        'reason', h.reason, 'changed_at', h.changed_at
      ) ORDER BY h.changed_at DESC)
      FROM public.appointment_reschedule_history AS h
      WHERE h.lead_id = p_lead_id
    ), '[]'::jsonb),
    'audit_history', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'action', a.action, 'actor_type', a.actor_type, 'actor_name', a.actor_name,
        'metadata', a.metadata, 'created_at', a.created_at
      ) ORDER BY a.created_at DESC)
      FROM (
        SELECT log.*
        FROM public.portal_audit_logs AS log
        WHERE log.entity_id IN (p_lead_id, v_appointment_id)
           OR log.metadata->>'lead_id' = p_lead_id::text
        ORDER BY log.created_at DESC
        LIMIT 50
      ) AS a
    ), '[]'::jsonb)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_admin_lead_crm(text, uuid, text, text, text, text, date, date, integer, integer)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_admin_lead_crm_detail(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_lead_crm(text, uuid, text, text, text, text, date, date, integer, integer)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_lead_crm_detail(uuid)
  TO authenticated;

COMMENT ON FUNCTION public.get_admin_lead_crm(text, uuid, text, text, text, text, date, date, integer, integer)
IS 'Admin-only homeowner-first CRM list with operational and financial filters.';
COMMENT ON FUNCTION public.get_admin_lead_crm_detail(uuid)
IS 'Admin-only complete lead record with QC, reschedule, invoice, and audit history.';

COMMIT;
