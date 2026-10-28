-- Extend the existing exception ledger; no appointments, assignments or weekly rules
-- are rewritten by this migration. All surfaces use the same inventory and day view.
DO $$ DECLARE table_name text; BEGIN
 IF EXISTS(SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') THEN
  FOREACH table_name IN ARRAY ARRAY['company_schedule_rules','company_schedule_exceptions'] LOOP
   IF NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename=table_name) THEN
    EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I',table_name);
   END IF;
  END LOOP;
 END IF;
END; $$;
ALTER TABLE public.company_schedule_exceptions
  ADD COLUMN override_kind text NOT NULL DEFAULT 'block'
    CHECK (override_kind IN ('block','capacity','open')),
  ADD COLUMN capacity_limit integer CHECK (capacity_limit BETWEEN 0 AND 50),
  ADD COLUMN cancelled_at timestamptz;

CREATE OR REPLACE FUNCTION public.save_company_location_schedule(p_company_id uuid,p_location_id uuid,p_patch jsonb,p_apply_weekly boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE old public.company_locations; draft public.company_locations; saved public.company_locations; d integer;
BEGIN
 IF NOT public.portal_is_admin() THEN RAISE EXCEPTION 'Administrator required'; END IF;
 IF p_location_id IS NOT NULL THEN
  SELECT * INTO old FROM public.company_locations WHERE id=p_location_id AND company_id=p_company_id FOR UPDATE;
  IF old.id IS NULL THEN RAISE EXCEPTION 'Invalid location'; END IF;
 END IF;
 draft:=jsonb_populate_record(old,p_patch-'id'-'company_id'-'active'-'created_at'-'updated_at');
 IF nullif(trim(draft.location_label),'') IS NULL THEN RAISE EXCEPTION 'Location name is required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=draft.timezone) THEN RAISE EXCEPTION 'Choose a valid IANA timezone'; END IF;
 IF draft.end_time<=draft.start_time OR draft.slot_interval_minutes NOT BETWEEN 15 AND 480 OR draft.max_per_hour NOT BETWEEN 1 AND 50 OR draft.max_per_day NOT BETWEEN 1 AND 250 THEN RAISE EXCEPTION 'Invalid schedule hours, interval, or capacity'; END IF;
 IF p_location_id IS NULL THEN
  INSERT INTO public.company_locations(company_id,location_label,office_name,address,city,state,zip_code,service_cities,service_zips,phone,email,manager_name,timezone,available_days,start_time,end_time,slot_interval_minutes,max_per_hour,max_per_day,notes)
   VALUES(p_company_id,draft.location_label,draft.office_name,draft.address,draft.city,draft.state,draft.zip_code,draft.service_cities,draft.service_zips,draft.phone,draft.email,draft.manager_name,draft.timezone,draft.available_days,draft.start_time,draft.end_time,draft.slot_interval_minutes,draft.max_per_hour,draft.max_per_day,draft.notes) RETURNING * INTO saved;
 ELSE
  UPDATE public.company_locations SET location_label=draft.location_label,office_name=draft.office_name,address=draft.address,city=draft.city,state=draft.state,zip_code=draft.zip_code,
   service_cities=draft.service_cities,service_zips=draft.service_zips,phone=draft.phone,email=draft.email,manager_name=draft.manager_name,timezone=draft.timezone,
   available_days=draft.available_days,start_time=draft.start_time,end_time=draft.end_time,slot_interval_minutes=draft.slot_interval_minutes,max_per_hour=draft.max_per_hour,max_per_day=draft.max_per_day,notes=draft.notes,updated_at=now()
  WHERE id=p_location_id AND company_id=p_company_id RETURNING * INTO saved;
 END IF;
 IF p_apply_weekly OR p_location_id IS NULL THEN
  FOR d IN 0..6 LOOP
   PERFORM public.upsert_company_schedule_rule(p_company_id,NULL,jsonb_build_object('location_id',saved.id,'day_of_week',d,
    'is_open',(ARRAY['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'])[d+1]=ANY(saved.available_days),
    'start_time',saved.start_time,'end_time',saved.end_time,'slot_minutes',saved.slot_interval_minutes,'max_per_slot',saved.max_per_hour,'max_per_day',saved.max_per_day));
  END LOOP;
 END IF;
 PERFORM public.portal_write_audit(p_company_id,'admin',auth.uid(),public.portal_actor_name_for_management(),'location_schedule_saved','company_location',saved.id,to_jsonb(old),to_jsonb(saved),jsonb_build_object('weekly_template_applied',p_apply_weekly));
 RETURN to_jsonb(saved);
END; $$;
REVOKE ALL ON FUNCTION public.save_company_location_schedule(uuid,uuid,jsonb,boolean) FROM public,anon;
GRANT EXECUTE ON FUNCTION public.save_company_location_schedule(uuid,uuid,jsonb,boolean) TO authenticated;

CREATE OR REPLACE FUNCTION private.schedule_timezone(p_company uuid,p_location uuid)
RETURNS text LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT coalesce((SELECT l.timezone FROM public.company_locations l WHERE l.id=p_location AND l.company_id=p_company),
   (SELECT s.timezone FROM public.company_portal_settings s WHERE s.company_id=p_company),'America/Chicago');
$$;

CREATE OR REPLACE FUNCTION private.schedule_access(p_company uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=auth.uid() AND p.active AND
  (p.role IN ('admin','qc') OR p.role='company' AND EXISTS(SELECT 1 FROM public.company_user_access ca WHERE ca.user_id=p.id AND ca.company_id=p_company) OR (p.role IN ('agent','manager') AND
   (NOT EXISTS(SELECT 1 FROM public.company_teams ct WHERE ct.company_id=p_company)
     AND NOT EXISTS(SELECT 1 FROM public.roster_companies c WHERE c.id=p_company AND c.team_id IS NOT NULL)
    OR EXISTS(SELECT 1 FROM public.company_teams ct WHERE ct.company_id=p_company AND ct.team_id=coalesce(p.team_id,(SELECT a.team_id FROM public.agents a WHERE a.id=p.agent_id)))
    OR NOT EXISTS(SELECT 1 FROM public.company_teams ct WHERE ct.company_id=p_company)
      AND EXISTS(SELECT 1 FROM public.roster_companies c WHERE c.id=p_company AND c.team_id=coalesce(p.team_id,(SELECT a.team_id FROM public.agents a WHERE a.id=p.agent_id)))))));
$$;

CREATE OR REPLACE FUNCTION public.portal_slot_is_blocked(p_company_id uuid,p_location_id uuid,p_date date,p_start time,p_end time)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.company_locations l WHERE l.id=p_location_id AND l.company_id=p_company_id AND
   (NOT l.active OR (NOT EXISTS(SELECT 1 FROM public.company_schedule_rules r WHERE r.company_id=p_company_id AND r.location_id=p_location_id AND r.day_of_week=extract(dow FROM p_date))
     AND (NOT(trim(to_char(p_date,'Day'))=ANY(l.available_days)) OR p_start<l.start_time OR p_end>l.end_time))))
 OR EXISTS(SELECT 1 FROM public.company_schedule_exceptions e WHERE e.company_id=p_company_id AND e.exception_date=p_date
   AND (e.location_id IS NULL OR e.location_id=p_location_id) AND e.cancelled_at IS NULL AND e.override_kind='block'
   AND (e.is_closed OR p_start<e.end_time AND p_end>e.start_time)
   AND NOT EXISTS(SELECT 1 FROM public.company_schedule_exceptions opened WHERE opened.company_id=e.company_id
     AND opened.location_id IS NOT DISTINCT FROM e.location_id AND opened.exception_date=e.exception_date
     AND opened.cancelled_at IS NULL AND opened.override_kind='open' AND opened.created_at>e.created_at
     AND (opened.is_closed OR p_start>=opened.start_time AND p_end<=opened.end_time)))
 OR (EXISTS(SELECT 1 FROM public.company_bookings b WHERE b.company_id=p_company_id AND b.day=trim(to_char(p_date,'Day'))
   AND b.time_slot=to_char(p_start,'FMHH12') AND extract(minute FROM p_start)=0 AND(b.location_id IS NULL OR b.location_id=p_location_id))
   AND NOT EXISTS(SELECT 1 FROM public.company_schedule_exceptions e WHERE e.company_id=p_company_id AND e.exception_date=p_date
    AND e.location_id IS NOT DISTINCT FROM p_location_id AND e.cancelled_at IS NULL AND e.override_kind='open'
    AND (e.is_closed OR p_start<e.end_time AND p_end>e.start_time)));
