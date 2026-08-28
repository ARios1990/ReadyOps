-- Imported from the hosted ReadyOp Supabase migration history on 2026-08-28.
-- Schema only: no production table data is included.

grant execute on function public.get_company_management_portal(uuid,uuid,date,date) to anon, authenticated, service_role;
grant execute on function public.get_representative_portal(uuid,date,date) to anon, authenticated, service_role;
