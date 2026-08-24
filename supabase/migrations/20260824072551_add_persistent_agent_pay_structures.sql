alter table public.agents
  add column if not exists pay_structure text not null default 'commission_only',
  add column if not exists weekly_base numeric(12,2) not null default 0,
  add column if not exists hourly_rate numeric(12,2) not null default 0,
  add column if not exists payroll_lead_rate numeric(12,2) not null default 0,
  add column if not exists payroll_signed_contract_rate numeric(12,2) not null default 0;

alter table public.payroll_entries
  add column if not exists pay_structure text not null default 'commission_only',
  add column if not exists hourly_rate numeric(12,2) not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'agents_pay_structure_check'
  ) then
    alter table public.agents
      add constraint agents_pay_structure_check
      check (pay_structure in ('commission_only', 'base_only', 'base_plus_commission', 'hourly'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'agents_pay_rates_nonnegative_check'
  ) then
    alter table public.agents
      add constraint agents_pay_rates_nonnegative_check
      check (
        weekly_base >= 0
        and hourly_rate >= 0
        and payroll_lead_rate >= 0
        and payroll_signed_contract_rate >= 0
      );
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'payroll_entries_pay_structure_check'
  ) then
    alter table public.payroll_entries
      add constraint payroll_entries_pay_structure_check
      check (pay_structure in ('commission_only', 'base_only', 'base_plus_commission', 'hourly'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'payroll_entries_hourly_rate_nonnegative_check'
  ) then
    alter table public.payroll_entries
      add constraint payroll_entries_hourly_rate_nonnegative_check
      check (hourly_rate >= 0);
  end if;
end
$$;

update public.agents a
set pay_structure = 'base_only',
    weekly_base = 450,
    hourly_rate = 0,
    payroll_lead_rate = 0,
    payroll_signed_contract_rate = 0
from public.teams t
where a.team_id = t.id
  and upper(t.name) in ('MSR', 'BRL');

update public.agents
set pay_structure = 'base_only',
    weekly_base = 4000,
    hourly_rate = 0,
    payroll_lead_rate = 0,
    payroll_signed_contract_rate = 0
where lower(name) in ('dopey-msr', 'yeni-msr');

update public.agents
set pay_structure = 'commission_only',
    weekly_base = 0,
    hourly_rate = 0,
    payroll_lead_rate = 500,
    payroll_signed_contract_rate = 0
where lower(name) = 'leah-msr';

update public.payroll_entries pe
set pay_structure = a.pay_structure,
    base_pay = a.weekly_base,
    hourly_rate = a.hourly_rate,
    lead_rate = a.payroll_lead_rate,
    signed_contract_rate = a.payroll_signed_contract_rate,
    updated_at = now()
from public.agents a
join public.payroll_periods pp on pp.id = pe.payroll_period_id
where pe.agent_id = a.id
  and pp.status <> 'locked';

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'payroll_entries'
      and column_name = 'total_pay'
  ) and not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'payroll_entries'
      and column_name = 'total_pay_legacy'
  ) then
    alter table public.payroll_entries rename column total_pay to total_pay_legacy;
  end if;
end
$$;

alter table public.payroll_entries
  add column if not exists total_pay numeric generated always as (
    greatest(
      case pay_structure
        when 'commission_only' then
          qualified_leads * lead_rate + signed_contracts * signed_contract_rate
        when 'base_only' then
          base_pay
        when 'base_plus_commission' then
          base_pay + qualified_leads * lead_rate + signed_contracts * signed_contract_rate
        when 'hourly' then
          hours * hourly_rate
        else 0
      end + bonus - deductions,
      0
    )
  ) stored;

comment on column public.agents.pay_structure is
  'Payroll mode: commission_only, base_only, base_plus_commission, or hourly.';
comment on column public.agents.weekly_base is
  'Default weekly base copied into newly generated payroll entries.';
comment on column public.payroll_entries.total_pay_legacy is
  'Previous generated total retained for migration compatibility.';
comment on column public.payroll_entries.total_pay is
  'Generated total that respects the selected pay structure.';

create or replace function public.generate_readyops_payroll_week(p_date date default current_date)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_start date := p_date - extract(dow from p_date)::int;
  v_period uuid;
begin
  if not public.is_admin() then
    raise exception 'Admin access required';
  end if;

  insert into public.payroll_periods(week_start, week_end)
  values (v_start, v_start + 6)
  on conflict (week_start) do update set updated_at = now()
  returning id into v_period;

  insert into public.payroll_entries(
    payroll_period_id,
    agent_id,
    team_id,
    qualified_leads,
    signed_contracts,
    pay_structure,
    base_pay,
    hourly_rate,
    lead_rate,
    signed_contract_rate
  )
  select
    v_period,
    a.id,
    a.team_id,
    count(distinct l.id) filter (
      where l.qc_status = 'approved'
        and ap.client_status in ('good', 'signed_contract')
    )::int,
    count(distinct l.id) filter (
      where l.qc_status = 'approved'
        and ap.client_status = 'signed_contract'
    )::int,
    a.pay_structure,
    a.weekly_base,
    a.hourly_rate,
    a.payroll_lead_rate,
    a.payroll_signed_contract_rate
  from public.agents a
  left join public.portal_leads l on l.agent_id = a.id
  left join public.portal_appointments ap
    on ap.lead_id = l.id
   and ap.appointment_date between v_start and v_start + 6
  where a.active = true
  group by
    a.id,
    a.team_id,
    a.pay_structure,
    a.weekly_base,
    a.hourly_rate,
    a.payroll_lead_rate,
    a.payroll_signed_contract_rate
  on conflict (payroll_period_id, agent_id) do update
    set team_id = excluded.team_id,
        qualified_leads = excluded.qualified_leads,
        signed_contracts = excluded.signed_contracts,
        updated_at = now();

  return v_period;
end;
$$;

revoke all on function public.generate_readyops_payroll_week(date) from public, anon;
grant execute on function public.generate_readyops_payroll_week(date) to authenticated;
