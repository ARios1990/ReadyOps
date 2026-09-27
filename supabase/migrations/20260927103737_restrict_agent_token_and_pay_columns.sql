-- F1 + F3: agents.access_token is a bearer credential for the agent lead portal,
-- and the payroll columns are compensation data. Both were readable by every
-- signed-in teammate because the RLS predicate on public.agents is row-level
-- (team_id = current_team_id()) while the grants were column-wide.
--
-- Column SELECT is revoked from anon/authenticated and the privileged fields are
-- served instead through an admin/manager scoped SECURITY DEFINER function.

CREATE OR REPLACE FUNCTION public.readyops_agent_privileged_fields()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role text;
  v_team_id uuid;
  v_is_anonymous boolean := coalesce(((SELECT auth.jwt()) ->> 'is_anonymous')::boolean, false);
BEGIN
  IF auth.uid() IS NULL OR v_is_anonymous THEN
    RETURN '[]'::jsonb;
  END IF;

  SELECT p.role, coalesce(p.team_id, a.team_id)
    INTO v_role, v_team_id
  FROM public.profiles p
  LEFT JOIN public.agents a ON a.id = p.agent_id
  WHERE p.id = auth.uid();

  IF v_role NOT IN ('admin', 'manager') THEN
    RETURN '[]'::jsonb;
  END IF;

  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'id', ag.id,
      'access_token', ag.access_token,
      'pay_structure', CASE WHEN v_role = 'admin' THEN ag.pay_structure END,
      'weekly_base', CASE WHEN v_role = 'admin' THEN ag.weekly_base END,
      'hourly_rate', CASE WHEN v_role = 'admin' THEN ag.hourly_rate END,
      'payroll_lead_rate', CASE WHEN v_role = 'admin' THEN ag.payroll_lead_rate END,
      'payroll_signed_contract_rate', CASE WHEN v_role = 'admin' THEN ag.payroll_signed_contract_rate END
    ))
    FROM public.agents ag
    WHERE v_role = 'admin'
       OR (v_team_id IS NOT NULL AND ag.team_id = v_team_id)
  ), '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.readyops_agent_privileged_fields() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.readyops_agent_privileged_fields() TO authenticated;

REVOKE SELECT (
  access_token,
  pay_structure,
  weekly_base,
  hourly_rate,
  payroll_lead_rate,
  payroll_signed_contract_rate
) ON public.agents FROM anon, authenticated;
