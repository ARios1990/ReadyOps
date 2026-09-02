BEGIN;

CREATE OR REPLACE FUNCTION public.get_company_management_dashboard_summary(
  p_company_id uuid,
  p_access_token uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_company public.roster_companies%ROWTYPE;
  v_package public.company_packages%ROWTYPE;
  v_total integer := 0;
  v_good integer := 0;
  v_signed integer := 0;
  v_no_show integer := 0;
  v_bad integer := 0;
  v_rescheduled integer := 0;
  v_pending integer := 0;
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
    count(DISTINCT a.id) FILTER (
      WHERE a.canonical_status = 'good_inspected'
         OR a.client_status IN ('good', 'inspected', 'good_inspected')
         OR a.company_action IN ('good', 'inspected', 'good_inspected')
    ),
    count(DISTINCT a.id) FILTER (
      WHERE a.canonical_status = 'signed_contract'
         OR a.client_status IN ('signed', 'signed_contract')
         OR a.company_action IN ('signed', 'signed_contract')
    ),
    count(DISTINCT a.id) FILTER (
      WHERE a.canonical_status = 'no_show'
         OR a.client_status = 'no_show'
         OR a.company_action = 'no_show'
    ),
    count(DISTINCT a.id) FILTER (
      WHERE a.canonical_status = 'bad'
         OR a.client_status IN ('bad', 'cancelled', 'canceled', 'lost')
         OR a.company_action IN ('bad', 'cancelled', 'canceled', 'lost')
    ),
    count(DISTINCT a.id) FILTER (
      WHERE a.canonical_status IN ('rescheduled', 'reschedule')
         OR a.client_status IN ('rescheduled', 'reschedule')
         OR a.company_action IN ('rescheduled', 'reschedule')
    ),
    count(DISTINCT a.id) FILTER (
      WHERE coalesce(a.company_action, 'pending') = 'pending'
        AND coalesce(a.canonical_status, 'pending') NOT IN (
          'good_inspected', 'signed_contract', 'no_show', 'bad',
          'rescheduled', 'reschedule'
        )
    )
  INTO v_total, v_good, v_signed, v_no_show, v_bad, v_rescheduled, v_pending
  FROM public.portal_appointments AS a
  JOIN public.portal_leads AS l ON l.id = a.lead_id
  WHERE a.company_id = p_company_id
    AND l.qc_status = 'approved'
    AND a.company_visible_at IS NOT NULL
    AND a.status NOT IN ('draft', 'qc_pending', 'qc_denied');

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
      AND a.status NOT IN ('draft', 'qc_pending', 'qc_denied');
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
      'rescheduled', v_rescheduled,
      'pending_updates', v_pending,
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
            AND a.status NOT IN ('draft', 'qc_pending', 'qc_denied')
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

COMMENT ON FUNCTION public.get_company_management_dashboard_summary(uuid, uuid)
  IS 'Token-scoped company dashboard summary using the shared six-disposition status model.';

REVOKE ALL ON FUNCTION public.get_company_management_dashboard_summary(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_company_management_dashboard_summary(uuid, uuid) TO anon, authenticated;

COMMIT;
