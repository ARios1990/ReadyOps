-- Imported from the hosted ReadyOp Supabase migration history on 2026-08-28.
-- Schema only: no production table data is included.

create sequence if not exists public.readyops_invoice_seq start 1001;

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_number text not null unique default ('INV-' || to_char(current_date,'YYYYMM') || '-' || lpad(nextval('public.readyops_invoice_seq')::text,5,'0')),
  company_id uuid not null references public.roster_companies(id) on delete restrict,
  period_start date not null,
  period_end date not null,
  billing_type text not null default 'per_lead' check (billing_type in ('package_upfront','weekly_pay','per_lead','signed_contract','flat_fee','percentage')),
  billable_leads integer not null default 0 check (billable_leads >= 0),
  rate numeric(12,2) not null default 0 check (rate >= 0),
  additional_charges numeric(12,2) not null default 0,
  discount numeric(12,2) not null default 0 check (discount >= 0),
  subtotal numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  amount_paid numeric(12,2) not null default 0 check (amount_paid >= 0),
  balance numeric(12,2) generated always as (greatest(total - amount_paid, 0::numeric)) stored,
  due_date date,
  status text not null default 'draft' check (status in ('draft','sent','partial','paid','overdue','void')),
  internal_notes text,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (period_end >= period_start)
);

create table if not exists public.invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  lead_id uuid references public.portal_leads(id) on delete restrict,
  description text not null default 'Billable Lead',
  quantity numeric(12,2) not null default 1 check (quantity >= 0),
  unit_rate numeric(12,2) not null default 0 check (unit_rate >= 0),
  line_total numeric(12,2) generated always as (quantity * unit_rate) stored,
  created_at timestamptz not null default now()
);

create unique index if not exists invoice_items_unique_lead on public.invoice_items(lead_id) where lead_id is not null;
create index if not exists invoices_company_period_idx on public.invoices(company_id, period_start, period_end);
create index if not exists invoice_items_invoice_idx on public.invoice_items(invoice_id);

create table if not exists public.invoice_payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  amount numeric(12,2) not null check (amount > 0),
  payment_date date not null default current_date,
  method text,
  reference text,
  notes text,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists invoice_payments_invoice_idx on public.invoice_payments(invoice_id);

create table if not exists public.payroll_periods (
  id uuid primary key default gen_random_uuid(),
  week_start date not null unique,
  week_end date not null,
  status text not null default 'draft' check (status in ('draft','review','approved','paid','locked')),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  paid_at timestamptz,
  locked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (week_end = week_start + 6)
);

create table if not exists public.payroll_entries (
  id uuid primary key default gen_random_uuid(),
  payroll_period_id uuid not null references public.payroll_periods(id) on delete cascade,
  agent_id uuid not null references public.agents(id) on delete restrict,
  team_id uuid references public.teams(id) on delete set null,
  hours numeric(8,2) not null default 0 check (hours >= 0),
  qualified_leads integer not null default 0 check (qualified_leads >= 0),
  signed_contracts integer not null default 0 check (signed_contracts >= 0),
  base_pay numeric(12,2) not null default 0,
  lead_rate numeric(12,2) not null default 0,
  signed_contract_rate numeric(12,2) not null default 0,
  bonus numeric(12,2) not null default 0,
  deductions numeric(12,2) not null default 0,
  total_pay numeric(12,2) generated always as (
    greatest(base_pay + (qualified_leads * lead_rate) + (signed_contracts * signed_contract_rate) + bonus - deductions, 0::numeric)
  ) stored,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(payroll_period_id, agent_id)
);
create index if not exists payroll_entries_period_idx on public.payroll_entries(payroll_period_id);
create index if not exists payroll_entries_agent_idx on public.payroll_entries(agent_id);

alter table public.invoices enable row level security;
alter table public.invoice_items enable row level security;
alter table public.invoice_payments enable row level security;
alter table public.payroll_periods enable row level security;
alter table public.payroll_entries enable row level security;

do $$ begin
  create policy invoices_admin_all on public.invoices for all to authenticated using (public.is_admin()) with check (public.is_admin());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy invoice_items_admin_all on public.invoice_items for all to authenticated using (public.is_admin()) with check (public.is_admin());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy invoice_payments_admin_all on public.invoice_payments for all to authenticated using (public.is_admin()) with check (public.is_admin());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy payroll_periods_admin_all on public.payroll_periods for all to authenticated using (public.is_admin()) with check (public.is_admin());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy payroll_entries_admin_all on public.payroll_entries for all to authenticated using (public.is_admin()) with check (public.is_admin());
exception when duplicate_object then null; end $$;

grant select,insert,update,delete on public.invoices, public.invoice_items, public.invoice_payments, public.payroll_periods, public.payroll_entries to authenticated;
grant usage,select on sequence public.readyops_invoice_seq to authenticated;

