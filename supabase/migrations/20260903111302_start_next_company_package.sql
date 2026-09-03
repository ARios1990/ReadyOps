BEGIN;

CREATE OR REPLACE FUNCTION public.start_next_company_package_admin(
  p_company_id uuid,
  p_current_package_id uuid,
  p_lead_target integer,
  p_amount_per_lead numeric,
  p_start_date date,
  p_location_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_current public.company_packages%ROWTYPE;
  v_completed jsonb;
  v_active jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT private.readyops_is_owner_admin() THEN
    RAISE EXCEPTION 'Owner account access required';
  END IF;

  SELECT *
  INTO v_current
  FROM public.company_packages
  WHERE id = p_current_package_id
    AND company_id = p_company_id
    AND status = 'active'
    AND archived_at IS NULL
  FOR UPDATE;

  IF v_current.id IS NULL THEN
    RAISE EXCEPTION 'Active package not found';
  END IF;

  v_completed := public.complete_company_package_admin(p_current_package_id);
  v_active := public.save_company_package_admin(
    p_company_id,
    NULL,
    p_lead_target,
    p_amount_per_lead,
    p_start_date,
    coalesce(p_location_ids, '{}'::uuid[]),
    true
  );

  RETURN jsonb_build_object(
    'completed_package', v_completed,
    'active_package', v_active
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.start_next_company_package_admin(
  uuid, uuid, integer, numeric, date, uuid[]
) FROM PUBLIC, anon, service_role;

GRANT EXECUTE ON FUNCTION public.start_next_company_package_admin(
  uuid, uuid, integer, numeric, date, uuid[]
) TO authenticated;

COMMENT ON FUNCTION public.start_next_company_package_admin(
  uuid, uuid, integer, numeric, date, uuid[]
) IS 'Owner-only atomic rollover: completes the active company package and creates the next package while preserving history.';

COMMIT;
