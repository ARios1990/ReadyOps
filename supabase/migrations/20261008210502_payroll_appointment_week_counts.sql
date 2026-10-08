BEGIN;
ALTER TABLE public.payroll_entries ADD COLUMN IF NOT EXISTS days_worked integer NOT NULL DEFAULT 0 CHECK (days_worked BETWEEN 0 AND 7);

CREATE OR REPLACE FUNCTION private.readyops_payroll_week_counts(p_start date,p_end date)
RETURNS TABLE(agent_id uuid,total_leads integer,qc_approved integer,good_leads integer,signed_contracts integer,successful_leads integer,bad_leads integer,no_show_leads integer,qc_denied integer,rescheduled integer,pending_leads integer,needs_correction integer)
LANGUAGE sql STABLE SET search_path='' AS $$
 WITH weekly AS (
 SELECT l.id,coalesce(l.agent_id,matched.agent_id) agent_id,coalesce(q.status,l.qc_status,'pending') qc,
 CASE
 WHEN normalized.status IN ('signed_contract','signed','signed_claim_filed') THEN 'signed_contract'
 WHEN normalized.status IN ('good','good_inspected','inspected','inspection_completed','completed') THEN 'good'
 WHEN normalized.status IN ('bad','lost','cancelled','canceled','homeowner_cancelled') THEN 'bad'
 WHEN normalized.status IN ('no_show','homeowner_no_show') THEN 'no_show'
 WHEN normalized.status IN ('rescheduled','reschedule') THEN 'rescheduled'
 ELSE 'pending' END outcome
 FROM public.portal_leads l
 JOIN LATERAL (SELECT ap.* FROM public.portal_appointments ap WHERE ap.lead_id=l.id ORDER BY ap.created_at DESC,ap.id DESC LIMIT 1) ap ON true
 LEFT JOIN public.qc_review_cycles q ON q.lead_id=l.id AND q.is_current
 LEFT JOIN LATERAL (
 WITH candidates AS (SELECT a.id,CASE WHEN lower(trim(a.name))=lower(trim(l.agent_name)) THEN 0 ELSE 1 END rank
 FROM public.agents a LEFT JOIN public.teams t ON t.id=a.team_id
 WHERE lower(trim(a.name))=lower(trim(l.agent_name)) OR (
 regexp_replace(lower(trim(a.name)),'-(msr|brl|octo|woo)$','')=regexp_replace(lower(trim(l.agent_name)),'-(msr|brl|octo|woo)$','')
 AND (lower(trim(l.agent_name)) !~ '-(msr|brl|octo|woo)$' OR lower(t.abbreviation)=substring(lower(trim(l.agent_name)) from '-(msr|brl|octo|woo)$'))))
 SELECT (array_agg(id))[1] agent_id FROM candidates WHERE rank=(SELECT min(rank) FROM candidates) HAVING count(*)=1
 ) matched ON l.agent_id IS NULL
 CROSS JOIN LATERAL (SELECT regexp_replace(lower(trim(coalesce(
 nullif(nullif(ap.canonical_status,'pending'),'confirmed'),nullif(ap.client_status,'pending'),
 nullif(ap.company_action,'pending'),nullif(ap.sales_outcome,'pending'),ap.status,'pending'))),'[[:space:]/-]+','_','g') status) normalized
 WHERE ap.appointment_date BETWEEN p_start AND p_end
 ), categorized AS (
 SELECT *,CASE WHEN qc='denied' THEN 'qc_denied' WHEN qc='needs_correction' THEN 'needs_correction'
 WHEN qc<>'approved' THEN 'pending' ELSE outcome END category FROM weekly
 )
 SELECT w.agent_id,count(*)::int,count(*) FILTER(WHERE qc='approved')::int,
 count(*) FILTER(WHERE category='good')::int,count(*) FILTER(WHERE category='signed_contract')::int,
 count(*) FILTER(WHERE category IN ('good','signed_contract'))::int,
 count(*) FILTER(WHERE category='bad')::int,count(*) FILTER(WHERE category='no_show')::int,
 count(*) FILTER(WHERE category='qc_denied')::int,count(*) FILTER(WHERE category='rescheduled')::int,
 count(*) FILTER(WHERE category='pending')::int,count(*) FILTER(WHERE category='needs_correction')::int
 FROM categorized w GROUP BY w.agent_id;
