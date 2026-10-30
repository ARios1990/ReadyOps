-- Add filter-aware Good and Bad outcome totals to the existing Admin CRM response.
-- The function retains its existing admin-only auth.uid/role guard and privileges.
DO $migration$
DECLARE
  v_signature regprocedure := 'public.get_admin_lead_crm_by_agent(text,uuid,text,text,text,text,date,date,integer,integer,uuid,uuid)'::regprocedure;
  v_definition text;
  v_updated text;
BEGIN
  SELECT pg_get_functiondef(v_signature) INTO v_definition;

  IF v_definition LIKE '%''good'', count(*) FILTER (%'
     AND v_definition LIKE '%''bad'', count(*) FILTER (%' THEN
    RETURN;
  END IF;

  v_updated := regexp_replace(
    v_definition,
    $find$'signed_contracts', count\(\*\) FILTER \(WHERE sales_outcome = 'signed_contract' OR canonical_status = 'signed_contract'\),[[:space:]]+'revenue',$find$,
    $replace$'good', count(*) FILTER (
            WHERE client_status IN ('good', 'inspected', 'good_inspected')
               OR canonical_status = 'good_inspected'
               OR sales_outcome IN ('good', 'good_inspected')
          ),
          'bad', count(*) FILTER (
            WHERE client_status IN ('bad', 'cancelled', 'canceled', 'lost')
               OR canonical_status = 'bad'
               OR sales_outcome IN ('bad', 'cancelled', 'canceled', 'lost')
          ),
          'signed_contracts', count(*) FILTER (WHERE sales_outcome = 'signed_contract' OR canonical_status = 'signed_contract'),
          'revenue',$replace$
  );

  IF v_updated = v_definition
     OR v_updated NOT LIKE '%''good'', count(*) FILTER (%'
     OR v_updated NOT LIKE '%''bad'', count(*) FILTER (%' THEN
    RAISE EXCEPTION 'Unable to add Good and Bad totals to get_admin_lead_crm_by_agent';
  END IF;

  EXECUTE v_updated;
END
$migration$;

REVOKE ALL ON FUNCTION public.get_admin_lead_crm_by_agent(text,uuid,text,text,text,text,date,date,integer,integer,uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_lead_crm_by_agent(text,uuid,text,text,text,text,date,date,integer,integer,uuid,uuid) TO authenticated;

COMMENT ON FUNCTION public.get_admin_lead_crm_by_agent(text,uuid,text,text,text,text,date,date,integer,integer,uuid,uuid)
IS 'Returns the filter-aware Admin All Leads CRM page, summary totals including Good and Bad outcomes, and reference filters.';
