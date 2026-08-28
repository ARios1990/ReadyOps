-- Imported from the hosted ReadyOp Supabase migration history on 2026-08-28.
-- Schema only: no production table data is included.

-- ReadyOps Company Management v2
-- Additive, backwards-compatible migration. Existing company, lead, appointment,
-- package, scheduling, and audit records remain in place.

-- Company-authenticated users are mapped explicitly to companies. Managers keep
-- using the existing team/company relationship and admins retain global access.
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role = any (array['admin'::text,'agent'::text,'qc'::text,'manager'::text,'company'::text]));

create table if not exists public.company_user_access (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.roster_companies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  can_manage_logo boolean not null default true,
  can_manage_packages boolean not null default false,
  can_start_packages boolean not null default false,
  can_import_leads boolean not null default true,
  can_export_leads boolean not null default true,
  can_update_outcomes boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id,user_id)
);
create index if not exists company_user_access_user_company_idx
  on public.company_user_access(user_id,company_id);
alter table public.company_user_access enable row level security;

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
      select 1 from public.company_user_access cua
      where cua.company_id = $1 and cua.user_id = auth.uid()
    )
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

create or replace function public.readyops_company_management_role(p_company_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when auth.uid() is null then null
    when exists (select 1 from public.profiles p where p.id=auth.uid() and p.role='admin') then 'admin'
    when exists (select 1 from public.profiles p where p.id=auth.uid() and p.role='manager')
      and public.user_can_access_company(p_company_id) then 'manager'
    when exists (
      select 1 from public.profiles p
      join public.company_user_access cua on cua.user_id=p.id
      where p.id=auth.uid() and p.role='company' and cua.company_id=p_company_id
    ) then 'company'
    else null
  end;
$$;

drop policy if exists company_user_access_admin_all on public.company_user_access;
create policy company_user_access_admin_all on public.company_user_access
for all to authenticated using (public.portal_is_admin()) with check (public.portal_is_admin());
drop policy if exists company_user_access_self_select on public.company_user_access;
create policy company_user_access_self_select on public.company_user_access
for select to authenticated using (user_id=auth.uid());

grant select on public.company_user_access to authenticated;
revoke all on public.company_user_access from anon;

-- Store an object path (not a hard-coded host) and derive the public URL with the
-- configured Supabase client. This keeps deployment domains portable.
alter table public.roster_companies add column if not exists logo_path text;
alter table public.company_portal_settings add column if not exists allow_company_logo_update boolean not null default true;

-- Extend the existing package lifecycle without duplicating existing fields.
-- lead_target remains the canonical "leads included" value; amount_per_lead is
-- the canonical agreement rate; completed_at is the completion timestamp.
alter table public.company_packages add column if not exists package_number integer;
alter table public.company_packages add column if not exists agreement_type text not null default 'paid_per_lead';
alter table public.company_packages add column if not exists agreement_data jsonb not null default '{}'::jsonb;
alter table public.company_packages add column if not exists created_by uuid references auth.users(id) on delete set null;
alter table public.company_packages add column if not exists archived_at timestamptz;

with numbered as (
  select id,row_number() over(partition by company_id order by start_date,created_at,id)::integer as package_number
  from public.company_packages
)
update public.company_packages p set package_number=n.package_number
from numbered n where p.id=n.id and p.package_number is null;

alter table public.company_packages alter column package_number set not null;
alter table public.company_packages drop constraint if exists company_packages_status_v2_check;
alter table public.company_packages add constraint company_packages_status_v2_check
  check (status in ('draft','active','completed','cancelled','archived'));
alter table public.company_packages drop constraint if exists company_packages_agreement_type_check;
alter table public.company_packages add constraint company_packages_agreement_type_check
  check (agreement_type in ('paid_per_lead','per_contract','weekly','per_installed_job'));
alter table public.company_packages drop constraint if exists company_packages_lead_target_positive_check;
alter table public.company_packages add constraint company_packages_lead_target_positive_check check (lead_target > 0);
alter table public.company_packages drop constraint if exists company_packages_rate_nonnegative_check;
alter table public.company_packages add constraint company_packages_rate_nonnegative_check check (amount_per_lead >= 0 and package_total >= 0);
create unique index if not exists company_packages_company_number_uidx
  on public.company_packages(company_id,package_number);
create unique index if not exists company_packages_one_active_uidx
  on public.company_packages(company_id) where status='active';
create index if not exists company_packages_company_status_dates_idx
  on public.company_packages(company_id,status,start_date desc,created_at desc);

drop policy if exists company_packages_company_select on public.company_packages;
create policy company_packages_company_select on public.company_packages
for select to authenticated using (public.user_can_access_company(company_id));

-- Canonical lead/inspector status. Legacy fields remain for older pages and are
-- synchronized by a single trigger so they cannot silently diverge.
alter table public.portal_appointments add column if not exists canonical_status text;
alter table public.portal_appointments add column if not exists canonical_status_updated_at timestamptz;
alter table public.portal_appointments add column if not exists canonical_status_updated_by uuid references auth.users(id) on delete set null;
alter table public.portal_appointments add column if not exists canonical_status_source text;

update public.portal_appointments
set canonical_status = case
  when sales_outcome='signed_contract' or client_status='signed_contract' then 'signed_contract'
  when client_status='no_show' or attendance_status='homeowner_no_show' then 'no_show'
  when client_status='bad' or sales_outcome in ('lost','no_sale') or attendance_status='cancelled' then 'bad'
  when client_status in ('reschedule','rescheduled') or rep_status='reschedule_requested' then 'rescheduled'
  when inspection_status='completed' or client_status='good' then 'good_inspected'
  when status in ('confirmed','assigned') then 'confirmed'
  else 'pending'
end,
canonical_status_updated_at=coalesce(last_company_update_at,updated_at,created_at,now()),
canonical_status_source='legacy_migration'
where canonical_status is null;

alter table public.portal_appointments alter column canonical_status set default 'pending';
alter table public.portal_appointments alter column canonical_status set not null;
alter table public.portal_appointments drop constraint if exists portal_appointments_canonical_status_check;
alter table public.portal_appointments add constraint portal_appointments_canonical_status_check
  check (canonical_status in ('pending','confirmed','good_inspected','signed_contract','no_show','bad','rescheduled'));
create index if not exists portal_appointments_company_date_canonical_idx
  on public.portal_appointments(company_id,appointment_date,canonical_status);

insert into public.portal_audit_logs(company_id,actor_type,actor_name,action,entity_type,entity_id,old_value,new_value,metadata)
select a.company_id,'system','Migration','canonical_status_migrated','appointment',a.id,
  jsonb_build_object('status',a.status,'client_status',a.client_status,'inspection_status',a.inspection_status,'sales_outcome',a.sales_outcome,'attendance_status',a.attendance_status),
  jsonb_build_object('canonical_status',a.canonical_status),
  jsonb_build_object('source','readyops_company_management_v2')
from public.portal_appointments a
where not exists (
  select 1 from public.portal_audit_logs al
  where al.entity_id=a.id and al.action='canonical_status_migrated'
);

create or replace function public.readyops_sync_canonical_status()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare v_derived text;
begin
  if tg_op='INSERT' or new.canonical_status is distinct from old.canonical_status then
    v_derived:=coalesce(new.canonical_status,'pending');
  elsif new.client_status is distinct from old.client_status
     or new.inspection_status is distinct from old.inspection_status
     or new.sales_outcome is distinct from old.sales_outcome
     or new.attendance_status is distinct from old.attendance_status
     or new.rep_status is distinct from old.rep_status then
    v_derived:=case
      when new.sales_outcome='signed_contract' or new.client_status='signed_contract' then 'signed_contract'
      when new.client_status='no_show' or new.attendance_status='homeowner_no_show' then 'no_show'
      when new.client_status='bad' or new.sales_outcome in ('lost','no_sale') or new.attendance_status='cancelled' then 'bad'
      when new.client_status in ('reschedule','rescheduled') or new.rep_status='reschedule_requested' then 'rescheduled'
      when new.inspection_status='completed' or new.client_status='good' then 'good_inspected'
      when new.client_status='pending' and new.inspection_status in ('not_started','started') then coalesce(old.canonical_status,'confirmed')
      else coalesce(old.canonical_status,'pending')
    end;
  else
    return new;
  end if;

  new.canonical_status:=v_derived;
  new.canonical_status_updated_at:=now();
  new.canonical_status_updated_by:=auth.uid();
  new.canonical_status_source:=coalesce(nullif(current_setting('readyops.status_source',true),''),'legacy_sync');
  new.client_status:=case v_derived
    when 'good_inspected' then 'good'
    when 'signed_contract' then 'signed_contract'
    when 'no_show' then 'no_show'
    when 'bad' then 'bad'
    when 'rescheduled' then 'reschedule'
    else 'pending' end;
  if v_derived in ('good_inspected','signed_contract') then new.inspection_status:='completed'; end if;
  if v_derived='signed_contract' then new.sales_outcome:='signed_contract'; end if;
  if v_derived='no_show' then new.attendance_status:='homeowner_no_show'; end if;
  if v_derived='rescheduled' then new.rep_status:='reschedule_requested'; end if;
  return new;
end;
$$;

drop trigger if exists readyops_sync_canonical_status_trigger on public.portal_appointments;
create trigger readyops_sync_canonical_status_trigger
before insert or update of canonical_status,client_status,inspection_status,sales_outcome,attendance_status,rep_status
on public.portal_appointments for each row execute function public.readyops_sync_canonical_status();

create or replace function public.readyops_audit_canonical_status()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
begin
  if new.canonical_status is distinct from old.canonical_status then
    perform public.portal_write_audit(
      new.company_id,
      coalesce(public.readyops_company_management_role(new.company_id),'system'),
      auth.uid(),
      coalesce((select p.display_name from public.profiles p where p.id=auth.uid()),'System'),
      'canonical_status_changed','appointment',new.id,
      jsonb_build_object('canonical_status',old.canonical_status),
      jsonb_build_object('canonical_status',new.canonical_status),
      jsonb_build_object('lead_id',new.lead_id,'source',new.canonical_status_source)
    );
  end if;
  return new;
end;
$$;
drop trigger if exists readyops_audit_canonical_status_trigger on public.portal_appointments;
create trigger readyops_audit_canonical_status_trigger
after update of canonical_status on public.portal_appointments
for each row execute function public.readyops_audit_canonical_status();

create table if not exists public.appointment_reschedule_history (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.roster_companies(id) on delete cascade,
  appointment_id uuid not null references public.portal_appointments(id) on delete cascade,
  lead_id uuid not null references public.portal_leads(id) on delete cascade,
  old_appointment_date date not null,
  old_start_time time not null,
  old_end_time time not null,
  new_appointment_date date not null,
  new_start_time time not null,
  new_end_time time not null,
  reason text,
  changed_by uuid references auth.users(id) on delete set null,
  changed_at timestamptz not null default now()
);
create index if not exists appointment_reschedule_history_company_appointment_idx
  on public.appointment_reschedule_history(company_id,appointment_id,changed_at desc);
alter table public.appointment_reschedule_history enable row level security;
drop policy if exists appointment_reschedule_history_select on public.appointment_reschedule_history;
create policy appointment_reschedule_history_select on public.appointment_reschedule_history
for select to authenticated using (public.user_can_access_company(company_id));
revoke all on public.appointment_reschedule_history from anon;
grant select on public.appointment_reschedule_history to authenticated;

-- Synchronization history and conflict review. OAuth credentials/tokens are never
-- stored in frontend-readable tables.
create table if not exists public.lead_sync_connections (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.roster_companies(id) on delete cascade,
  provider text not null check (provider in ('google_sheets','excel')),
  display_name text not null,
  provider_resource_id text,
  worksheet_name text,
  column_mapping jsonb not null default '{}'::jsonb,
  sync_mode text not null default 'one_time' check (sync_mode in ('one_time','ongoing')),
  enabled boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists lead_sync_connections_company_idx on public.lead_sync_connections(company_id,provider,created_at desc);

create table if not exists public.lead_sync_runs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.roster_companies(id) on delete cascade,
  connection_id uuid references public.lead_sync_connections(id) on delete set null,
  provider text not null check (provider in ('google_sheets','excel','csv_export','excel_export')),
  status text not null default 'running' check (status in ('running','success','partial','failed')),
  imported_count integer not null default 0 check (imported_count>=0),
  updated_count integer not null default 0 check (updated_count>=0),
  skipped_count integer not null default 0 check (skipped_count>=0),
  failed_count integer not null default 0 check (failed_count>=0),
  filters jsonb not null default '{}'::jsonb,
  error_summary text,
  started_by uuid references auth.users(id) on delete set null,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists lead_sync_runs_company_started_idx on public.lead_sync_runs(company_id,started_at desc);

create table if not exists public.lead_sync_conflicts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.roster_companies(id) on delete cascade,
  sync_run_id uuid not null references public.lead_sync_runs(id) on delete cascade,
  row_number integer,
  duplicate_key text,
  existing_lead_id uuid references public.portal_leads(id) on delete set null,
  reason text not null,
  incoming_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists lead_sync_conflicts_run_idx on public.lead_sync_conflicts(sync_run_id,row_number);

alter table public.lead_sync_connections enable row level security;
alter table public.lead_sync_runs enable row level security;
alter table public.lead_sync_conflicts enable row level security;
drop policy if exists lead_sync_connections_company_access on public.lead_sync_connections;
create policy lead_sync_connections_company_access on public.lead_sync_connections for select to authenticated
  using (public.user_can_access_company(company_id));
drop policy if exists lead_sync_runs_company_access on public.lead_sync_runs;
create policy lead_sync_runs_company_access on public.lead_sync_runs for select to authenticated
  using (public.user_can_access_company(company_id));
drop policy if exists lead_sync_conflicts_company_access on public.lead_sync_conflicts;
create policy lead_sync_conflicts_company_access on public.lead_sync_conflicts for select to authenticated
  using (public.user_can_access_company(company_id));
revoke all on public.lead_sync_connections,public.lead_sync_runs,public.lead_sync_conflicts from anon;
grant select on public.lead_sync_connections,public.lead_sync_runs,public.lead_sync_conflicts to authenticated;

alter table public.portal_leads add column if not exists import_dedupe_key text;
create unique index if not exists portal_leads_company_import_dedupe_uidx
  on public.portal_leads(company_id,import_dedupe_key) where import_dedupe_key is not null;

drop policy if exists portal_audit_logs_company_select on public.portal_audit_logs;
create policy portal_audit_logs_company_select on public.portal_audit_logs
for select to authenticated using (company_id is not null and public.user_can_access_company(company_id));

-- Authenticated company management data. Token secrets are intentionally omitted.
create or replace function public.get_company_management_v2(
  p_company_id uuid,
  p_start_date date,
  p_end_date date
)
returns jsonb
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $$
declare v_role text;
begin
  v_role:=public.readyops_company_management_role(p_company_id);
  if v_role is null then raise exception 'Company access required'; end if;
  if p_start_date is null or p_end_date is null or p_end_date < p_start_date or p_end_date-p_start_date > 370 then
    raise exception 'Invalid report date range';
  end if;

  return jsonb_build_object(
    'role',v_role,
    'company',(select jsonb_build_object('id',c.id,'name',c.name,'state',c.state,'email',c.email,'phone',c.phone,'logo_path',c.logo_path) from public.roster_companies c where c.id=p_company_id),
    'settings',(select to_jsonb(s)-'company_access_token'-'external_webhook_secret' from public.company_portal_settings s where s.company_id=p_company_id),
    'locations',coalesce((select jsonb_agg(to_jsonb(l) order by l.sort_order,l.location_label) from public.company_locations l where l.company_id=p_company_id),'[]'::jsonb),
    'schedule_rules',coalesce((select jsonb_agg(to_jsonb(r) order by r.location_id nulls first,r.day_of_week) from public.company_schedule_rules r where r.company_id=p_company_id),'[]'::jsonb),
    'exceptions',coalesce((select jsonb_agg(to_jsonb(e) order by e.exception_date,e.start_time) from public.company_schedule_exceptions e where e.company_id=p_company_id and e.exception_date between p_start_date-30 and p_end_date+60),'[]'::jsonb),
    'representatives',coalesce((select jsonb_agg(to_jsonb(r)-'access_token' order by r.active desc,r.name) from public.company_representatives r where r.company_id=p_company_id),'[]'::jsonb),
    'packages',coalesce((select jsonb_agg(
      to_jsonb(cp)||jsonb_build_object(
        'leads_included',cp.lead_target,
        'agreed_rate',cp.amount_per_lead,
        'completion_date',cp.completed_at,
        'leads_delivered',(select count(distinct l.id) from public.portal_leads l where l.package_id=cp.id and l.company_id=p_company_id and l.qc_status='approved'),
        'leads_remaining',greatest(cp.lead_target-(select count(distinct l.id) from public.portal_leads l where l.package_id=cp.id and l.company_id=p_company_id and l.qc_status='approved'),0),
        'completion_percentage',case when cp.lead_target=0 then 0 else round(least((select count(distinct l.id) from public.portal_leads l where l.package_id=cp.id and l.company_id=p_company_id and l.qc_status='approved')::numeric/cp.lead_target*100,100),1) end
      ) order by cp.package_number desc
    ) from public.company_packages cp where cp.company_id=p_company_id),'[]'::jsonb),
    'appointments',coalesce((select jsonb_agg(
      (to_jsonb(a)-'manage_token')||jsonb_build_object(
        'lead',(to_jsonb(l)-'recording_url'-'form_data')||jsonb_build_object('recording_url',case when l.share_recording_with_company then l.recording_url else null end),
        'package',case when cp.id is null then null else jsonb_build_object('id',cp.id,'package_number',cp.package_number,'package_name',cp.package_name,'agreement_type',cp.agreement_type) end,
        'location_label',loc.location_label,
        'representative_name',rep.name,
        'reschedule_history',coalesce((select jsonb_agg(to_jsonb(h) order by h.changed_at desc) from public.appointment_reschedule_history h where h.appointment_id=a.id),'[]'::jsonb)
      ) order by a.appointment_date,a.start_time,a.id)
      from public.portal_appointments a
      join public.portal_leads l on l.id=a.lead_id and l.company_id=p_company_id
      left join public.company_packages cp on cp.id=l.package_id and cp.company_id=p_company_id
      left join public.company_locations loc on loc.id=a.location_id
      left join public.company_representatives rep on rep.id=a.representative_id
      where a.company_id=p_company_id and a.appointment_date between p_start_date and p_end_date and l.qc_status='approved' and a.company_visible_at is not null),'[]'::jsonb),
    'audit_logs',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (select * from public.portal_audit_logs al where al.company_id=p_company_id order by al.created_at desc limit 300)x),'[]'::jsonb),
    'sync_runs',coalesce((select jsonb_agg(to_jsonb(x) order by x.started_at desc) from (select * from public.lead_sync_runs sr where sr.company_id=p_company_id order by sr.started_at desc limit 100)x),'[]'::jsonb)
  );
