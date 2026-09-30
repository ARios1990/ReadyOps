-- Additive staff settings and team-scoped payroll. All authority comes from
-- database profiles, never a browser-provided team, role or JWT user_metadata.
alter table public.profiles add column if not exists active boolean not null default true;

create table public.management_audit_events(
 id uuid primary key default gen_random_uuid(),actor_id uuid references public.profiles(id),
 team_id uuid references public.teams(id),target_id uuid,event_type text not null,
 metadata jsonb not null default '{}'::jsonb,created_at timestamptz not null default now()
);
create index management_audit_actor_idx on public.management_audit_events(actor_id);
create index management_audit_team_idx on public.management_audit_events(team_id);
alter table public.management_audit_events enable row level security;
revoke all on public.management_audit_events from anon,authenticated;
grant select on public.management_audit_events to authenticated;
create policy scoped_management_audit on public.management_audit_events for select to authenticated
 using(public.is_admin() or (public.get_user_role()='manager' and team_id=public.get_user_team_id()));
create or replace function private.immutable_management_audit() returns trigger language plpgsql set search_path = '' as $$
begin raise exception 'Management audit history is immutable';end $$;
create trigger protect_management_audit before update or delete on public.management_audit_events for each row execute function private.immutable_management_audit();

create or replace function public.current_profile_role() returns text
language sql stable security definer set search_path = '' as $$
  select coalesce((select p.role from public.profiles p where p.id = (select auth.uid()) and p.active),'inactive')
$$;
create or replace function public.get_user_role() returns text
language sql stable security definer set search_path = '' as $$ select public.current_profile_role() $$;
create or replace function private.readyops_profile_role() returns text
language sql stable security definer set search_path = '' as $$ select public.current_profile_role() $$;
create or replace function public.current_team_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select case when p.role = 'manager' then p.team_id else coalesce(p.team_id,a.team_id) end
  from public.profiles p left join public.agents a on a.id=p.agent_id
  where p.id=(select auth.uid()) and p.active
$$;
create or replace function public.get_user_team_id() returns uuid
language sql stable security definer set search_path = '' as $$ select public.current_team_id() $$;
create or replace function public.current_agent_id() returns uuid
language sql stable security definer set search_path = '' as $$ select p.agent_id from public.profiles p where p.id=(select auth.uid()) and p.active $$;
create or replace function public.portal_is_admin() returns boolean
language sql stable security definer set search_path = '' as $$ select coalesce(public.current_profile_role()='admin',false) $$;
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$ select coalesce(public.current_profile_role()='admin',false) $$;

create or replace function public.prevent_profile_privilege_escalation() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and not coalesce(public.is_admin(),false) and
    (new.id is distinct from old.id or new.email is distinct from old.email
    or new.role is distinct from old.role or new.agent_id is distinct from old.agent_id
    or new.team_id is distinct from old.team_id or new.active is distinct from old.active) then
    raise exception 'Only an administrator can change profile access fields';
  end if;
  return new;
end $$;
-- Profiles are provisioned by Auth/server functions, not self-selected roles.
drop policy if exists users_insert_own_profile on public.profiles;

create or replace function private.readyops_can_review_lead(p_lead_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.profiles p join public.portal_leads l on l.id=p_lead_id
 left join public.agents a on a.id=l.agent_id where p.id=(select auth.uid()) and p.active
 and (p.role in ('admin','qc') or (p.role='manager' and p.team_id is not null and a.team_id=p.team_id)))
$$;
create or replace function private.readyops_can_view_lead(p_lead_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.profiles p join public.portal_leads l on l.id=p_lead_id
 left join public.agents a on a.id=l.agent_id where p.id=(select auth.uid()) and p.active
 and (p.role in ('admin','qc') or (p.role='manager' and p.team_id is not null and a.team_id=p.team_id)
 or (p.role='agent' and (l.agent_profile_id=p.id or l.agent_id=p.agent_id))
 or (p.role='company' and exists(select 1 from public.company_user_access cua
 where cua.user_id=p.id and cua.company_id=l.company_id))))
