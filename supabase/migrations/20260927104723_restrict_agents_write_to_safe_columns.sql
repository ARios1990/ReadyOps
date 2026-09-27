/*
# Restrict INSERT/UPDATE on public.agents to non-sensitive columns

1. Background
   The table-level INSERT and UPDATE grants on `public.agents` implied every
   column, which made the column-level revokes on the portal token and the pay
   columns ineffective. A signed-in account permitted by row level security
   could therefore set its own portal `access_token` or its own pay rates.

2. Security
   - Revokes table-level INSERT and UPDATE on `public.agents` from `anon` and
     `authenticated`.
   - Grants INSERT and UPDATE back only on the non-sensitive columns
     (`id`, `name`, `team_id`, `email`, `portal_slug`, `active`).
   - Token generation (`regenerate_agent_portal_link`), agent creation
     (`create_agent_admin`) and pay-rate maintenance all run through
     SECURITY DEFINER functions, which are unaffected by these grants.

3. Notes
   1. No data is modified; this migration only changes privileges.
*/

REVOKE INSERT, UPDATE ON public.agents FROM anon, authenticated;

GRANT INSERT (id, name, team_id, email, portal_slug, active)
  ON public.agents TO authenticated;

GRANT UPDATE (name, team_id, email, portal_slug, active)
  ON public.agents TO authenticated;