end;
$$;

create or replace function public.get_company_management_v2_by_slug(
  p_slug text,p_start_date date,p_end_date date
)
returns jsonb
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $$
declare v_company_id uuid;
begin
  select s.company_id into v_company_id from public.company_portal_settings s where s.public_slug=p_slug;
  if v_company_id is null then raise exception 'Company not found'; end if;
  return public.get_company_management_v2(v_company_id,p_start_date,p_end_date);
end;
$$;

create or replace function public.company_set_logo_path(p_company_id uuid,p_path text)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare v_role text; v_old text; v_new text;
begin
  v_role:=public.readyops_company_management_role(p_company_id);
  if v_role not in ('admin','manager','company') then raise exception 'Logo permission required'; end if;
  if v_role='company' and not exists(select 1 from public.company_user_access cua where cua.company_id=p_company_id and cua.user_id=auth.uid() and cua.can_manage_logo) then raise exception 'Logo permission required'; end if;
  if p_path is not null and (length(p_path)>500 or split_part(p_path,'/',1)<>p_company_id::text) then raise exception 'Invalid company logo path'; end if;
  select logo_path into v_old from public.roster_companies where id=p_company_id for update;
  update public.roster_companies set logo_path=nullif(trim(p_path),'') where id=p_company_id returning logo_path into v_new;
  perform public.portal_write_audit(p_company_id,v_role,auth.uid(),coalesce((select display_name from public.profiles where id=auth.uid()),'User'),
    case when v_new is null then 'company_logo_removed' when v_old is null then 'company_logo_added' else 'company_logo_changed' end,
    'company',p_company_id,to_jsonb(v_old),to_jsonb(v_new),'{}'::jsonb);
  return jsonb_build_object('logo_path',v_new);