$$;

CREATE OR REPLACE FUNCTION private.schedule_slot_limit(p_company uuid,p_location uuid,p_date date,p_start time,p_base integer)
RETURNS integer LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT least(p_base,coalesce((SELECT min(e.capacity_limit) FROM public.company_schedule_exceptions e
  WHERE e.company_id=p_company AND (e.location_id IS NULL OR e.location_id=p_location) AND e.exception_date=p_date
  AND e.cancelled_at IS NULL AND e.override_kind='capacity' AND(e.is_closed OR p_start>=e.start_time AND p_start<e.end_time)),p_base));
$$;

CREATE OR REPLACE FUNCTION private.schedule_day(p_company uuid,p_location uuid,p_date date)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE r public.company_schedule_rules; t timestamp; c record; tz text; s text; remaining integer; slots jsonb:='[]'; openings integer:=0; day_booked integer:=0; day_held integer:=0; day_limit integer:=0;
BEGIN
 IF p_location IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.company_locations WHERE id=p_location AND company_id=p_company AND active) THEN
  RAISE EXCEPTION 'Invalid or inactive company location'; END IF;
 tz:=private.schedule_timezone(p_company,p_location);
 r:=public.portal_find_rule(p_company,p_location,extract(dow FROM p_date)::int);
 SELECT * INTO c FROM private.portal_slot_inventory(p_company,p_location,p_date,coalesce(r.start_time,'09:00'));
 day_booked:=coalesce(c.day_booked,0);day_held:=coalesce(c.day_reserved,0);day_limit:=coalesce(c.day_limit,0);
 IF r.id IS NOT NULL AND r.is_open THEN
  FOR t IN SELECT generate_series(p_date+r.start_time,p_date+r.end_time-make_interval(mins=>r.slot_minutes),make_interval(mins=>r.slot_minutes)) LOOP
   SELECT * INTO c FROM private.portal_slot_inventory(p_company,p_location,p_date,t::time);
   remaining:=greatest(least(c.slot_limit-c.slot_used,c.hour_limit-c.hour_used,c.day_limit-c.day_used),0);
   s:=CASE WHEN p_date<(now() AT TIME ZONE tz)::date THEN 'past'
    WHEN (t AT TIME ZONE tz) AT TIME ZONE tz<>t OR ((t+make_interval(mins=>r.slot_minutes)) AT TIME ZONE tz) AT TIME ZONE tz<>t+make_interval(mins=>r.slot_minutes) THEN 'closed'
    WHEN public.portal_slot_is_blocked(p_company,p_location,p_date,t::time,(t+make_interval(mins=>r.slot_minutes))::time) THEN 'blocked'
    WHEN remaining=0 THEN 'full' ELSE 'available' END;
   IF s<>'available' THEN remaining:=0; END IF;
   slots:=slots||jsonb_build_array(jsonb_build_object('start_time',to_char(t,'HH24:MI'),'end_time',to_char(t+make_interval(mins=>r.slot_minutes),'HH24:MI'),
    'status',s,'openings',remaining,'capacity',least(c.slot_limit,c.hour_limit),'booked',c.slot_used,'hour_remaining',greatest(c.hour_limit-c.hour_used,0),
    'starts_at',t AT TIME ZONE tz));
  END LOOP;
 END IF;
 -- Slots in the same hour share the hourly limit. The daily limit is shared by
 -- every team and slot, so neither slot count nor team count multiplies capacity.
 SELECT least(greatest(day_limit-day_booked-day_held,0),coalesce(sum(x.n),0))::int INTO openings FROM (
  SELECT least(sum((j->>'openings')::int),max((j->>'hour_remaining')::int)) n FROM jsonb_array_elements(slots) j
  GROUP BY left(j->>'start_time',2)) x;
 RETURN jsonb_build_object('date',p_date,'day_name',trim(to_char(p_date,'Day')),'timezone',tz,'closed',jsonb_array_length(slots)=0 OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(slots) j WHERE j->>'status' IN ('available','full','blocked')),
  'openings',openings,'booked',day_booked,'reserved',day_held,'capacity',day_limit,'slots',slots);
