/*
# Restrict team directory visibility

1. Security
   - Drops the permissive `authenticated_select_teams` policy on `public.teams`,
     whose predicate was `true` and therefore exposed every team row to every
     signed-in account (including anonymous sign-ins that carry the
     `authenticated` role).
   - The stricter sibling policy `teams_select_admin_or_own_team`
     (`is_admin() OR id = current_team_id()`) remains and becomes the effective
     control, because permissive policies are OR-ed together and the `true`
     predicate made the stricter one inert.

2. Notes
   1. Admin screens continue to see all teams via `is_admin()`.
   2. Managers and agents continue to see their own team via `current_team_id()`.
*/

DROP POLICY IF EXISTS "authenticated_select_teams" ON public.teams;
