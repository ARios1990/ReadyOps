-- Imported from the hosted ReadyOp Supabase migration history on 2026-08-28.
-- Schema only: no production table data is included.

-- Allow QC/admin staff to reassign a lead to a past appointment date (for correcting
-- records after the fact), while the public booking flows continue to reject past dates.
CREATE OR REPLACE FUNCTION public.portal_validate_slot(p_company_id uuid, p_location_id uuid, p_date date, p_start time without time zone, p_allow_past boolean DEFAULT false)
 RETURNS company_schedule_rules
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_rule public.company_schedule_rules%ROWTYPE;
  v_end time;
  v_start_minutes integer;
  v_rule_start_minutes integer;
BEGIN
  IF p_date < current_date AND NOT p_allow_past THEN
    RAISE EXCEPTION 'Past appointment dates are not available';
  END IF;

  v_rule := public.portal_find_rule(p_company_id, p_location_id, extract(dow FROM p_date)::integer);
  IF v_rule.id IS NULL OR NOT v_rule.is_open THEN
    RAISE EXCEPTION 'The company is closed on this date';
  END IF;

  v_end := (p_start + make_interval(mins => v_rule.slot_minutes))::time;
  IF p_start < v_rule.start_time OR v_end > v_rule.end_time THEN
    RAISE EXCEPTION 'The requested time is outside company hours';
  END IF;

  v_start_minutes := extract(hour FROM p_start)::integer * 60 + extract(minute FROM p_start)::integer;
  v_rule_start_minutes := extract(hour FROM v_rule.start_time)::integer * 60 + extract(minute FROM v_rule.start_time)::integer;
  IF mod(v_start_minutes - v_rule_start_minutes, v_rule.slot_minutes) <> 0 THEN
    RAISE EXCEPTION 'The requested time does not match the company appointment interval';
  END IF;

  IF public.portal_slot_is_blocked(p_company_id, p_location_id, p_date, p_start, v_end) THEN
    RAISE EXCEPTION 'The requested time is blocked';
  END IF;

  RETURN v_rule;
END;
$function$;

CREATE OR REPLACE FUNCTION public.portal_assert_slot_capacity(p_company_id uuid, p_location_id uuid, p_date date, p_start time without time zone, p_exclude_reservation_id uuid DEFAULT NULL::uuid, p_exclude_appointment_id uuid DEFAULT NULL::uuid, p_allow_past boolean DEFAULT false)
 RETURNS company_schedule_rules
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_rule public.company_schedule_rules%ROWTYPE;
  v_slot_used integer;
  v_hour_used integer;
  v_day_used integer;
  v_location_max_hour integer;
  v_location_max_day integer;
  v_lock_key text;
BEGIN
  v_rule := public.portal_validate_slot(p_company_id, p_location_id, p_date, p_start, p_allow_past);
  v_lock_key := p_company_id::text || ':' || coalesce(p_location_id::text, 'all') || ':' || p_date::text || ':' || p_start::text;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_lock_key, 0));
  PERFORM public.portal_expire_reservations();

  SELECT location.max_per_hour, location.max_per_day
  INTO v_location_max_hour, v_location_max_day
  FROM public.company_locations AS location
  WHERE location.id = p_location_id
    AND location.company_id = p_company_id
    AND location.active;

  SELECT
    (SELECT count(*) FROM public.portal_appointments AS appointment
      WHERE appointment.company_id = p_company_id
        AND appointment.location_id IS NOT DISTINCT FROM p_location_id
        AND appointment.appointment_date = p_date
        AND appointment.start_time = p_start
        AND appointment.status NOT IN ('cancelled', 'rescheduled', 'qc_denied')
        AND (p_exclude_appointment_id IS NULL OR appointment.id <> p_exclude_appointment_id))
    +
    (SELECT count(*) FROM public.appointment_reservations AS reservation
      WHERE reservation.company_id = p_company_id
        AND reservation.location_id IS NOT DISTINCT FROM p_location_id
        AND reservation.appointment_date = p_date
        AND reservation.start_time = p_start
        AND reservation.status = 'active'
        AND reservation.expires_at > now()
        AND (p_exclude_reservation_id IS NULL OR reservation.id <> p_exclude_reservation_id))
  INTO v_slot_used;

  SELECT
    (SELECT count(*) FROM public.portal_appointments AS appointment
      WHERE appointment.company_id = p_company_id
        AND appointment.location_id IS NOT DISTINCT FROM p_location_id
        AND appointment.appointment_date = p_date
        AND extract(hour FROM appointment.start_time) = extract(hour FROM p_start)
        AND appointment.status NOT IN ('cancelled', 'rescheduled', 'qc_denied')
        AND (p_exclude_appointment_id IS NULL OR appointment.id <> p_exclude_appointment_id))
    +
    (SELECT count(*) FROM public.appointment_reservations AS reservation
      WHERE reservation.company_id = p_company_id
        AND reservation.location_id IS NOT DISTINCT FROM p_location_id
        AND reservation.appointment_date = p_date
        AND extract(hour FROM reservation.start_time) = extract(hour FROM p_start)
        AND reservation.status = 'active'
        AND reservation.expires_at > now()
        AND (p_exclude_reservation_id IS NULL OR reservation.id <> p_exclude_reservation_id))
  INTO v_hour_used;

  SELECT
    (SELECT count(*) FROM public.portal_appointments AS appointment
      WHERE appointment.company_id = p_company_id
        AND appointment.location_id IS NOT DISTINCT FROM p_location_id
        AND appointment.appointment_date = p_date
        AND appointment.status NOT IN ('cancelled', 'rescheduled', 'qc_denied')
        AND (p_exclude_appointment_id IS NULL OR appointment.id <> p_exclude_appointment_id))
    +
    (SELECT count(*) FROM public.appointment_reservations AS reservation
      WHERE reservation.company_id = p_company_id
        AND reservation.location_id IS NOT DISTINCT FROM p_location_id
        AND reservation.appointment_date = p_date
        AND reservation.status = 'active'
        AND reservation.expires_at > now()
        AND (p_exclude_reservation_id IS NULL OR reservation.id <> p_exclude_reservation_id))
  INTO v_day_used;

  IF v_slot_used >= v_rule.max_per_slot THEN
    RAISE EXCEPTION 'This appointment time was just taken. Please select another opening.';
  END IF;
  IF v_location_max_hour IS NOT NULL AND v_hour_used >= v_location_max_hour THEN
    RAISE EXCEPTION 'This location has reached its hourly appointment capacity.';
  END IF;
  IF v_day_used >= coalesce(v_location_max_day, v_rule.max_per_day) THEN
    RAISE EXCEPTION 'This day has reached its appointment capacity.';
  END IF;
  RETURN v_rule;
