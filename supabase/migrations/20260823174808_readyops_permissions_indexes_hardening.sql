-- ReadyOps production hardening.
-- This migration is intentionally additive except for redundant RLS policies
-- and anonymous execution on authenticated-only helpers. Public token-based
-- portal, booking, onboarding, agent, manager, and representative RPCs are
-- deliberately unchanged.

-- Pin function resolution to trusted schemas.
alter function public.portal_calculate_qualification(jsonb,jsonb) set search_path = public, pg_temp;
alter function public.portal_default_form_schema_legacy() set search_path = public, pg_temp;
alter function public.portal_default_qualification_rules() set search_path = public, pg_temp;
alter function public.portal_evaluate_qualification(jsonb,jsonb) set search_path = public, pg_temp;
alter function public.portal_haversine_meters(double precision,double precision,double precision,double precision) set search_path = public, pg_temp;
alter function public.portal_next_lead_code() set search_path = public, pg_temp;
alter function public.portal_set_updated_at() set search_path = public, pg_temp;
alter function public.portal_slugify(text) set search_path = public, pg_temp;
alter function public.set_updated_at() set search_path = public, pg_temp;

-- These functions depend on an authenticated ReadyOps profile or admin role.
-- Remove the default PUBLIC grant, then explicitly retain staff and service access.
revoke execute on function public.create_readyops_invoice(uuid,date,date,text,numeric,numeric,numeric,date) from public, anon;
revoke execute on function public.generate_readyops_payroll_week(date) from public, anon;
revoke execute on function public.current_agent_id() from public, anon;
revoke execute on function public.current_profile_role() from public, anon;
revoke execute on function public.get_user_agent_id() from public, anon;
revoke execute on function public.get_user_role() from public, anon;
revoke execute on function public.is_admin() from public, anon;
revoke execute on function public.portal_is_admin() from public, anon;
revoke execute on function public.portal_is_qc_or_admin() from public, anon;
revoke execute on function public.user_can_access_company(uuid) from public, anon;
revoke execute on function public.portal_actor_name_for_management() from public, anon;

grant execute on function public.create_readyops_invoice(uuid,date,date,text,numeric,numeric,numeric,date) to authenticated, service_role;
grant execute on function public.generate_readyops_payroll_week(date) to authenticated, service_role;
grant execute on function public.current_agent_id() to authenticated, service_role;
grant execute on function public.current_profile_role() to authenticated, service_role;
grant execute on function public.get_user_agent_id() to authenticated, service_role;
grant execute on function public.get_user_role() to authenticated, service_role;
grant execute on function public.is_admin() to authenticated, service_role;
grant execute on function public.portal_is_admin() to authenticated, service_role;
grant execute on function public.portal_is_qc_or_admin() to authenticated, service_role;
grant execute on function public.user_can_access_company(uuid) to authenticated, service_role;
grant execute on function public.portal_actor_name_for_management() to authenticated, service_role;

-- Remove superseded duplicate admin policies. The *_admin_all policies remain.
drop policy if exists admin_delete_agents on public.agents;
drop policy if exists admin_insert_agents on public.agents;
drop policy if exists admin_update_agents on public.agents;
drop policy if exists delete_company_locations on public.company_locations;
drop policy if exists insert_company_locations on public.company_locations;
drop policy if exists update_company_locations on public.company_locations;
drop policy if exists delete_company_teams on public.company_teams;
drop policy if exists insert_company_teams on public.company_teams;
drop policy if exists update_company_teams on public.company_teams;
drop policy if exists admin_delete_profiles on public.profiles;

-- The former broad profile SELECT policy made the self/admin policy redundant.
drop policy if exists authenticated_select_profiles on public.profiles;

-- Cache auth.uid() once per statement in the remaining policies.
drop policy if exists audit_logs_authenticated_insert on public.audit_logs;
create policy audit_logs_authenticated_insert on public.audit_logs
  for insert to authenticated
  with check (actor_user_id is null or actor_user_id = (select auth.uid()) or is_admin());

drop policy if exists profiles_select_self_or_admin on public.profiles;
create policy profiles_select_self_or_admin on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or is_admin());

