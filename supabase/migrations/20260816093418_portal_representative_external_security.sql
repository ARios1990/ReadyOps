-- Imported from the hosted ReadyOp Supabase migration history on 2026-08-28.
-- Schema only: no production table data is included.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_representative_portal(
  p_access_token uuid,
  p_start_date date,
  p_end_date date
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_rep public.company_representatives%ROWTYPE;
BEGIN
  SELECT * INTO v_rep FROM public.company_representatives r WHERE r.access_token=p_access_token AND r.active;
  IF v_rep.id IS NULL THEN RAISE EXCEPTION 'Representative link is invalid or disabled'; END IF;
  RETURN jsonb_build_object(
    'representative', to_jsonb(v_rep)-'access_token',
    'company', (SELECT to_jsonb(c) FROM public.roster_companies c WHERE c.id=v_rep.company_id),
    'settings', (SELECT jsonb_build_object(
      'timezone',s.timezone,'check_in_radius_m',s.check_in_radius_m,
      'check_in_before_minutes',s.check_in_before_minutes,'check_in_after_minutes',s.check_in_after_minutes
    ) FROM public.company_portal_settings s WHERE s.company_id=v_rep.company_id),
    'appointments', coalesce((
      SELECT jsonb_agg(
        to_jsonb(a)
        || jsonb_build_object(
          'lead',to_jsonb(l),
          'location_label',loc.location_label,
          'latest_checkin',(
            SELECT to_jsonb(ci) FROM public.appointment_checkins ci
            WHERE ci.appointment_id=a.id ORDER BY ci.checked_in_at DESC LIMIT 1
          ),
          'timeline',coalesce((
            SELECT jsonb_agg(to_jsonb(al) ORDER BY al.created_at)
            FROM public.portal_audit_logs al
            WHERE al.entity_type='appointment' AND al.entity_id=a.id
          ),'[]'::jsonb)
        ) ORDER BY a.appointment_date,a.start_time
      )
      FROM public.portal_appointments a
      JOIN public.portal_leads l ON l.id=a.lead_id
      LEFT JOIN public.company_locations loc ON loc.id=a.location_id
      WHERE a.representative_id=v_rep.id
        AND a.appointment_date BETWEEN p_start_date AND p_end_date
        AND a.status NOT IN ('cancelled','rescheduled')
    ),'[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.representative_update_appointment(
  p_access_token uuid,
  p_appointment_id uuid,
  p_action text,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_rep public.company_representatives%ROWTYPE;
  v_old public.portal_appointments%ROWTYPE;
  v_new public.portal_appointments%ROWTYPE;
BEGIN
  SELECT * INTO v_rep FROM public.company_representatives r WHERE r.access_token=p_access_token AND r.active;
  IF v_rep.id IS NULL THEN RAISE EXCEPTION 'Representative link is invalid or disabled'; END IF;
  SELECT * INTO v_old FROM public.portal_appointments a WHERE a.id=p_appointment_id AND a.representative_id=v_rep.id FOR UPDATE;
  IF v_old.id IS NULL THEN RAISE EXCEPTION 'Appointment is not assigned to this representative'; END IF;

  IF p_action = 'en_route' THEN
    UPDATE public.portal_appointments SET rep_status='en_route' WHERE id=v_old.id RETURNING * INTO v_new;
  ELSIF p_action = 'arrived' THEN
    UPDATE public.portal_appointments SET rep_status='arrived',attendance_status=CASE WHEN attendance_status='verified_show' THEN attendance_status ELSE 'unverified_show' END WHERE id=v_old.id RETURNING * INTO v_new;
  ELSIF p_action = 'inspection_started' THEN
    UPDATE public.portal_appointments SET rep_status='inspection_started',inspection_status='started',attendance_status=CASE WHEN attendance_status='verified_show' THEN attendance_status ELSE 'unverified_show' END WHERE id=v_old.id RETURNING * INTO v_new;
  ELSIF p_action = 'inspection_completed' THEN
    UPDATE public.portal_appointments SET rep_status='inspection_completed',inspection_status='completed',status='completed',attendance_status=CASE WHEN attendance_status='verified_show' THEN attendance_status ELSE 'unverified_show' END WHERE id=v_old.id RETURNING * INTO v_new;
  ELSIF p_action = 'homeowner_no_show' THEN
    UPDATE public.portal_appointments SET attendance_status='homeowner_no_show',inspection_status='not_completed' WHERE id=v_old.id RETURNING * INTO v_new;
  ELSIF p_action = 'rep_no_show' THEN
    UPDATE public.portal_appointments SET attendance_status='rep_no_show',inspection_status='not_completed' WHERE id=v_old.id RETURNING * INTO v_new;
  ELSIF p_action = 'homeowner_cancelled' THEN
    UPDATE public.portal_appointments SET attendance_status='cancelled',status='cancelled',inspection_status='not_completed' WHERE id=v_old.id RETURNING * INTO v_new;
  ELSIF p_action = 'follow_up' THEN
    UPDATE public.portal_appointments SET rep_status='follow_up',sales_outcome='follow_up' WHERE id=v_old.id RETURNING * INTO v_new;
  ELSIF p_action = 'signed_contract' THEN
    UPDATE public.portal_appointments SET sales_outcome='signed_contract',status='completed',inspection_status=CASE WHEN inspection_status='not_started' THEN 'completed' ELSE inspection_status END WHERE id=v_old.id RETURNING * INTO v_new;
  ELSIF p_action = 'lost' THEN
    UPDATE public.portal_appointments SET sales_outcome='lost' WHERE id=v_old.id RETURNING * INTO v_new;
  ELSE
    RAISE EXCEPTION 'Unsupported representative action';
  END IF;

  PERFORM public.portal_write_audit(
    v_rep.company_id,'representative',v_rep.id,v_rep.name,
    p_action,'appointment',v_new.id,to_jsonb(v_old),to_jsonb(v_new),jsonb_build_object('note',p_note)
  );
  RETURN to_jsonb(v_new);
END;
$$;

CREATE OR REPLACE FUNCTION public.portal_haversine_meters(
  lat1 double precision,
  lon1 double precision,
  lat2 double precision,
  lon2 double precision
)
RETURNS double precision
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT 6371000 * 2 * asin(sqrt(
    power(sin(radians(lat2-lat1)/2),2)
    + cos(radians(lat1))*cos(radians(lat2))*power(sin(radians(lon2-lon1)/2),2)
  ));
$$;

CREATE OR REPLACE FUNCTION public.representative_check_in(
  p_access_token uuid,
  p_appointment_id uuid,
  p_latitude double precision,
  p_longitude double precision,
  p_accuracy_m double precision,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_rep public.company_representatives%ROWTYPE;
  v_appt public.portal_appointments%ROWTYPE;
  v_lead public.portal_leads%ROWTYPE;
  v_settings public.company_portal_settings%ROWTYPE;
  v_distance double precision;
  v_verified boolean := false;
  v_timing text := 'within_window';
  v_checkin public.appointment_checkins%ROWTYPE;
  v_scheduled timestamptz;
BEGIN
  SELECT * INTO v_rep FROM public.company_representatives r WHERE r.access_token=p_access_token AND r.active;
  IF v_rep.id IS NULL THEN RAISE EXCEPTION 'Representative link is invalid or disabled'; END IF;
  SELECT * INTO v_appt FROM public.portal_appointments a WHERE a.id=p_appointment_id AND a.representative_id=v_rep.id FOR UPDATE;
  IF v_appt.id IS NULL THEN RAISE EXCEPTION 'Appointment is not assigned to this representative'; END IF;
  SELECT * INTO v_lead FROM public.portal_leads WHERE id=v_appt.lead_id;
  SELECT * INTO v_settings FROM public.company_portal_settings WHERE company_id=v_rep.company_id;

  v_scheduled := (v_appt.appointment_date + v_appt.start_time) AT TIME ZONE v_settings.timezone;
  IF now() < v_scheduled - make_interval(mins=>v_settings.check_in_before_minutes) THEN v_timing := 'too_early';
  ELSIF now() > v_scheduled + make_interval(mins=>v_settings.check_in_after_minutes) THEN v_timing := 'too_late';
  END IF;

  IF v_lead.property_latitude IS NOT NULL AND v_lead.property_longitude IS NOT NULL THEN
    v_distance := public.portal_haversine_meters(p_latitude,p_longitude,v_lead.property_latitude,v_lead.property_longitude);
    v_verified := v_distance <= v_settings.check_in_radius_m AND v_timing='within_window';
  END IF;

  INSERT INTO public.appointment_checkins(
    appointment_id,representative_id,latitude,longitude,accuracy_m,distance_m,verified,timing_status,note
  ) VALUES (
    v_appt.id,v_rep.id,p_latitude,p_longitude,p_accuracy_m,v_distance,v_verified,v_timing,nullif(trim(coalesce(p_note,'')),'')
  ) RETURNING * INTO v_checkin;

  UPDATE public.portal_appointments
  SET
    rep_status='arrived',
    attendance_status=CASE WHEN v_verified THEN 'verified_show' ELSE 'unverified_show' END
  WHERE id=v_appt.id;

  PERFORM public.portal_write_audit(
    v_rep.company_id,'representative',v_rep.id,v_rep.name,
    'gps_check_in','appointment',v_appt.id,NULL,to_jsonb(v_checkin),
    jsonb_build_object('property_coordinates_available',v_lead.property_latitude IS NOT NULL AND v_lead.property_longitude IS NOT NULL)
  );

  RETURN jsonb_build_object(
    'checkin',to_jsonb(v_checkin),
    'verified',v_verified,
    'distance_m',v_distance,
    'timing_status',v_timing,
    'property_coordinates_available',v_lead.property_latitude IS NOT NULL AND v_lead.property_longitude IS NOT NULL
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_external_form_submission(
  p_company_id uuid,
  p_secret uuid,
  p_lead_code text,
  p_provider_submission_id text,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_settings public.company_portal_settings%ROWTYPE;
  v_lead public.portal_leads%ROWTYPE;
  v_appt public.portal_appointments%ROWTYPE;
  v_mapped jsonb := '{}'::jsonb;
  v_key text;
  v_external_key text;
  v_value jsonb;
  v_event public.external_form_events%ROWTYPE;
BEGIN
  SELECT * INTO v_settings FROM public.company_portal_settings s
  WHERE s.company_id=p_company_id AND s.external_webhook_secret=p_secret;
  IF v_settings.company_id IS NULL THEN RAISE EXCEPTION 'Invalid webhook secret'; END IF;

  IF p_provider_submission_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.external_form_events e
    WHERE e.company_id=p_company_id AND e.provider_submission_id=p_provider_submission_id
  ) THEN
    RETURN jsonb_build_object('status','duplicate');
  END IF;

  SELECT * INTO v_lead FROM public.portal_leads l
  WHERE l.company_id=p_company_id AND l.lead_code=p_lead_code
  FOR UPDATE;
  IF v_lead.id IS NULL THEN RAISE EXCEPTION 'Lead code was not found'; END IF;
  SELECT * INTO v_appt FROM public.portal_appointments a WHERE a.lead_id=v_lead.id;

  FOR v_key,v_value IN SELECT key,value FROM jsonb_each(v_settings.external_submission_map) LOOP
    v_external_key := trim(both '"' FROM v_value::text);
    IF p_payload ? v_external_key THEN
      v_mapped := v_mapped || jsonb_build_object(v_key,p_payload->v_external_key);
    END IF;
  END LOOP;

  UPDATE public.portal_leads
  SET
    form_data = form_data || v_mapped,
    external_form_status='synced',
    external_submission_id=p_provider_submission_id
  WHERE id=v_lead.id RETURNING * INTO v_lead;

  UPDATE public.portal_appointments SET external_form_status='synced' WHERE id=v_appt.id;

  INSERT INTO public.external_form_events(company_id,lead_id,appointment_id,provider,provider_submission_id,payload,status)
  VALUES (p_company_id,v_lead.id,v_appt.id,v_settings.external_form_provider,p_provider_submission_id,p_payload,'synced')
  RETURNING * INTO v_event;

  PERFORM public.portal_write_audit(p_company_id,'external_form',NULL,coalesce(v_settings.external_form_provider,'External Form'),'external_form_synced','appointment',v_appt.id,NULL,jsonb_build_object('lead_code',v_lead.lead_code,'mapped',v_mapped),jsonb_build_object('event_id',v_event.id));

  RETURN jsonb_build_object('status','synced','lead_id',v_lead.id,'appointment_id',v_appt.id,'mapped',v_mapped);
END;
$$;

ALTER TABLE public.company_portal_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_schedule_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_schedule_exceptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_representatives ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointment_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointment_checkins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.external_form_events ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'company_portal_settings','company_schedule_rules','company_schedule_exceptions','company_representatives',
    'portal_leads','appointment_reservations','portal_appointments','appointment_checkins','portal_audit_logs','external_form_events'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_admin_all', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (public.portal_is_admin()) WITH CHECK (public.portal_is_admin())',
      t || '_admin_all', t
    );
  END LOOP;
END $$;

REVOKE ALL ON public.company_portal_settings,public.company_schedule_rules,public.company_schedule_exceptions,
  public.company_representatives,public.portal_leads,public.appointment_reservations,public.portal_appointments,
  public.appointment_checkins,public.portal_audit_logs,public.external_form_events FROM anon;

GRANT SELECT,INSERT,UPDATE,DELETE ON public.company_portal_settings,public.company_schedule_rules,public.company_schedule_exceptions,
  public.company_representatives,public.portal_leads,public.appointment_reservations,public.portal_appointments,
  public.appointment_checkins,public.portal_audit_logs,public.external_form_events TO authenticated;

GRANT USAGE, SELECT ON SEQUENCE public.portal_lead_sequence TO authenticated;

REVOKE ALL ON FUNCTION public.portal_resolve_company_access(uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.portal_assert_slot_capacity(uuid,uuid,date,time,uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.portal_validate_slot(uuid,uuid,date,time) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.portal_write_audit(uuid,text,uuid,text,text,text,uuid,jsonb,jsonb,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.portal_expire_reservations() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.portal_next_lead_code() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.portal_actor_type_for_management(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.portal_actor_name_for_management() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_public_booking_portal(text,uuid,date,date) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_public_appointment_slot(text,uuid,date,text,uuid,text) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.undo_public_reservation_action(uuid,uuid) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.move_public_reservation_slot(uuid,uuid,uuid,date,text) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.submit_public_appointment(uuid,uuid,jsonb,text) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reschedule_public_appointment(uuid,uuid,date,text,text) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mark_external_form_opened(uuid) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_company_management_portal(uuid,uuid,date,date) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.update_company_portal_settings(uuid,uuid,jsonb) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.regenerate_company_access_token(uuid,uuid) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_company_schedule_rule(uuid,uuid,jsonb) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_company_schedule_exception(uuid,uuid,jsonb) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.delete_company_schedule_exception(uuid,uuid,uuid) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_company_representative(uuid,uuid,jsonb) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.update_company_representative(uuid,uuid,uuid,jsonb) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.assign_appointment_representative(uuid,uuid,uuid,uuid) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.company_update_appointment_status(uuid,uuid,uuid,text) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_representative_portal(uuid,date,date) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.representative_update_appointment(uuid,uuid,text,text) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.representative_check_in(uuid,uuid,double precision,double precision,double precision,text) TO anon,authenticated;

REVOKE ALL ON FUNCTION public.sync_external_form_submission(uuid,uuid,text,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_external_form_submission(uuid,uuid,text,text,jsonb) TO service_role;

COMMIT;
