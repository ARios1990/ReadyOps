BEGIN;

-- Keep the Companies & Scheduling table on one canonical all-time data set.
-- QC counts describe the QC workflow; disposition counts are mutually
-- exclusive and account for every delivered lead exactly once.
CREATE OR REPLACE FUNCTION public.get_company_operations_overview()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  IF NOT public.portal_is_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  RETURN coalesce((
    SELECT jsonb_agg(
      row_data
      ORDER BY (row_data->>'active_package')::boolean DESC,
        row_data->>'company_name'
    )
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
        'owner_email', c.owner_email,
        'billing_email', c.billing_email,
        'secondary_emails', c.secondary_emails,
        'billing_address', c.billing_address,
        'website', c.website,
        'requirements_note', c.requirements_note,
        'notes', c.notes,
        'account_status', c.account_status,
        'public_slug', s.public_slug,
        'agent_link', CASE
          WHEN s.public_slug IS NULL THEN NULL
          ELSE '/book/' || s.public_slug || '?' || public.ready_mode_prefill_query()
        END,
        'plain_agent_link', CASE
          WHEN s.public_slug IS NULL THEN NULL
          ELSE '/book/' || s.public_slug
        END,
        'company_link', CASE
          WHEN s.public_slug IS NULL OR s.company_access_token IS NULL THEN NULL
          ELSE '/company/' || s.public_slug || '/manage/' || s.company_access_token
        END,
        'teams', coalesce((
          SELECT jsonb_agg(
            jsonb_build_object(
              'id', t.id,
              'name', t.name,
              'abbreviation', t.abbreviation
            )
            ORDER BY t.name
          )
          FROM public.company_teams AS ct
          JOIN public.teams AS t ON t.id = ct.team_id
          WHERE ct.company_id = c.id
        ), '[]'::jsonb),
        'total_leads', disposition.total_leads,
        'approved_leads', qc.approved_leads,
        'qc_pending', qc.qc_pending,
        'qc_denied', qc.qc_denied,
        'good_leads', disposition.good_leads,
        'signed_contracts', disposition.signed_contracts,
        'bad_leads', disposition.bad_leads,
        'no_shows', disposition.no_shows,
        'pending_updates', disposition.pending_updates,
        'scheduled_upcoming', (
          SELECT count(DISTINCT a.id)
          FROM public.portal_appointments AS a
          JOIN public.portal_leads AS l ON l.id = a.lead_id
          WHERE a.company_id = c.id
            AND l.qc_status = 'approved'
            AND a.company_visible_at IS NOT NULL
            AND a.appointment_date >= current_date
            AND a.status NOT IN (
              'draft', 'qc_pending', 'qc_denied', 'cancelled', 'rescheduled'
            )
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
              AND a.status NOT IN (
                'draft', 'qc_pending', 'qc_denied', 'cancelled', 'rescheduled'
              )
          ),
          'pending_leads', greatest(cp.lead_target - (
            SELECT count(DISTINCT l.id)
            FROM public.portal_leads AS l
            JOIN public.portal_appointments AS a ON a.lead_id = l.id
            WHERE l.package_id = cp.id
              AND l.qc_status = 'approved'
              AND a.company_visible_at IS NOT NULL
              AND a.status NOT IN (
                'draft', 'qc_pending', 'qc_denied', 'cancelled', 'rescheduled'
              )
          ), 0)
        ) END
      ) AS row_data
      FROM public.roster_companies AS c
      LEFT JOIN public.company_portal_settings AS s ON s.company_id = c.id
      LEFT JOIN LATERAL (
        SELECT
          count(*)::integer AS total_leads,
          count(*) FILTER (WHERE delivered.outcome = 'good')::integer AS good_leads,
          count(*) FILTER (WHERE delivered.outcome = 'signed_contract')::integer AS signed_contracts,
          count(*) FILTER (WHERE delivered.outcome = 'bad')::integer AS bad_leads,
          count(*) FILTER (WHERE delivered.outcome = 'no_show')::integer AS no_shows,
          count(*) FILTER (WHERE delivered.outcome = 'pending')::integer AS pending_updates
        FROM (
          SELECT DISTINCT ON (l.id)
            l.id,
            CASE
              WHEN normalized.company_action IN ('signed_contract', 'signed', 'signed_claim_filed')
                OR normalized.client_status IN ('signed_contract', 'signed', 'signed_claim_filed')
                OR normalized.canonical_status IN ('signed_contract', 'signed', 'signed_claim_filed')
                OR normalized.sales_outcome IN ('signed_contract', 'signed', 'signed_claim_filed')
                THEN 'signed_contract'
              WHEN normalized.company_action LIKE '%no_show%'
                OR normalized.client_status LIKE '%no_show%'
                OR normalized.canonical_status LIKE '%no_show%'
                OR normalized.sales_outcome LIKE '%no_show%'
                OR normalized.attendance_status LIKE '%no_show%'
                THEN 'no_show'
              WHEN normalized.company_action IN ('bad', 'lost')
                OR normalized.client_status IN ('bad', 'lost')
                OR normalized.canonical_status IN ('bad', 'lost')
                OR normalized.sales_outcome IN ('bad', 'lost')
                THEN 'bad'
              WHEN normalized.company_action IN ('good', 'inspected', 'good_inspected')
                OR normalized.client_status IN ('good', 'inspected', 'good_inspected')
                OR normalized.canonical_status IN ('good', 'inspected', 'good_inspected')
                OR normalized.sales_outcome IN ('good', 'inspected', 'good_inspected')
                THEN 'good'
              ELSE 'pending'
            END AS outcome
          FROM public.portal_leads AS l
          JOIN public.portal_appointments AS a ON a.lead_id = l.id
          CROSS JOIN LATERAL (
            SELECT
              regexp_replace(lower(trim(coalesce(a.company_action, ''))), '[[:space:]-]+', '_', 'g') AS company_action,
              regexp_replace(lower(trim(coalesce(a.client_status, ''))), '[[:space:]-]+', '_', 'g') AS client_status,
              regexp_replace(lower(trim(coalesce(a.canonical_status, ''))), '[[:space:]-]+', '_', 'g') AS canonical_status,
              regexp_replace(lower(trim(coalesce(a.sales_outcome, ''))), '[[:space:]-]+', '_', 'g') AS sales_outcome,
              regexp_replace(lower(trim(coalesce(a.attendance_status, ''))), '[[:space:]-]+', '_', 'g') AS attendance_status
          ) AS normalized
          WHERE l.company_id = c.id
            AND l.qc_status = 'approved'
            AND a.company_visible_at IS NOT NULL
            AND a.status NOT IN (
              'draft', 'qc_pending', 'qc_denied', 'cancelled', 'rescheduled'
            )
          ORDER BY l.id, a.updated_at DESC NULLS LAST, a.created_at DESC
        ) AS delivered
      ) AS disposition ON true
      LEFT JOIN LATERAL (
        SELECT
          count(DISTINCT l.id) FILTER (
            WHERE coalesce(q.status, l.qc_status) = 'approved'
              AND a.company_visible_at IS NOT NULL
              AND a.status NOT IN (
                'draft', 'qc_pending', 'qc_denied', 'cancelled', 'rescheduled'
              )
          )::integer AS approved_leads,
          count(DISTINCT l.id) FILTER (
            WHERE l.qc_required
              AND coalesce(q.status, l.qc_status) IN (
                'pending', 'in_review', 'needs_correction'
              )
              AND a.status NOT IN ('draft', 'cancelled', 'rescheduled')
          )::integer AS qc_pending,
          count(DISTINCT l.id) FILTER (
            WHERE l.qc_required
              AND coalesce(q.status, l.qc_status) = 'denied'
              AND a.status NOT IN ('draft', 'cancelled', 'rescheduled')
          )::integer AS qc_denied
        FROM public.portal_leads AS l
        JOIN public.portal_appointments AS a ON a.lead_id = l.id
        LEFT JOIN public.qc_review_cycles AS q
          ON q.lead_id = l.id AND q.is_current
        WHERE l.company_id = c.id
      ) AS qc ON true
      LEFT JOIN LATERAL (
        SELECT *
        FROM public.company_packages AS p
        WHERE p.company_id = c.id AND p.status = 'active'
        ORDER BY p.start_date DESC, p.created_at DESC
        LIMIT 1
      ) AS cp ON true
      WHERE true
    ) AS q
  ), '[]'::jsonb);
END;
$function$;

REVOKE ALL ON FUNCTION public.get_company_operations_overview()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_company_operations_overview()
  TO authenticated;

COMMENT ON FUNCTION public.get_company_operations_overview()
IS 'Admin company operations overview with canonical all-time delivered-lead dispositions and separate current QC workflow counts.';

COMMIT;
