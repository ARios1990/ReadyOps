-- Keep the privileged multi-table move implementation out of the exposed
-- public API schema. The public RPC remains SECURITY INVOKER and repeats the
-- owner check before dispatching to the private implementation.

ALTER FUNCTION public.qc_move_lead(uuid, uuid, uuid, date, text, text)
  SET SCHEMA private;

ALTER FUNCTION private.qc_move_lead(uuid, uuid, uuid, date, text, text)
  RENAME TO owner_qc_move_lead_impl;

REVOKE ALL ON FUNCTION private.owner_qc_move_lead_impl(uuid, uuid, uuid, date, text, text)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION private.owner_qc_move_lead_impl(uuid, uuid, uuid, date, text, text)
  TO authenticated;

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
SECURITY INVOKER
SET search_path = ''
AS $function$
BEGIN
  IF NOT private.readyops_is_owner_admin() THEN
    RAISE EXCEPTION 'Owner account access is required to move or reschedule a lead';
  END IF;

  RETURN private.owner_qc_move_lead_impl(
    p_lead_id,
    p_company_id,
    p_location_id,
    p_date,
    p_start_time,
    p_reason
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.qc_move_lead(uuid, uuid, uuid, date, text, text)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.qc_move_lead(uuid, uuid, uuid, date, text, text)
  TO authenticated;

COMMENT ON FUNCTION private.owner_qc_move_lead_impl(uuid, uuid, uuid, date, text, text)
IS 'Private privileged implementation for owner-only QC lead transfers and reschedules.';

COMMENT ON FUNCTION public.qc_move_lead(uuid, uuid, uuid, date, text, text)
IS 'Owner-account-only SECURITY INVOKER wrapper for audited QC transfers and reschedules.';
