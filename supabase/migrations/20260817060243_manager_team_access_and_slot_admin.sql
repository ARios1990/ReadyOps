-- Imported from the hosted ReadyOp Supabase migration history on 2026-08-28.
-- Schema only: no production table data is included.

alter table public.profiles
  add column if not exists team_id uuid references public.teams(id) on delete set null;

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check
  check (role = any (array['admin'::text,'agent'::text,'qc'::text,'manager'::text]));

create or replace function public.current_team_id()
returns uuid
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(p.team_id, a.team_id)
  from public.profiles p
  left join public.agents a on a.id = p.agent_id
  where p.id = auth.uid()
  limit 1;
$$;

create or replace function public.get_user_team_id()
returns uuid
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(p.team_id, a.team_id)
  from public.profiles p
  left join public.agents a on a.id = p.agent_id
  where p.id = auth.uid()
  limit 1;
$$;

-- The hosted project already had this helper when the policy below was
-- recorded, but its original definition was missing from migration history.
-- This team/admin version makes a clean replay self-contained. The company
-- management migration on 2026-08-21 replaces it with the expanded version.
create or replace function public.user_can_access_company(company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(public.get_user_role() = 'admin', false)
    or exists (
      select 1 from public.company_teams ct
      where ct.company_id = $1 and ct.team_id = public.get_user_team_id()
    )
    or (
      not exists (select 1 from public.company_teams ct where ct.company_id = $1)
      and exists (
        select 1 from public.roster_companies rc
        where rc.id = $1 and rc.team_id = public.get_user_team_id()
      )
    );
$$;

revoke execute on function public.user_can_access_company(uuid) from public, anon;
grant execute on function public.user_can_access_company(uuid) to authenticated, service_role;

drop policy if exists portal_appointments_team_select on public.portal_appointments;
create policy portal_appointments_team_select
on public.portal_appointments
for select
to authenticated
using (public.user_can_access_company(company_id));

create or replace function public.admin_clear_manual_slot_blocks()
returns integer
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
declare
  v_count integer;
begin
  if not public.portal_is_admin() then
    raise exception 'Admin access required';
  end if;

  delete from public.company_bookings;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

grant execute on function public.admin_clear_manual_slot_blocks() to authenticated;

create or replace function public.get_manager_team_overview(
  p_team_id uuid default null,
  p_start_date date default null,
  p_end_date date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public','pg_temp'
as $$
declare
  v_role text;
  v_team_id uuid;
  v_start date := coalesce(p_start_date, current_date - 14);
  v_end date := coalesce(p_end_date, current_date + 45);
begin
  select p.role, coalesce(p.team_id, a.team_id)
    into v_role, v_team_id
  from public.profiles p
  left join public.agents a on a.id = p.agent_id
  where p.id = auth.uid();

  if v_role is null then
    raise exception 'Authenticated profile required';
  end if;

  if v_role = 'admin' then
    v_team_id := coalesce(p_team_id, v_team_id);
  elsif v_role <> 'manager' then
    raise exception 'Manager or admin access required';
  end if;

  if v_team_id is null then
    raise exception 'A team must be assigned to this manager';
  end if;

  return jsonb_build_object(
    'team', (
      select jsonb_build_object('id',t.id,'name',t.name,'abbreviation',t.abbreviation)
      from public.teams t where t.id = v_team_id
    ),
    'agents', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id',a.id,
          'name',a.name,
          'email',a.email,
          'active',a.active,
          'portal_slug',a.portal_slug,
          'access_token',a.access_token,
          'team_id',a.team_id,
          'total_leads',(select count(*) from public.portal_leads l join public.portal_appointments ap on ap.lead_id=l.id where l.agent_id=a.id and ap.appointment_date between v_start and v_end),
          'qc_pending',(select count(*) from public.portal_leads l join public.portal_appointments ap on ap.lead_id=l.id where l.agent_id=a.id and l.qc_status='pending' and ap.appointment_date between v_start and v_end),
          'approved',(select count(*) from public.portal_leads l join public.portal_appointments ap on ap.lead_id=l.id where l.agent_id=a.id and l.qc_status='approved' and ap.appointment_date between v_start and v_end),
          'denied',(select count(*) from public.portal_leads l join public.portal_appointments ap on ap.lead_id=l.id where l.agent_id=a.id and l.qc_status='denied' and ap.appointment_date between v_start and v_end)
        ) order by a.name
      )
      from public.agents a
      where a.team_id = v_team_id
    ), '[]'::jsonb),
    'companies', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',c.id,
        'name',c.name,
        'state',c.state,
        'public_slug',s.public_slug,
        'account_status',c.account_status
      ) order by c.name)
      from public.roster_companies c
      left join public.company_portal_settings s on s.company_id=c.id
      where exists (
        select 1 from public.company_teams ct
        where ct.company_id=c.id and ct.team_id=v_team_id
      )
      or (
        not exists (select 1 from public.company_teams ct2 where ct2.company_id=c.id)
        and c.team_id=v_team_id
      )
    ), '[]'::jsonb),
    'range', jsonb_build_object('start_date',v_start,'end_date',v_end)
  );
end;
$$;

grant execute on function public.get_manager_team_overview(uuid,date,date) to authenticated;
