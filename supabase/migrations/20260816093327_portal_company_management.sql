-- Imported from the hosted ReadyOp Supabase migration history on 2026-08-28.
-- Schema only: no production table data is included.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_company_management_portal(
  p_company_id uuid,
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
  v_company_id uuid;
BEGIN
  v_company_id := public.portal_resolve_company_access(p_company_id, p_access_token);

  RETURN jsonb_build_object(
    'company', (
      SELECT to_jsonb(c) FROM public.roster_companies c WHERE c.id = v_company_id
    ),
    'settings', (
      SELECT to_jsonb(s) FROM public.company_portal_settings s WHERE s.company_id = v_company_id
    ),
    'locations', coalesce((
      SELECT jsonb_agg(to_jsonb(l) ORDER BY l.sort_order,l.location_label)
      FROM public.company_locations l WHERE l.company_id = v_company_id
    ), '[]'::jsonb),
    'schedule_rules', coalesce((
      SELECT jsonb_agg(to_jsonb(r) ORDER BY r.location_id NULLS FIRST,r.day_of_week)
      FROM public.company_schedule_rules r WHERE r.company_id = v_company_id
    ), '[]'::jsonb),
    'exceptions', coalesce((
      SELECT jsonb_agg(to_jsonb(e) ORDER BY e.exception_date,e.start_time)
      FROM public.company_schedule_exceptions e
      WHERE e.company_id = v_company_id
        AND e.exception_date BETWEEN p_start_date - 30 AND p_end_date + 60
    ), '[]'::jsonb),
    'representatives', coalesce((
      SELECT jsonb_agg(to_jsonb(r) ORDER BY r.active DESC,r.name)
      FROM public.company_representatives r WHERE r.company_id = v_company_id
    ), '[]'::jsonb),
    'appointments', coalesce((
      SELECT jsonb_agg(
        to_jsonb(a)
        || jsonb_build_object(
          'lead', to_jsonb(l),
          'location_label', loc.location_label,
          'representative_name', rep.name,
          'latest_checkin', (
            SELECT to_jsonb(ci)
            FROM public.appointment_checkins ci
            WHERE ci.appointment_id = a.id
            ORDER BY ci.checked_in_at DESC
            LIMIT 1
          )
        )
        ORDER BY a.appointment_date,a.start_time
      )
      FROM public.portal_appointments a
      JOIN public.portal_leads l ON l.id = a.lead_id
      LEFT JOIN public.company_locations loc ON loc.id = a.location_id
      LEFT JOIN public.company_representatives rep ON rep.id = a.representative_id
      WHERE a.company_id = v_company_id
        AND a.appointment_date BETWEEN p_start_date AND p_end_date
    ), '[]'::jsonb),
    'audit_logs', coalesce((
      SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC)
      FROM (
        SELECT * FROM public.portal_audit_logs a
        WHERE a.company_id = v_company_id
        ORDER BY a.created_at DESC
        LIMIT 200
      ) x
    ), '[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.update_company_portal_settings(
  p_company_id uuid,
  p_access_token uuid,
  p_patch jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_company_id uuid;
  v_old public.company_portal_settings%ROWTYPE;
  v_new public.company_portal_settings%ROWTYPE;
  v_slug text;
BEGIN
  v_company_id := public.portal_resolve_company_access(p_company_id, p_access_token);
  SELECT * INTO v_old FROM public.company_portal_settings WHERE company_id = v_company_id FOR UPDATE;

  v_slug := CASE WHEN p_patch ? 'public_slug' THEN public.portal_slugify(p_patch->>'public_slug') ELSE v_old.public_slug END;
  IF v_slug = '' THEN RAISE EXCEPTION 'Public slug cannot be blank'; END IF;

  UPDATE public.company_portal_settings
  SET
    public_slug = v_slug,
    portal_enabled = CASE WHEN p_patch ? 'portal_enabled' THEN (p_patch->>'portal_enabled')::boolean ELSE portal_enabled END,
    allow_public_booking = CASE WHEN p_patch ? 'allow_public_booking' THEN (p_patch->>'allow_public_booking')::boolean ELSE allow_public_booking END,
    company_access_enabled = CASE WHEN p_patch ? 'company_access_enabled' THEN (p_patch->>'company_access_enabled')::boolean ELSE company_access_enabled END,
    timezone = CASE WHEN p_patch ? 'timezone' THEN coalesce(nullif(p_patch->>'timezone',''),'America/Chicago') ELSE timezone END,
    requirements_short = CASE WHEN p_patch ? 'requirements_short' THEN coalesce(p_patch->>'requirements_short','') ELSE requirements_short END,
    requirements_detail = CASE WHEN p_patch ? 'requirements_detail' THEN coalesce(p_patch->>'requirements_detail','') ELSE requirements_detail END,
    qualification_rules = CASE WHEN p_patch ? 'qualification_rules' THEN coalesce(p_patch->'qualification_rules',public.portal_default_qualification_rules()) ELSE qualification_rules END,
    form_mode = CASE WHEN p_patch ? 'form_mode' THEN p_patch->>'form_mode' ELSE form_mode END,
    form_schema = CASE WHEN p_patch ? 'form_schema' THEN coalesce(p_patch->'form_schema',public.portal_default_form_schema()) ELSE form_schema END,
    external_form_provider = CASE WHEN p_patch ? 'external_form_provider' THEN nullif(p_patch->>'external_form_provider','') ELSE external_form_provider END,
    external_form_url = CASE WHEN p_patch ? 'external_form_url' THEN nullif(p_patch->>'external_form_url','') ELSE external_form_url END,
    external_prefill_map = CASE WHEN p_patch ? 'external_prefill_map' THEN coalesce(p_patch->'external_prefill_map','{}'::jsonb) ELSE external_prefill_map END,
    external_submission_map = CASE WHEN p_patch ? 'external_submission_map' THEN coalesce(p_patch->'external_submission_map','{}'::jsonb) ELSE external_submission_map END,
    check_in_radius_m = CASE WHEN p_patch ? 'check_in_radius_m' THEN (p_patch->>'check_in_radius_m')::integer ELSE check_in_radius_m END,
    check_in_before_minutes = CASE WHEN p_patch ? 'check_in_before_minutes' THEN (p_patch->>'check_in_before_minutes')::integer ELSE check_in_before_minutes END,
    check_in_after_minutes = CASE WHEN p_patch ? 'check_in_after_minutes' THEN (p_patch->>'check_in_after_minutes')::integer ELSE check_in_after_minutes END
  WHERE company_id = v_company_id
  RETURNING * INTO v_new;

  PERFORM public.portal_write_audit(
    v_company_id,
    public.portal_actor_type_for_management(p_access_token),
    auth.uid(),
    public.portal_actor_name_for_management(),
    'portal_settings_updated','company_portal_settings',v_company_id,
    to_jsonb(v_old) - 'company_access_token' - 'external_webhook_secret',
    to_jsonb(v_new) - 'company_access_token' - 'external_webhook_secret',
    '{}'::jsonb
  );

  RETURN to_jsonb(v_new);
END;
$$;

CREATE OR REPLACE FUNCTION public.regenerate_company_access_token(
  p_company_id uuid,
  p_access_token uuid
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_company_id uuid;
  v_new_token uuid := gen_random_uuid();
BEGIN
  v_company_id := public.portal_resolve_company_access(p_company_id,p_access_token);
  UPDATE public.company_portal_settings SET company_access_token = v_new_token WHERE company_id = v_company_id;
  PERFORM public.portal_write_audit(v_company_id,public.portal_actor_type_for_management(p_access_token),auth.uid(),public.portal_actor_name_for_management(),'company_access_token_regenerated','company_portal_settings',v_company_id,NULL,NULL,'{}'::jsonb);
  RETURN v_new_token;
END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_company_schedule_rule(
  p_company_id uuid,
  p_access_token uuid,
  p_rule jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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
$$;

CREATE OR REPLACE FUNCTION public.create_company_schedule_exception(
  p_company_id uuid,
  p_access_token uuid,
  p_exception jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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
$$;

CREATE OR REPLACE FUNCTION public.delete_company_schedule_exception(
  p_company_id uuid,
  p_access_token uuid,
  p_exception_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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
$$;

CREATE OR REPLACE FUNCTION public.create_company_representative(
  p_company_id uuid,
  p_access_token uuid,
  p_representative jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_company_id uuid;
  v_saved public.company_representatives%ROWTYPE;
BEGIN
  v_company_id := public.portal_resolve_company_access(p_company_id,p_access_token);
  INSERT INTO public.company_representatives(company_id,location_id,name,phone,email,active)
  VALUES (
    v_company_id,
    nullif(p_representative->>'location_id','')::uuid,
    trim(p_representative->>'name'),
    nullif(trim(coalesce(p_representative->>'phone','')),''),
    nullif(lower(trim(coalesce(p_representative->>'email',''))),''),
    coalesce((p_representative->>'active')::boolean,true)
  ) RETURNING * INTO v_saved;
  IF nullif(v_saved.name,'') IS NULL THEN RAISE EXCEPTION 'Representative name is required'; END IF;
  PERFORM public.portal_write_audit(v_company_id,public.portal_actor_type_for_management(p_access_token),auth.uid(),public.portal_actor_name_for_management(),'representative_created','representative',v_saved.id,NULL,to_jsonb(v_saved) - 'access_token','{}'::jsonb);
  RETURN to_jsonb(v_saved);
END;
$$;

CREATE OR REPLACE FUNCTION public.update_company_representative(
  p_company_id uuid,
  p_access_token uuid,
  p_representative_id uuid,
  p_patch jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_company_id uuid;
  v_old public.company_representatives%ROWTYPE;
  v_new public.company_representatives%ROWTYPE;
BEGIN
  v_company_id := public.portal_resolve_company_access(p_company_id,p_access_token);
  SELECT * INTO v_old FROM public.company_representatives WHERE id=p_representative_id AND company_id=v_company_id FOR UPDATE;
  IF v_old.id IS NULL THEN RAISE EXCEPTION 'Representative not found'; END IF;
  UPDATE public.company_representatives
  SET
    name = CASE WHEN p_patch ? 'name' THEN trim(p_patch->>'name') ELSE name END,
    phone = CASE WHEN p_patch ? 'phone' THEN nullif(trim(p_patch->>'phone'),'') ELSE phone END,
    email = CASE WHEN p_patch ? 'email' THEN nullif(lower(trim(p_patch->>'email')),'') ELSE email END,
    location_id = CASE WHEN p_patch ? 'location_id' THEN nullif(p_patch->>'location_id','')::uuid ELSE location_id END,
    active = CASE WHEN p_patch ? 'active' THEN (p_patch->>'active')::boolean ELSE active END,
    access_token = CASE WHEN coalesce((p_patch->>'regenerate_token')::boolean,false) THEN gen_random_uuid() ELSE access_token END
  WHERE id=v_old.id RETURNING * INTO v_new;
  PERFORM public.portal_write_audit(v_company_id,public.portal_actor_type_for_management(p_access_token),auth.uid(),public.portal_actor_name_for_management(),'representative_updated','representative',v_new.id,to_jsonb(v_old)-'access_token',to_jsonb(v_new)-'access_token','{}'::jsonb);
  RETURN to_jsonb(v_new);
END;
$$;

CREATE OR REPLACE FUNCTION public.assign_appointment_representative(
  p_company_id uuid,
  p_access_token uuid,
  p_appointment_id uuid,
  p_representative_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_company_id uuid;
  v_old public.portal_appointments%ROWTYPE;
  v_new public.portal_appointments%ROWTYPE;
BEGIN
  v_company_id := public.portal_resolve_company_access(p_company_id,p_access_token);
  IF p_representative_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.company_representatives r WHERE r.id=p_representative_id AND r.company_id=v_company_id AND r.active
  ) THEN RAISE EXCEPTION 'Representative is not active for this company'; END IF;
  SELECT * INTO v_old FROM public.portal_appointments a WHERE a.id=p_appointment_id AND a.company_id=v_company_id FOR UPDATE;
  IF v_old.id IS NULL THEN RAISE EXCEPTION 'Appointment not found'; END IF;
  UPDATE public.portal_appointments
  SET representative_id=p_representative_id,
      status=CASE WHEN p_representative_id IS NULL THEN 'confirmed' ELSE 'assigned' END,
      rep_status=CASE WHEN p_representative_id IS NULL THEN 'unassigned' ELSE 'assigned' END
  WHERE id=v_old.id RETURNING * INTO v_new;
  PERFORM public.portal_write_audit(v_company_id,public.portal_actor_type_for_management(p_access_token),auth.uid(),public.portal_actor_name_for_management(),'representative_assigned','appointment',v_new.id,to_jsonb(v_old),to_jsonb(v_new),'{}'::jsonb);
  RETURN to_jsonb(v_new);
END;
$$;

CREATE OR REPLACE FUNCTION public.company_update_appointment_status(
  p_company_id uuid,
  p_access_token uuid,
  p_appointment_id uuid,
  p_status text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_company_id uuid;
  v_old public.portal_appointments%ROWTYPE;
  v_new public.portal_appointments%ROWTYPE;
BEGIN
  v_company_id := public.portal_resolve_company_access(p_company_id,p_access_token);
  IF p_status NOT IN ('confirmed','assigned','cancelled','completed') THEN RAISE EXCEPTION 'Invalid appointment status'; END IF;
  SELECT * INTO v_old FROM public.portal_appointments a WHERE a.id=p_appointment_id AND a.company_id=v_company_id FOR UPDATE;
  IF v_old.id IS NULL THEN RAISE EXCEPTION 'Appointment not found'; END IF;
  UPDATE public.portal_appointments SET status=p_status WHERE id=v_old.id RETURNING * INTO v_new;
  PERFORM public.portal_write_audit(v_company_id,public.portal_actor_type_for_management(p_access_token),auth.uid(),public.portal_actor_name_for_management(),'appointment_status_updated','appointment',v_new.id,jsonb_build_object('status',v_old.status),jsonb_build_object('status',v_new.status),'{}'::jsonb);
  RETURN to_jsonb(v_new);
END;
$$;

COMMIT;
