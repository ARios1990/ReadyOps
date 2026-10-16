-- One occupancy model for calendar listings and all capacity checks.
CREATE OR REPLACE FUNCTION private.portal_slot_inventory(
 p_company_id uuid,p_location_id uuid,p_date date,p_start time,
 p_exclude_reservation_id uuid DEFAULT NULL,p_exclude_appointment_id uuid DEFAULT NULL
) RETURNS TABLE(slot_used integer,hour_used integer,day_used integer,day_booked integer,day_reserved integer,slot_limit integer,hour_limit integer,day_limit integer)
LANGUAGE sql STABLE SET search_path='' AS $function$
 WITH occupied AS (
  SELECT a.start_time,false AS held FROM public.portal_appointments a
  LEFT JOIN public.portal_leads l ON l.id=a.lead_id
  LEFT JOIN public.qc_review_cycles q ON q.lead_id=a.lead_id AND q.is_current
  WHERE a.company_id=p_company_id AND a.location_id IS NOT DISTINCT FROM p_location_id
   AND a.appointment_date=p_date AND a.status NOT IN ('cancelled','rescheduled','qc_denied')
   AND coalesce(q.status,l.qc_status,'pending')<>'denied'
   AND (p_exclude_appointment_id IS NULL OR a.id<>p_exclude_appointment_id)
  UNION ALL
  SELECT r.start_time,true FROM public.appointment_reservations r
  WHERE r.company_id=p_company_id AND r.location_id IS NOT DISTINCT FROM p_location_id
   AND r.appointment_date=p_date AND r.status='active' AND r.expires_at>now()
   AND (p_exclude_reservation_id IS NULL OR r.id<>p_exclude_reservation_id)
 ), counts AS (
  SELECT count(*) FILTER(WHERE start_time=p_start)::int slot_used,
   count(*) FILTER(WHERE extract(hour FROM start_time)=extract(hour FROM p_start))::int hour_used,
   count(*)::int day_used,count(*) FILTER(WHERE NOT held)::int day_booked,count(*) FILTER(WHERE held)::int day_reserved FROM occupied
 ), rule AS (SELECT (public.portal_find_rule(p_company_id,p_location_id,extract(dow FROM p_date)::int)).*)
 SELECT c.*,r.max_per_slot,coalesce(l.max_per_hour,2147483647),coalesce(l.max_per_day,r.max_per_day)
 FROM counts c CROSS JOIN rule r LEFT JOIN public.company_locations l ON l.id=p_location_id AND l.company_id=p_company_id AND l.active;
$function$;
REVOKE ALL ON FUNCTION private.portal_slot_inventory(uuid,uuid,date,time,uuid,uuid) FROM PUBLIC,anon,authenticated;

-- Capacity is shared across the entire day, so different hourly starts cannot
-- race past a daily/hourly limit while holding unrelated slot locks.
CREATE OR REPLACE FUNCTION public.portal_assert_slot_capacity(
 p_company_id uuid,p_location_id uuid,p_date date,p_start time,
 p_exclude_reservation_id uuid DEFAULT NULL,p_exclude_appointment_id uuid DEFAULT NULL,p_allow_past boolean DEFAULT false
) RETURNS public.company_schedule_rules LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE v_rule public.company_schedule_rules; v_counts record;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('booking-day:'||p_company_id::text||':'||coalesce(p_location_id::text,'all')||':'||p_date::text,0));
 v_rule:=public.portal_validate_slot(p_company_id,p_location_id,p_date,p_start,p_allow_past);
 PERFORM public.portal_expire_reservations();
 SELECT * INTO v_counts FROM private.portal_slot_inventory(p_company_id,p_location_id,p_date,p_start,p_exclude_reservation_id,p_exclude_appointment_id);
 IF v_counts.slot_used>=v_counts.slot_limit THEN RAISE EXCEPTION 'This appointment time was just taken. Please select another opening.'; END IF;
 IF v_counts.hour_used>=v_counts.hour_limit THEN RAISE EXCEPTION 'This location has reached its hourly appointment capacity.'; END IF;
 IF v_counts.day_used>=v_counts.day_limit THEN RAISE EXCEPTION 'This day has reached its appointment capacity.'; END IF;
 RETURN v_rule;
END;
$function$;

