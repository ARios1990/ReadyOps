-- F2: users_update_own_profile lets a user update every column of their own
-- profile row. The escalation trigger covered id/email/role/agent_id but not
-- team_id, so any signed-in user could join an arbitrary team and inherit that
-- team's visibility through current_team_id() / get_user_team_id().

CREATE OR REPLACE FUNCTION public.prevent_profile_privilege_escalation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NOT NULL
     AND NOT public.is_admin()
     AND (
       NEW.id IS DISTINCT FROM OLD.id
       OR NEW.email IS DISTINCT FROM OLD.email
       OR NEW.role IS DISTINCT FROM OLD.role
       OR NEW.agent_id IS DISTINCT FROM OLD.agent_id
       OR NEW.team_id IS DISTINCT FROM OLD.team_id
     )
  THEN
    RAISE EXCEPTION 'Only an administrator can change profile access fields';
  END IF;

  RETURN NEW;
END;
$function$;

-- Defence in depth: the browser never needs to write these columns directly.
-- Admin changes go through create_user / create_agent_admin, which run with
-- elevated rights and are unaffected by client grants.
REVOKE UPDATE (id, email, role, agent_id, team_id) ON public.profiles FROM anon, authenticated;
