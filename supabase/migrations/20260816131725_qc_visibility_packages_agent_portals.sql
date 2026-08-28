-- Imported from the hosted ReadyOp Supabase migration history on 2026-08-28.
-- Schema only: no production table data is included.

BEGIN;

CREATE OR REPLACE FUNCTION public.portal_assert_slot_capacity(p_company_id uuid,p_location_id uuid,p_date date,p_start time,p_exclude_reservation_id uuid DEFAULT NULL,p_exclude_appointment_id uuid DEFAULT NULL)
RETURNS public.company_schedule_rules
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
AS $$
DECLARE v_rule public.company_schedule_rules%ROWTYPE; v_slot_used integer; v_day_used integer; v_lock_key text;
BEGIN
  v_rule:=public.portal_validate_slot(p_company_id,p_location_id,p_date,p_start);
  v_lock_key:=p_company_id::text||':'||coalesce(p_location_id::text,'all')||':'||p_date::text||':'||p_start::text;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_lock_key,0));
  PERFORM public.portal_expire_reservations();
  SELECT
    (SELECT count(*) FROM public.portal_appointments a WHERE a.company_id=p_company_id AND a.location_id IS NOT DISTINCT FROM p_location_id AND a.appointment_date=p_date AND a.start_time=p_start AND a.status NOT IN ('cancelled','rescheduled','qc_denied') AND (p_exclude_appointment_id IS NULL OR a.id<>p_exclude_appointment_id))+
    (SELECT count(*) FROM public.appointment_reservations r WHERE r.company_id=p_company_id AND r.location_id IS NOT DISTINCT FROM p_location_id AND r.appointment_date=p_date AND r.start_time=p_start AND r.status='active' AND r.expires_at>now() AND (p_exclude_reservation_id IS NULL OR r.id<>p_exclude_reservation_id)) INTO v_slot_used;
  SELECT
    (SELECT count(*) FROM public.portal_appointments a WHERE a.company_id=p_company_id AND a.location_id IS NOT DISTINCT FROM p_location_id AND a.appointment_date=p_date AND a.status NOT IN ('cancelled','rescheduled','qc_denied') AND (p_exclude_appointment_id IS NULL OR a.id<>p_exclude_appointment_id))+
    (SELECT count(*) FROM public.appointment_reservations r WHERE r.company_id=p_company_id AND r.location_id IS NOT DISTINCT FROM p_location_id AND r.appointment_date=p_date AND r.status='active' AND r.expires_at>now() AND (p_exclude_reservation_id IS NULL OR r.id<>p_exclude_reservation_id)) INTO v_day_used;
  IF v_slot_used>=v_rule.max_per_slot THEN RAISE EXCEPTION 'This appointment time was just taken. Please select another opening.'; END IF;
  IF v_day_used>=v_rule.max_per_day THEN RAISE EXCEPTION 'This day has reached its appointment capacity.'; END IF;
  RETURN v_rule;
END;
$$;

