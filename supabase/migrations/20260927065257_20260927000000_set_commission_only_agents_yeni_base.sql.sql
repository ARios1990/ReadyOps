/*
  # Set all agents to commission-only $450, keep Yeni on $4250 base

  1. Agent Pay Structure Changes
     - Every agent in `public.agents` is switched to `commission_only` with
       `payroll_lead_rate = 450` (paid for every good/qualified lead OR signed
       contract; a signed contract already counts as a good lead in the payroll
       generator, so `payroll_signed_contract_rate` stays at 0 to avoid double-
       paying the same lead).
     - `weekly_base` and `hourly_rate` cleared to 0.
     - Exception: `Yeni-MSR` stays on `base_only` with `weekly_base = 4250`.

  2. Payroll Entry Sync
     - All payroll entries in periods whose status is NOT `locked` are refreshed
       to mirror the new agent pay structure, so any open week reflects the new
       comp plan immediately. Locked periods are left untouched to preserve
       historical payroll integrity.

  Notes
     1. No columns are dropped or renamed — data updates only.
     2. Yeni matching is case-insensitive (`lower(name) = 'yeni-msr'`).
     3. Migration is idempotent and safe to re-run.
*/

update public.agents
set pay_structure = 'commission_only',
    weekly_base = 0,
    hourly_rate = 0,
    payroll_lead_rate = 450,
    payroll_signed_contract_rate = 0
where lower(name) <> 'yeni-msr';

update public.agents
set pay_structure = 'base_only',
    weekly_base = 4250,
    hourly_rate = 0,
    payroll_lead_rate = 0,
    payroll_signed_contract_rate = 0
where lower(name) = 'yeni-msr';

update public.payroll_entries pe
set pay_structure = a.pay_structure,
    base_pay = a.weekly_base,
    hourly_rate = a.hourly_rate,
    lead_rate = a.payroll_lead_rate,
    signed_contract_rate = a.payroll_signed_contract_rate,
    updated_at = now()
from public.agents a,
     public.payroll_periods pp
where pe.agent_id = a.id
  and pp.id = pe.payroll_period_id
  and pp.status <> 'locked';