END; $$;

CREATE OR REPLACE FUNCTION public.get_schedule_availability(p_company_id uuid,p_location_id uuid,p_date date,p_access_token uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT coalesce(private.schedule_access(p_company_id),false) THEN
  IF public.portal_resolve_company_access(p_company_id,p_access_token)<>p_company_id THEN RAISE EXCEPTION 'Access denied'; END IF;
 END IF;
 RETURN private.schedule_day(p_company_id,p_location_id,p_date);
END; $$;
REVOKE ALL ON FUNCTION public.get_schedule_availability(uuid,uuid,date,uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.get_schedule_availability(uuid,uuid,date,uuid) TO authenticated,anon;

CREATE OR REPLACE FUNCTION public.portal_slot_statuses(p_company_id uuid,p_location_id uuid,p_date date)
RETURNS TABLE(slot_start time,slot_end time,status text,booked_count integer,capacity integer)
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT (s->>'start_time')::time,(s->>'end_time')::time,s->>'status',(s->>'booked')::int,(s->>'capacity')::int
 FROM jsonb_array_elements(private.schedule_day(p_company_id,p_location_id,p_date)->'slots') s;
$$;

CREATE OR REPLACE FUNCTION public.portal_validate_slot(p_company_id uuid,p_location_id uuid,p_date date,p_start time,p_allow_past boolean DEFAULT false)
RETURNS public.company_schedule_rules LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.company_schedule_rules; finish timestamp; tz text;
BEGIN
 tz:=private.schedule_timezone(p_company_id,p_location_id);
 IF p_date<(now() AT TIME ZONE tz)::date AND NOT(p_allow_past AND public.portal_is_qc_or_admin()) THEN RAISE EXCEPTION 'Past appointment dates are not available'; END IF;
 IF p_location_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.company_locations WHERE id=p_location_id AND company_id=p_company_id AND active) THEN RAISE EXCEPTION 'Invalid or inactive company location'; END IF;
 r:=public.portal_find_rule(p_company_id,p_location_id,extract(dow FROM p_date)::int);
 IF r.id IS NULL OR NOT r.is_open THEN RAISE EXCEPTION 'The company is closed on this date'; END IF;
 finish:=p_date+p_start+make_interval(mins=>r.slot_minutes);
 IF p_start<r.start_time OR finish>p_date+r.end_time OR extract(second FROM p_start)<>0
  OR mod((extract(epoch FROM (p_start-r.start_time))/60)::int,r.slot_minutes)<>0 THEN RAISE EXCEPTION 'The requested time is outside company hours or interval'; END IF;
 IF ((p_date+p_start) AT TIME ZONE tz) AT TIME ZONE tz<>p_date+p_start OR (finish AT TIME ZONE tz) AT TIME ZONE tz<>finish THEN RAISE EXCEPTION 'This local time does not exist because of daylight saving time'; END IF;
 IF public.portal_slot_is_blocked(p_company_id,p_location_id,p_date,p_start,finish::time) THEN RAISE EXCEPTION 'The requested time is blocked'; END IF;
 RETURN r;
END; $$;

CREATE OR REPLACE FUNCTION public.manage_schedule_slots(p_company_id uuid,p_location_id uuid,p_date date,p_action text,p_slots jsonb DEFAULT '[]',p_capacity integer DEFAULT NULL,p_note text DEFAULT '',p_access_token uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE company uuid; item jsonb; old public.company_schedule_exceptions; saved public.company_schedule_exceptions; st time; en time; whole boolean; items jsonb;
BEGIN
 company:=public.portal_resolve_company_access(p_company_id,p_access_token);
 IF company<>p_company_id OR p_action NOT IN('block','unblock','capacity','reset_capacity') THEN RAISE EXCEPTION 'Invalid schedule action'; END IF;
 IF p_location_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.company_locations WHERE id=p_location_id AND company_id=company AND active) THEN RAISE EXCEPTION 'Invalid location'; END IF;
 IF p_action='capacity' AND(p_capacity IS NULL OR p_capacity NOT BETWEEN 0 AND 50) THEN RAISE EXCEPTION 'Capacity must be between 0 and 50'; END IF;
 IF jsonb_typeof(p_slots)<>'array' OR jsonb_array_length(p_slots)>96 THEN RAISE EXCEPTION 'Invalid slots'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('booking-day:'||company||':'||coalesce(p_location_id::text,'all')||':'||p_date,0));
 whole:=jsonb_array_length(p_slots)=0;items:=CASE WHEN whole THEN '[{}]'::jsonb ELSE p_slots END;
 FOR item IN SELECT * FROM jsonb_array_elements(items) LOOP
  st:=nullif(item->>'start_time','')::time;en:=nullif(item->>'end_time','')::time;
  IF NOT whole AND(st IS NULL OR en IS NULL OR en<=st) THEN RAISE EXCEPTION 'Invalid slot interval'; END IF;
  -- Retain previous exceptions for auditing. Reopening only touches this exact
  -- scope; a company-wide holiday must be reopened from the company-wide row.
  FOR old IN SELECT * FROM public.company_schedule_exceptions e WHERE e.company_id=company AND e.location_id IS NOT DISTINCT FROM p_location_id
   AND e.exception_date=p_date AND e.cancelled_at IS NULL
   AND (whole OR NOT e.is_closed AND e.start_time>=st AND e.end_time<=en)
   AND e.override_kind=CASE WHEN p_action IN('capacity','reset_capacity') THEN 'capacity' ELSE 'block' END FOR UPDATE LOOP
   UPDATE public.company_schedule_exceptions SET cancelled_at=now() WHERE id=old.id;
   PERFORM public.portal_write_audit(company,public.portal_actor_type_for_management(p_access_token),auth.uid(),public.portal_actor_name_for_management(),'schedule_exception_reopened','schedule_exception',old.id,to_jsonb(old),NULL,jsonb_build_object('reason',p_note));
  END LOOP;
  IF p_action<>'reset_capacity' THEN
   INSERT INTO public.company_schedule_exceptions(company_id,location_id,exception_date,is_closed,start_time,end_time,note,override_kind,capacity_limit)
    VALUES(company,p_location_id,p_date,whole,st,en,nullif(p_note,''),CASE p_action WHEN 'unblock' THEN 'open' WHEN 'capacity' THEN 'capacity' ELSE 'block' END,p_capacity) RETURNING * INTO saved;
   PERFORM public.portal_write_audit(company,public.portal_actor_type_for_management(p_access_token),auth.uid(),public.portal_actor_name_for_management(),'schedule_'||p_action,'schedule_exception',saved.id,NULL,to_jsonb(saved),'{}');
  END IF;
 END LOOP;
 RETURN private.schedule_day(company,p_location_id,p_date);
