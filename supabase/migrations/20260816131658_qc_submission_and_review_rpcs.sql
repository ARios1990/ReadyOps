-- Imported from the hosted ReadyOp Supabase migration history on 2026-08-28.
-- Schema only: no production table data is included.

BEGIN;

CREATE OR REPLACE FUNCTION public.portal_active_package(p_company_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path=public,pg_temp
AS $$
  SELECT cp.id
  FROM public.company_packages cp
  WHERE cp.company_id=p_company_id AND cp.status='active'
  ORDER BY cp.start_date DESC,cp.created_at DESC
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.portal_resolve_agent_id(p_agent_name text,p_form_data jsonb)
RETURNS uuid
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path=public,pg_temp
AS $$
DECLARE v_id uuid; v_token uuid;
BEGIN
  BEGIN
    v_token := nullif(p_form_data->>'agent_token','')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN v_token := NULL;
  END;
  IF v_token IS NOT NULL THEN
    SELECT id INTO v_id FROM public.agents WHERE access_token=v_token AND active LIMIT 1;
  END IF;
  IF v_id IS NULL AND nullif(trim(coalesce(p_agent_name,'')),'') IS NOT NULL THEN
    SELECT id INTO v_id FROM public.agents
    WHERE active AND lower(trim(name))=lower(trim(p_agent_name))
    ORDER BY id LIMIT 1;
  END IF;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_public_appointment(
  p_reservation_token uuid,
  p_session_id uuid,
  p_form_data jsonb,
  p_agent_name text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $$
DECLARE
  v_res public.appointment_reservations%ROWTYPE;
  v_settings public.company_portal_settings%ROWTYPE;
  v_qualification jsonb;
  v_lead public.portal_leads%ROWTYPE;
  v_appt public.portal_appointments%ROWTYPE;
  v_sqft integer;
  v_home_value numeric;
  v_agent_id uuid;
  v_package_id uuid;
BEGIN
  SELECT * INTO v_res FROM public.appointment_reservations r
  WHERE r.reservation_token=p_reservation_token FOR UPDATE;
  IF v_res.id IS NULL OR v_res.session_id<>p_session_id THEN RAISE EXCEPTION 'Reservation was not found for this agent session'; END IF;
  IF v_res.status<>'active' OR v_res.expires_at<=now() THEN RAISE EXCEPTION 'The reservation expired. Please select the time again.'; END IF;

  SELECT * INTO v_settings FROM public.company_portal_settings WHERE company_id=v_res.company_id;
  v_qualification := public.portal_evaluate_qualification(v_settings.qualification_rules,p_form_data);

  -- QC is the final gate; do not hard-block an agent submission based on automatic qualification.
  IF nullif(trim(coalesce(p_form_data->>'full_name','')),'') IS NULL
     OR nullif(trim(coalesce(p_form_data->>'phone_number','')),'') IS NULL
     OR nullif(trim(coalesce(p_form_data->>'address','')),'') IS NULL THEN
    RAISE EXCEPTION 'Full name, phone number and address are required';
  END IF;

  v_sqft := nullif(regexp_replace(coalesce(p_form_data->>'sq_ft',''),'[^0-9]','','g'),'')::integer;
  v_home_value := nullif(regexp_replace(coalesce(p_form_data->>'home_value',''),'[^0-9.]','','g'),'')::numeric;
  v_agent_id := public.portal_resolve_agent_id(p_agent_name,p_form_data);
  v_package_id := public.portal_active_package(v_res.company_id);

  INSERT INTO public.portal_leads(
    company_id,original_company_id,location_id,agent_profile_id,agent_id,agent_name,session_id,package_id,
    service_needed,full_name,phone_number,address,city,state,zip_code,email,language,notes,home_value,sq_ft,web_url,
    property_latitude,property_longitude,form_data,qualification_status,qualification_reasons,external_form_status,
    qc_status,source,source_lead_id,source_disposition
  ) VALUES (
    v_res.company_id,v_res.company_id,v_res.location_id,auth.uid(),v_agent_id,coalesce(nullif(trim(p_agent_name),''),v_res.agent_name),p_session_id,v_package_id,
    p_form_data->>'service_needed',trim(p_form_data->>'full_name'),trim(p_form_data->>'phone_number'),trim(p_form_data->>'address'),
    nullif(trim(coalesce(p_form_data->>'city','')),''),nullif(trim(coalesce(p_form_data->>'state','')),''),nullif(trim(coalesce(p_form_data->>'zip_code','')),''),
    nullif(lower(trim(coalesce(p_form_data->>'email',''))),''),nullif(trim(coalesce(p_form_data->>'language','')),''),nullif(trim(coalesce(p_form_data->>'notes','')),''),
    v_home_value,v_sqft,nullif(trim(coalesce(p_form_data->>'web_url','')),''),
    nullif(p_form_data->>'property_latitude','')::double precision,nullif(p_form_data->>'property_longitude','')::double precision,
    p_form_data,v_qualification->>'status',v_qualification->'reasons',
    CASE WHEN v_settings.form_mode='internal' THEN 'not_required' ELSE 'pending' END,
    'pending',coalesce(nullif(p_form_data->>'_source',''),'ready_ops'),nullif(p_form_data->>'_source_lead_id',''),nullif(p_form_data->>'_source_disposition','')
  ) RETURNING * INTO v_lead;

  INSERT INTO public.portal_appointments(
    lead_id,company_id,location_id,appointment_date,start_time,end_time,timezone,status,external_form_status
  ) VALUES (
    v_lead.id,v_res.company_id,v_res.location_id,v_res.appointment_date,v_res.start_time,v_res.end_time,
    v_settings.timezone,'qc_pending',CASE WHEN v_settings.form_mode='internal' THEN 'not_required' ELSE 'pending' END
  ) RETURNING * INTO v_appt;

  UPDATE public.appointment_reservations SET status='converted',converted_appointment_id=v_appt.id WHERE id=v_res.id;

  PERFORM public.portal_write_audit(v_res.company_id,'agent',auth.uid(),v_lead.agent_name,
    'lead_submitted_for_qc','appointment',v_appt.id,NULL,
    jsonb_build_object('lead_code',v_lead.lead_code,'date',v_appt.appointment_date,'start_time',v_appt.start_time,'qc_status','pending'),
    jsonb_build_object('reservation_id',v_res.id,'agent_id',v_agent_id));

  RETURN jsonb_build_object(
    'appointment_id',v_appt.id,'manage_token',v_appt.manage_token,'lead_id',v_lead.id,'lead_code',v_lead.lead_code,
    'appointment_date',v_appt.appointment_date,'start_time',to_char(v_appt.start_time,'HH24:MI'),'end_time',to_char(v_appt.end_time,'HH24:MI'),
    'qualification_status',v_lead.qualification_status,'qualification_reasons',v_lead.qualification_reasons,
    'qc_status','pending','form_mode',v_settings.form_mode,'external_form_provider',v_settings.external_form_provider,
    'external_form_url',v_settings.external_form_url,'external_prefill_map',v_settings.external_prefill_map,'form_data',v_lead.form_data
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_qc_queue(
  p_start_date date DEFAULT current_date-7,
  p_end_date date DEFAULT current_date+14,
  p_company_id uuid DEFAULT NULL,
  p_qc_status text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path=public,pg_temp
AS $$
BEGIN
  IF NOT public.portal_is_qc_or_admin() THEN RAISE EXCEPTION 'QC or admin access required'; END IF;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'lead',to_jsonb(l),
      'appointment',to_jsonb(a),
      'company',jsonb_build_object('id',c.id,'name',c.name,'state',c.state,'requirements_note',c.requirements_note),
      'location',CASE WHEN loc.id IS NULL THEN NULL ELSE jsonb_build_object('id',loc.id,'label',loc.location_label,'state',loc.state) END,
      'agent',CASE WHEN ag.id IS NULL THEN NULL ELSE jsonb_build_object('id',ag.id,'name',ag.name,'portal_slug',ag.portal_slug) END,
      'package',CASE WHEN cp.id IS NULL THEN NULL ELSE to_jsonb(cp) END,
      'portal',jsonb_build_object('public_slug',s.public_slug,'requirements_short',s.requirements_short,'requirements_detail',s.requirements_detail,'qualification_rules',s.qualification_rules,'form_mode',s.form_mode,'external_form_provider',s.external_form_provider,'external_form_url',s.external_form_url,'external_prefill_map',s.external_prefill_map)
    ) ORDER BY c.name,a.appointment_date,a.start_time,l.created_at)
    FROM public.portal_leads l
    JOIN public.portal_appointments a ON a.lead_id=l.id
    JOIN public.roster_companies c ON c.id=l.company_id
    LEFT JOIN public.company_locations loc ON loc.id=l.location_id
    LEFT JOIN public.agents ag ON ag.id=l.agent_id
    LEFT JOIN public.company_packages cp ON cp.id=l.package_id
    LEFT JOIN public.company_portal_settings s ON s.company_id=l.company_id
    WHERE a.appointment_date BETWEEN p_start_date AND p_end_date
      AND (p_company_id IS NULL OR l.company_id=p_company_id)
      AND (p_qc_status IS NULL OR l.qc_status=p_qc_status)
  ),'[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.qc_update_lead(p_lead_id uuid,p_patch jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $$
DECLARE v_old public.portal_leads%ROWTYPE; v_new public.portal_leads%ROWTYPE; v_form jsonb;
BEGIN
  IF NOT public.portal_is_qc_or_admin() THEN RAISE EXCEPTION 'QC or admin access required'; END IF;
  SELECT * INTO v_old FROM public.portal_leads WHERE id=p_lead_id FOR UPDATE;
  IF v_old.id IS NULL THEN RAISE EXCEPTION 'Lead not found'; END IF;
  v_form := v_old.form_data || coalesce(p_patch->'form_data','{}'::jsonb);
  UPDATE public.portal_leads SET
    full_name=CASE WHEN p_patch?'full_name' THEN trim(p_patch->>'full_name') ELSE full_name END,
    phone_number=CASE WHEN p_patch?'phone_number' THEN trim(p_patch->>'phone_number') ELSE phone_number END,
    address=CASE WHEN p_patch?'address' THEN trim(p_patch->>'address') ELSE address END,
    city=CASE WHEN p_patch?'city' THEN nullif(trim(p_patch->>'city'),'') ELSE city END,
    state=CASE WHEN p_patch?'state' THEN nullif(trim(p_patch->>'state'),'') ELSE state END,
    zip_code=CASE WHEN p_patch?'zip_code' THEN nullif(trim(p_patch->>'zip_code'),'') ELSE zip_code END,
    email=CASE WHEN p_patch?'email' THEN nullif(lower(trim(p_patch->>'email')),'') ELSE email END,
    language=CASE WHEN p_patch?'language' THEN nullif(trim(p_patch->>'language'),'') ELSE language END,
    service_needed=CASE WHEN p_patch?'service_needed' THEN nullif(trim(p_patch->>'service_needed'),'') ELSE service_needed END,
    notes=CASE WHEN p_patch?'notes' THEN nullif(trim(p_patch->>'notes'),'') ELSE notes END,
    home_value=CASE WHEN p_patch?'home_value' THEN nullif(regexp_replace(coalesce(p_patch->>'home_value',''),'[^0-9.]','','g'),'')::numeric ELSE home_value END,
    sq_ft=CASE WHEN p_patch?'sq_ft' THEN nullif(regexp_replace(coalesce(p_patch->>'sq_ft',''),'[^0-9]','','g'),'')::integer ELSE sq_ft END,
    web_url=CASE WHEN p_patch?'web_url' THEN nullif(trim(p_patch->>'web_url'),'') ELSE web_url END,
    form_data=v_form,
    qc_notes=CASE WHEN p_patch?'qc_notes' THEN nullif(trim(p_patch->>'qc_notes'),'') ELSE qc_notes END
  WHERE id=p_lead_id RETURNING * INTO v_new;
  PERFORM public.portal_write_audit(v_new.company_id,CASE WHEN public.portal_is_admin() THEN 'admin' ELSE 'qc' END,auth.uid(),public.portal_actor_name_for_management(),'qc_lead_edited','lead',v_new.id,to_jsonb(v_old),to_jsonb(v_new),'{}'::jsonb);
  RETURN to_jsonb(v_new);
END;
$$;

CREATE OR REPLACE FUNCTION public.qc_review_lead(p_lead_id uuid,p_decision text,p_reason text DEFAULT NULL,p_notes text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $$
DECLARE v_lead public.portal_leads%ROWTYPE; v_appt public.portal_appointments%ROWTYPE; v_today date; v_same_day boolean;
BEGIN
  IF NOT public.portal_is_qc_or_admin() THEN RAISE EXCEPTION 'QC or admin access required'; END IF;
  IF p_decision NOT IN ('approved','denied') THEN RAISE EXCEPTION 'Decision must be approved or denied'; END IF;
  SELECT * INTO v_lead FROM public.portal_leads WHERE id=p_lead_id FOR UPDATE;
  IF v_lead.id IS NULL THEN RAISE EXCEPTION 'Lead not found'; END IF;
  SELECT * INTO v_appt FROM public.portal_appointments WHERE lead_id=p_lead_id FOR UPDATE;

  UPDATE public.portal_leads SET qc_status=p_decision,qc_reason=nullif(trim(coalesce(p_reason,'')),''),qc_notes=nullif(trim(coalesce(p_notes,'')),''),qc_reviewed_by=auth.uid(),qc_reviewed_at=now()
  WHERE id=p_lead_id RETURNING * INTO v_lead;

  IF p_decision='approved' THEN
    UPDATE public.portal_appointments SET status=CASE WHEN representative_id IS NULL THEN 'confirmed' ELSE 'assigned' END,company_visible_at=now()
    WHERE id=v_appt.id RETURNING * INTO v_appt;
    IF v_lead.package_id IS NULL THEN
      UPDATE public.portal_leads SET package_id=public.portal_active_package(v_lead.company_id) WHERE id=v_lead.id RETURNING * INTO v_lead;
    END IF;
    SELECT (now() AT TIME ZONE coalesce((SELECT timezone FROM public.company_portal_settings WHERE company_id=v_lead.company_id),'America/Chicago'))::date INTO v_today;
    v_same_day := v_appt.appointment_date=v_today;
    IF v_same_day THEN
      INSERT INTO public.company_notification_batches(company_id,notification_date,notification_type,status,recipient_email,lead_ids,lead_count,created_by)
      SELECT v_lead.company_id,v_today,'same_day','queued',c.email,ARRAY[v_lead.id],1,auth.uid()
      FROM public.roster_companies c WHERE c.id=v_lead.company_id;
    END IF;
  ELSE
    UPDATE public.portal_appointments SET status='qc_denied',company_visible_at=NULL WHERE id=v_appt.id RETURNING * INTO v_appt;
  END IF;

  PERFORM public.portal_write_audit(v_lead.company_id,CASE WHEN public.portal_is_admin() THEN 'admin' ELSE 'qc' END,auth.uid(),public.portal_actor_name_for_management(),
    CASE WHEN p_decision='approved' THEN 'qc_approved' ELSE 'qc_denied' END,'lead',v_lead.id,NULL,
    jsonb_build_object('qc_status',p_decision,'reason',p_reason,'appointment_status',v_appt.status),jsonb_build_object('appointment_id',v_appt.id));
  RETURN jsonb_build_object('lead',to_jsonb(v_lead),'appointment',to_jsonb(v_appt));
END;
$$;

CREATE OR REPLACE FUNCTION public.qc_move_lead(
  p_lead_id uuid,p_company_id uuid,p_location_id uuid,p_date date,p_start_time text,p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $$
DECLARE v_lead public.portal_leads%ROWTYPE; v_appt public.portal_appointments%ROWTYPE; v_rule public.company_schedule_rules%ROWTYPE; v_start time; v_settings public.company_portal_settings%ROWTYPE; v_old jsonb;
BEGIN
  IF NOT public.portal_is_qc_or_admin() THEN RAISE EXCEPTION 'QC or admin access required'; END IF;
  SELECT * INTO v_lead FROM public.portal_leads WHERE id=p_lead_id FOR UPDATE;
  SELECT * INTO v_appt FROM public.portal_appointments WHERE lead_id=p_lead_id FOR UPDATE;
  IF v_lead.id IS NULL OR v_appt.id IS NULL THEN RAISE EXCEPTION 'Lead or appointment not found'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.roster_companies WHERE id=p_company_id AND account_status='Active') THEN RAISE EXCEPTION 'Target company is not active'; END IF;
  IF p_location_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.company_locations WHERE id=p_location_id AND company_id=p_company_id) THEN RAISE EXCEPTION 'Target service area does not belong to the company'; END IF;
  v_start:=p_start_time::time;
  v_rule:=public.portal_assert_slot_capacity(p_company_id,p_location_id,p_date,v_start,NULL,CASE WHEN v_appt.company_id=p_company_id THEN v_appt.id ELSE NULL END);
  SELECT * INTO v_settings FROM public.company_portal_settings WHERE company_id=p_company_id;
  v_old:=jsonb_build_object('company_id',v_lead.company_id,'location_id',v_lead.location_id,'date',v_appt.appointment_date,'start_time',v_appt.start_time);
  UPDATE public.portal_leads SET company_id=p_company_id,location_id=p_location_id,package_id=public.portal_active_package(p_company_id),qc_status='pending',qc_reason=nullif(trim(coalesce(p_reason,'')),''),qc_reviewed_by=NULL,qc_reviewed_at=NULL
  WHERE id=p_lead_id RETURNING * INTO v_lead;
  UPDATE public.portal_appointments SET company_id=p_company_id,location_id=p_location_id,appointment_date=p_date,start_time=v_start,end_time=(v_start+make_interval(mins=>v_rule.slot_minutes))::time,timezone=coalesce(v_settings.timezone,'America/Chicago'),status='qc_pending',representative_id=NULL,rep_status='unassigned',company_visible_at=NULL
  WHERE id=v_appt.id RETURNING * INTO v_appt;
  PERFORM public.portal_write_audit(p_company_id,CASE WHEN public.portal_is_admin() THEN 'admin' ELSE 'qc' END,auth.uid(),public.portal_actor_name_for_management(),'qc_lead_reassigned','lead',v_lead.id,v_old,jsonb_build_object('company_id',p_company_id,'location_id',p_location_id,'date',p_date,'start_time',v_start),jsonb_build_object('reason',p_reason));
  RETURN jsonb_build_object('lead',to_jsonb(v_lead),'appointment',to_jsonb(v_appt));
END;
$$;

COMMIT;
