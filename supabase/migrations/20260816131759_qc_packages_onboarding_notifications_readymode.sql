-- Imported from the hosted ReadyOp Supabase migration history on 2026-08-28.
-- Schema only: no production table data is included.

BEGIN;

CREATE TABLE IF NOT EXISTS public.readymode_integration_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  webhook_secret uuid NOT NULL DEFAULT gen_random_uuid(),
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.readymode_integration_settings(id) VALUES(true) ON CONFLICT(id) DO NOTHING;
ALTER TABLE public.readymode_integration_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS readymode_settings_admin_select ON public.readymode_integration_settings;
CREATE POLICY readymode_settings_admin_select ON public.readymode_integration_settings FOR SELECT USING(public.portal_is_admin());

CREATE OR REPLACE FUNCTION public.create_company_package(p_company_id uuid,p_lead_target integer,p_amount_per_lead numeric,p_package_total numeric,p_payment_date date DEFAULT NULL,p_payment_status text DEFAULT 'pending',p_package_name text DEFAULT 'Lead Package')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
AS $$
DECLARE v_pkg public.company_packages%ROWTYPE;
BEGIN
  IF NOT public.portal_is_admin() THEN RAISE EXCEPTION 'Admin access required'; END IF;
  IF p_payment_status NOT IN ('pending','complete') THEN RAISE EXCEPTION 'Invalid payment status'; END IF;
  UPDATE public.company_packages SET status='completed',completed_at=coalesce(completed_at,now()) WHERE company_id=p_company_id AND status='active';
  INSERT INTO public.company_packages(company_id,package_name,lead_target,amount_per_lead,package_total,payment_date,payment_status,status)
  VALUES(p_company_id,coalesce(nullif(trim(p_package_name),''),'Lead Package'),p_lead_target,coalesce(p_amount_per_lead,0),coalesce(p_package_total,p_lead_target*coalesce(p_amount_per_lead,0)),p_payment_date,p_payment_status,'active') RETURNING * INTO v_pkg;
  PERFORM public.portal_write_audit(p_company_id,'admin',auth.uid(),public.portal_actor_name_for_management(),'package_created','company_package',v_pkg.id,NULL,to_jsonb(v_pkg),'{}'::jsonb);
  RETURN to_jsonb(v_pkg);
END;
$$;