$$;

-- Service-only staff RPC used by update-staff after it verifies the caller.
-- A two-phase validate/apply supports Auth email changes without orphaning data.
create or replace function public.save_readyops_staff_account(
 p_actor_id uuid,p_profile_id uuid,p_agent_id uuid,p_display_name text,p_email text,
 p_role text,p_team_id uuid,p_active boolean,p_apply boolean default false,
 p_expected_updated_at timestamptz default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_profile public.profiles; v_agent public.agents; v_email text:=lower(trim(coalesce(p_email,'')));
begin
 if not exists(select 1 from public.profiles where id=p_actor_id and role='admin' and active) then
   raise exception 'Active admin access required'; end if;
 if nullif(trim(p_display_name),'') is null or length(p_display_name)>150 then raise exception 'Name is required (maximum 150 characters)'; end if;
 if p_profile_id is null and p_agent_id is null then raise exception 'An account or agent is required'; end if;
 if p_profile_id is null then
   select * into v_profile from public.profiles where agent_id=p_agent_id order by created_at limit 1;
 else select * into v_profile from public.profiles where id=p_profile_id for update;
   if v_profile.id is null then raise exception 'Account not found'; end if;
 end if;
 if v_profile.id is not null then
   if p_agent_id is not null and v_profile.agent_id is distinct from p_agent_id then raise exception 'Agent does not match account'; end if;
   if p_role not in ('agent','manager','admin','qc','company') or p_role is null then raise exception 'Invalid role'; end if;
   if p_role in ('qc','company') and p_role<>v_profile.role then raise exception 'Choose Agent, Manager or Admin'; end if;
   if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then raise exception 'A valid email is required'; end if;
   if v_profile.id=p_actor_id and (p_role<>'admin' or not p_active) then raise exception 'You cannot disable or demote your own admin account'; end if;
   if exists(select 1 from public.profiles where id<>v_profile.id and lower(email)=v_email) then raise exception 'Email is already in use'; end if;
   if p_apply and p_expected_updated_at is distinct from v_profile.updated_at then raise exception 'Account changed; refresh and try again'; end if;
 elsif p_role is distinct from 'agent' then raise exception 'Create a login before changing this agent role';
 end if;
 if coalesce(p_role,'agent') in ('agent','manager') and p_team_id is null then raise exception 'Assign a team'; end if;
 if p_team_id is not null and not exists(select 1 from public.teams where id=p_team_id) then raise exception 'Team not found'; end if;
 select * into v_agent from public.agents where id=coalesce(v_profile.agent_id,p_agent_id) for update;
 if p_agent_id is not null and v_agent.id is null then raise exception 'Agent not found'; end if;
 if v_agent.id is not null and (select count(*) from public.profiles where agent_id=v_agent.id)>1 then
   raise exception 'This agent has multiple linked accounts; resolve the links before editing'; end if;
 if p_apply then
   if v_agent.id is null and p_role='agent' then
     insert into public.agents(name,email,team_id,active) values(trim(p_display_name),v_email,p_team_id,p_active) returning * into v_agent;
   elsif v_agent.id is not null then
     update public.agents set name=trim(p_display_name),email=nullif(v_email,''),team_id=p_team_id,active=p_active,
       access_token=case when team_id is distinct from p_team_id or active is distinct from p_active or (v_profile.id is not null and v_profile.role is distinct from p_role)
         then gen_random_uuid() else access_token end where id=v_agent.id;
   end if;
   if v_profile.id is not null then
     update public.profiles set display_name=trim(p_display_name),email=v_email,role=p_role,team_id=p_team_id,
       active=p_active,agent_id=v_agent.id,updated_at=now() where id=v_profile.id;
   end if;
   insert into public.management_audit_events(actor_id,team_id,target_id,event_type,metadata)
   values(p_actor_id,p_team_id,coalesce(v_profile.id,v_agent.id),'staff_account_updated',jsonb_build_object(
     'previous_role',v_profile.role,'role',p_role,'previous_team',coalesce(v_profile.team_id,v_agent.team_id),
     'team',p_team_id,'previous_active',coalesce(v_profile.active,v_agent.active),'active',p_active,
     'email_changed',v_profile.email is distinct from v_email));
 end if;
 return jsonb_build_object('profile_id',v_profile.id,'agent_id',v_agent.id,'email',v_profile.email,
   'active',v_profile.active,'updated_at',v_profile.updated_at);
end $$;
revoke all on function public.save_readyops_staff_account(uuid,uuid,uuid,text,text,text,uuid,boolean,boolean,timestamptz) from public,anon,authenticated;
grant execute on function public.save_readyops_staff_account(uuid,uuid,uuid,text,text,text,uuid,boolean,boolean,timestamptz) to service_role;

alter table public.payroll_entries add column if not exists status text not null default 'pending' check(status in ('pending','approved','paid'));
alter table public.payroll_entries add column if not exists payment_date date;
update public.payroll_entries pe set status=case when pp.status in ('paid','locked') and pp.paid_at is not null then 'paid'
 when pp.status='approved' then 'approved' else 'pending' end,payment_date=pp.paid_at::date
 from public.payroll_periods pp where pp.id=pe.payroll_period_id;
create or replace function private.sync_payroll_period_status() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
 if new.status is distinct from old.status then
   if new.status='approved' then update public.payroll_entries set status='approved',updated_at=now() where payroll_period_id=new.id and status='pending';
   elsif new.status='paid' then update public.payroll_entries set status='paid',payment_date=coalesce(payment_date,new.paid_at::date,current_date),updated_at=now() where payroll_period_id=new.id;
   end if;
 end if;return new;
end $$;
create trigger sync_payroll_period_status after update of status on public.payroll_periods for each row execute function private.sync_payroll_period_status();

create or replace function private.readyops_can_manage_payroll(p_team_id uuid,p_agent_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.active
 and (p.role='admin' or (p.role='manager' and p.team_id is not null and p.team_id=p_team_id
 and exists(select 1 from public.agents a where a.id=p_agent_id and a.team_id=p.team_id))))
$$;
revoke all on function private.readyops_can_manage_payroll(uuid,uuid) from public,anon;
grant execute on function private.readyops_can_manage_payroll(uuid,uuid) to authenticated;
create policy managers_select_team_payroll on public.payroll_entries for select to authenticated
 using(private.readyops_can_manage_payroll(team_id,agent_id));
create policy managers_select_team_payroll_periods on public.payroll_periods for select to authenticated
 using(exists(select 1 from public.payroll_entries pe where pe.payroll_period_id=id and private.readyops_can_manage_payroll(pe.team_id,pe.agent_id)));
-- No direct manager write policies: mutations must pass the locked RPC below.
create or replace function public.save_readyops_team_payroll_entry(p_entry_id uuid,p_patch jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare v_entry public.payroll_entries; v_period public.payroll_periods; v_key text; v_value numeric;
begin
 select * into v_entry from public.payroll_entries where id=p_entry_id for update;
 if v_entry.id is null or not private.readyops_can_manage_payroll(v_entry.team_id,v_entry.agent_id) then raise exception 'Payroll entry unavailable'; end if;
 select * into v_period from public.payroll_periods where id=v_entry.payroll_period_id for update;
 if v_period.status='locked' or v_entry.status='paid' then raise exception 'Paid or locked payroll cannot be edited'; end if;
 if jsonb_typeof(p_patch)<>'object' or p_patch is null then raise exception 'Invalid payroll patch'; end if;
 for v_key in select jsonb_object_keys(p_patch) loop
   if v_key not in ('pay_structure','hours','base_pay','hourly_rate','lead_rate','signed_contract_rate','bonus','deductions','notes','status','payment_date','save_defaults') then raise exception 'Invalid payroll field: %',v_key; end if;
   if v_key='save_defaults' and not public.is_admin() then raise exception 'Only Admins can update permanent pay defaults';end if;
   if v_key in ('hours','base_pay','hourly_rate','lead_rate','signed_contract_rate','bonus','deductions') then
     v_value:=(p_patch->>v_key)::numeric;
     if v_value is null or v_value<0 or v_value::text in ('NaN','Infinity','-Infinity') or v_value>10000000 then raise exception 'Invalid payroll amount'; end if;
   end if;
 end loop;
 if p_patch?'pay_structure' and coalesce(p_patch->>'pay_structure','') not in ('commission_only','base_only','base_plus_commission','hourly') then raise exception 'Invalid pay structure'; end if;
 if p_patch?'status' and coalesce(p_patch->>'status','') not in ('pending','approved','paid') then raise exception 'Invalid payroll status'; end if;
 if p_patch->>'status'='paid' and nullif(p_patch->>'payment_date','') is null then raise exception 'Payment date is required for paid payroll'; end if;
 update public.payroll_entries set
 pay_structure=coalesce(p_patch->>'pay_structure',pay_structure),hours=coalesce((p_patch->>'hours')::numeric,hours),
 base_pay=coalesce((p_patch->>'base_pay')::numeric,base_pay),hourly_rate=coalesce((p_patch->>'hourly_rate')::numeric,hourly_rate),
 lead_rate=coalesce((p_patch->>'lead_rate')::numeric,lead_rate),signed_contract_rate=coalesce((p_patch->>'signed_contract_rate')::numeric,signed_contract_rate),
 bonus=coalesce((p_patch->>'bonus')::numeric,bonus),deductions=coalesce((p_patch->>'deductions')::numeric,deductions),
 notes=case when p_patch?'notes' then nullif(trim(p_patch->>'notes'),'') else notes end,
 status=coalesce(p_patch->>'status',status),payment_date=case when p_patch?'payment_date' then nullif(p_patch->>'payment_date','')::date else payment_date end,
 updated_at=now() where id=p_entry_id;
 if coalesce((p_patch->>'save_defaults')::boolean,false) then
   update public.agents a set pay_structure=pe.pay_structure,weekly_base=pe.base_pay,hourly_rate=pe.hourly_rate,
   payroll_lead_rate=pe.lead_rate,payroll_signed_contract_rate=pe.signed_contract_rate from public.payroll_entries pe where pe.id=p_entry_id and a.id=pe.agent_id;
 end if;
 insert into public.management_audit_events(actor_id,team_id,target_id,event_type,metadata)
 values(auth.uid(),v_entry.team_id,p_entry_id,'payroll_entry_updated',jsonb_build_object('payroll_period_id',v_entry.payroll_period_id,
 'previous_status',v_entry.status,'status',coalesce(p_patch->>'status',v_entry.status),'previous_total',v_entry.total_pay,'changes',p_patch));
 -- A manager edits this week only, never another team's records or default rates.
end $$;
revoke all on function public.save_readyops_team_payroll_entry(uuid,jsonb) from public,anon;
grant execute on function public.save_readyops_team_payroll_entry(uuid,jsonb) to authenticated;

create or replace function public.get_readyops_payroll_entries(p_period_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
 select coalesce(jsonb_agg(to_jsonb(pe)||jsonb_build_object('agent_name',a.name,'team_name',t.name,
 'week_start',pp.week_start,'week_end',pp.week_end,'total_leads',counts.leads,'appointments',counts.appointments,
 'bad_leads',counts.bad,'no_show_leads',counts.no_show) order by a.name),'[]'::jsonb)
 from public.payroll_entries pe join public.payroll_periods pp on pp.id=pe.payroll_period_id
 join public.agents a on a.id=pe.agent_id left join public.teams t on t.id=pe.team_id
 left join lateral(select count(distinct l.id) leads,count(distinct ap.id) appointments,
 count(distinct l.id) filter(where ap.client_status='bad' or l.qc_status='denied') bad,
 count(distinct l.id) filter(where ap.client_status='no_show') no_show
 from public.portal_leads l join public.portal_appointments ap on ap.lead_id=l.id
 where l.agent_id=pe.agent_id and ap.appointment_date between pp.week_start and pp.week_end) counts on true
 where pe.payroll_period_id=p_period_id and private.readyops_can_manage_payroll(pe.team_id,pe.agent_id)
$$;
revoke all on function public.get_readyops_payroll_entries(uuid) from public,anon;
grant execute on function public.get_readyops_payroll_entries(uuid) to authenticated;

create or replace function public.generate_readyops_payroll_week(p_date date default current_date) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_start date:=p_date-extract(dow from p_date)::int; v_period uuid; v_role text:=public.current_profile_role(); v_team uuid:=public.current_team_id();
begin
 if v_role is null or v_role not in ('admin','manager') or (v_role='manager' and v_team is null) then raise exception 'Assigned manager or admin required'; end if;
 if p_date is null then raise exception 'Payroll date required'; end if;
 insert into public.payroll_periods(week_start,week_end) values(v_start,v_start+6) on conflict(week_start) do nothing;
 select id into v_period from public.payroll_periods where week_start=v_start for update;
 if exists(select 1 from public.payroll_periods where id=v_period and status in ('paid','locked')) then raise exception 'Paid or locked payroll cannot be regenerated'; end if;
 insert into public.payroll_entries(payroll_period_id,agent_id,team_id,qualified_leads,signed_contracts,pay_structure,base_pay,hourly_rate,lead_rate,signed_contract_rate)
 select v_period,a.id,a.team_id,
 count(distinct l.id) filter(where ap.id is not null and l.qc_status='approved' and ap.client_status in ('good','signed_contract'))::int,
 count(distinct l.id) filter(where ap.id is not null and l.qc_status='approved' and ap.client_status='signed_contract')::int,
 a.pay_structure,a.weekly_base,a.hourly_rate,a.payroll_lead_rate,a.payroll_signed_contract_rate
 from public.agents a left join public.portal_leads l on l.agent_id=a.id
 left join public.portal_appointments ap on ap.lead_id=l.id and ap.appointment_date between v_start and v_start+6
 where a.active and (v_role='admin' or a.team_id=v_team)
 group by a.id,a.team_id,a.pay_structure,a.weekly_base,a.hourly_rate,a.payroll_lead_rate,a.payroll_signed_contract_rate
 on conflict(payroll_period_id,agent_id) do update set qualified_leads=excluded.qualified_leads,signed_contracts=excluded.signed_contracts,updated_at=now()
 where payroll_entries.status='pending' and (v_role='admin' or (payroll_entries.team_id=v_team and excluded.team_id=v_team));
 return v_period;
end $$;
revoke all on function public.generate_readyops_payroll_week(date) from public,anon;
grant execute on function public.generate_readyops_payroll_week(date) to authenticated;
-- Legacy manager links now require the same authenticated team authority.
create or replace function public.get_manager_link_overview(p_access_token uuid,p_start_date date default null,p_end_date date default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_link public.manager_portal_links; v_role text:=public.current_profile_role(); v_data jsonb;
begin
 select * into v_link from public.manager_portal_links where access_token=p_access_token and active;
 if v_link.id is null or v_role is null or v_role not in ('admin','manager')
 or (v_role='manager' and public.current_team_id() is distinct from v_link.team_id) then raise exception 'Sign in with an active account assigned to this team'; end if;
 v_data:=public.get_manager_team_overview(v_link.team_id,p_start_date,p_end_date);
 return v_data||jsonb_build_object('manager',jsonb_build_object('id',v_link.id,'name',v_link.name,'portal_slug',v_link.portal_slug));
end $$;
revoke all on function public.get_manager_link_overview(uuid,date,date) from public,anon;
grant execute on function public.get_manager_link_overview(uuid,date,date) to authenticated;
-- Do not issue durable agent bearer tokens to managers. Their review access
-- must be re-evaluated against the currently assigned team on every request.
create or replace function public.regenerate_agent_portal_link(p_agent_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_agent public.agents;v_slug text;v_token uuid:=gen_random_uuid();
begin
 if not public.is_admin() then raise exception 'Admin access required; managers review through Team QC';end if;
 select * into v_agent from public.agents where id=p_agent_id for update;
 if v_agent.id is null then raise exception 'Agent not found';end if;
 v_slug:=coalesce(nullif(trim(v_agent.portal_slug),''),trim(both '-' from regexp_replace(lower(v_agent.name),'[^a-z0-9]+','-','g'))||'-'||left(v_agent.id::text,8));
 update public.agents set portal_slug=v_slug,access_token=v_token where id=p_agent_id;
 insert into public.management_audit_events(actor_id,team_id,target_id,event_type) values(auth.uid(),v_agent.team_id,p_agent_id,'agent_portal_token_rotated');
 return jsonb_build_object('agent_id',v_agent.id,'agent_name',v_agent.name,'portal_slug',v_slug,'access_token',v_token,'path','/agent/'||v_slug||'/'||v_token::text);
end $$;
revoke all on function public.regenerate_agent_portal_link(uuid) from public,anon;
grant execute on function public.regenerate_agent_portal_link(uuid) to authenticated;
CREATE OR REPLACE FUNCTION public.get_manager_team_overview(
  p_team_id uuid DEFAULT NULL,
  p_start_date date DEFAULT NULL,
  p_end_date date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_role text;
  v_team_id uuid;
  v_start date := coalesce(p_start_date, current_date - 14);
  v_end date := coalesce(p_end_date, current_date + 45);
BEGIN
  SELECT p.role, CASE WHEN p.role = 'manager' THEN p.team_id ELSE coalesce(p.team_id, a.team_id) END
  INTO v_role, v_team_id
  FROM public.profiles AS p
  LEFT JOIN public.agents AS a ON a.id = p.agent_id
  WHERE p.id = (SELECT auth.uid()) AND p.active;

  IF v_role IS NULL THEN RAISE EXCEPTION 'Authenticated profile required'; END IF;
  IF v_role = 'admin' THEN
    v_team_id := coalesce(p_team_id, v_team_id);
  ELSIF v_role <> 'manager' THEN
    RAISE EXCEPTION 'Manager or admin access required';
  END IF;
  IF v_role = 'manager' AND p_team_id IS NOT NULL AND p_team_id IS DISTINCT FROM v_team_id THEN RAISE EXCEPTION 'Another team is not accessible'; END IF;
  IF v_team_id IS NULL THEN RAISE EXCEPTION 'A team must be assigned to this manager'; END IF;

  RETURN jsonb_build_object(
    'team', (
      SELECT jsonb_build_object('id', t.id, 'name', t.name, 'abbreviation', t.abbreviation)
      FROM public.teams AS t WHERE t.id = v_team_id
    ),
    'agents', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', a.id, 'name', a.name, 'email', a.email, 'active', a.active,
        'portal_slug', a.portal_slug, 'access_token', CASE WHEN v_role = 'admin' THEN a.access_token END, 'team_id', a.team_id,
        'total_leads', (SELECT count(*) FROM public.portal_leads l JOIN public.portal_appointments ap ON ap.lead_id=l.id WHERE l.agent_id=a.id AND ap.appointment_date BETWEEN v_start AND v_end),
        'qc_pending', (SELECT count(*) FROM public.portal_leads l JOIN public.portal_appointments ap ON ap.lead_id=l.id WHERE l.agent_id=a.id AND l.qc_status IN ('pending','in_review','needs_correction') AND ap.appointment_date BETWEEN v_start AND v_end),
        'awaiting_final_qc', (SELECT count(*) FROM public.portal_leads l JOIN public.portal_appointments ap ON ap.lead_id=l.id WHERE l.agent_id=a.id AND l.qc_status='manager_approved' AND ap.appointment_date BETWEEN v_start AND v_end),
        'approved', (SELECT count(*) FROM public.portal_leads l JOIN public.portal_appointments ap ON ap.lead_id=l.id WHERE l.agent_id=a.id AND l.qc_status='approved' AND ap.appointment_date BETWEEN v_start AND v_end),
        'denied', (SELECT count(*) FROM public.portal_leads l JOIN public.portal_appointments ap ON ap.lead_id=l.id WHERE l.agent_id=a.id AND l.qc_status='denied' AND ap.appointment_date BETWEEN v_start AND v_end)
      ) ORDER BY a.name)
      FROM public.agents AS a
      WHERE a.team_id = v_team_id
    ), '[]'::jsonb),
    'companies', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name, 'state', c.state, 'public_slug', s.public_slug, 'account_status', c.account_status
      ) ORDER BY c.name)
      FROM public.roster_companies AS c
      LEFT JOIN public.company_portal_settings AS s ON s.company_id = c.id
      WHERE EXISTS (SELECT 1 FROM public.company_teams ct WHERE ct.company_id=c.id AND ct.team_id=v_team_id)
        OR (NOT EXISTS (SELECT 1 FROM public.company_teams ct2 WHERE ct2.company_id=c.id) AND c.team_id=v_team_id)
    ), '[]'::jsonb),
    'range', jsonb_build_object('start_date', v_start, 'end_date', v_end)
  );
