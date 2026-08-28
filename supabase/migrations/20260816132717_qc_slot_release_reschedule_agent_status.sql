-- Imported from the hosted ReadyOp Supabase migration history on 2026-08-28.
-- Schema only: no production table data is included.

BEGIN;

UPDATE public.company_portal_settings SET form_mode='internal_external' WHERE form_mode='external';

CREATE OR REPLACE FUNCTION public.reschedule_public_appointment(p_manage_token uuid,p_location_id uuid,p_date date,p_start_time text,p_actor_name text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
AS $$
DECLARE v_appt public.portal_appointments%ROWTYPE; v_lead public.portal_leads%ROWTYPE; v_old jsonb; v_rule public.company_schedule_rules%ROWTYPE; v_start time;
BEGIN
  SELECT * INTO v_appt FROM public.portal_appointments a WHERE a.manage_token=p_manage_token FOR UPDATE;
  IF v_appt.id IS NULL OR v_appt.status IN ('cancelled','rescheduled','qc_denied') THEN RAISE EXCEPTION 'Appointment was not found or cannot be rescheduled'; END IF;
  SELECT * INTO v_lead FROM public.portal_leads WHERE id=v_appt.lead_id FOR UPDATE;
  v_start:=p_start_time::time;
  v_rule:=public.portal_assert_slot_capacity(v_appt.company_id,p_location_id,p_date,v_start,NULL,v_appt.id);
  v_old:=jsonb_build_object('date',v_appt.appointment_date,'start_time',v_appt.start_time,'location_id',v_appt.location_id,'qc_status',v_lead.qc_status);
  UPDATE public.portal_leads SET location_id=p_location_id,qc_status='pending',qc_reason=NULL,qc_notes=NULL,qc_reviewed_by=NULL,qc_reviewed_at=NULL WHERE id=v_lead.id RETURNING * INTO v_lead;
  UPDATE public.portal_appointments SET location_id=p_location_id,appointment_date=p_date,start_time=v_start,end_time=(v_start+make_interval(mins=>v_rule.slot_minutes))::time,status='qc_pending',company_visible_at=NULL,representative_id=NULL,rep_status='unassigned' WHERE id=v_appt.id RETURNING * INTO v_appt;
  PERFORM public.portal_write_audit(v_appt.company_id,'agent',NULL,coalesce(nullif(trim(p_actor_name),''),'Agent'),'appointment_rescheduled_for_qc','appointment',v_appt.id,v_old,jsonb_build_object('date',v_appt.appointment_date,'start_time',v_appt.start_time,'location_id',v_appt.location_id,'qc_status','pending'),'{}'::jsonb);
  RETURN jsonb_build_object('appointment_id',v_appt.id,'manage_token',v_appt.manage_token,'appointment_date',v_appt.appointment_date,'start_time',to_char(v_appt.start_time,'HH24:MI'),'end_time',to_char(v_appt.end_time,'HH24:MI'),'location_id',v_appt.location_id,'qc_status','pending');
END;
$$;

CREATE OR REPLACE FUNCTION public.qc_review_lead(p_lead_id uuid,p_decision text,p_reason text DEFAULT NULL,p_notes text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
AS $$
DECLARE v_lead public.portal_leads%ROWTYPE; v_appt public.portal_appointments%ROWTYPE; v_today date; v_same_day boolean:=false;
BEGIN
  IF NOT public.portal_is_qc_or_admin() THEN RAISE EXCEPTION 'QC or admin access required'; END IF;
  IF p_decision NOT IN ('approved','denied') THEN RAISE EXCEPTION 'Decision must be approved or denied'; END IF;
  SELECT * INTO v_lead FROM public.portal_leads WHERE id=p_lead_id FOR UPDATE; IF v_lead.id IS NULL THEN RAISE EXCEPTION 'Lead not found'; END IF;
  SELECT * INTO v_appt FROM public.portal_appointments WHERE lead_id=p_lead_id FOR UPDATE;
  UPDATE public.portal_leads SET qc_status=p_decision,qc_reason=nullif(trim(coalesce(p_reason,'')),''),qc_notes=nullif(trim(coalesce(p_notes,'')),''),qc_reviewed_by=auth.uid(),qc_reviewed_at=now() WHERE id=p_lead_id RETURNING * INTO v_lead;
  IF p_decision='approved' THEN
    IF v_lead.package_id IS NULL THEN UPDATE public.portal_leads SET package_id=public.portal_active_package(v_lead.company_id) WHERE id=v_lead.id RETURNING * INTO v_lead; END IF;
    UPDATE public.portal_appointments SET status=CASE WHEN representative_id IS NULL THEN 'confirmed' ELSE 'assigned' END,company_visible_at=now() WHERE id=v_appt.id RETURNING * INTO v_appt;
    PERFORM public.portal_complete_package_if_filled(v_lead.package_id);
    SELECT (now() AT TIME ZONE coalesce((SELECT timezone FROM public.company_portal_settings WHERE company_id=v_lead.company_id),'America/Chicago'))::date INTO v_today;
    v_same_day:=v_appt.appointment_date=v_today;
    IF v_same_day AND NOT EXISTS(SELECT 1 FROM public.company_notification_batches b WHERE b.notification_type='same_day' AND v_lead.id=ANY(b.lead_ids) AND b.status IN ('queued','sent')) THEN
      INSERT INTO public.company_notification_batches(company_id,notification_date,notification_type,status,recipient_email,lead_ids,lead_count,created_by)
      SELECT v_lead.company_id,v_today,'same_day','queued',c.email,ARRAY[v_lead.id],1,auth.uid() FROM public.roster_companies c WHERE c.id=v_lead.company_id;
    END IF;
  ELSE
    UPDATE public.portal_appointments SET status='cancelled',company_visible_at=NULL,representative_id=NULL,rep_status='unassigned' WHERE id=v_appt.id RETURNING * INTO v_appt;
  END IF;
  PERFORM public.portal_write_audit(v_lead.company_id,CASE WHEN public.portal_is_admin() THEN 'admin' ELSE 'qc' END,auth.uid(),public.portal_actor_name_for_management(),CASE WHEN p_decision='approved' THEN 'qc_approved' ELSE 'qc_denied' END,'lead',v_lead.id,NULL,jsonb_build_object('qc_status',p_decision,'reason',p_reason,'appointment_status',v_appt.status),jsonb_build_object('appointment_id',v_appt.id));
  RETURN jsonb_build_object('lead',to_jsonb(v_lead),'appointment',to_jsonb(v_appt),'same_day_notification_queued',v_same_day AND p_decision='approved');
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_readymode_lead(p_secret uuid,p_source_lead_id text,p_disposition text,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
AS $$
DECLARE v_secret uuid; v_lead public.portal_leads%ROWTYPE; v_appt public.portal_appointments%ROWTYPE; v_patch jsonb;
BEGIN
  SELECT webhook_secret INTO v_secret FROM public.readymode_integration_settings WHERE id=true AND enabled;
  IF v_secret IS NULL OR p_secret<>v_secret THEN RAISE EXCEPTION 'Invalid integration secret'; END IF;
  SELECT * INTO v_lead FROM public.portal_leads WHERE source='readymode' AND source_lead_id=p_source_lead_id FOR UPDATE;
  IF v_lead.id IS NULL THEN RAISE EXCEPTION 'ReadyMode lead has not been submitted into Ready Ops yet'; END IF;
  SELECT * INTO v_appt FROM public.portal_appointments WHERE lead_id=v_lead.id FOR UPDATE;
  v_patch:=v_lead.form_data||coalesce(p_payload,'{}'::jsonb);
  UPDATE public.portal_leads SET form_data=v_patch,source_disposition=p_disposition,service_needed=coalesce(nullif(p_payload->>'service_needed',''),service_needed),language=coalesce(nullif(p_payload->>'language',''),language),notes=coalesce(nullif(p_payload->>'notes',''),notes),home_value=coalesce(nullif(regexp_replace(coalesce(p_payload->>'home_value',''),'[^0-9.]','','g'),'')::numeric,home_value),sq_ft=coalesce(nullif(regexp_replace(coalesce(p_payload->>'sq_ft',''),'[^0-9]','','g'),'')::integer,sq_ft),web_url=coalesce(nullif(p_payload->>'web_url',''),web_url) WHERE id=v_lead.id RETURNING * INTO v_lead;
  IF lower(coalesce(p_disposition,'')) IN ('qc denied','qc_denied','qc-denied') THEN
    UPDATE public.portal_leads SET qc_status='denied',qc_reason=coalesce(nullif(p_payload->>'qc_reason',''),'ReadyMode QC Denied'),qc_reviewed_at=now() WHERE id=v_lead.id RETURNING * INTO v_lead;
    UPDATE public.portal_appointments SET status='cancelled',company_visible_at=NULL,representative_id=NULL,rep_status='unassigned' WHERE id=v_appt.id RETURNING * INTO v_appt;
  END IF;
  RETURN jsonb_build_object('lead',to_jsonb(v_lead),'appointment',to_jsonb(v_appt));
END;
$$;

CREATE OR REPLACE FUNCTION public.get_agent_portal(p_access_token uuid,p_start_date date DEFAULT NULL,p_end_date date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp
AS $$
DECLARE v_agent public.agents%ROWTYPE; v_start date; v_end date;
BEGIN
  SELECT * INTO v_agent FROM public.agents a WHERE a.access_token=p_access_token AND a.active;
  IF v_agent.id IS NULL THEN RAISE EXCEPTION 'Agent link is invalid or disabled'; END IF;
  v_start:=coalesce(p_start_date,current_date-35);v_end:=coalesce(p_end_date,current_date+35);
  RETURN jsonb_build_object('agent',jsonb_build_object('id',v_agent.id,'name',v_agent.name,'portal_slug',v_agent.portal_slug),
  'companies',coalesce((SELECT jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'state',c.state,'public_slug',s.public_slug) ORDER BY c.name) FROM public.roster_companies c JOIN public.company_portal_settings s ON s.company_id=c.id WHERE c.account_status='Active' AND s.portal_enabled),'[]'::jsonb),
  'appointments',coalesce((SELECT jsonb_agg(jsonb_build_object('lead_id',l.id,'lead_code',l.lead_code,'company_id',c.id,'company_name',c.name,'name',l.full_name,'phone',l.phone_number,'address',l.address,'appointment_id',a.id,'appointment_date',a.appointment_date,'start_time',to_char(a.start_time,'HH24:MI'),'qc_status',l.qc_status,'qc_reason',l.qc_reason,'qc_notes',l.qc_notes,'appointment_status',a.status,'client_status',a.client_status,'attendance_status',a.attendance_status,'inspection_status',a.inspection_status,'sales_outcome',a.sales_outcome,'inspector_notes',a.inspector_notes,'payroll_week_start',(a.appointment_date-extract(dow from a.appointment_date)::integer),'payroll_week_end',(a.appointment_date-extract(dow from a.appointment_date)::integer+6),'pay_date',(a.appointment_date-extract(dow from a.appointment_date)::integer+13)) ORDER BY a.appointment_date DESC,a.start_time DESC) FROM public.portal_leads l JOIN public.portal_appointments a ON a.lead_id=l.id JOIN public.roster_companies c ON c.id=l.company_id WHERE l.agent_id=v_agent.id AND a.appointment_date BETWEEN v_start AND v_end),'[]'::jsonb));
END;
$$;

COMMIT;