create or replace function public.create_readyops_invoice(
  p_company_id uuid,
  p_period_start date,
  p_period_end date,
  p_billing_type text default 'per_lead',
  p_rate numeric default 0,
  p_additional_charges numeric default 0,
  p_discount numeric default 0,
  p_due_date date default null
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_invoice_id uuid;
  v_count integer := 0;
  v_subtotal numeric := 0;
  v_total numeric := 0;
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  if p_period_end < p_period_start then raise exception 'Invalid billing period'; end if;
  if p_billing_type not in ('package_upfront','weekly_pay','per_lead','signed_contract','flat_fee','percentage') then raise exception 'Invalid billing type'; end if;

  select count(*) into v_count
  from public.portal_appointments ap
  join public.portal_leads l on l.id = ap.lead_id
  where ap.company_id = p_company_id
    and ap.appointment_date between p_period_start and p_period_end
    and l.qc_status = 'approved'
    and ap.client_status in ('good','signed_contract')
    and not exists (select 1 from public.invoice_items ii where ii.lead_id = l.id);

  if p_billing_type in ('per_lead','weekly_pay') then
    v_subtotal := v_count * coalesce(p_rate,0);
  elsif p_billing_type = 'signed_contract' then
    select count(*) * coalesce(p_rate,0) into v_subtotal
    from public.portal_appointments ap
    join public.portal_leads l on l.id = ap.lead_id
    where ap.company_id = p_company_id
      and ap.appointment_date between p_period_start and p_period_end
      and l.qc_status='approved'
      and ap.client_status='signed_contract'
      and not exists (select 1 from public.invoice_items ii where ii.lead_id=l.id);
  else
    v_subtotal := coalesce(p_rate,0);
  end if;

  v_total := greatest(v_subtotal + coalesce(p_additional_charges,0) - coalesce(p_discount,0),0);

  insert into public.invoices(company_id,period_start,period_end,billing_type,billable_leads,rate,additional_charges,discount,subtotal,total,due_date)
  values(p_company_id,p_period_start,p_period_end,p_billing_type,v_count,coalesce(p_rate,0),coalesce(p_additional_charges,0),coalesce(p_discount,0),v_subtotal,v_total,p_due_date)
  returning id into v_invoice_id;

  if p_billing_type in ('per_lead','weekly_pay') then
    insert into public.invoice_items(invoice_id,lead_id,description,quantity,unit_rate)
    select v_invoice_id,l.id,'Billable Lead ' || l.lead_code,1,coalesce(p_rate,0)
    from public.portal_appointments ap join public.portal_leads l on l.id=ap.lead_id
    where ap.company_id=p_company_id and ap.appointment_date between p_period_start and p_period_end
      and l.qc_status='approved' and ap.client_status in ('good','signed_contract')
      and not exists(select 1 from public.invoice_items ii where ii.lead_id=l.id);
  elsif p_billing_type='signed_contract' then
    insert into public.invoice_items(invoice_id,lead_id,description,quantity,unit_rate)
    select v_invoice_id,l.id,'Signed Contract ' || l.lead_code,1,coalesce(p_rate,0)
    from public.portal_appointments ap join public.portal_leads l on l.id=ap.lead_id
    where ap.company_id=p_company_id and ap.appointment_date between p_period_start and p_period_end
      and l.qc_status='approved' and ap.client_status='signed_contract'
      and not exists(select 1 from public.invoice_items ii where ii.lead_id=l.id);
  end if;

  return v_invoice_id;
end;
$$;
grant execute on function public.create_readyops_invoice(uuid,date,date,text,numeric,numeric,numeric,date) to authenticated;

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
  if not public.is_admin() then raise exception 'Admin access required'; end if;

  insert into public.payroll_periods(week_start,week_end)
  values(v_start,v_start+6)
  on conflict(week_start) do update set updated_at=now()
  returning id into v_period;

  insert into public.payroll_entries(payroll_period_id,agent_id,team_id,qualified_leads,signed_contracts)
  select v_period,a.id,a.team_id,
    count(*) filter (where l.qc_status='approved' and ap.client_status in ('good','signed_contract'))::int,
    count(*) filter (where l.qc_status='approved' and ap.client_status='signed_contract')::int
  from public.agents a
  left join public.portal_leads l on l.agent_id=a.id
  left join public.portal_appointments ap on ap.lead_id=l.id and ap.appointment_date between v_start and v_start+6
  where a.active=true
  group by a.id,a.team_id
  on conflict(payroll_period_id,agent_id) do update
    set team_id=excluded.team_id,
        qualified_leads=excluded.qualified_leads,
        signed_contracts=excluded.signed_contracts,
        updated_at=now();

  return v_period;
end;
$$;
grant execute on function public.generate_readyops_payroll_week(date) to authenticated;

