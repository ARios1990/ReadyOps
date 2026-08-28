-- Imported from the hosted ReadyOp Supabase migration history on 2026-08-28.
-- Schema only: no production table data is included.

drop policy if exists appointment_reservations_team_select on public.appointment_reservations;
create policy appointment_reservations_team_select
on public.appointment_reservations
for select
to authenticated
using (public.user_can_access_company(company_id));
