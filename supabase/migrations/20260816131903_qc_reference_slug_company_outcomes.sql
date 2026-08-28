-- Imported from the hosted ReadyOp Supabase migration history on 2026-08-28.
-- Schema only: no production table data is included.

BEGIN;

ALTER TABLE public.portal_appointments
  ADD COLUMN IF NOT EXISTS client_status text NOT NULL DEFAULT 'pending';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='portal_appointments_client_status_check') THEN
    ALTER TABLE public.portal_appointments ADD CONSTRAINT portal_appointments_client_status_check CHECK (client_status IN ('pending','good','bad','no_show','reschedule','follow_up','signed_contract'));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.get_qc_reference_data()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp
AS $$
BEGIN
  IF NOT public.portal_is_qc_or_admin() THEN RAISE EXCEPTION 'QC or admin access required'; END IF;
  RETURN jsonb_build_object(
    'companies',coalesce((SELECT jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'state',c.state,'public_slug',s.public_slug,'requirements_short',s.requirements_short,'requirements_detail',s.requirements_detail,'qualification_rules',s.qualification_rules,'form_mode',s.form_mode,'external_form_provider',s.external_form_provider,'external_form_url',s.external_form_url,'external_prefill_map',s.external_prefill_map) ORDER BY c.name) FROM public.roster_companies c JOIN public.company_portal_settings s ON s.company_id=c.id WHERE c.account_status='Active'),'[]'::jsonb),
    'locations',coalesce((SELECT jsonb_agg(jsonb_build_object('id',l.id,'company_id',l.company_id,'label',l.location_label,'state',l.state) ORDER BY l.location_label) FROM public.company_locations l JOIN public.roster_companies c ON c.id=l.company_id WHERE c.account_status='Active'),'[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_company_management_portal_by_slug(p_slug text,p_access_token uuid,p_start_date date,p_end_date date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp
AS $$
DECLARE v_company_id uuid;
BEGIN
  SELECT s.company_id INTO v_company_id FROM public.company_portal_settings s WHERE s.public_slug=p_slug AND s.company_access_enabled AND s.company_access_token=p_access_token;
  IF v_company_id IS NULL THEN RAISE EXCEPTION 'Company link is invalid or disabled'; END IF;
  RETURN public.get_company_management_portal(v_company_id,p_access_token,p_start_date,p_end_date);
END;
$$;

CREATE OR REPLACE FUNCTION public.company_update_lead_outcome(p_company_id uuid,p_access_token uuid,p_appointment_id uuid,p_client_status text,p_notes text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
AS $$
DECLARE v_company uuid; v_old public.portal_appointments%ROWTYPE; v_new public.portal_appointments%ROWTYPE;
BEGIN
  v_company:=public.portal_resolve_company_access(p_company_id,p_access_token);
  IF p_client_status NOT IN ('pending','good','bad','no_show','reschedule','follow_up','signed_contract') THEN RAISE EXCEPTION 'Invalid company lead status'; END IF;
  SELECT a.* INTO v_old FROM public.portal_appointments a JOIN public.portal_leads l ON l.id=a.lead_id WHERE a.id=p_appointment_id AND a.company_id=v_company AND l.qc_status='approved' FOR UPDATE OF a;
  IF v_old.id IS NULL THEN RAISE EXCEPTION 'Approved appointment not found'; END IF;
  UPDATE public.portal_appointments SET client_status=p_client_status,inspector_notes=CASE WHEN nullif(trim(coalesce(p_notes,'')),'') IS NULL THEN inspector_notes ELSE trim(p_notes) END,last_company_update_at=now(),
    attendance_status=CASE WHEN p_client_status='no_show' THEN 'homeowner_no_show' ELSE attendance_status END,
    sales_outcome=CASE WHEN p_client_status='signed_contract' THEN 'signed_contract' WHEN p_client_status='follow_up' THEN 'follow_up' ELSE sales_outcome END
  WHERE id=v_old.id RETURNING * INTO v_new;
  PERFORM public.portal_write_audit(v_company,'company',NULL,'Company','company_lead_outcome_updated','appointment',v_new.id,to_jsonb(v_old),to_jsonb(v_new),'{}'::jsonb);
  RETURN to_jsonb(v_new);
END;
$$;

CREATE OR REPLACE FUNCTION public.representative_update_appointment(p_access_token uuid,p_appointment_id uuid,p_action text,p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
AS $$
DECLARE v_rep public.company_representatives%ROWTYPE; v_old public.portal_appointments%ROWTYPE; v_new public.portal_appointments%ROWTYPE;
BEGIN
  SELECT * INTO v_rep FROM public.company_representatives r WHERE r.access_token=p_access_token AND r.active;
  IF v_rep.id IS NULL THEN RAISE EXCEPTION 'Representative link is invalid or disabled'; END IF;
  SELECT a.* INTO v_old FROM public.portal_appointments a JOIN public.portal_leads l ON l.id=a.lead_id WHERE a.id=p_appointment_id AND a.representative_id=v_rep.id AND l.qc_status='approved' FOR UPDATE OF a;
  IF v_old.id IS NULL THEN RAISE EXCEPTION 'Approved appointment is not assigned to this representative'; END IF;
  IF p_action='en_route' THEN UPDATE public.portal_appointments SET rep_status='en_route' WHERE id=v_old.id RETURNING * INTO v_new;
  ELSIF p_action='arrived' THEN UPDATE public.portal_appointments SET rep_status='arrived',attendance_status=CASE WHEN attendance_status='verified_show' THEN attendance_status ELSE 'unverified_show' END WHERE id=v_old.id RETURNING * INTO v_new;
  ELSIF p_action='inspection_started' THEN UPDATE public.portal_appointments SET rep_status='inspection_started',inspection_status='started',attendance_status=CASE WHEN attendance_status='verified_show' THEN attendance_status ELSE 'unverified_show' END WHERE id=v_old.id RETURNING * INTO v_new;
  ELSIF p_action='inspection_completed' THEN UPDATE public.portal_appointments SET rep_status='inspection_completed',inspection_status='completed',status='completed',client_status=CASE WHEN client_status='pending' THEN 'good' ELSE client_status END,attendance_status=CASE WHEN attendance_status='verified_show' THEN attendance_status ELSE 'unverified_show' END WHERE id=v_old.id RETURNING * INTO v_new;
  ELSIF p_action='homeowner_no_show' THEN UPDATE public.portal_appointments SET attendance_status='homeowner_no_show',inspection_status='not_completed',client_status='no_show' WHERE id=v_old.id RETURNING * INTO v_new;
  ELSIF p_action='homeowner_cancelled' THEN UPDATE public.portal_appointments SET attendance_status='cancelled',status='cancelled',inspection_status='not_completed',client_status='bad' WHERE id=v_old.id RETURNING * INTO v_new;
  ELSIF p_action='follow_up' THEN UPDATE public.portal_appointments SET rep_status='follow_up',sales_outcome='follow_up',client_status='follow_up' WHERE id=v_old.id RETURNING * INTO v_new;
  ELSIF p_action='signed_contract' THEN UPDATE public.portal_appointments SET sales_outcome='signed_contract',client_status='signed_contract',status='completed',inspection_status=CASE WHEN inspection_status='not_started' THEN 'completed' ELSE inspection_status END WHERE id=v_old.id RETURNING * INTO v_new;
  ELSIF p_action='lost' THEN UPDATE public.portal_appointments SET sales_outcome='lost',client_status='bad' WHERE id=v_old.id RETURNING * INTO v_new;
  ELSE RAISE EXCEPTION 'Unsupported representative action'; END IF;
  IF nullif(trim(coalesce(p_note,'')),'') IS NOT NULL THEN UPDATE public.portal_appointments SET inspector_notes=trim(p_note),last_company_update_at=now() WHERE id=v_old.id RETURNING * INTO v_new; END IF;
  PERFORM public.portal_write_audit(v_rep.company_id,'representative',v_rep.id,v_rep.name,p_action,'appointment',v_new.id,to_jsonb(v_old),to_jsonb(v_new),jsonb_build_object('note',p_note));
  RETURN to_jsonb(v_new);
END;
$$;

-- Automatically close a package when its approved target is reached.
CREATE OR REPLACE FUNCTION public.portal_complete_package_if_filled(p_package_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
AS $$
DECLARE v_target integer; v_count integer;
BEGIN
  IF p_package_id IS NULL THEN RETURN; END IF;
  SELECT lead_target INTO v_target FROM public.company_packages WHERE id=p_package_id AND status='active';
  IF v_target IS NULL THEN RETURN; END IF;
  SELECT count(*) INTO v_count FROM public.portal_leads WHERE package_id=p_package_id AND qc_status='approved';
  IF v_count>=v_target THEN UPDATE public.company_packages SET status='completed',completed_at=coalesce(completed_at,now()),updated_at=now() WHERE id=p_package_id AND status='active'; END IF;
END;
$$;

-- Re-wrap QC approval to include package completion.
CREATE OR REPLACE FUNCTION public.qc_review_lead(p_lead_id uuid,p_decision text,p_reason text DEFAULT NULL,p_notes text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
AS $$
DECLARE v_lead public.portal_leads%ROWTYPE; v_appt public.portal_appointments%ROWTYPE; v_today date; v_same_day boolean;
BEGIN
  IF NOT public.portal_is_qc_or_admin() THEN RAISE EXCEPTION 'QC or admin access required'; END IF;
  IF p_decision NOT IN ('approved','denied') THEN RAISE EXCEPTION 'Decision must be approved or denied'; END IF;
  SELECT * INTO v_lead FROM public.portal_leads WHERE id=p_lead_id FOR UPDATE;
  IF v_lead.id IS NULL THEN RAISE EXCEPTION 'Lead not found'; END IF;
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
    UPDATE public.portal_appointments SET status='qc_denied',company_visible_at=NULL WHERE id=v_appt.id RETURNING * INTO v_appt;
  END IF;
  PERFORM public.portal_write_audit(v_lead.company_id,CASE WHEN public.portal_is_admin() THEN 'admin' ELSE 'qc' END,auth.uid(),public.portal_actor_name_for_management(),CASE WHEN p_decision='approved' THEN 'qc_approved' ELSE 'qc_denied' END,'lead',v_lead.id,NULL,jsonb_build_object('qc_status',p_decision,'reason',p_reason,'appointment_status',v_appt.status),jsonb_build_object('appointment_id',v_appt.id));
  RETURN jsonb_build_object('lead',to_jsonb(v_lead),'appointment',to_jsonb(v_appt),'same_day_notification_queued',v_same_day AND p_decision='approved');
END;
$$;

COMMIT;
