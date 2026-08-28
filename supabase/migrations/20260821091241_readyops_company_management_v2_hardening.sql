-- Imported from the hosted ReadyOp Supabase migration history on 2026-08-28.
-- Schema only: no production table data is included.

-- Harden Company Management v2 policies and cover all new foreign keys.

create or replace function public.get_user_role()
returns text
language sql
stable
security definer
set search_path=public
as $$ select role from public.profiles where id=auth.uid() $$;

revoke all on function public.readyops_sync_canonical_status() from public,anon,authenticated;
revoke all on function public.readyops_audit_canonical_status() from public,anon,authenticated;
revoke all on function public.readyops_company_management_role(uuid) from public,anon;
grant execute on function public.readyops_company_management_role(uuid) to authenticated;

create index if not exists appointment_reschedule_history_appointment_idx on public.appointment_reschedule_history(appointment_id);
create index if not exists appointment_reschedule_history_lead_idx on public.appointment_reschedule_history(lead_id);
create index if not exists appointment_reschedule_history_changed_by_idx on public.appointment_reschedule_history(changed_by) where changed_by is not null;
create index if not exists company_user_access_created_by_idx on public.company_user_access(created_by) where created_by is not null;
create index if not exists lead_sync_conflicts_company_idx on public.lead_sync_conflicts(company_id);
create index if not exists lead_sync_conflicts_existing_lead_idx on public.lead_sync_conflicts(existing_lead_id) where existing_lead_id is not null;
create index if not exists lead_sync_connections_created_by_idx on public.lead_sync_connections(created_by) where created_by is not null;
create index if not exists lead_sync_runs_connection_idx on public.lead_sync_runs(connection_id) where connection_id is not null;
create index if not exists lead_sync_runs_started_by_idx on public.lead_sync_runs(started_by) where started_by is not null;
create index if not exists portal_appointments_canonical_updated_by_idx on public.portal_appointments(canonical_status_updated_by) where canonical_status_updated_by is not null;

drop policy if exists company_user_access_admin_all on public.company_user_access;
drop policy if exists company_user_access_self_select on public.company_user_access;
drop policy if exists company_user_access_select on public.company_user_access;
create policy company_user_access_select on public.company_user_access for select to authenticated
  using (coalesce(((select auth.jwt())->>'is_anonymous')::boolean,false)=false and (public.portal_is_admin() or user_id=(select auth.uid())));
drop policy if exists company_user_access_admin_insert on public.company_user_access;
create policy company_user_access_admin_insert on public.company_user_access for insert to authenticated
  with check (coalesce(((select auth.jwt())->>'is_anonymous')::boolean,false)=false and public.portal_is_admin());
drop policy if exists company_user_access_admin_update on public.company_user_access;
create policy company_user_access_admin_update on public.company_user_access for update to authenticated
  using (coalesce(((select auth.jwt())->>'is_anonymous')::boolean,false)=false and public.portal_is_admin())
  with check (coalesce(((select auth.jwt())->>'is_anonymous')::boolean,false)=false and public.portal_is_admin());
drop policy if exists company_user_access_admin_delete on public.company_user_access;
create policy company_user_access_admin_delete on public.company_user_access for delete to authenticated
  using (coalesce(((select auth.jwt())->>'is_anonymous')::boolean,false)=false and public.portal_is_admin());

drop policy if exists company_packages_admin_all on public.company_packages;
drop policy if exists company_packages_admin_qc_select on public.company_packages;
drop policy if exists company_packages_company_select on public.company_packages;
drop policy if exists company_packages_authorized_select on public.company_packages;
create policy company_packages_authorized_select on public.company_packages for select to authenticated
  using (coalesce(((select auth.jwt())->>'is_anonymous')::boolean,false)=false and (public.portal_is_qc_or_admin() or public.user_can_access_company(company_id)));
drop policy if exists company_packages_admin_insert on public.company_packages;
create policy company_packages_admin_insert on public.company_packages for insert to authenticated
  with check (coalesce(((select auth.jwt())->>'is_anonymous')::boolean,false)=false and public.portal_is_admin());
drop policy if exists company_packages_admin_update on public.company_packages;
create policy company_packages_admin_update on public.company_packages for update to authenticated
  using (coalesce(((select auth.jwt())->>'is_anonymous')::boolean,false)=false and public.portal_is_admin())
  with check (coalesce(((select auth.jwt())->>'is_anonymous')::boolean,false)=false and public.portal_is_admin());
drop policy if exists company_packages_admin_delete on public.company_packages;
create policy company_packages_admin_delete on public.company_packages for delete to authenticated
  using (coalesce(((select auth.jwt())->>'is_anonymous')::boolean,false)=false and public.portal_is_admin());

drop policy if exists portal_audit_logs_admin_select on public.portal_audit_logs;
drop policy if exists portal_audit_logs_company_select on public.portal_audit_logs;
drop policy if exists portal_audit_logs_authorized_select on public.portal_audit_logs;
create policy portal_audit_logs_authorized_select on public.portal_audit_logs for select to authenticated
  using (coalesce(((select auth.jwt())->>'is_anonymous')::boolean,false)=false and company_id is not null and (public.portal_is_admin() or public.user_can_access_company(company_id)));

drop policy if exists appointment_reschedule_history_select on public.appointment_reschedule_history;
create policy appointment_reschedule_history_select on public.appointment_reschedule_history for select to authenticated
  using (coalesce(((select auth.jwt())->>'is_anonymous')::boolean,false)=false and public.user_can_access_company(company_id));
drop policy if exists lead_sync_connections_company_access on public.lead_sync_connections;
create policy lead_sync_connections_company_access on public.lead_sync_connections for select to authenticated
  using (coalesce(((select auth.jwt())->>'is_anonymous')::boolean,false)=false and public.user_can_access_company(company_id));
drop policy if exists lead_sync_runs_company_access on public.lead_sync_runs;
create policy lead_sync_runs_company_access on public.lead_sync_runs for select to authenticated
  using (coalesce(((select auth.jwt())->>'is_anonymous')::boolean,false)=false and public.user_can_access_company(company_id));
drop policy if exists lead_sync_conflicts_company_access on public.lead_sync_conflicts;
create policy lead_sync_conflicts_company_access on public.lead_sync_conflicts for select to authenticated
  using (coalesce(((select auth.jwt())->>'is_anonymous')::boolean,false)=false and public.user_can_access_company(company_id));

drop policy if exists company_logos_insert on storage.objects;
create policy company_logos_insert on storage.objects for insert to authenticated
with check (coalesce(((select auth.jwt())->>'is_anonymous')::boolean,false)=false and bucket_id='company-logos' and (storage.foldername(name))[1] is not null and public.user_can_access_company(((storage.foldername(name))[1])::uuid));
drop policy if exists company_logos_update on storage.objects;
create policy company_logos_update on storage.objects for update to authenticated
using (coalesce(((select auth.jwt())->>'is_anonymous')::boolean,false)=false and bucket_id='company-logos' and public.user_can_access_company(((storage.foldername(name))[1])::uuid))
with check (coalesce(((select auth.jwt())->>'is_anonymous')::boolean,false)=false and bucket_id='company-logos' and public.user_can_access_company(((storage.foldername(name))[1])::uuid));
drop policy if exists company_logos_delete on storage.objects;
create policy company_logos_delete on storage.objects for delete to authenticated
using (coalesce(((select auth.jwt())->>'is_anonymous')::boolean,false)=false and bucket_id='company-logos' and public.user_can_access_company(((storage.foldername(name))[1])::uuid));



