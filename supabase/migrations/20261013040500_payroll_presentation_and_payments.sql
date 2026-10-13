BEGIN;
ALTER TABLE public.payroll_entries ADD COLUMN IF NOT EXISTS payment_method text;
ALTER TABLE public.payroll_entries ADD COLUMN IF NOT EXISTS payment_recorded_by uuid;

CREATE OR REPLACE FUNCTION private.readyops_payroll_presentation(p_period_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid := auth.uid(); v_entries jsonb; v_leads jsonb;
BEGIN
 IF v_actor IS NULL OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=v_actor AND active AND role IN ('admin','manager')) THEN RAISE EXCEPTION 'Payroll access required'; END IF;
 SELECT coalesce(jsonb_agg(e.value||jsonb_build_object('payment_recorded_by_name',actor.display_name)),'[]'::jsonb) INTO v_entries
 FROM jsonb_array_elements(public.get_readyops_payroll_entries(p_period_id)) e
 LEFT JOIN public.profiles actor ON actor.id=nullif(e.value->>'payment_recorded_by','')::uuid;
 SELECT coalesce(jsonb_agg(to_jsonb(detail) ORDER BY detail.appointment_date,detail.start_time,detail.full_name),'[]'::jsonb) INTO v_leads FROM (
 SELECT l.id AS lead_id,pe.agent_id,a.name AS agent_name,pe.team_id,t.name AS team_name,
 c.name AS company_name,l.company_id,l.full_name,l.phone_number,l.address,l.service_needed,
 coalesce(l.form_data->>'service_type','roofing') AS service_type,ap.appointment_date,ap.start_time,ap.inspector_notes,
 coalesce(q.status,l.qc_status,'pending') AS qc_status,
 CASE WHEN coalesce(q.status,l.qc_status,'pending')='denied' THEN 'qc_denied'
 WHEN coalesce(q.status,l.qc_status,'pending')='needs_correction' THEN 'needs_correction'
 WHEN coalesce(q.status,l.qc_status,'pending')<>'approved' THEN 'pending'
 WHEN normalized.status IN ('signed_contract','signed','signed_claim_filed') THEN 'signed_contract'
 WHEN normalized.status IN ('good','good_inspected','inspected','inspection_completed','completed') THEN 'good'
 WHEN normalized.status IN ('bad','lost','cancelled','canceled','homeowner_cancelled') THEN 'bad'
 WHEN normalized.status IN ('no_show','homeowner_no_show') THEN 'no_show'
 WHEN normalized.status IN ('rescheduled','reschedule') THEN 'rescheduled' ELSE 'pending' END AS outcome,
 (lower(coalesce(l.source,'')) IN ('paper','paper_lead','manual_paper') OR l.form_data->>'paper_lead'='true') AS paper_lead,
 CASE WHEN pe.pay_structure IN ('commission_only','base_plus_commission') AND coalesce(q.status,l.qc_status)='approved'
 THEN CASE WHEN normalized.status IN ('signed_contract','signed','signed_claim_filed') THEN pe.lead_rate+pe.signed_contract_rate
 WHEN normalized.status IN ('good','good_inspected','inspected','inspection_completed','completed') THEN pe.lead_rate ELSE 0 END ELSE 0 END AS commission
 FROM public.portal_leads l
 JOIN LATERAL (SELECT ap.* FROM public.portal_appointments ap WHERE ap.lead_id=l.id ORDER BY ap.created_at DESC,ap.id DESC LIMIT 1) ap ON true
 LEFT JOIN public.qc_review_cycles q ON q.lead_id=l.id AND q.is_current
 LEFT JOIN LATERAL (
 WITH candidates AS (SELECT ag.id,CASE WHEN lower(trim(ag.name))=lower(trim(l.agent_name)) THEN 0 ELSE 1 END rank
 FROM public.agents ag LEFT JOIN public.teams tm ON tm.id=ag.team_id
 WHERE lower(trim(ag.name))=lower(trim(l.agent_name)) OR (
 regexp_replace(lower(trim(ag.name)),'-(msr|brl|octo|woo)$','')=regexp_replace(lower(trim(l.agent_name)),'-(msr|brl|octo|woo)$','')
 AND (lower(trim(l.agent_name)) !~ '-(msr|brl|octo|woo)$' OR lower(tm.abbreviation)=substring(lower(trim(l.agent_name)) from '-(msr|brl|octo|woo)$'))))
 SELECT (array_agg(id))[1] agent_id FROM candidates WHERE rank=(SELECT min(rank) FROM candidates) HAVING count(*)=1
 ) matched ON l.agent_id IS NULL
 JOIN public.payroll_entries pe ON pe.agent_id=coalesce(l.agent_id,matched.agent_id) AND pe.payroll_period_id=p_period_id
 JOIN public.payroll_periods pp ON pp.id=pe.payroll_period_id
 JOIN public.agents a ON a.id=pe.agent_id LEFT JOIN public.teams t ON t.id=pe.team_id
 JOIN public.roster_companies c ON c.id=l.company_id
 CROSS JOIN LATERAL (SELECT regexp_replace(lower(trim(coalesce(nullif(nullif(ap.canonical_status,'pending'),'confirmed'),nullif(ap.client_status,'pending'),nullif(ap.company_action,'pending'),nullif(ap.sales_outcome,'pending'),ap.status,'pending'))),'[[:space:]/-]+','_','g') status) normalized
 WHERE ap.appointment_date BETWEEN pp.week_start AND pp.week_end AND private.readyops_can_manage_payroll(pe.team_id,pe.agent_id)
 ) detail;
 RETURN jsonb_build_object('entries',v_entries,'leads',v_leads);
