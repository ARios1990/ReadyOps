BEGIN;

CREATE OR REPLACE FUNCTION public.update_company_portal_name(
  p_company_id uuid,
  p_access_token uuid,
  p_company_name text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_company_id uuid;
  v_old_name text;
  v_new_name text := btrim(coalesce(p_company_name, ''));
BEGIN
  v_company_id := public.portal_resolve_company_access(
    p_company_id,
    p_access_token
  );

  IF v_new_name = '' THEN
    RAISE EXCEPTION 'Company name cannot be blank';
  END IF;

  IF char_length(v_new_name) > 120 THEN
    RAISE EXCEPTION 'Company name must be 120 characters or fewer';
  END IF;

  SELECT company.name
  INTO v_old_name
  FROM public.roster_companies AS company
  WHERE company.id = v_company_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Company not found';
  END IF;

  IF v_old_name IS DISTINCT FROM v_new_name THEN
    UPDATE public.roster_companies
    SET name = v_new_name
    WHERE id = v_company_id;

    PERFORM public.portal_write_audit(
      v_company_id,
      public.portal_actor_type_for_management(p_access_token),
      auth.uid(),
      public.portal_actor_name_for_management(),
      'company_name_updated',
      'roster_companies',
      v_company_id,
      jsonb_build_object('name', v_old_name),
      jsonb_build_object('name', v_new_name),
      '{}'::jsonb
    );
  END IF;

  RETURN (
    SELECT jsonb_build_object(
      'id', company.id,
      'name', company.name,
      'state', company.state,
      'email', company.email,
      'phone', company.phone,
      'logo_path', company.logo_path
    )
    FROM public.roster_companies AS company
    WHERE company.id = v_company_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.update_company_portal_name(uuid, uuid, text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_company_portal_name(uuid, uuid, text)
  TO anon, authenticated;

COMMENT ON FUNCTION public.update_company_portal_name(uuid, uuid, text)
IS 'Updates a company display name through a valid private management link and records an audit entry.';

COMMIT;