-- Company portal only receives QC-approved leads.
CREATE OR REPLACE FUNCTION public.get_company_management_portal(p_company_id uuid,p_access_token uuid,p_start_date date,p_end_date date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp
AS $$
DECLARE v_company_id uuid;
BEGIN
  v_company_id:=public.portal_resolve_company_access(p_company_id,p_access_token);
  RETURN jsonb_build_object(
    'company',(SELECT to_jsonb(c) FROM public.roster_companies c WHERE c.id=v_company_id),
    'settings',(SELECT to_jsonb(s) FROM public.company_portal_settings s WHERE s.company_id=v_company_id),
    'locations',coalesce((SELECT jsonb_agg(to_jsonb(l) ORDER BY l.sort_order,l.location_label) FROM public.company_locations l WHERE l.company_id=v_company_id),'[]'::jsonb),
    'schedule_rules',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.location_id NULLS FIRST,r.day_of_week) FROM public.company_schedule_rules r WHERE r.company_id=v_company_id),'[]'::jsonb),
    'exceptions',coalesce((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.exception_date,e.start_time) FROM public.company_schedule_exceptions e WHERE e.company_id=v_company_id AND e.exception_date BETWEEN p_start_date-30 AND p_end_date+60),'[]'::jsonb),
    'representatives',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.active DESC,r.name) FROM public.company_representatives r WHERE r.company_id=v_company_id),'[]'::jsonb),
    'packages',coalesce((SELECT jsonb_agg(to_jsonb(cp) ORDER BY cp.start_date DESC,cp.created_at DESC) FROM public.company_packages cp WHERE cp.company_id=v_company_id),'[]'::jsonb),
    'appointments',coalesce((SELECT jsonb_agg(to_jsonb(a)||jsonb_build_object('lead',to_jsonb(l),'location_label',loc.location_label,'representative_name',rep.name,'latest_checkin',(SELECT to_jsonb(ci) FROM public.appointment_checkins ci WHERE ci.appointment_id=a.id ORDER BY ci.checked_in_at DESC LIMIT 1)) ORDER BY a.appointment_date,a.start_time)
      FROM public.portal_appointments a JOIN public.portal_leads l ON l.id=a.lead_id LEFT JOIN public.company_locations loc ON loc.id=a.location_id LEFT JOIN public.company_representatives rep ON rep.id=a.representative_id
      WHERE a.company_id=v_company_id AND a.appointment_date BETWEEN p_start_date AND p_end_date AND l.qc_status='approved' AND a.company_visible_at IS NOT NULL),'[]'::jsonb),
    'audit_logs',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC) FROM (SELECT * FROM public.portal_audit_logs al WHERE al.company_id=v_company_id ORDER BY al.created_at DESC LIMIT 200)x),'[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_representative_portal(p_access_token uuid,p_start_date date,p_end_date date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp
AS $$
DECLARE v_rep public.company_representatives%ROWTYPE;
BEGIN
  SELECT * INTO v_rep FROM public.company_representatives r WHERE r.access_token=p_access_token AND r.active;
  IF v_rep.id IS NULL THEN RAISE EXCEPTION 'Representative link is invalid or disabled'; END IF;
  RETURN jsonb_build_object(
    'representative',to_jsonb(v_rep)-'access_token',
    'company',(SELECT to_jsonb(c) FROM public.roster_companies c WHERE c.id=v_rep.company_id),
    'settings',(SELECT jsonb_build_object('timezone',s.timezone,'check_in_radius_m',s.check_in_radius_m,'check_in_before_minutes',s.check_in_before_minutes,'check_in_after_minutes',s.check_in_after_minutes) FROM public.company_portal_settings s WHERE s.company_id=v_rep.company_id),
    'appointments',coalesce((SELECT jsonb_agg(to_jsonb(a)||jsonb_build_object('lead',to_jsonb(l),'location_label',loc.location_label,'latest_checkin',(SELECT to_jsonb(ci) FROM public.appointment_checkins ci WHERE ci.appointment_id=a.id ORDER BY ci.checked_in_at DESC LIMIT 1),'timeline',coalesce((SELECT jsonb_agg(to_jsonb(al) ORDER BY al.created_at) FROM public.portal_audit_logs al WHERE al.entity_type='appointment' AND al.entity_id=a.id),'[]'::jsonb)) ORDER BY a.appointment_date,a.start_time)
      FROM public.portal_appointments a JOIN public.portal_leads l ON l.id=a.lead_id LEFT JOIN public.company_locations loc ON loc.id=a.location_id
      WHERE a.representative_id=v_rep.id AND a.appointment_date BETWEEN p_start_date AND p_end_date AND a.status NOT IN ('cancelled','rescheduled','qc_denied') AND l.qc_status='approved' AND a.company_visible_at IS NOT NULL),'[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_company_operations_overview()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp
AS $$
BEGIN
  IF NOT public.portal_is_admin() THEN RAISE EXCEPTION 'Admin access required'; END IF;
  RETURN coalesce((SELECT jsonb_agg(row_data ORDER BY (row_data->>'active_package')::boolean DESC,row_data->>'company_name') FROM (
    SELECT jsonb_build_object(
      'company_id',c.id,'company_name',c.name,'state',c.state,'contact_name',c.contact_name,'phone',c.phone,'email',c.email,'account_status',c.account_status,
      'public_slug',s.public_slug,'agent_link','/book/'||s.public_slug,'company_link','/company/'||s.public_slug||'/manage/'||s.company_access_token,
      'total_leads',(SELECT count(*) FROM public.portal_leads l WHERE l.company_id=c.id),
      'approved_leads',(SELECT count(*) FROM public.portal_leads l WHERE l.company_id=c.id AND l.qc_status='approved'),
      'qc_pending',(SELECT count(*) FROM public.portal_leads l WHERE l.company_id=c.id AND l.qc_status='pending'),
      'scheduled_upcoming',(SELECT count(*) FROM public.portal_appointments a JOIN public.portal_leads l ON l.id=a.lead_id WHERE a.company_id=c.id AND l.qc_status='approved' AND a.appointment_date>=current_date AND a.status NOT IN ('cancelled','rescheduled','qc_denied')),
      'active_package',(cp.id IS NOT NULL),
      'package',CASE WHEN cp.id IS NULL THEN NULL ELSE to_jsonb(cp)||jsonb_build_object('delivered_leads',(SELECT count(*) FROM public.portal_leads l WHERE l.package_id=cp.id AND l.qc_status='approved'),'pending_leads',greatest(cp.lead_target-(SELECT count(*) FROM public.portal_leads l WHERE l.package_id=cp.id AND l.qc_status='approved'),0)) END
    ) row_data
    FROM public.roster_companies c
    LEFT JOIN public.company_portal_settings s ON s.company_id=c.id
    LEFT JOIN LATERAL (SELECT * FROM public.company_packages p WHERE p.company_id=c.id AND p.status='active' ORDER BY p.start_date DESC,p.created_at DESC LIMIT 1) cp ON true
    WHERE c.account_status IN ('Active','Pause') OR cp.id IS NOT NULL
  ) q),'[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_agent_portal(p_access_token uuid,p_start_date date DEFAULT NULL,p_end_date date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp
AS $$
DECLARE v_agent public.agents%ROWTYPE; v_start date; v_end date;
BEGIN
  SELECT * INTO v_agent FROM public.agents a WHERE a.access_token=p_access_token AND a.active;
  IF v_agent.id IS NULL THEN RAISE EXCEPTION 'Agent link is invalid or disabled'; END IF;
  v_start:=coalesce(p_start_date,current_date-35); v_end:=coalesce(p_end_date,current_date+35);
  RETURN jsonb_build_object(
    'agent',jsonb_build_object('id',v_agent.id,'name',v_agent.name,'portal_slug',v_agent.portal_slug),
    'companies',coalesce((SELECT jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'state',c.state,'public_slug',s.public_slug) ORDER BY c.name) FROM public.roster_companies c JOIN public.company_portal_settings s ON s.company_id=c.id WHERE c.account_status='Active' AND s.portal_enabled),'[]'::jsonb),
    'appointments',coalesce((SELECT jsonb_agg(jsonb_build_object(
      'lead_id',l.id,'lead_code',l.lead_code,'company_id',c.id,'company_name',c.name,'name',l.full_name,'phone',l.phone_number,'address',l.address,
      'appointment_id',a.id,'appointment_date',a.appointment_date,'start_time',to_char(a.start_time,'HH24:MI'),'qc_status',l.qc_status,'qc_reason',l.qc_reason,'qc_notes',l.qc_notes,
      'appointment_status',a.status,'attendance_status',a.attendance_status,'inspection_status',a.inspection_status,'sales_outcome',a.sales_outcome,'inspector_notes',a.inspector_notes,
      'payroll_week_start',(a.appointment_date-extract(dow from a.appointment_date)::integer),'payroll_week_end',(a.appointment_date-extract(dow from a.appointment_date)::integer+6),'pay_date',(a.appointment_date-extract(dow from a.appointment_date)::integer+13)
    ) ORDER BY a.appointment_date DESC,a.start_time DESC) FROM public.portal_leads l JOIN public.portal_appointments a ON a.lead_id=l.id JOIN public.roster_companies c ON c.id=l.company_id WHERE l.agent_id=v_agent.id AND a.appointment_date BETWEEN v_start AND v_end),'[]'::jsonb)
  );
END;
$$;

COMMIT;