END; $$;
REVOKE ALL ON FUNCTION public.manage_schedule_slots(uuid,uuid,date,text,jsonb,integer,text,uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.manage_schedule_slots(uuid,uuid,date,text,jsonb,integer,text,uuid) TO authenticated,anon;

CREATE OR REPLACE FUNCTION public.get_schedule_slot_bookings(p_company_id uuid,p_location_id uuid,p_date date,p_start time,p_access_token uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF public.portal_resolve_company_access(p_company_id,p_access_token)<>p_company_id THEN RAISE EXCEPTION 'Access denied'; END IF;
 RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id',a.id,'name',l.full_name,'status',a.status,'time',a.start_time))
  FROM public.portal_appointments a LEFT JOIN public.portal_leads l ON l.id=a.lead_id
  WHERE a.company_id=p_company_id AND a.location_id IS NOT DISTINCT FROM p_location_id AND a.appointment_date=p_date AND a.start_time=p_start AND a.status NOT IN('cancelled','rescheduled','qc_denied')
    AND (public.portal_is_admin() OR a.company_visible_at IS NOT NULL AND l.qc_status='approved')),'[]');
END; $$;
REVOKE ALL ON FUNCTION public.get_schedule_slot_bookings(uuid,uuid,date,time,uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.get_schedule_slot_bookings(uuid,uuid,date,time,uuid) TO authenticated,anon;

-- Never expose private helpers as RPCs.
REVOKE ALL ON FUNCTION private.schedule_timezone(uuid,uuid),private.schedule_access(uuid),private.schedule_slot_limit(uuid,uuid,date,time,integer),private.schedule_day(uuid,uuid,date) FROM public,anon,authenticated;
REVOKE ALL ON FUNCTION public.portal_slot_statuses(uuid,uuid,date) FROM public,anon,authenticated;

CREATE OR REPLACE FUNCTION private.portal_slot_inventory(p_company_id uuid, p_location_id uuid, p_date date, p_start time without time zone, p_exclude_reservation_id uuid DEFAULT NULL::uuid, p_exclude_appointment_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(slot_used integer, hour_used integer, day_used integer, day_booked integer, day_reserved integer, slot_limit integer, hour_limit integer, day_limit integer)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
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
 SELECT c.*,private.schedule_slot_limit(p_company_id,p_location_id,p_date,p_start,r.max_per_slot),coalesce(l.max_per_hour,2147483647),least(l.max_per_day,r.max_per_day)
 FROM counts c CROSS JOIN rule r LEFT JOIN public.company_locations l ON l.id=p_location_id AND l.company_id=p_company_id AND l.active;
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
    v_days := v_days || jsonb_build_array(private.schedule_day(v_company.id,p_location_id,v_date));
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
$function$;

CREATE OR REPLACE FUNCTION public.reserve_public_appointment_slot(p_slug text, p_location_id uuid, p_date date, p_start_time text, p_session_id uuid, p_agent_name text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_company_id uuid;
  v_settings public.company_portal_settings%ROWTYPE;
  v_rule public.company_schedule_rules%ROWTYPE;
  v_res public.appointment_reservations%ROWTYPE;
  v_start time;
BEGIN
  SELECT s.* INTO v_settings
  FROM public.company_portal_settings s
  JOIN public.roster_companies c ON c.id = s.company_id
  WHERE s.public_slug = p_slug
    AND s.portal_enabled
    AND s.allow_public_booking
    AND c.account_status = 'Active';

  v_company_id := v_settings.company_id;

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Public booking is disabled for this company';
  END IF;

  IF p_session_id IS NULL THEN
    RAISE EXCEPTION 'A valid booking session is required';
  END IF;

  v_start := p_start_time::time;
  IF auth.uid() IS NOT NULL AND NOT private.schedule_access(v_company_id) THEN
    RAISE EXCEPTION 'This company is restricted to another team';
  END IF;
  v_rule := public.portal_assert_slot_capacity(v_company_id, p_location_id, p_date, v_start, NULL, NULL);

  INSERT INTO public.appointment_reservations(
    company_id, location_id, appointment_date, start_time, end_time,
    session_id, agent_name, status, last_action, undo_deadline, expires_at
  ) VALUES (
    v_company_id, p_location_id, p_date, v_start,
    (v_start + make_interval(mins => v_rule.slot_minutes))::time,
    p_session_id, coalesce(nullif(trim(p_agent_name), ''), 'Agent'),
    'active', 'reserve', now() + interval '45 seconds', now() + interval '10 minutes'
  ) RETURNING * INTO v_res;

  PERFORM public.portal_write_audit(
    v_company_id, 'agent', NULL, v_res.agent_name,
    'reservation_created', 'reservation', v_res.id,
    NULL,
    jsonb_build_object('date', v_res.appointment_date, 'start_time', v_res.start_time, 'location_id', v_res.location_id),
    jsonb_build_object('reservation_token', v_res.reservation_token)
  );

  RETURN jsonb_build_object(
    'id', v_res.id,
    'reservation_token', v_res.reservation_token,
    'appointment_date', v_res.appointment_date,
    'start_time', to_char(v_res.start_time, 'HH24:MI'),
    'end_time', to_char(v_res.end_time, 'HH24:MI'),
    'location_id', v_res.location_id,
    'last_action', v_res.last_action,
    'undo_deadline', v_res.undo_deadline,
    'expires_at', v_res.expires_at
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_company_schedule_exception(p_company_id uuid, p_access_token uuid, p_exception jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_company_id uuid;
  v_saved public.company_schedule_exceptions%ROWTYPE;
BEGIN
  v_company_id := public.portal_resolve_company_access(p_company_id,p_access_token);
  IF nullif(p_exception->>'location_id','') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.company_locations l WHERE l.id=(p_exception->>'location_id')::uuid AND l.company_id=v_company_id AND l.active) THEN RAISE EXCEPTION 'Invalid company location'; END IF;
  INSERT INTO public.company_schedule_exceptions(company_id,location_id,exception_date,is_closed,start_time,end_time,note)
  VALUES (
    v_company_id,
    nullif(p_exception->>'location_id','')::uuid,
    (p_exception->>'exception_date')::date,
    coalesce((p_exception->>'is_closed')::boolean,false),
    nullif(p_exception->>'start_time','')::time,
    nullif(p_exception->>'end_time','')::time,
    nullif(p_exception->>'note','')
  ) RETURNING * INTO v_saved;
  PERFORM public.portal_write_audit(v_company_id,public.portal_actor_type_for_management(p_access_token),auth.uid(),public.portal_actor_name_for_management(),'schedule_exception_created','schedule_exception',v_saved.id,NULL,to_jsonb(v_saved),'{}'::jsonb);
  RETURN to_jsonb(v_saved);
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_company_schedule_exception(p_company_id uuid, p_access_token uuid, p_exception_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_company_id uuid;
  v_old public.company_schedule_exceptions%ROWTYPE;
BEGIN
  v_company_id := public.portal_resolve_company_access(p_company_id,p_access_token);
  SELECT * INTO v_old FROM public.company_schedule_exceptions WHERE id=p_exception_id AND company_id=v_company_id AND cancelled_at IS NULL FOR UPDATE;
  UPDATE public.company_schedule_exceptions SET cancelled_at=now() WHERE id=v_old.id;
  IF v_old.id IS NULL THEN RETURN false; END IF;
  PERFORM public.portal_write_audit(v_company_id,public.portal_actor_type_for_management(p_access_token),auth.uid(),public.portal_actor_name_for_management(),'schedule_exception_deleted','schedule_exception',v_old.id,to_jsonb(v_old),NULL,'{}'::jsonb);
  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_company_management_portal(p_company_id uuid, p_access_token uuid, p_start_date date, p_end_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_company_id uuid;
begin
  v_company_id:=public.portal_resolve_company_access(p_company_id,p_access_token);
  return jsonb_build_object(
    'company',(select to_jsonb(c) from public.roster_companies c where c.id=v_company_id),
    'settings',(select to_jsonb(s) from public.company_portal_settings s where s.company_id=v_company_id),
    'locations',coalesce((select jsonb_agg(to_jsonb(l) order by l.sort_order,l.location_label) from public.company_locations l where l.company_id=v_company_id),'[]'::jsonb),
    'schedule_rules',coalesce((select jsonb_agg(to_jsonb(r) order by r.location_id nulls first,r.day_of_week) from public.company_schedule_rules r where r.company_id=v_company_id),'[]'::jsonb),
    'exceptions',coalesce((select jsonb_agg(to_jsonb(e) order by e.exception_date,e.start_time) from public.company_schedule_exceptions e where e.cancelled_at IS NULL AND e.override_kind='block' AND e.company_id=v_company_id and e.exception_date between p_start_date-30 and p_end_date+60),'[]'::jsonb),
    'representatives',coalesce((select jsonb_agg(to_jsonb(r) order by r.active desc,r.name) from public.company_representatives r where r.company_id=v_company_id),'[]'::jsonb),
    'packages',coalesce((select jsonb_agg(to_jsonb(cp) order by cp.start_date desc,cp.created_at desc) from public.company_packages cp where cp.company_id=v_company_id),'[]'::jsonb),
    'appointments',coalesce((select jsonb_agg(
      to_jsonb(a)||jsonb_build_object(
        'lead',
          (to_jsonb(l)-'recording_url'-'share_recording_with_company'-'form_data') ||
          jsonb_build_object(
            'form_data',coalesce(l.form_data,'{}'::jsonb)-'recording_url'-'recording'-'audio_url'-'call_recording'-'recording_link',
            'recording_url',case when l.share_recording_with_company then l.recording_url else null end,
            'recording_shared',l.share_recording_with_company
          ),
        'location_label',loc.location_label,
        'representative_name',rep.name,
        'latest_checkin',(select to_jsonb(ci) from public.appointment_checkins ci where ci.appointment_id=a.id order by ci.checked_in_at desc limit 1)
      ) order by a.appointment_date,a.start_time)
      from public.portal_appointments a
      join public.portal_leads l on l.id=a.lead_id
      left join public.company_locations loc on loc.id=a.location_id
      left join public.company_representatives rep on rep.id=a.representative_id
      where a.company_id=v_company_id and a.appointment_date between p_start_date and p_end_date and l.qc_status='approved' and a.company_visible_at is not null),'[]'::jsonb),
    'audit_logs',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (select * from public.portal_audit_logs al where al.company_id=v_company_id order by al.created_at desc limit 200)x),'[]'::jsonb)
  );
end;
$function$;
