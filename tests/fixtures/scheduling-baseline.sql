-- Schema and current dependency functions, no customer data.
create table public.company_bookings (id uuid default gen_random_uuid(),company_id uuid,day text,time_slot text,booked_by uuid,created_at timestamp with time zone default now(),location_id uuid);
create table public.company_locations (id uuid default gen_random_uuid(),company_id uuid,location_label text,state text,metro_tag text,sort_order integer default 0,created_at timestamp with time zone default now(),office_name text,address text,city text,zip_code text,service_cities text[] default '{}'::text[],service_zips text[] default '{}'::text[],phone text,email text,manager_name text,timezone text default 'America/Chicago'::text,available_days text[] default ARRAY['Monday'::text, 'Tuesday'::text, 'Wednesday'::text, 'Thursday'::text, 'Friday'::text, 'Saturday'::text],start_time time without time zone default '09:00:00'::time without time zone,end_time time without time zone default '18:00:00'::time without time zone,slot_interval_minutes integer default 60,max_per_hour integer default 1,max_per_day integer default 5,notes text,updated_at timestamp with time zone default now(),active boolean default true);
create table public.company_schedule_exceptions (id uuid default gen_random_uuid(),company_id uuid,location_id uuid,exception_date date,is_closed boolean default false,start_time time without time zone,end_time time without time zone,note text,created_at timestamp with time zone default now());
create table public.company_schedule_rules (id uuid default gen_random_uuid(),company_id uuid,location_id uuid,day_of_week smallint,is_open boolean default true,start_time time without time zone default '09:00:00'::time without time zone,end_time time without time zone default '18:00:00'::time without time zone,slot_minutes integer default 60,max_per_slot integer default 1,max_per_day integer default 8,created_at timestamp with time zone default now(),updated_at timestamp with time zone default now());
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
  DELETE FROM public.company_schedule_exceptions
  WHERE id = p_exception_id AND company_id = v_company_id
  RETURNING * INTO v_old;
  IF v_old.id IS NULL THEN RETURN false; END IF;
  PERFORM public.portal_write_audit(v_company_id,public.portal_actor_type_for_management(p_access_token),auth.uid(),public.portal_actor_name_for_management(),'schedule_exception_deleted','schedule_exception',v_old.id,to_jsonb(v_old),NULL,'{}'::jsonb);
  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.portal_resolve_company_access(p_company_id uuid, p_access_token uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_company_id uuid;
BEGIN
  IF p_company_id IS NOT NULL AND public.portal_is_admin() THEN
    RETURN p_company_id;
  END IF;

  SELECT s.company_id
  INTO v_company_id
  FROM public.company_portal_settings s
  WHERE s.company_access_enabled
    AND s.company_access_token = p_access_token;

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Invalid or disabled company access link';
  END IF;

  RETURN v_company_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.upsert_company_schedule_rule(p_company_id uuid, p_access_token uuid, p_rule jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_company_id uuid;
  v_location_id uuid;
  v_day smallint;
  v_existing public.company_schedule_rules%ROWTYPE;
  v_saved public.company_schedule_rules%ROWTYPE;
BEGIN
  v_company_id := public.portal_resolve_company_access(p_company_id,p_access_token);
  v_location_id := nullif(p_rule->>'location_id','')::uuid;
  v_day := (p_rule->>'day_of_week')::smallint;

  IF v_location_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.company_locations l WHERE l.id = v_location_id AND l.company_id = v_company_id
  ) THEN RAISE EXCEPTION 'Invalid company location'; END IF;

  SELECT * INTO v_existing FROM public.company_schedule_rules r
  WHERE r.company_id = v_company_id
    AND r.location_id IS NOT DISTINCT FROM v_location_id
    AND r.day_of_week = v_day
  FOR UPDATE;

  IF v_existing.id IS NULL THEN
    INSERT INTO public.company_schedule_rules(
      company_id,location_id,day_of_week,is_open,start_time,end_time,slot_minutes,max_per_slot,max_per_day
    ) VALUES (
      v_company_id,v_location_id,v_day,
      coalesce((p_rule->>'is_open')::boolean,true),
      coalesce(nullif(p_rule->>'start_time','')::time,'09:00'::time),
      coalesce(nullif(p_rule->>'end_time','')::time,'18:00'::time),
      coalesce((p_rule->>'slot_minutes')::integer,60),
      coalesce((p_rule->>'max_per_slot')::integer,1),
      coalesce((p_rule->>'max_per_day')::integer,8)
    ) RETURNING * INTO v_saved;
  ELSE
    UPDATE public.company_schedule_rules
    SET
      is_open = coalesce((p_rule->>'is_open')::boolean,is_open),
      start_time = coalesce(nullif(p_rule->>'start_time','')::time,start_time),
      end_time = coalesce(nullif(p_rule->>'end_time','')::time,end_time),
      slot_minutes = coalesce((p_rule->>'slot_minutes')::integer,slot_minutes),
      max_per_slot = coalesce((p_rule->>'max_per_slot')::integer,max_per_slot),
      max_per_day = coalesce((p_rule->>'max_per_day')::integer,max_per_day)
    WHERE id = v_existing.id
    RETURNING * INTO v_saved;
  END IF;

  PERFORM public.portal_write_audit(
    v_company_id,public.portal_actor_type_for_management(p_access_token),auth.uid(),public.portal_actor_name_for_management(),
    'schedule_rule_saved','company_schedule_rule',v_saved.id,
    CASE WHEN v_existing.id IS NULL THEN NULL ELSE to_jsonb(v_existing) END,to_jsonb(v_saved),'{}'::jsonb
  );
  RETURN to_jsonb(v_saved);
END;
$function$;

CREATE OR REPLACE FUNCTION public.portal_assert_slot_capacity(p_company_id uuid, p_location_id uuid, p_date date, p_start time without time zone, p_exclude_reservation_id uuid DEFAULT NULL::uuid, p_exclude_appointment_id uuid DEFAULT NULL::uuid, p_allow_past boolean DEFAULT false)
 RETURNS company_schedule_rules
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
