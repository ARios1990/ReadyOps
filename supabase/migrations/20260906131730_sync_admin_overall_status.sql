BEGIN;

-- Overall Status is an admin-level disposition override. The CRM sends the
-- client, canonical, and company representations together so a stale terminal
-- value (for example, Bad) cannot win again after the admin selects Pending.
DO $migration$
DECLARE
  v_definition text;
  v_updated text;
BEGIN
  SELECT pg_get_functiondef(
    'public.admin_update_lead_crm(uuid,jsonb,jsonb)'::regprocedure
  ) INTO v_definition;

  v_updated := replace(
    v_definition,
    $find$      'inspection_status', 'sales_outcome', 'inspector_notes', 'company_action'$find$,
    $replace$      'inspection_status', 'sales_outcome', 'inspector_notes', 'company_action',
      'canonical_status'$replace$
  );

  IF v_updated = v_definition THEN
    RAISE EXCEPTION 'Could not add canonical_status to the Admin CRM appointment patch allowlist';
  END IF;

  v_definition := v_updated;
  v_updated := replace(
    v_definition,
    $find$        company_action = CASE WHEN p_appointment_patch ? 'company_action' THEN nullif(trim(p_appointment_patch->>'company_action'), '') ELSE company_action END,
        updated_at = now()$find$,
    $replace$        company_action = CASE WHEN p_appointment_patch ? 'company_action' THEN nullif(trim(p_appointment_patch->>'company_action'), '') ELSE company_action END,
        canonical_status = CASE WHEN p_appointment_patch ? 'canonical_status' THEN nullif(trim(p_appointment_patch->>'canonical_status'), '') ELSE canonical_status END,
        updated_at = now()$replace$
  );

  IF v_updated = v_definition THEN
    RAISE EXCEPTION 'Could not add canonical_status to the Admin CRM appointment update';
  END IF;

  EXECUTE v_updated;
END;
$migration$;

REVOKE ALL ON FUNCTION public.admin_update_lead_crm(uuid, jsonb, jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_lead_crm(uuid, jsonb, jsonb)
  TO authenticated;

COMMENT ON FUNCTION public.admin_update_lead_crm(uuid, jsonb, jsonb)
IS 'Admin-only audited editing of shared lead fields, including atomic overall-status overrides.';

COMMIT;