CREATE OR REPLACE FUNCTION private.lock_booking_appointment_days() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE k text;
BEGIN
 FOR k IN SELECT DISTINCT key FROM (
  SELECT 'booking-day:'||NEW.company_id::text||':'||coalesce(NEW.location_id::text,'all')||':'||NEW.appointment_date::text key
  UNION ALL
  SELECT 'booking-day:'||OLD.company_id::text||':'||coalesce(OLD.location_id::text,'all')||':'||OLD.appointment_date::text WHERE TG_OP='UPDATE'
 ) keys ORDER BY key LOOP PERFORM pg_advisory_xact_lock(hashtextextended(k,0)); END LOOP;
 RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION private.lock_booking_appointment_days() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS lock_booking_appointment_days ON public.portal_appointments;
CREATE TRIGGER lock_booking_appointment_days BEFORE INSERT OR UPDATE OF company_id,location_id,appointment_date,start_time,status ON public.portal_appointments FOR EACH ROW EXECUTE FUNCTION private.lock_booking_appointment_days();

CREATE OR REPLACE FUNCTION public.portal_slot_statuses(p_company_id uuid,p_location_id uuid,p_date date)
RETURNS TABLE(slot_start time,slot_end time,status text,booked_count integer,capacity integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE r public.company_schedule_rules; t timestamp; c record;
BEGIN
 r:=public.portal_find_rule(p_company_id,p_location_id,extract(dow FROM p_date)::int);
 IF r.id IS NULL OR NOT r.is_open THEN RETURN; END IF;
 IF p_location_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.company_locations l WHERE l.id=p_location_id AND l.company_id=p_company_id AND l.active) THEN RETURN; END IF;
 FOR t IN SELECT generate_series(p_date+r.start_time,p_date+r.end_time-make_interval(mins=>r.slot_minutes),make_interval(mins=>r.slot_minutes)) LOOP
  SELECT * INTO c FROM private.portal_slot_inventory(p_company_id,p_location_id,p_date,t::time);
  slot_start:=t::time;slot_end:=(t+make_interval(mins=>r.slot_minutes))::time;booked_count:=c.slot_used;capacity:=least(c.slot_limit,c.hour_limit);
  status:=CASE WHEN p_date<current_date THEN 'past' WHEN public.portal_slot_is_blocked(p_company_id,p_location_id,p_date,slot_start,slot_end) THEN 'blocked' WHEN c.day_used>=c.day_limit OR c.hour_used>=c.hour_limit OR c.slot_used>=c.slot_limit THEN 'full' ELSE 'available' END;
  RETURN NEXT;
 END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_public_booking_portal(p_slug text, p_location_id uuid, p_start_date date, p_end_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_company public.roster_companies%ROWTYPE;
  v_settings public.company_portal_settings%ROWTYPE;
  v_date date;
  v_rule public.company_schedule_rules%ROWTYPE;
  v_slot_ts timestamp;
  v_slot_end time;
  v_slot_used integer;
  v_day_booked integer;
  v_day_reserved integer;
  v_daily_remaining integer;
  v_slot_open integer;
  v_open_sum integer;
  v_slots jsonb;
  v_days jsonb := '[]'::jsonb;
  v_day_closed boolean;
  v_location_valid boolean;
  v_counts record;
  v_hour_remaining integer;
BEGIN
  IF p_end_date < p_start_date OR p_end_date > p_start_date + 31 THEN
    RAISE EXCEPTION 'Availability range must be between 1 and 32 days';
  END IF;

  SELECT c.*
  INTO v_company
  FROM public.roster_companies c
  JOIN public.company_portal_settings s ON s.company_id = c.id
  WHERE s.public_slug = p_slug
    AND s.portal_enabled
    AND c.account_status = 'Active';

  IF v_company.id IS NOT NULL THEN
    SELECT s.* INTO v_settings
    FROM public.company_portal_settings s
    WHERE s.company_id = v_company.id;
  END IF;

  IF v_company.id IS NULL THEN
    RAISE EXCEPTION 'Company booking page was not found or is disabled';
  END IF;

  IF p_location_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.company_locations l
      WHERE l.id = p_location_id AND l.company_id = v_company.id
    ) INTO v_location_valid;
    IF NOT v_location_valid THEN
      RAISE EXCEPTION 'Invalid service area';
    END IF;
  END IF;

  FOR v_date IN SELECT generate_series(p_start_date, p_end_date, interval '1 day')::date LOOP
    v_rule := public.portal_find_rule(v_company.id, p_location_id, extract(dow FROM v_date)::integer);
    v_slots := '[]'::jsonb;
    v_open_sum := 0;
    v_day_closed := v_rule.id IS NULL OR NOT v_rule.is_open OR EXISTS (
      SELECT 1 FROM public.company_schedule_exceptions e
      WHERE e.company_id = v_company.id
        AND e.exception_date = v_date
        AND (e.location_id IS NULL OR e.location_id = p_location_id)
        AND e.is_closed
    );

    SELECT * INTO v_counts FROM private.portal_slot_inventory(v_company.id,p_location_id,v_date,coalesce(v_rule.start_time,'09:00'::time));
    v_day_booked:=v_counts.day_booked; v_day_reserved:=v_counts.day_reserved;
    v_day_closed:=v_day_closed OR v_date<current_date;
    IF NOT v_day_closed THEN
      v_daily_remaining := greatest(v_counts.day_limit - v_day_booked - v_day_reserved, 0);

      FOR v_slot_ts IN
        SELECT generate_series(
          v_date + v_rule.start_time,
          v_date + v_rule.end_time - make_interval(mins => v_rule.slot_minutes),
          make_interval(mins => v_rule.slot_minutes)
        )
      LOOP
        v_slot_end := (v_slot_ts::time + make_interval(mins => v_rule.slot_minutes))::time;

        SELECT * INTO v_counts FROM private.portal_slot_inventory(v_company.id,p_location_id,v_date,v_slot_ts::time);
        v_slot_used:=v_counts.slot_used;
        v_hour_remaining:=greatest(v_counts.hour_limit-v_counts.hour_used,0);
        IF public.portal_slot_is_blocked(v_company.id, p_location_id, v_date, v_slot_ts::time, v_slot_end) THEN
          v_slot_open := 0;
          v_slots := v_slots || jsonb_build_array(jsonb_build_object(
            'start_time', to_char(v_slot_ts, 'HH24:MI'),
            'end_time', to_char(v_slot_end, 'HH24:MI'),
            'status', 'blocked',
            'openings', 0
          ));
        ELSE
          v_slot_open := greatest(least(v_counts.slot_limit-v_slot_used,v_hour_remaining,v_daily_remaining),0);
          IF v_daily_remaining = 0 THEN
            v_slot_open := 0;
          END IF;
          v_open_sum := v_open_sum + v_slot_open;
          v_slots := v_slots || jsonb_build_array(jsonb_build_object(
            'start_time', to_char(v_slot_ts, 'HH24:MI'),
            'end_time', to_char(v_slot_end, 'HH24:MI'),
            'status', CASE WHEN v_slot_open > 0 THEN 'available' ELSE 'booked' END,
            'openings', v_slot_open,
            'capacity', least(v_counts.slot_limit,v_counts.hour_limit),
            'booked', v_slot_used,
            'hour_remaining', v_hour_remaining
          ));
        END IF;
      END LOOP;

      SELECT coalesce(sum(remaining),0)::int INTO v_open_sum FROM (
        SELECT least(sum((s->>'openings')::int),max((s->>'hour_remaining')::int)) remaining
        FROM jsonb_array_elements(v_slots) s WHERE s->>'status'='available'
        GROUP BY left(s->>'start_time',2)
      ) hours;
      v_open_sum := least(v_open_sum, v_daily_remaining);
    ELSE
      v_daily_remaining := 0;
      v_open_sum := 0;
    END IF;

    v_days := v_days || jsonb_build_array(jsonb_build_object(
      'date', v_date,
      'day_name', trim(to_char(v_date, 'Day')),
      'closed', v_day_closed,
      'openings', v_open_sum,
      'booked', v_day_booked,
      'reserved', v_day_reserved,
      'capacity', CASE WHEN v_rule.id IS NULL THEN 0 ELSE v_counts.day_limit END,
      'slots', v_slots
    ));
  END LOOP;

  RETURN jsonb_build_object(
    'company', jsonb_build_object(
      'id', v_company.id,
      'name', v_company.name,
      'state', v_company.state,
      'website', v_company.website,
      'phone', v_company.phone,
      'public_slug', v_settings.public_slug
    ),
    'settings', jsonb_build_object(
      'timezone', v_settings.timezone,
      'requirements_short', v_settings.requirements_short,
      'requirements_detail', v_settings.requirements_detail,
      'qualification_rules', v_settings.qualification_rules,
      'form_mode', v_settings.form_mode,
      'form_schema', v_settings.form_schema,
      'external_form_provider', v_settings.external_form_provider,
      'external_form_url', v_settings.external_form_url,
      'external_prefill_map', v_settings.external_prefill_map,
      'allow_public_booking', v_settings.allow_public_booking
    ),
    'locations', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', l.id,
        'label', l.location_label,
        'city', l.city,
        'state', l.state,
        'zip_code', l.zip_code
      ) ORDER BY l.sort_order, l.location_label)
      FROM public.company_locations l
      WHERE l.company_id = v_company.id
    ), '[]'::jsonb),
    'selected_location_id', p_location_id,
    'days', v_days
  );
END;
$function$
;
