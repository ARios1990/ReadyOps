/*
# Restrict SELECT on public.agents to non-sensitive columns

1. Background
   An earlier migration revoked column-level SELECT on the agent portal token
   and the pay-rate columns, but the table-level SELECT grant to
   `authenticated` was still in place. In PostgreSQL a table-level grant
   implies every column, so the column-level revoke had no effect and any
   signed-in account could still read `access_token`, `pay_structure`,
   `weekly_base`, `hourly_rate`, `payroll_lead_rate` and
   `payroll_signed_contract_rate`.

2. Security
   - Revokes table-level SELECT on `public.agents` from `anon` and
     `authenticated`.
   - Grants SELECT only on the columns the application actually reads from the
     browser: `id`, `name`, `team_id`, `email`, `portal_slug`, `active`.
   - Also revokes UPDATE and INSERT on the token and pay columns, so a
     signed-in account cannot mint itself a portal token or change pay rates
     through the Data API. Administrators continue to manage these values
     through the existing SECURITY DEFINER functions.
   - Token and pay values continue to reach the admin and manager screens
     through `public.readyops_agent_privileged_fields()`, which checks the
     caller's role before returning anything.

3. Notes
   1. No data is modified; this migration only changes privileges.
   2. Row level security on `public.agents` is unchanged.
*/

REVOKE SELECT ON public.agents FROM anon, authenticated;

GRANT SELECT (id, name, team_id, email, portal_slug, active)
  ON public.agents TO authenticated;

REVOKE UPDATE (access_token, pay_structure, weekly_base, hourly_rate,
               payroll_lead_rate, payroll_signed_contract_rate)
  ON public.agents FROM anon, authenticated;

REVOKE INSERT (access_token, pay_structure, weekly_base, hourly_rate,
               payroll_lead_rate, payroll_signed_contract_rate)
  ON public.agents FROM anon, authenticated;
