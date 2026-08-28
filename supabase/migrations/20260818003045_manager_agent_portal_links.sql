-- Imported from the hosted ReadyOp Supabase migration history on 2026-08-28.
-- Schema only: no production table data is included.

BEGIN;

CREATE OR REPLACE FUNCTION public.regenerate_agent_portal_link(p_agent_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_role text;
  v_manager_team_id uuid;
  v_agent public.agents%ROWTYPE;
  v_slug text;
  v_token uuid;
BEGIN
  SELECT p.role, coalesce(p.team_id, linked_agent.team_id)
    INTO v_role, v_manager_team_id
  FROM public.profiles p
  LEFT JOIN public.agents linked_agent ON linked_agent.id = p.agent_id
  WHERE p.id = auth.uid();

  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Authenticated profile required';
  END IF;

  IF v_role NOT IN ('admin', 'manager') THEN
    RAISE EXCEPTION 'Admin or manager access required';
  END IF;

  SELECT *
    INTO v_agent
  FROM public.agents
  WHERE id = p_agent_id
  FOR UPDATE;

  IF v_agent.id IS NULL THEN
    RAISE EXCEPTION 'Agent not found';
  END IF;

  IF v_role = 'manager' THEN
    IF v_manager_team_id IS NULL THEN
      RAISE EXCEPTION 'A team must be assigned to this manager';
    END IF;
    IF v_agent.team_id IS DISTINCT FROM v_manager_team_id THEN
      RAISE EXCEPTION 'Managers can only generate links for agents on their own team';
    END IF;
  END IF;

  v_slug := nullif(trim(v_agent.portal_slug), '');
  IF v_slug IS NULL THEN
    v_slug := trim(both '-' from regexp_replace(lower(v_agent.name), '[^a-z0-9]+', '-', 'g'))
      || '-' || left(v_agent.id::text, 8);
  END IF;

  v_token := gen_random_uuid();

  UPDATE public.agents
  SET portal_slug = v_slug,
      access_token = v_token
  WHERE id = v_agent.id;

  RETURN jsonb_build_object(
    'agent_id', v_agent.id,
    'agent_name', v_agent.name,
    'portal_slug', v_slug,
    'access_token', v_token,
    'path', '/agent/' || v_slug || '/' || v_token::text
  );
END;
$$;

REVOKE ALL ON FUNCTION public.regenerate_agent_portal_link(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.regenerate_agent_portal_link(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.regenerate_agent_portal_link(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.regenerate_agent_portal_link(uuid)
IS 'Creates or rotates an agent private lead-portal link. Admins may manage any agent; managers are restricted to agents on their own assigned team.';

COMMIT;