END;
$function$;
-- Keep agent identity available to authorized payroll/scheduling screens even
-- when direct column access to public.agents is restricted by grants or RLS.
-- The function remains scoped to admins and managers' own teams.
CREATE OR REPLACE FUNCTION public.readyops_agent_privileged_fields()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role text;
  v_team_id uuid;
  v_is_anonymous boolean := coalesce(((SELECT auth.jwt()) ->> 'is_anonymous')::boolean, false);
BEGIN
  IF auth.uid() IS NULL OR v_is_anonymous THEN
    RETURN '[]'::jsonb;
  END IF;

  SELECT p.role, CASE WHEN p.role = 'manager' THEN p.team_id ELSE coalesce(p.team_id, a.team_id) END
    INTO v_role, v_team_id
  FROM public.profiles p
  LEFT JOIN public.agents a ON a.id = p.agent_id
  WHERE p.id = auth.uid() AND p.active;

  IF v_role NOT IN ('admin', 'manager') THEN
    RETURN '[]'::jsonb;
  END IF;

  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'id', ag.id,
      'name', ag.name,
      'team_id', ag.team_id,
      'active', ag.active,
      'access_token', CASE WHEN v_role = 'admin' THEN ag.access_token END,
      'pay_structure', CASE WHEN v_role = 'admin' THEN ag.pay_structure END,
      'weekly_base', CASE WHEN v_role = 'admin' THEN ag.weekly_base END,
      'hourly_rate', CASE WHEN v_role = 'admin' THEN ag.hourly_rate END,
      'payroll_lead_rate', CASE WHEN v_role = 'admin' THEN ag.payroll_lead_rate END,
      'payroll_signed_contract_rate', CASE WHEN v_role = 'admin' THEN ag.payroll_signed_contract_rate END
    ))
    FROM public.agents ag
    WHERE v_role = 'admin'
       OR (v_team_id IS NOT NULL AND ag.team_id = v_team_id)
  ), '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.readyops_agent_privileged_fields() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.readyops_agent_privileged_fields() TO authenticated;
