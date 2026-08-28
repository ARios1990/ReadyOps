-- Keep the security-definer helper on a fixed, trusted schema path.
alter function public.get_user_agent_id()
  set search_path = public, pg_temp;