drop policy if exists users_insert_own_profile on public.profiles;
create policy users_insert_own_profile on public.profiles
  for insert to authenticated
  with check ((select auth.uid()) = id);

drop policy if exists users_update_own_profile on public.profiles;
create policy users_update_own_profile on public.profiles
  for update to authenticated
  using ((select auth.uid()) = id or get_user_role() = 'admin')
  with check ((select auth.uid()) = id or get_user_role() = 'admin');

-- Foreign-key indexes improve deletes, joins, and the live operational views.
create index if not exists idx_agent_aliases_agent_id on public.agent_aliases(agent_id);
create index if not exists idx_agents_team_id on public.agents(team_id);
create index if not exists idx_appointment_checkins_representative_id on public.appointment_checkins(representative_id);
create index if not exists idx_reschedule_history_new_company on public.appointment_reschedule_history(new_company_id);
create index if not exists idx_reschedule_history_new_location on public.appointment_reschedule_history(new_location_id);
create index if not exists idx_reschedule_history_old_company on public.appointment_reschedule_history(old_company_id);
create index if not exists idx_reschedule_history_old_location on public.appointment_reschedule_history(old_location_id);
create index if not exists idx_reservations_converted_appointment on public.appointment_reservations(converted_appointment_id);
create index if not exists idx_reservations_location_id on public.appointment_reservations(location_id);
create index if not exists idx_reservations_previous_location on public.appointment_reservations(previous_location_id);
create index if not exists idx_audit_logs_actor_user_id on public.audit_logs(actor_user_id);
create index if not exists idx_company_agent_links_agent_id on public.company_agent_links(agent_id);
create index if not exists idx_company_bookings_booked_by on public.company_bookings(booked_by);
create index if not exists idx_notification_batches_created_by on public.company_notification_batches(created_by);
create index if not exists idx_onboarding_invites_company_id on public.company_onboarding_invites(company_id);
create index if not exists idx_onboarding_invites_created_by on public.company_onboarding_invites(created_by);
create index if not exists idx_company_packages_created_by on public.company_packages(created_by);
create index if not exists idx_company_representatives_location on public.company_representatives(location_id);
create index if not exists idx_schedule_exceptions_location on public.company_schedule_exceptions(location_id);
create index if not exists idx_schedule_rules_location on public.company_schedule_rules(location_id);
create index if not exists idx_external_form_events_appointment on public.external_form_events(appointment_id);
create index if not exists idx_external_form_events_lead on public.external_form_events(lead_id);
create index if not exists idx_invoice_payments_created_by on public.invoice_payments(created_by);
create index if not exists idx_invoices_created_by on public.invoices(created_by);
create index if not exists idx_payroll_entries_team_id on public.payroll_entries(team_id);
create index if not exists idx_payroll_periods_approved_by on public.payroll_periods(approved_by);
create index if not exists idx_payroll_periods_created_by on public.payroll_periods(created_by);
create index if not exists idx_portal_appointments_location_id on public.portal_appointments(location_id);
create index if not exists idx_portal_leads_agent_profile_id on public.portal_leads(agent_profile_id);
create index if not exists idx_portal_leads_location_id on public.portal_leads(location_id);
create index if not exists idx_portal_leads_original_company on public.portal_leads(original_company_id);
create index if not exists idx_portal_leads_qc_reviewed_by on public.portal_leads(qc_reviewed_by);
create index if not exists idx_profiles_agent_id on public.profiles(agent_id);
create index if not exists idx_profiles_team_id on public.profiles(team_id);
create index if not exists idx_qc_transcripts_updated_by on public.qc_lead_transcripts(updated_by);
create index if not exists idx_qc_cycles_appointment_id on public.qc_review_cycles(appointment_id);
create index if not exists idx_qc_cycles_correction_assignee on public.qc_review_cycles(correction_assignee_id);
create index if not exists idx_qc_cycles_location_id on public.qc_review_cycles(location_id);
create index if not exists idx_qc_cycles_reviewer_id on public.qc_review_cycles(reviewer_id);
