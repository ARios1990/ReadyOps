-- F8: the signed-out `anon` role held SELECT/INSERT/UPDATE/DELETE on payroll,
-- invoicing, staff and audit tables. Nothing in the application reads these
-- without a session: every unauthenticated surface goes through a SECURITY
-- DEFINER RPC or a service-role edge function.
--
-- No policy on any of these tables targets `anon` or `public`, so RLS already
-- returns an empty set to a signed-out caller. Removing the grant therefore
-- cannot break a request that works today; it removes the single-mistake risk
-- that a future policy written without an explicit role list (which PostgreSQL
-- defaults to PUBLIC) silently publishes the whole table.

REVOKE ALL ON TABLE
  public.agents,
  public.audit_logs,
  public.company_agent_links,
  public.company_bookings,
  public.company_location_agents,
  public.company_locations,
  public.company_notification_batches,
  public.company_onboarding_invites,
  public.company_package_locations,
  public.company_packages,
  public.company_teams,
  public.invoice_items,
  public.invoice_payments,
  public.invoices,
  public.payroll_entries,
  public.payroll_periods,
  public.profiles,
  public.qc_lead_transcripts,
  public.readymode_integration_settings,
  public.roster_companies,
  public.slot_bookings,
  public.teams,
  public.weekly_ops_rows,
  public.weekly_ops_schedule_config,
  public.weekly_ops_uploads
FROM anon;
