BEGIN;

DO $migration$
DECLARE
  v_definition text;
  v_updated text;
BEGIN
  SELECT pg_get_functiondef(
    'public.get_company_location_lead_spreadsheet(uuid, uuid, uuid, text, text, integer, integer, uuid, date, date)'::regprocedure
  )
  INTO v_definition;

  IF v_definition LIKE '%''bad''%'
    AND v_definition LIKE '%v_filter = ''bad''%'
    AND v_definition LIKE '%''bad'', (%'
  THEN
    RETURN;
  END IF;

  v_updated := replace(
    v_definition,
    $find$    'signed_contract',
    'pending'
  ) THEN$find$,
    $replace$    'signed_contract',
    'bad',
    'pending'
  ) THEN$replace$
  );

  v_updated := replace(
    v_updated,
    $find$        OR (
          v_filter = 'pending'
          AND coalesce(lead_row.company_action, 'pending') = 'pending'
        )$find$,
    $replace$        OR (
          v_filter = 'bad'
          AND (
            lead_row.canonical_status = 'bad'
            OR lead_row.client_status = 'bad'
            OR lead_row.company_action = 'bad'
          )
        )
        OR (
          v_filter = 'pending'
          AND coalesce(lead_row.company_action, 'pending') = 'pending'
        )$replace$
  );

  v_updated := replace(
    v_updated,
    $find$        'no_show', (
          SELECT count(*) FROM base$find$,
    $replace$        'bad', (
          SELECT count(*) FROM base
          WHERE canonical_status = 'bad'
            OR client_status = 'bad'
            OR company_action = 'bad'
        ),
        'no_show', (
          SELECT count(*) FROM base$replace$
  );

  IF v_updated = v_definition
    OR v_updated NOT LIKE '%v_filter = ''bad''%'
    OR v_updated NOT LIKE '%''bad'', (%'
  THEN
    RAISE EXCEPTION 'Unable to add the bad lead filter to get_company_location_lead_spreadsheet';
  END IF;

  EXECUTE v_updated;
END;
$migration$;

COMMENT ON FUNCTION public.get_company_location_lead_spreadsheet(
  uuid, uuid, uuid, text, text, integer, integer, uuid, date, date
) IS 'Returns token-authorized company leads filtered by status, including bad outcomes, location, inspector, and appointment date range.';

COMMIT;
