import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

const db=new PGlite();
await db.exec(`
create role anon;
create role authenticated;
create schema private;
create schema auth;
create function public.get_admin_lead_crm_by_agent(
  p_search text default null, p_company_id uuid default null, p_qc_status text default null,
  p_client_status text default null, p_source text default null, p_date_basis text default 'received',
  p_start_date date default null, p_end_date date default null, p_limit integer default 50,
  p_offset integer default 0, p_team_id uuid default null, p_agent_id uuid default null
) returns jsonb language plpgsql stable security definer set search_path to '' as $function$
begin
  return (
    with base(client_status,canonical_status,sales_outcome,invoice_line_total,amount_per_lead) as (
      values
        ('good', 'pending', 'pending', null::numeric, 10::numeric),
        ('pending', 'good_inspected', 'pending', null::numeric, 10::numeric),
        ('bad', 'pending', 'pending', null::numeric, 10::numeric),
        ('pending', 'bad', 'pending', null::numeric, 10::numeric),
        ('signed_contract', 'signed_contract', 'signed_contract', null::numeric, 10::numeric)
    )
    select jsonb_build_object('summary', (
      select jsonb_build_object(
          'signed_contracts', count(*) FILTER (WHERE sales_outcome = 'signed_contract' OR canonical_status = 'signed_contract'),
          'revenue', coalesce(sum(coalesce(invoice_line_total, amount_per_lead, 0)), 0)
        ) FROM base
    ))
  );
end;
$function$;
`);

const migration=fs.readFileSync(new URL('../supabase/migrations/20261030191649_admin_crm_good_bad_metrics.sql',import.meta.url),'utf8');
await db.exec(migration);
await db.exec(migration);
const signature=`null,null,null,null,null,'received',null,null,50,0,null,null`;
const result=(await db.query(`select public.get_admin_lead_crm_by_agent(${signature}) value`)).rows[0].value;
assert.equal(Number(result.summary.good),2);
assert.equal(Number(result.summary.bad),2);
assert.equal(Number(result.summary.signed_contracts),1);
assert.equal(Number(result.summary.revenue),50);
await db.close();
console.log('PASS Admin CRM Good and Bad summary totals, canonical fallbacks, and idempotent migration');