$$;
REVOKE ALL ON FUNCTION private.readyops_payroll_week_counts(date,date) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.get_readyops_payroll_entries(p_period_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 WITH week_counts AS MATERIALIZED (SELECT * FROM private.readyops_payroll_week_counts((SELECT week_start FROM public.payroll_periods WHERE id=p_period_id),(SELECT week_end FROM public.payroll_periods WHERE id=p_period_id))), rows AS (
 SELECT to_jsonb(pe)||jsonb_build_object('agent_name',a.name,'team_name',t.name,'team_abbreviation',t.abbreviation,
 'week_start',pp.week_start,'week_end',pp.week_end,'total_leads',coalesce(c.total_leads,0),'appointments',coalesce(c.total_leads,0),
 'unassigned_weekly_leads',CASE WHEN public.is_admin() THEN coalesce((SELECT total_leads FROM week_counts WHERE agent_id IS NULL),0) ELSE 0 END,
 'qc_approved',coalesce(c.qc_approved,0),'good_leads',coalesce(c.good_leads,0),'successful_leads',coalesce(c.successful_leads,0),
 'bad_leads',coalesce(c.bad_leads,0),'no_show_leads',coalesce(c.no_show_leads,0),'qc_denied',coalesce(c.qc_denied,0),
 'rescheduled',coalesce(c.rescheduled,0),'pending_leads',coalesce(c.pending_leads,0),'needs_correction',coalesce(c.needs_correction,0),
 'qualified_leads',CASE WHEN pe.status='pending' AND pp.status IN ('draft','review') THEN coalesce(c.successful_leads,0) ELSE pe.qualified_leads END,
 'signed_contracts',CASE WHEN pe.status='pending' AND pp.status IN ('draft','review') THEN coalesce(c.signed_contracts,0) ELSE pe.signed_contracts END) row_data,a.name
 FROM public.payroll_entries pe JOIN public.payroll_periods pp ON pp.id=pe.payroll_period_id
 JOIN public.agents a ON a.id=pe.agent_id LEFT JOIN public.teams t ON t.id=pe.team_id
 LEFT JOIN week_counts c ON c.agent_id=pe.agent_id
 WHERE pe.payroll_period_id=p_period_id AND private.readyops_can_manage_payroll(pe.team_id,pe.agent_id)
 )
 SELECT coalesce(jsonb_agg(row_data||jsonb_build_object('total_pay',greatest(0,
 CASE row_data->>'pay_structure'
 WHEN 'base_only' THEN (row_data->>'base_pay')::numeric
 WHEN 'hourly' THEN (row_data->>'hours')::numeric*(row_data->>'hourly_rate')::numeric
 ELSE CASE WHEN row_data->>'pay_structure'='base_plus_commission' THEN (row_data->>'base_pay')::numeric ELSE 0 END
 +(row_data->>'qualified_leads')::numeric*(row_data->>'lead_rate')::numeric
 +(row_data->>'signed_contracts')::numeric*(row_data->>'signed_contract_rate')::numeric END
 +(row_data->>'bonus')::numeric-(row_data->>'deductions')::numeric)) ORDER BY name),'[]'::jsonb) FROM rows;
$$;
REVOKE ALL ON FUNCTION public.get_readyops_payroll_entries(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_readyops_payroll_entries(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.generate_readyops_payroll_week(p_date date DEFAULT current_date) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_start date:=p_date-extract(dow from p_date)::int;v_period uuid;v_role text:=public.current_profile_role();v_team uuid:=public.current_team_id();
BEGIN
 IF v_role IS NULL OR v_role NOT IN ('admin','manager') OR (v_role='manager' AND v_team IS NULL) THEN RAISE EXCEPTION 'Assigned manager or admin required';END IF;
 IF p_date IS NULL THEN RAISE EXCEPTION 'Payroll date required';END IF;
 INSERT INTO public.payroll_periods(week_start,week_end) VALUES(v_start,v_start+6) ON CONFLICT(week_start) DO NOTHING;
 SELECT id INTO v_period FROM public.payroll_periods WHERE week_start=v_start FOR UPDATE;
 IF EXISTS(SELECT 1 FROM public.payroll_periods WHERE id=v_period AND status IN ('approved','paid','locked')) THEN RAISE EXCEPTION 'Approved, paid or locked payroll cannot be regenerated';END IF;
 INSERT INTO public.payroll_entries(payroll_period_id,agent_id,team_id,qualified_leads,signed_contracts,pay_structure,base_pay,hourly_rate,lead_rate,signed_contract_rate)
 SELECT v_period,a.id,a.team_id,coalesce(c.successful_leads,0),coalesce(c.signed_contracts,0),a.pay_structure,a.weekly_base,a.hourly_rate,a.payroll_lead_rate,a.payroll_signed_contract_rate
 FROM public.agents a LEFT JOIN private.readyops_payroll_week_counts(v_start,v_start+6) c ON c.agent_id=a.id
 WHERE (a.active OR c.total_leads>0) AND (v_role='admin' OR a.team_id=v_team)
 ON CONFLICT(payroll_period_id,agent_id) DO UPDATE SET qualified_leads=excluded.qualified_leads,signed_contracts=excluded.signed_contracts,updated_at=now()
 WHERE payroll_entries.status='pending' AND (v_role='admin' OR (payroll_entries.team_id=v_team AND excluded.team_id=v_team));
 RETURN v_period;
END $$;
REVOKE ALL ON FUNCTION public.generate_readyops_payroll_week(date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.generate_readyops_payroll_week(date) TO authenticated;
CREATE OR REPLACE FUNCTION public.save_readyops_team_payroll_entry(p_entry_id uuid, p_patch jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_entry public.payroll_entries; v_period public.payroll_periods; v_key text; v_value numeric;
begin
 select * into v_entry from public.payroll_entries where id=p_entry_id for update;
 if v_entry.id is null or not private.readyops_can_manage_payroll(v_entry.team_id,v_entry.agent_id) then raise exception 'Payroll entry unavailable'; end if;
 select * into v_period from public.payroll_periods where id=v_entry.payroll_period_id for update;
 if v_period.status='locked' or v_entry.status='paid' then raise exception 'Paid or locked payroll cannot be edited'; end if;
 if jsonb_typeof(p_patch)<>'object' or p_patch is null then raise exception 'Invalid payroll patch'; end if;
 for v_key in select jsonb_object_keys(p_patch) loop
   if v_key not in ('days_worked','pay_structure','hours','base_pay','hourly_rate','lead_rate','signed_contract_rate','bonus','deductions','notes','status','payment_date','save_defaults') then raise exception 'Invalid payroll field: %',v_key; end if;
   if v_key='save_defaults' and not public.is_admin() then raise exception 'Only Admins can update permanent pay defaults';end if;
   if v_key in ('hours','base_pay','hourly_rate','lead_rate','signed_contract_rate','bonus','deductions') then
     v_value:=(p_patch->>v_key)::numeric;
     if v_value is null or v_value<0 or v_value::text in ('NaN','Infinity','-Infinity') or v_value>10000000 then raise exception 'Invalid payroll amount'; end if;
   end if;
 end loop;
 if p_patch?'days_worked' and ((p_patch->>'days_worked')::numeric not between 0 and 7 or (p_patch->>'days_worked')::numeric <> trunc((p_patch->>'days_worked')::numeric)) then raise exception 'Days worked must be a whole number from 0 to 7'; end if;
 if p_patch?'pay_structure' and coalesce(p_patch->>'pay_structure','') not in ('commission_only','base_only','base_plus_commission','hourly') then raise exception 'Invalid pay structure'; end if;
 if p_patch?'status' and coalesce(p_patch->>'status','') not in ('pending','approved','paid') then raise exception 'Invalid payroll status'; end if;
 if p_patch->>'status'='paid' and nullif(p_patch->>'payment_date','') is null then raise exception 'Payment date is required for paid payroll'; end if;
 update public.payroll_entries set
 days_worked=coalesce((p_patch->>'days_worked')::integer,days_worked),
 qualified_leads=case when v_entry.status='pending' and v_period.status in ('draft','review') then coalesce((select successful_leads from private.readyops_payroll_week_counts(v_period.week_start,v_period.week_end) where agent_id=v_entry.agent_id),0) else qualified_leads end,
 signed_contracts=case when v_entry.status='pending' and v_period.status in ('draft','review') then coalesce((select signed_contracts from private.readyops_payroll_week_counts(v_period.week_start,v_period.week_end) where agent_id=v_entry.agent_id),0) else signed_contracts end,
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
end $function$;
REVOKE ALL ON FUNCTION public.save_readyops_team_payroll_entry(uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_readyops_team_payroll_entry(uuid,jsonb) TO authenticated;
CREATE OR REPLACE FUNCTION private.readyops_freeze_payroll_week() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF OLD.status IN ('draft','review') AND NEW.status IN ('approved','paid','locked') THEN
   UPDATE public.payroll_entries pe SET qualified_leads=coalesce(c.successful_leads,0),signed_contracts=coalesce(c.signed_contracts,0),updated_at=now()
   FROM (SELECT e.id,w.successful_leads,w.signed_contracts FROM public.payroll_entries e
     LEFT JOIN private.readyops_payroll_week_counts(NEW.week_start,NEW.week_end) w ON w.agent_id=e.agent_id
     WHERE e.payroll_period_id=NEW.id AND e.status='pending') c WHERE pe.id=c.id;
 END IF;
 IF NEW.status='approved' AND OLD.status IS DISTINCT FROM NEW.status THEN
   UPDATE public.payroll_entries SET status='approved',updated_at=now() WHERE payroll_period_id=NEW.id AND status='pending';
 ELSIF NEW.status='paid' AND OLD.status IS DISTINCT FROM NEW.status THEN
   UPDATE public.payroll_entries SET status='paid',payment_date=coalesce(payment_date,(now() AT TIME ZONE 'America/Mexico_City')::date),updated_at=now() WHERE payroll_period_id=NEW.id AND status<>'paid';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.readyops_freeze_payroll_week() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS readyops_freeze_payroll_week ON public.payroll_periods;
CREATE TRIGGER readyops_freeze_payroll_week BEFORE UPDATE OF status ON public.payroll_periods FOR EACH ROW EXECUTE FUNCTION private.readyops_freeze_payroll_week();
-- Refresh draft counts without changing attendance, rates, adjustments, or finalized payroll.
UPDATE public.payroll_entries pe SET qualified_leads=c.successful_leads,signed_contracts=c.signed_contracts,updated_at=now()
FROM (SELECT e.id,coalesce(w.successful_leads,0) successful_leads,coalesce(w.signed_contracts,0) signed_contracts
 FROM public.payroll_entries e JOIN public.payroll_periods pp ON pp.id=e.payroll_period_id
 LEFT JOIN LATERAL private.readyops_payroll_week_counts(pp.week_start,pp.week_end) w ON w.agent_id=e.agent_id
 WHERE e.status='pending' AND pp.status IN ('draft','review')) c WHERE pe.id=c.id;
COMMIT;
