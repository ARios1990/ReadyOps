create or replace function public.save_readyops_payroll_entry(
  p_entry_id uuid,
  p_pay_structure text,
  p_hours numeric,
  p_base_pay numeric,
  p_hourly_rate numeric,
  p_lead_rate numeric,
  p_signed_contract_rate numeric,
  p_bonus numeric,
  p_deductions numeric,
  p_notes text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_agent_id uuid;
  v_period_status text;
begin
  if not public.is_admin() then
    raise exception 'Admin access required';
  end if;

  if p_pay_structure not in ('commission_only', 'base_only', 'base_plus_commission', 'hourly') then
    raise exception 'Invalid pay structure';
  end if;

  if least(
    coalesce(p_hours, 0),
    coalesce(p_base_pay, 0),
    coalesce(p_hourly_rate, 0),
    coalesce(p_lead_rate, 0),
    coalesce(p_signed_contract_rate, 0),
    coalesce(p_bonus, 0),
    coalesce(p_deductions, 0)
  ) < 0 then
    raise exception 'Payroll values cannot be negative';
  end if;

  select pe.agent_id, pp.status
    into v_agent_id, v_period_status
  from public.payroll_entries pe
  join public.payroll_periods pp on pp.id = pe.payroll_period_id
  where pe.id = p_entry_id
  for update of pe;

  if v_agent_id is null then
    raise exception 'Payroll entry not found';
  end if;

  if v_period_status = 'locked' then
    raise exception 'This payroll period is locked';
  end if;

  update public.payroll_entries
  set pay_structure = p_pay_structure,
      hours = coalesce(p_hours, 0),
      base_pay = coalesce(p_base_pay, 0),
      hourly_rate = coalesce(p_hourly_rate, 0),
      lead_rate = coalesce(p_lead_rate, 0),
      signed_contract_rate = coalesce(p_signed_contract_rate, 0),
      bonus = coalesce(p_bonus, 0),
      deductions = coalesce(p_deductions, 0),
      notes = nullif(btrim(coalesce(p_notes, '')), ''),
      updated_at = now()
  where id = p_entry_id;

  update public.agents
  set pay_structure = p_pay_structure,
      weekly_base = coalesce(p_base_pay, 0),
      hourly_rate = coalesce(p_hourly_rate, 0),
      payroll_lead_rate = coalesce(p_lead_rate, 0),
      payroll_signed_contract_rate = coalesce(p_signed_contract_rate, 0)
  where id = v_agent_id;
end;
$$;

revoke all on function public.save_readyops_payroll_entry(
  uuid, text, numeric, numeric, numeric, numeric, numeric, numeric, numeric, text
) from public, anon;

grant execute on function public.save_readyops_payroll_entry(
  uuid, text, numeric, numeric, numeric, numeric, numeric, numeric, numeric, text
) to authenticated;