END;
$function$;

CREATE OR REPLACE FUNCTION public.qc_move_lead(p_lead_id uuid, p_company_id uuid, p_location_id uuid, p_date date, p_start_time text, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_lead public.portal_leads%ROWTYPE; v_appt public.portal_appointments%ROWTYPE; v_rule public.company_schedule_rules%ROWTYPE; v_start time; v_settings public.company_portal_settings%ROWTYPE; v_old jsonb;
BEGIN
  IF NOT public.portal_is_qc_or_admin() THEN RAISE EXCEPTION 'QC or admin access required'; END IF;
  SELECT * INTO v_lead FROM public.portal_leads WHERE id=p_lead_id FOR UPDATE;
  SELECT * INTO v_appt FROM public.portal_appointments WHERE lead_id=p_lead_id FOR UPDATE;
  IF v_lead.id IS NULL OR v_appt.id IS NULL THEN RAISE EXCEPTION 'Lead or appointment not found'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.roster_companies WHERE id=p_company_id AND account_status='Active') THEN RAISE EXCEPTION 'Target company is not active'; END IF;
  IF p_location_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.company_locations WHERE id=p_location_id AND company_id=p_company_id) THEN RAISE EXCEPTION 'Target service area does not belong to the company'; END IF;
  v_start:=p_start_time::time;
  v_rule:=public.portal_assert_slot_capacity(p_company_id,p_location_id,p_date,v_start,NULL,CASE WHEN v_appt.company_id=p_company_id THEN v_appt.id ELSE NULL END,true);
  SELECT * INTO v_settings FROM public.company_portal_settings WHERE company_id=p_company_id;
  v_old:=jsonb_build_object('company_id',v_lead.company_id,'location_id',v_lead.location_id,'date',v_appt.appointment_date,'start_time',v_appt.start_time);
  UPDATE public.portal_leads SET company_id=p_company_id,location_id=p_location_id,package_id=public.portal_active_package(p_company_id),qc_status='pending',qc_reason=nullif(trim(coalesce(p_reason,'')),''),qc_reviewed_by=NULL,qc_reviewed_at=NULL
  WHERE id=p_lead_id RETURNING * INTO v_lead;
  UPDATE public.portal_appointments SET company_id=p_company_id,location_id=p_location_id,appointment_date=p_date,start_time=v_start,end_time=(v_start+make_interval(mins=>v_rule.slot_minutes))::time,timezone=coalesce(v_settings.timezone,'America/Chicago'),status='qc_pending',representative_id=NULL,rep_status='unassigned',company_visible_at=NULL
  WHERE id=v_appt.id RETURNING * INTO v_appt;
  PERFORM public.portal_write_audit(p_company_id,CASE WHEN public.portal_is_admin() THEN 'admin' ELSE 'qc' END,auth.uid(),public.portal_actor_name_for_management(),'qc_lead_reassigned','lead',v_lead.id,v_old,jsonb_build_object('company_id',p_company_id,'location_id',p_location_id,'date',p_date,'start_time',v_start),jsonb_build_object('reason',p_reason));
  RETURN jsonb_build_object('lead',to_jsonb(v_lead),'appointment',to_jsonb(v_appt));
END;
$function$;

