-- Imported from the hosted ReadyOp Supabase migration history on 2026-08-28.
-- Schema only: no production table data is included.

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='company_bookings') then
    alter publication supabase_realtime add table public.company_bookings;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='portal_appointments') then
    alter publication supabase_realtime add table public.portal_appointments;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='appointment_reservations') then
    alter publication supabase_realtime add table public.appointment_reservations;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='company_locations') then
    alter publication supabase_realtime add table public.company_locations;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='roster_companies') then
    alter publication supabase_realtime add table public.roster_companies;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='company_teams') then
    alter publication supabase_realtime add table public.company_teams;
  end if;
end $$;
