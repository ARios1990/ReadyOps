-- Imported from the hosted ReadyOp Supabase migration history on 2026-08-28.
-- Schema only: no production table data is included.

create or replace function public.readyops_delivered_lead_count(p_package_id uuid)
returns integer
language sql
stable
security definer
set search_path=public,pg_temp
as $$
  select count(distinct l.id)::integer
  from public.portal_leads l
  join public.portal_appointments a on a.lead_id=l.id and a.company_id=l.company_id
  where l.package_id=p_package_id
    and l.qc_status='approved'
    and a.company_visible_at is not null;
$$;
revoke all on function public.readyops_delivered_lead_count(uuid) from public,anon;
grant execute on function public.readyops_delivered_lead_count(uuid) to authenticated;

create or replace function public.portal_complete_package_if_filled(p_package_id uuid)
returns void
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare v_target integer; v_count integer;
begin
  if p_package_id is null then return; end if;
  select lead_target into v_target from public.company_packages where id=p_package_id and status='active';
  if v_target is null then return; end if;
  v_count:=public.readyops_delivered_lead_count(p_package_id);
  if v_count>=v_target then
    update public.company_packages set status='completed',completed_at=coalesce(completed_at,now()),updated_at=now()
    where id=p_package_id and status='active';
  end if;
end;
$$;

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
        'leads_delivered',public.readyops_delivered_lead_count(cp.id),
        'leads_remaining',greatest(cp.lead_target-public.readyops_delivered_lead_count(cp.id),0),
        'completion_percentage',case when cp.lead_target=0 then 0 else round(least(public.readyops_delivered_lead_count(cp.id)::numeric/cp.lead_target*100,100),1) end
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
    v_delivered:=public.readyops_delivered_lead_count(v_active.id);
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