end;
$$;

create or replace function public.company_create_package_v2(p_company_id uuid,p_package jsonb,p_force_close boolean default false)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare v_role text; v_active public.company_packages%rowtype; v_delivered integer; v_next integer; v_new public.company_packages%rowtype;
begin
  v_role:=public.readyops_company_management_role(p_company_id);
  if v_role not in ('admin','manager','company') then raise exception 'Package permission required'; end if;
  if v_role='company' and not exists(select 1 from public.company_user_access cua where cua.company_id=p_company_id and cua.user_id=auth.uid() and cua.can_start_packages) then raise exception 'Package permission required'; end if;
  perform pg_advisory_xact_lock(hashtextextended('company-package:'||p_company_id::text,0));
  select * into v_active from public.company_packages where company_id=p_company_id and status='active' for update;
  if v_active.id is not null then
    select count(distinct l.id) into v_delivered from public.portal_leads l where l.package_id=v_active.id and l.qc_status='approved';
    if v_delivered < v_active.lead_target and not p_force_close then raise exception 'Active package still has remaining leads'; end if;
    update public.company_packages set status='completed',completed_at=coalesce(completed_at,now()),updated_at=now() where id=v_active.id;
    perform public.portal_write_audit(p_company_id,v_role,auth.uid(),coalesce((select display_name from public.profiles where id=auth.uid()),'User'),'package_completed','company_package',v_active.id,to_jsonb(v_active),jsonb_build_object('status','completed'),jsonb_build_object('forced',p_force_close));
  end if;
  select coalesce(max(package_number),0)+1 into v_next from public.company_packages where company_id=p_company_id;
  insert into public.company_packages(company_id,package_number,package_name,lead_target,amount_per_lead,package_total,payment_date,payment_status,status,start_date,notes,agreement_type,agreement_data,created_by)
  values(p_company_id,v_next,coalesce(nullif(trim(p_package->>'package_name'),''),'Lead Package #'||v_next),
    greatest(coalesce((p_package->>'leads_included')::integer,0),1),greatest(coalesce((p_package->>'agreed_rate')::numeric,0),0),
    greatest(coalesce((p_package->>'package_total')::numeric,coalesce((p_package->>'leads_included')::numeric,0)*coalesce((p_package->>'agreed_rate')::numeric,0)),0),
    nullif(p_package->>'payment_date','')::date,coalesce(nullif(p_package->>'payment_status',''),'pending'),'active',
    coalesce(nullif(p_package->>'start_date','')::date,current_date),nullif(trim(p_package->>'notes'),''),
    coalesce(nullif(p_package->>'agreement_type',''),'paid_per_lead'),coalesce(p_package->'agreement_data','{}'::jsonb),auth.uid()) returning * into v_new;
  perform public.portal_write_audit(p_company_id,v_role,auth.uid(),coalesce((select display_name from public.profiles where id=auth.uid()),'User'),'package_created','company_package',v_new.id,null,to_jsonb(v_new),'{}'::jsonb);
  return to_jsonb(v_new);
