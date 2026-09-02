BEGIN;

CREATE OR REPLACE FUNCTION public.readyops_owner_access()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
  SELECT private.readyops_is_owner_admin()
$function$;

REVOKE ALL ON FUNCTION public.readyops_owner_access()
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.readyops_owner_access()
  TO authenticated;

CREATE OR REPLACE FUNCTION public.get_owner_paid_client_leads(
  p_search text DEFAULT NULL,
  p_company_id uuid DEFAULT NULL,
  p_payment_source text DEFAULT 'all',
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
  v_search text := trim(coalesce(p_search, ''));
  v_digits text := regexp_replace(coalesce(p_search, ''), '[^0-9]', '', 'g');
  v_source text := lower(trim(coalesce(p_payment_source, 'all')));
  v_limit integer := least(greatest(coalesce(p_limit, 50), 10), 500);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
BEGIN
  IF NOT private.readyops_is_owner_admin() THEN
    RAISE EXCEPTION 'Owner account access is required';
  END IF;
  IF v_source NOT IN ('all', 'invoice', 'package') THEN
    RAISE EXCEPTION 'Invalid payment source';
  END IF;
  IF p_start_date IS NOT NULL
     AND p_end_date IS NOT NULL
     AND p_end_date < p_start_date THEN
    RAISE EXCEPTION 'End date must be on or after start date';
  END IF;

  RETURN (
    WITH paid_invoice AS MATERIALIZED (
      SELECT DISTINCT ON (item.lead_id)
        item.lead_id,
        invoice.id AS invoice_id,
        invoice.invoice_number,
        invoice.billing_type,
        item.unit_rate,
        item.line_total,
        invoice.amount_paid,
        invoice.total AS invoice_total,
        coalesce(payment.payment_date, invoice.updated_at::date) AS payment_date
      FROM public.invoice_items AS item
      JOIN public.invoices AS invoice ON invoice.id = item.invoice_id
      LEFT JOIN LATERAL (
        SELECT max(recorded.payment_date) AS payment_date
        FROM public.invoice_payments AS recorded
        WHERE recorded.invoice_id = invoice.id
      ) AS payment ON true
      WHERE invoice.status = 'paid'
         OR (
           coalesce(invoice.amount_paid, 0) > 0
           AND coalesce(invoice.balance, invoice.total - invoice.amount_paid, 0) <= 0
         )
      ORDER BY item.lead_id, invoice.updated_at DESC, invoice.created_at DESC
    ),
    paid_package AS MATERIALIZED (
      SELECT
        lead.id AS lead_id,
        package.id AS package_id,
        package.package_name,
        package.agreement_type,
        package.amount_per_lead,
        package.package_total,
        package.payment_date
      FROM public.portal_leads AS lead
      JOIN public.company_packages AS package ON package.id = lead.package_id
      WHERE lower(package.payment_status) IN ('paid', 'complete', 'completed')
    ),
    paid_base AS MATERIALIZED (
      SELECT
        lead.id AS lead_id,
        lead.lead_code,
        lead.company_id,
        company.name AS company_name,
        lead.full_name,
        lead.phone_number,
        lead.email,
        lead.address,
        lead.city,
        lead.state,
        lead.zip_code,
        lead.service_needed,
        lead.form_data,
        lead.qc_status,
        lead.source,
        lead.created_at AS lead_received_at,
        appointment.id AS appointment_id,
        appointment.appointment_date,
        appointment.start_time,
        coalesce(
          appointment.company_action,
          appointment.canonical_status,
          appointment.client_status,
          'pending'
        ) AS lead_status,
        CASE WHEN paid_invoice.lead_id IS NOT NULL THEN 'invoice' ELSE 'package' END AS payment_source,
        coalesce(paid_invoice.billing_type, paid_package.agreement_type, 'paid_per_lead') AS billing_type,
        coalesce(paid_invoice.line_total, paid_package.amount_per_lead, 0) AS client_pay,
        coalesce(paid_invoice.payment_date, paid_package.payment_date) AS payment_date,
        paid_invoice.invoice_id,
        paid_invoice.invoice_number,
        paid_invoice.invoice_total,
        paid_invoice.amount_paid,
        paid_package.package_id,
        paid_package.package_name,
        paid_package.package_total
      FROM public.portal_leads AS lead
      JOIN public.roster_companies AS company ON company.id = lead.company_id
      LEFT JOIN paid_invoice ON paid_invoice.lead_id = lead.id
      LEFT JOIN paid_package ON paid_package.lead_id = lead.id
      LEFT JOIN LATERAL (
        SELECT candidate.*
        FROM public.portal_appointments AS candidate
        WHERE candidate.lead_id = lead.id
        ORDER BY candidate.updated_at DESC, candidate.created_at DESC
        LIMIT 1
      ) AS appointment ON true
      WHERE paid_invoice.lead_id IS NOT NULL
         OR paid_package.lead_id IS NOT NULL
    ),
    filtered AS MATERIALIZED (
      SELECT *
      FROM paid_base AS paid
      WHERE (p_company_id IS NULL OR paid.company_id = p_company_id)
        AND (v_source = 'all' OR paid.payment_source = v_source)
        AND (p_start_date IS NULL OR paid.appointment_date >= p_start_date)
        AND (p_end_date IS NULL OR paid.appointment_date <= p_end_date)
        AND (
          v_search = ''
          OR concat_ws(
            ' ', paid.lead_code, paid.company_name, paid.full_name,
            paid.phone_number, paid.email, paid.address, paid.city,
            paid.state, paid.zip_code, paid.invoice_number,
            paid.package_name
          ) ILIKE '%' || v_search || '%'
          OR (
            length(v_digits) >= 4
            AND regexp_replace(coalesce(paid.phone_number, ''), '[^0-9]', '', 'g')
              LIKE '%' || v_digits || '%'
          )
        )
    ),
    paged AS (
      SELECT *
      FROM filtered
      ORDER BY payment_date DESC NULLS LAST,
        appointment_date DESC NULLS LAST,
        lead_received_at DESC
      LIMIT v_limit
      OFFSET v_offset
    )
    SELECT jsonb_build_object(
      'total', (SELECT count(*) FROM filtered),
      'limit', v_limit,
      'offset', v_offset,
      'summary', jsonb_build_object(
        'paid_leads', (SELECT count(*) FROM filtered),
        'paid_value', coalesce((SELECT sum(client_pay) FROM filtered), 0),
        'companies', (SELECT count(DISTINCT company_id) FROM filtered),
        'invoice_paid', (SELECT count(*) FROM filtered WHERE payment_source = 'invoice'),
        'package_paid', (SELECT count(*) FROM filtered WHERE payment_source = 'package')
      ),
      'companies', coalesce((
        SELECT jsonb_agg(jsonb_build_object('id', company_id, 'name', company_name) ORDER BY company_name)
        FROM (
          SELECT DISTINCT company_id, company_name
          FROM paid_base
        ) AS paid_companies
      ), '[]'::jsonb),
      'rows', coalesce((
        SELECT jsonb_agg(
          jsonb_build_object(
            'lead_id', row.lead_id,
            'lead_code', row.lead_code,
            'company_id', row.company_id,
            'company_name', row.company_name,
            'full_name', row.full_name,
            'phone_number', row.phone_number,
            'email', row.email,
            'address', row.address,
            'city', row.city,
            'state', row.state,
            'zip_code', row.zip_code,
            'service_needed', row.service_needed,
            'form_data', coalesce(row.form_data, '{}'::jsonb),
            'qc_status', row.qc_status,
            'source', row.source,
            'lead_received_at', row.lead_received_at,
            'appointment_id', row.appointment_id,
            'appointment_date', row.appointment_date,
            'start_time', row.start_time,
            'lead_status', row.lead_status,
            'payment_source', row.payment_source,
            'billing_type', row.billing_type,
            'client_pay', row.client_pay,
            'payment_status', 'paid',
            'payment_date', row.payment_date,
            'invoice_id', row.invoice_id,
            'invoice_number', row.invoice_number,
            'invoice_total', row.invoice_total,
            'amount_paid', row.amount_paid,
            'package_id', row.package_id,
            'package_name', row.package_name,
            'package_total', row.package_total
          )
          ORDER BY row.payment_date DESC NULLS LAST,
            row.appointment_date DESC NULLS LAST,
            row.lead_received_at DESC
        )
        FROM paged AS row
      ), '[]'::jsonb)
    )
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_owner_paid_client_leads(
  text, uuid, text, date, date, integer, integer
) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_owner_paid_client_leads(
  text, uuid, text, date, date, integer, integer
) TO authenticated;

COMMENT ON FUNCTION public.readyops_owner_access()
  IS 'Returns whether the current authenticated user is the established ReadyOps owner account.';
COMMENT ON FUNCTION public.get_owner_paid_client_leads(text, uuid, text, date, date, integer, integer)
  IS 'Owner-only paid client lead ledger backed by completed packages and fully paid invoice items.';

CREATE INDEX IF NOT EXISTS invoice_items_lead_id_idx
  ON public.invoice_items(lead_id);
CREATE INDEX IF NOT EXISTS portal_leads_package_id_idx
  ON public.portal_leads(package_id)
  WHERE package_id IS NOT NULL;

COMMIT;
