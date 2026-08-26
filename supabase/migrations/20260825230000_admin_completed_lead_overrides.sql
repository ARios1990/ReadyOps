CREATE OR REPLACE FUNCTION public.qc_admin_override_schedule(
  p_lead_id uuid,
  p_date date,
  p_start_time text,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_role text := private.readyops_profile_role();
  v_lead public.portal_leads%ROWTYPE;
  v_appt public.portal_appointments%ROWTYPE;
  v_updated public.portal_appointments%ROWTYPE;
  v_cycle public.qc_review_cycles%ROWTYPE;
  v_start time;
  v_duration_minutes integer;
  v_old jsonb;
BEGIN
  IF v_role <> 'admin' THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;
  IF p_date IS NULL OR nullif(trim(coalesce(p_start_time, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Appointment date and time are required';
  END IF;
  IF nullif(trim(coalesce(p_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'An override reason is required';
  END IF;

  v_start := p_start_time::time;

  SELECT * INTO v_lead
  FROM public.portal_leads
  WHERE id = p_lead_id
  FOR UPDATE;

  SELECT * INTO v_appt
  FROM public.portal_appointments
  WHERE lead_id = p_lead_id
  FOR UPDATE;

  IF v_lead.id IS NULL OR v_appt.id IS NULL THEN
    RAISE EXCEPTION 'Lead or appointment not found';
  END IF;
  IF NOT private.readyops_can_access_company(v_lead.company_id) THEN
    RAISE EXCEPTION 'Lead access denied';
  END IF;
  IF v_appt.appointment_date = p_date AND v_appt.start_time = v_start THEN
    RAISE EXCEPTION 'Choose a different appointment date or time';
  END IF;

  SELECT * INTO v_cycle
  FROM public.qc_review_cycles
  WHERE lead_id = p_lead_id AND is_current
  FOR UPDATE;

  v_duration_minutes := CASE
    WHEN v_appt.end_time > v_appt.start_time
      THEN greatest(1, floor(extract(epoch FROM (v_appt.end_time - v_appt.start_time)) / 60)::integer)
    ELSE 60
  END;

  v_old := jsonb_build_object(
    'appointment_date', v_appt.appointment_date,
    'start_time', v_appt.start_time,
    'end_time', v_appt.end_time,
    'appointment_status', v_appt.status,
    'company_visible_at', v_appt.company_visible_at,
    'qc_status', v_lead.qc_status
  );

  INSERT INTO public.appointment_reschedule_history (
    company_id, appointment_id, lead_id,
    old_appointment_date, old_start_time, old_end_time,
    new_appointment_date, new_start_time, new_end_time,
    reason, changed_by, old_company_id, new_company_id,
    old_location_id, new_location_id, qc_review_id
  ) VALUES (
    v_lead.company_id, v_appt.id, v_lead.id,
    v_appt.appointment_date, v_appt.start_time, v_appt.end_time,
    p_date, v_start, (v_start + make_interval(mins => v_duration_minutes))::time,
    trim(p_reason), (SELECT auth.uid()), v_lead.company_id, v_lead.company_id,
    v_lead.location_id, v_lead.location_id, v_cycle.id
  );

  UPDATE public.portal_appointments
  SET appointment_date = p_date,
      start_time = v_start,
      end_time = (v_start + make_interval(mins => v_duration_minutes))::time,
      updated_at = now()
  WHERE id = v_appt.id
  RETURNING * INTO v_updated;

  PERFORM public.portal_write_audit(
    v_lead.company_id,
    v_role,
    (SELECT auth.uid()),
    public.portal_actor_name_for_management(),
    'admin_schedule_overridden',
    'lead',
    v_lead.id,
    v_old,
    jsonb_build_object(
      'appointment_date', v_updated.appointment_date,
      'start_time', v_updated.start_time,
      'end_time', v_updated.end_time,
      'appointment_status', v_updated.status,
      'company_visible_at', v_updated.company_visible_at,
      'qc_status', v_lead.qc_status
    ),
    jsonb_build_object(
      'appointment_id', v_updated.id,
      'qc_review_id', v_cycle.id,
      'reason', trim(p_reason),
      'preserved_qc_status', true,
      'preserved_delivery_status', true
    )
  );

  RETURN jsonb_build_object(
    'lead', to_jsonb(v_lead),
    'appointment', to_jsonb(v_updated),
    'qc_review', to_jsonb(v_cycle)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.qc_admin_override_schedule(uuid, date, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.qc_admin_override_schedule(uuid, date, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.qc_admin_override_schedule(uuid, date, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.qc_admin_override_schedule(uuid, date, text, text) TO service_role;

COMMENT ON FUNCTION public.qc_admin_override_schedule(uuid, date, text, text)
IS 'Admin-only audited date/time override that preserves QC status and company delivery visibility.';