CREATE OR REPLACE FUNCTION public.update_company_package(p_package_id uuid,p_patch jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
AS $$
DECLARE v_old public.company_packages%ROWTYPE; v_new public.company_packages%ROWTYPE;
BEGIN
  IF NOT public.portal_is_admin() THEN RAISE EXCEPTION 'Admin access required'; END IF;
  SELECT * INTO v_old FROM public.company_packages WHERE id=p_package_id FOR UPDATE;
  IF v_old.id IS NULL THEN RAISE EXCEPTION 'Package not found'; END IF;
  UPDATE public.company_packages SET
    package_name=CASE WHEN p_patch?'package_name' THEN p_patch->>'package_name' ELSE package_name END,
    lead_target=CASE WHEN p_patch?'lead_target' THEN (p_patch->>'lead_target')::integer ELSE lead_target END,
    amount_per_lead=CASE WHEN p_patch?'amount_per_lead' THEN (p_patch->>'amount_per_lead')::numeric ELSE amount_per_lead END,
    package_total=CASE WHEN p_patch?'package_total' THEN (p_patch->>'package_total')::numeric ELSE package_total END,
    payment_date=CASE WHEN p_patch?'payment_date' THEN nullif(p_patch->>'payment_date','')::date ELSE payment_date END,
    payment_status=CASE WHEN p_patch?'payment_status' THEN p_patch->>'payment_status' ELSE payment_status END,
    status=CASE WHEN p_patch?'status' THEN p_patch->>'status' ELSE status END,
    notes=CASE WHEN p_patch?'notes' THEN nullif(p_patch->>'notes','') ELSE notes END,
    completed_at=CASE WHEN (p_patch->>'status')='completed' THEN coalesce(completed_at,now()) ELSE completed_at END,
    updated_at=now()
  WHERE id=p_package_id RETURNING * INTO v_new;
  PERFORM public.portal_write_audit(v_new.company_id,'admin',auth.uid(),public.portal_actor_name_for_management(),'package_updated','company_package',v_new.id,to_jsonb(v_old),to_jsonb(v_new),'{}'::jsonb);
  RETURN to_jsonb(v_new);
END;
$$;

CREATE OR REPLACE FUNCTION public.create_company_onboarding_invite(p_company_name_hint text DEFAULT NULL,p_expires_days integer DEFAULT 14)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
AS $$
DECLARE v_row public.company_onboarding_invites%ROWTYPE; v_base text;
BEGIN
  IF NOT public.portal_is_admin() THEN RAISE EXCEPTION 'Admin access required'; END IF;
  v_base:=coalesce(nullif(public.portal_slugify(p_company_name_hint),''),'new-company');
  INSERT INTO public.company_onboarding_invites(invite_slug,company_name_hint,expires_at,created_by)
  VALUES(v_base||'-'||substr(gen_random_uuid()::text,1,6),nullif(trim(coalesce(p_company_name_hint,'')),''),now()+make_interval(days=>greatest(p_expires_days,1)),auth.uid()) RETURNING * INTO v_row;
  RETURN jsonb_build_object('id',v_row.id,'invite_token',v_row.invite_token,'invite_slug',v_row.invite_slug,'company_name_hint',v_row.company_name_hint,'expires_at',v_row.expires_at);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_company_onboarding_invite(p_invite_slug text,p_invite_token uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp
AS $$
DECLARE v public.company_onboarding_invites%ROWTYPE;
BEGIN
  SELECT * INTO v FROM public.company_onboarding_invites WHERE invite_slug=p_invite_slug AND invite_token=p_invite_token AND active AND submitted_at IS NULL AND (expires_at IS NULL OR expires_at>now());
  IF v.id IS NULL THEN RAISE EXCEPTION 'Invite is invalid or expired'; END IF;
  RETURN jsonb_build_object('invite_slug',v.invite_slug,'company_name_hint',v.company_name_hint,'expires_at',v.expires_at);
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_company_onboarding(p_invite_slug text,p_invite_token uuid,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
AS $$
DECLARE v public.company_onboarding_invites%ROWTYPE; v_company public.roster_companies%ROWTYPE; v_slug text; v_location uuid; i integer;
BEGIN
  SELECT * INTO v FROM public.company_onboarding_invites WHERE invite_slug=p_invite_slug AND invite_token=p_invite_token AND active AND submitted_at IS NULL AND (expires_at IS NULL OR expires_at>now()) FOR UPDATE;
  IF v.id IS NULL THEN RAISE EXCEPTION 'Invite is invalid or expired'; END IF;
  IF nullif(trim(coalesce(p_payload->>'name','')),'') IS NULL THEN RAISE EXCEPTION 'Company name is required'; END IF;
  INSERT INTO public.roster_companies(name,state,contact_name,phone,email,website,requirements_note,notes,account_status)
  VALUES(trim(p_payload->>'name'),nullif(trim(coalesce(p_payload->>'state','')),''),nullif(trim(coalesce(p_payload->>'contact_name','')),''),nullif(trim(coalesce(p_payload->>'phone','')),''),nullif(lower(trim(coalesce(p_payload->>'email',''))),''),nullif(trim(coalesce(p_payload->>'website','')),''),nullif(trim(coalesce(p_payload->>'requirements','')),''),nullif(trim(coalesce(p_payload->>'notes','')),''),'Active') RETURNING * INTO v_company;
  v_slug:=public.portal_slugify(v_company.name)||'-'||substr(v_company.id::text,1,6);
  INSERT INTO public.company_portal_settings(company_id,public_slug,portal_enabled,allow_public_booking,requirements_short,requirements_detail,form_mode)
  VALUES(v_company.id,v_slug,true,true,coalesce(p_payload->>'requirements',''),'','internal') ON CONFLICT(company_id) DO NOTHING;
  IF nullif(trim(coalesce(p_payload->>'location','')),'') IS NOT NULL THEN
    INSERT INTO public.company_locations(company_id,location_label,state) VALUES(v_company.id,trim(p_payload->>'location'),nullif(trim(coalesce(p_payload->>'state','')),'')) RETURNING id INTO v_location;
  END IF;
  FOR i IN 0..6 LOOP
    INSERT INTO public.company_schedule_rules(company_id,day_of_week,is_open,start_time,end_time,slot_minutes,max_per_slot,max_per_day)
    VALUES(v_company.id,i,CASE WHEN i=0 THEN false ELSE true END,'09:00','18:00',60,1,9) ON CONFLICT DO NOTHING;
  END LOOP;
  IF coalesce((p_payload->>'lead_target')::integer,0)>0 THEN
    INSERT INTO public.company_packages(company_id,lead_target,amount_per_lead,package_total,payment_date,payment_status,status)
    VALUES(v_company.id,(p_payload->>'lead_target')::integer,coalesce(nullif(p_payload->>'amount_per_lead','')::numeric,0),coalesce(nullif(p_payload->>'package_total','')::numeric,(p_payload->>'lead_target')::integer*coalesce(nullif(p_payload->>'amount_per_lead','')::numeric,0)),nullif(p_payload->>'payment_date','')::date,coalesce(nullif(p_payload->>'payment_status',''),'pending'),'active');
  END IF;
  UPDATE public.company_onboarding_invites SET active=false,submitted_at=now(),company_id=v_company.id WHERE id=v.id;
  RETURN jsonb_build_object('company_id',v_company.id,'company_name',v_company.name,'public_slug',v_slug,'agent_link','/book/'||v_slug,'company_link','/company/'||v_slug||'/manage/'||(SELECT company_access_token FROM public.company_portal_settings WHERE company_id=v_company.id));
END;
$$;

CREATE OR REPLACE FUNCTION public.prepare_company_end_of_day_notification(p_company_id uuid,p_notification_date date DEFAULT current_date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
AS $$
DECLARE v_ids uuid[]; v_batch public.company_notification_batches%ROWTYPE; v_email text;
BEGIN
  IF NOT public.portal_is_qc_or_admin() THEN RAISE EXCEPTION 'QC or admin access required'; END IF;
  SELECT array_agg(l.id ORDER BY a.appointment_date,a.start_time),c.email INTO v_ids,v_email
  FROM public.roster_companies c LEFT JOIN public.portal_leads l ON l.company_id=c.id AND l.qc_status='approved' LEFT JOIN public.portal_appointments a ON a.lead_id=l.id
  WHERE c.id=p_company_id AND l.id IS NOT NULL AND l.qc_reviewed_at::date=p_notification_date
    AND NOT EXISTS (SELECT 1 FROM public.company_notification_batches b WHERE b.company_id=c.id AND l.id=ANY(b.lead_ids) AND b.status IN ('queued','sent'))
  GROUP BY c.email;
  IF coalesce(array_length(v_ids,1),0)=0 THEN RAISE EXCEPTION 'No approved, unnotified leads found for this company/date'; END IF;
  INSERT INTO public.company_notification_batches(company_id,notification_date,notification_type,status,recipient_email,lead_ids,lead_count,created_by)
  VALUES(p_company_id,p_notification_date,'end_of_day','queued',v_email,v_ids,array_length(v_ids,1),auth.uid()) RETURNING * INTO v_batch;
  RETURN to_jsonb(v_batch);
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
  UPDATE public.portal_leads SET form_data=v_patch,source_disposition=p_disposition,
    service_needed=coalesce(nullif(p_payload->>'service_needed',''),service_needed),language=coalesce(nullif(p_payload->>'language',''),language),
    notes=coalesce(nullif(p_payload->>'notes',''),notes),home_value=coalesce(nullif(regexp_replace(coalesce(p_payload->>'home_value',''),'[^0-9.]','','g'),'')::numeric,home_value),
    sq_ft=coalesce(nullif(regexp_replace(coalesce(p_payload->>'sq_ft',''),'[^0-9]','','g'),'')::integer,sq_ft),web_url=coalesce(nullif(p_payload->>'web_url',''),web_url)
  WHERE id=v_lead.id RETURNING * INTO v_lead;
  IF lower(coalesce(p_disposition,'')) IN ('qc denied','qc_denied','qc-denied') THEN
    UPDATE public.portal_leads SET qc_status='denied',qc_reason=coalesce(nullif(p_payload->>'qc_reason',''),'ReadyMode QC Denied'),qc_reviewed_at=now() WHERE id=v_lead.id RETURNING * INTO v_lead;
    UPDATE public.portal_appointments SET status='qc_denied',company_visible_at=NULL WHERE id=v_appt.id RETURNING * INTO v_appt;
  END IF;
  RETURN jsonb_build_object('lead',to_jsonb(v_lead),'appointment',to_jsonb(v_appt));
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_company_onboarding_invite(text,uuid) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.submit_company_onboarding(text,uuid,jsonb) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_agent_portal(uuid,date,date) TO anon,authenticated;

COMMIT;