end;
$$;

create or replace function public.company_update_package_v2(p_company_id uuid,p_package_id uuid,p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare v_role text; v_old public.company_packages%rowtype; v_new public.company_packages%rowtype; v_status text;
begin
  v_role:=public.readyops_company_management_role(p_company_id);
  if v_role not in ('admin','manager') then raise exception 'Package edit permission required'; end if;
  select * into v_old from public.company_packages where id=p_package_id and company_id=p_company_id for update;
  if v_old.id is null then raise exception 'Package not found'; end if;
  v_status:=coalesce(p_patch->>'status',v_old.status);
  if v_status not in ('draft','active','completed','cancelled','archived') then raise exception 'Invalid package status'; end if;
  update public.company_packages set
    package_name=case when p_patch?'package_name' then coalesce(nullif(trim(p_patch->>'package_name'),''),package_name) else package_name end,
    lead_target=case when p_patch?'leads_included' then greatest((p_patch->>'leads_included')::integer,1) else lead_target end,
    amount_per_lead=case when p_patch?'agreed_rate' then greatest((p_patch->>'agreed_rate')::numeric,0) else amount_per_lead end,
    package_total=case when p_patch?'package_total' then greatest((p_patch->>'package_total')::numeric,0) else package_total end,
    agreement_type=case when p_patch?'agreement_type' then p_patch->>'agreement_type' else agreement_type end,
    agreement_data=case when p_patch?'agreement_data' then coalesce(p_patch->'agreement_data','{}'::jsonb) else agreement_data end,
    payment_date=case when p_patch?'payment_date' then nullif(p_patch->>'payment_date','')::date else payment_date end,
    payment_status=case when p_patch?'payment_status' then p_patch->>'payment_status' else payment_status end,
    notes=case when p_patch?'notes' then nullif(trim(p_patch->>'notes'),'') else notes end,
    status=v_status,
    completed_at=case when v_status='completed' then coalesce(completed_at,now()) else completed_at end,
    archived_at=case when v_status='archived' then coalesce(archived_at,now()) else archived_at end,
    updated_at=now()
  where id=v_old.id returning * into v_new;
  perform public.portal_write_audit(p_company_id,v_role,auth.uid(),coalesce((select display_name from public.profiles where id=auth.uid()),'User'),
    case when (to_jsonb(v_old)-'updated_at') is distinct from (to_jsonb(v_new)-'updated_at') and (v_old.agreement_type is distinct from v_new.agreement_type or v_old.amount_per_lead is distinct from v_new.amount_per_lead or v_old.agreement_data is distinct from v_new.agreement_data) then 'agreement_changed' else 'package_updated' end,
    'company_package',v_new.id,to_jsonb(v_old),to_jsonb(v_new),'{}'::jsonb);
  return to_jsonb(v_new);
end;
$$;

create or replace function public.company_update_canonical_status(
  p_company_id uuid,p_appointment_id uuid,p_status text,p_new_date date default null,p_new_start_time time default null,p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare v_role text; v_old public.portal_appointments%rowtype; v_new public.portal_appointments%rowtype; v_duration interval; v_new_end time;
begin
  v_role:=public.readyops_company_management_role(p_company_id);
  if v_role not in ('admin','manager','company') then raise exception 'Outcome update permission required'; end if;
  if v_role='company' and not exists(select 1 from public.company_user_access cua where cua.company_id=p_company_id and cua.user_id=auth.uid() and cua.can_update_outcomes) then raise exception 'Outcome update permission required'; end if;
  if p_status not in ('pending','confirmed','good_inspected','signed_contract','no_show','bad','rescheduled') then raise exception 'Invalid canonical status'; end if;
  select a.* into v_old from public.portal_appointments a join public.portal_leads l on l.id=a.lead_id
    where a.id=p_appointment_id and a.company_id=p_company_id and l.company_id=p_company_id and l.qc_status='approved' for update of a;
  if v_old.id is null then raise exception 'Approved appointment not found'; end if;
  perform set_config('readyops.status_source','company_management',true);
  if p_status='rescheduled' then
    if p_new_date is null or p_new_start_time is null then raise exception 'A new appointment date and time are required'; end if;
    v_duration:=v_old.end_time-v_old.start_time;
    if v_duration<=interval '0' then v_duration:=interval '1 hour'; end if;
    v_new_end:=(p_new_start_time+v_duration)::time;
    insert into public.appointment_reschedule_history(company_id,appointment_id,lead_id,old_appointment_date,old_start_time,old_end_time,new_appointment_date,new_start_time,new_end_time,reason,changed_by)
    values(p_company_id,v_old.id,v_old.lead_id,v_old.appointment_date,v_old.start_time,v_old.end_time,p_new_date,p_new_start_time,v_new_end,nullif(trim(p_reason),''),auth.uid());
    update public.portal_appointments set appointment_date=p_new_date,start_time=p_new_start_time,end_time=v_new_end,canonical_status=p_status,
      inspector_notes=case when nullif(trim(coalesce(p_reason,'')),'') is null then inspector_notes else trim(p_reason) end,last_company_update_at=now(),updated_at=now()
    where id=v_old.id returning * into v_new;
    perform public.portal_write_audit(p_company_id,v_role,auth.uid(),coalesce((select display_name from public.profiles where id=auth.uid()),'User'),'appointment_rescheduled','appointment',v_new.id,
      jsonb_build_object('date',v_old.appointment_date,'start_time',v_old.start_time,'end_time',v_old.end_time),jsonb_build_object('date',v_new.appointment_date,'start_time',v_new.start_time,'end_time',v_new.end_time),jsonb_build_object('reason',p_reason,'lead_id',v_new.lead_id));
  else
    update public.portal_appointments set canonical_status=p_status,last_company_update_at=now(),updated_at=now() where id=v_old.id returning * into v_new;
  end if;
  return to_jsonb(v_new)-'manage_token';
end;
$$;

create or replace function public.company_record_export(
  p_company_id uuid,p_format text,p_filters jsonb,p_row_count integer
)
returns uuid
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare v_role text; v_run uuid;
begin
  v_role:=public.readyops_company_management_role(p_company_id);
  if v_role not in ('admin','manager','company') then raise exception 'Export permission required'; end if;
  if v_role='company' and not exists(select 1 from public.company_user_access cua where cua.company_id=p_company_id and cua.user_id=auth.uid() and cua.can_export_leads) then raise exception 'Export permission required'; end if;
  if p_format not in ('csv','excel') then raise exception 'Invalid export format'; end if;
  insert into public.lead_sync_runs(company_id,provider,status,imported_count,filters,started_by,completed_at)
  values(p_company_id,case when p_format='csv' then 'csv_export' else 'excel_export' end,'success',greatest(coalesce(p_row_count,0),0),coalesce(p_filters,'{}'::jsonb),auth.uid(),now()) returning id into v_run;
  perform public.portal_write_audit(p_company_id,v_role,auth.uid(),coalesce((select display_name from public.profiles where id=auth.uid()),'User'),
    case when p_format='csv' then 'csv_exported' else 'excel_exported' end,'lead_export',v_run,null,jsonb_build_object('row_count',greatest(coalesce(p_row_count,0),0)),coalesce(p_filters,'{}'::jsonb));
  return v_run;
end;
$$;

-- Normalized import rows are produced only after the client-side mapping preview.
-- Explicit external IDs update their matching lead. Heuristic matches are logged
-- as conflicts and are never silently overwritten.
create or replace function public.company_import_leads(
  p_company_id uuid,p_provider text,p_rows jsonb,p_mode text default 'upsert'
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_role text; v_run uuid; v_row jsonb; v_num integer:=0; v_imported integer:=0; v_updated integer:=0; v_skipped integer:=0; v_failed integer:=0;
  v_external text; v_key text; v_existing public.portal_leads%rowtype; v_lead public.portal_leads%rowtype; v_appt public.portal_appointments%rowtype;
  v_date date; v_time time; v_package uuid; v_error text;
begin
  v_role:=public.readyops_company_management_role(p_company_id);
  if v_role not in ('admin','manager','company') then raise exception 'Import permission required'; end if;
  if v_role='company' and not exists(select 1 from public.company_user_access cua where cua.company_id=p_company_id and cua.user_id=auth.uid() and cua.can_import_leads) then raise exception 'Import permission required'; end if;
  if p_provider not in ('google_sheets','excel') then raise exception 'Invalid import provider'; end if;
  if p_mode not in ('insert_only','upsert') or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)>5000 then raise exception 'Invalid import payload'; end if;
  insert into public.lead_sync_runs(company_id,provider,status,started_by) values(p_company_id,p_provider,'running',auth.uid()) returning id into v_run;
  v_package:=public.portal_active_package(p_company_id);

  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_num:=v_num+1; v_error:=null; v_existing:=null; v_lead:=null; v_appt:=null;
    begin
      v_external:=nullif(trim(v_row->>'external_id'),'');
      v_date:=nullif(v_row->>'appointment_date','')::date;
      v_time:=nullif(v_row->>'appointment_time','')::time;
      if nullif(trim(v_row->>'full_name'),'') is null or nullif(regexp_replace(coalesce(v_row->>'phone',''),'\\D','','g'),'') is null or nullif(trim(v_row->>'address'),'') is null or v_date is null or v_time is null then
        raise exception 'Missing required name, phone, address, appointment date, or appointment time';
      end if;
      v_key:=case when v_external is not null then 'ext:'||md5(p_provider||':'||v_external)
        else 'norm:'||md5(regexp_replace(coalesce(v_row->>'phone',''),'\\D','','g')||'|'||lower(trim(v_row->>'address'))||'|'||v_date::text||'|'||v_time::text) end;
      select * into v_existing from public.portal_leads l where l.company_id=p_company_id and l.import_dedupe_key=v_key for update;
      if v_existing.id is not null then
        if v_external is null or p_mode='insert_only' then
          insert into public.lead_sync_conflicts(company_id,sync_run_id,row_number,duplicate_key,existing_lead_id,reason,incoming_data)
          values(p_company_id,v_run,v_num,v_key,v_existing.id,'Possible duplicate requires review',v_row);
          v_skipped:=v_skipped+1; continue;
        end if;
        update public.portal_leads set
          full_name=coalesce(nullif(trim(v_row->>'full_name'),''),full_name),phone_number=coalesce(nullif(trim(v_row->>'phone'),''),phone_number),
          address=coalesce(nullif(trim(v_row->>'address'),''),address),city=coalesce(nullif(trim(v_row->>'city'),''),city),state=coalesce(nullif(trim(v_row->>'state'),''),state),
          zip_code=coalesce(nullif(trim(v_row->>'zip'),''),zip_code),email=coalesce(nullif(trim(v_row->>'email'),''),email),service_needed=coalesce(nullif(trim(v_row->>'service_needed'),''),service_needed),
          notes=coalesce(nullif(trim(v_row->>'notes'),''),notes),updated_at=now()
        where id=v_existing.id returning * into v_lead;
        update public.portal_appointments set appointment_date=v_date,start_time=v_time,end_time=(v_time+interval '1 hour')::time,updated_at=now()
          where lead_id=v_existing.id and company_id=p_company_id returning * into v_appt;
        v_updated:=v_updated+1;
      else
        insert into public.portal_leads(company_id,package_id,agent_name,service_needed,full_name,phone_number,address,city,state,zip_code,email,notes,qualification_status,qc_status,source,source_lead_id,import_dedupe_key)
        values(p_company_id,v_package,'Spreadsheet Import',nullif(trim(v_row->>'service_needed'),''),trim(v_row->>'full_name'),trim(v_row->>'phone'),trim(v_row->>'address'),
          nullif(trim(v_row->>'city'),''),nullif(trim(v_row->>'state'),''),nullif(trim(v_row->>'zip'),''),nullif(trim(v_row->>'email'),''),nullif(trim(v_row->>'notes'),''),'qualified','approved',p_provider,null,v_key)
        returning * into v_lead;
        insert into public.portal_appointments(lead_id,company_id,appointment_date,start_time,end_time,timezone,status,company_visible_at,canonical_status)
        values(v_lead.id,p_company_id,v_date,v_time,(v_time+interval '1 hour')::time,coalesce((select timezone from public.company_portal_settings where company_id=p_company_id),'America/Chicago'),'confirmed',now(),'confirmed')
        returning * into v_appt;
        v_imported:=v_imported+1;
      end if;
    exception when others then
      get stacked diagnostics v_error=message_text;
      v_failed:=v_failed+1;
      insert into public.lead_sync_conflicts(company_id,sync_run_id,row_number,duplicate_key,existing_lead_id,reason,incoming_data)
      values(p_company_id,v_run,v_num,v_key,v_existing.id,coalesce(v_error,'Import failed'),v_row);
    end;
  end loop;
  update public.lead_sync_runs set status=case when v_failed=0 then 'success' when v_imported+v_updated>0 then 'partial' else 'failed' end,
    imported_count=v_imported,updated_count=v_updated,skipped_count=v_skipped,failed_count=v_failed,completed_at=now(),error_summary=case when v_failed>0 then v_failed||' row(s) failed' else null end
  where id=v_run;
  perform public.portal_write_audit(p_company_id,v_role,auth.uid(),coalesce((select display_name from public.profiles where id=auth.uid()),'User'),
    p_provider||'_sync','lead_sync',v_run,null,jsonb_build_object('imported',v_imported,'updated',v_updated,'skipped',v_skipped,'failed',v_failed),'{}'::jsonb);
  return jsonb_build_object('run_id',v_run,'imported',v_imported,'updated',v_updated,'skipped',v_skipped,'failed',v_failed);
end;
$$;

-- Company logos are public-facing brand assets, but authenticated writes are
-- constrained to the user's authorized company-id folder.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('company-logos','company-logos',true,5242880,array['image/png','image/jpeg','image/webp'])
on conflict(id) do update set public=excluded.public,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists company_logos_insert on storage.objects;
create policy company_logos_insert on storage.objects for insert to authenticated
with check (bucket_id='company-logos' and (storage.foldername(name))[1] is not null and public.user_can_access_company(((storage.foldername(name))[1])::uuid));
drop policy if exists company_logos_update on storage.objects;
create policy company_logos_update on storage.objects for update to authenticated
using (bucket_id='company-logos' and public.user_can_access_company(((storage.foldername(name))[1])::uuid))
with check (bucket_id='company-logos' and public.user_can_access_company(((storage.foldername(name))[1])::uuid));
drop policy if exists company_logos_delete on storage.objects;
create policy company_logos_delete on storage.objects for delete to authenticated
using (bucket_id='company-logos' and public.user_can_access_company(((storage.foldername(name))[1])::uuid));

-- Execute privileges are explicit. Public token-management functions remain
-- unchanged for legacy agent/representative pages, but the v2 company page uses
-- only these authenticated functions.
revoke all on function public.get_company_management_v2(uuid,date,date) from public,anon;
revoke all on function public.get_company_management_v2_by_slug(text,date,date) from public,anon;
revoke all on function public.company_set_logo_path(uuid,text) from public,anon;
revoke all on function public.company_create_package_v2(uuid,jsonb,boolean) from public,anon;
revoke all on function public.company_update_package_v2(uuid,uuid,jsonb) from public,anon;
revoke all on function public.company_update_canonical_status(uuid,uuid,text,date,time,text) from public,anon;
revoke all on function public.company_record_export(uuid,text,jsonb,integer) from public,anon;
revoke all on function public.company_import_leads(uuid,text,jsonb,text) from public,anon;
grant execute on function public.get_company_management_v2(uuid,date,date) to authenticated;
grant execute on function public.get_company_management_v2_by_slug(text,date,date) to authenticated;
grant execute on function public.company_set_logo_path(uuid,text) to authenticated;
grant execute on function public.company_create_package_v2(uuid,jsonb,boolean) to authenticated;
grant execute on function public.company_update_package_v2(uuid,uuid,jsonb) to authenticated;
grant execute on function public.company_update_canonical_status(uuid,uuid,text,date,time,text) to authenticated;
grant execute on function public.company_record_export(uuid,text,jsonb,integer) to authenticated;
grant execute on function public.company_import_leads(uuid,text,jsonb,text) to authenticated;