END $$;
REVOKE ALL ON FUNCTION private.readyops_payroll_presentation(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.readyops_payroll_presentation(uuid) TO authenticated;
CREATE OR REPLACE FUNCTION public.get_readyops_payroll_presentation(p_period_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$ SELECT private.readyops_payroll_presentation(p_period_id) $$;
REVOKE ALL ON FUNCTION public.get_readyops_payroll_presentation(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_readyops_payroll_presentation(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION private.readyops_record_payroll_payment(p_period_id uuid,p_entry_ids uuid[],p_payment_date date,p_payment_method text) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid:=auth.uid(); v_entry public.payroll_entries; v_period public.payroll_periods; v_count integer:=0; v_expected integer;
BEGIN
 IF v_actor IS NULL OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=v_actor AND active AND role IN ('admin','manager')) THEN RAISE EXCEPTION 'Payroll access required'; END IF;
 IF p_payment_date IS NULL OR length(trim(coalesce(p_payment_method,''))) NOT BETWEEN 1 AND 80 THEN RAISE EXCEPTION 'Payment date and method are required'; END IF;
 SELECT count(DISTINCT id) INTO v_expected FROM unnest(p_entry_ids) id;
 IF v_expected NOT BETWEEN 1 AND 500 OR v_expected<>(SELECT count(*) FROM public.payroll_entries pe WHERE pe.id=ANY(p_entry_ids) AND pe.payroll_period_id=p_period_id AND private.readyops_can_manage_payroll(pe.team_id,pe.agent_id)) THEN RAISE EXCEPTION 'Payroll entries unavailable'; END IF;
 PERFORM pe.id FROM public.payroll_entries pe WHERE pe.id=ANY(p_entry_ids) ORDER BY pe.id FOR UPDATE;
 SELECT * INTO v_period FROM public.payroll_periods WHERE id=p_period_id FOR UPDATE;
 IF v_period.status='locked' THEN RAISE EXCEPTION 'Locked payroll cannot be edited'; END IF;
 FOR v_entry IN SELECT * FROM public.payroll_entries WHERE id=ANY(p_entry_ids) ORDER BY id LOOP
   IF v_entry.status='paid' THEN CONTINUE; END IF;
   PERFORM public.save_readyops_team_payroll_entry(v_entry.id,jsonb_build_object('status','paid','payment_date',p_payment_date));
   UPDATE public.payroll_entries SET payment_method=trim(p_payment_method),payment_recorded_by=v_actor WHERE id=v_entry.id;
   INSERT INTO public.management_audit_events(actor_id,team_id,target_id,event_type,metadata)
   VALUES(v_actor,v_entry.team_id,v_entry.id,'payroll_payment_recorded',jsonb_build_object('period_id',p_period_id,'payment_date',p_payment_date,'payment_method',trim(p_payment_method)));
   v_count:=v_count+1;
 END LOOP;
 RETURN v_count;
END $$;
REVOKE ALL ON FUNCTION private.readyops_record_payroll_payment(uuid,uuid[],date,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.readyops_record_payroll_payment(uuid,uuid[],date,text) TO authenticated;
CREATE OR REPLACE FUNCTION public.record_readyops_payroll_payment(p_period_id uuid,p_entry_ids uuid[],p_payment_date date,p_payment_method text) RETURNS integer
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT private.readyops_record_payroll_payment(p_period_id,p_entry_ids,p_payment_date,p_payment_method) $$;
REVOKE ALL ON FUNCTION public.record_readyops_payroll_payment(uuid,uuid[],date,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.record_readyops_payroll_payment(uuid,uuid[],date,text) TO authenticated;

CREATE OR REPLACE FUNCTION private.readyops_reopen_payroll_payment(p_period_id uuid,p_entry_ids uuid[],p_reason text) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid:=auth.uid(); v_entry public.payroll_entries; v_period public.payroll_periods; v_count integer:=0; v_expected integer;
BEGIN
 IF v_actor IS NULL OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=v_actor AND active AND role='admin') THEN RAISE EXCEPTION 'Admin access required'; END IF;
 IF length(trim(coalesce(p_reason,''))) NOT BETWEEN 3 AND 1000 THEN RAISE EXCEPTION 'Enter a reason for reopening payment'; END IF;
 SELECT count(DISTINCT id) INTO v_expected FROM unnest(p_entry_ids) id;
 IF v_expected NOT BETWEEN 1 AND 500 OR v_expected<>(SELECT count(*) FROM public.payroll_entries WHERE id=ANY(p_entry_ids) AND payroll_period_id=p_period_id) THEN RAISE EXCEPTION 'Payroll entries unavailable'; END IF;
 PERFORM pe.id FROM public.payroll_entries pe WHERE pe.id=ANY(p_entry_ids) ORDER BY pe.id FOR UPDATE;
 SELECT * INTO v_period FROM public.payroll_periods WHERE id=p_period_id FOR UPDATE;
 IF v_period.status='locked' THEN RAISE EXCEPTION 'Locked payroll cannot be reopened'; END IF;
 FOR v_entry IN SELECT * FROM public.payroll_entries WHERE id=ANY(p_entry_ids) AND status='paid' ORDER BY id LOOP
   INSERT INTO public.management_audit_events(actor_id,team_id,target_id,event_type,metadata)
   VALUES(v_actor,v_entry.team_id,v_entry.id,'payroll_payment_reopened',jsonb_build_object('reason',trim(p_reason),'previous_payment_date',v_entry.payment_date,'previous_payment_method',v_entry.payment_method,'previous_total',v_entry.total_pay));
   UPDATE public.payroll_entries SET status='approved',payment_date=NULL,payment_method=NULL,payment_recorded_by=NULL,updated_at=now() WHERE id=v_entry.id;
   v_count:=v_count+1;
 END LOOP;
 IF v_period.status='paid' AND v_count>0 THEN UPDATE public.payroll_periods SET status='review',updated_at=now() WHERE id=p_period_id; END IF;
 RETURN v_count;
END $$;
REVOKE ALL ON FUNCTION private.readyops_reopen_payroll_payment(uuid,uuid[],text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.readyops_reopen_payroll_payment(uuid,uuid[],text) TO authenticated;
CREATE OR REPLACE FUNCTION public.reopen_readyops_payroll_payment(p_period_id uuid,p_entry_ids uuid[],p_reason text) RETURNS integer
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT private.readyops_reopen_payroll_payment(p_period_id,p_entry_ids,p_reason) $$;
REVOKE ALL ON FUNCTION public.reopen_readyops_payroll_payment(uuid,uuid[],text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.reopen_readyops_payroll_payment(uuid,uuid[],text) TO authenticated;
COMMIT;
