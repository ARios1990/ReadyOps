-- Reserve QC lead transfers and appointment-time overrides for the established
-- ReadyOps owner account. The authorization check is repeated in the database
-- so hiding the controls in the browser is not the security boundary.

CREATE OR REPLACE FUNCTION private.readyops_is_owner_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM auth.users AS user_account
    JOIN public.profiles AS profile ON profile.id = user_account.id
    WHERE user_account.id = (SELECT auth.uid())
      AND profile.role = 'admin'
      AND lower(trim(user_account.email)) = 'mastersreadyservices2025@gmail.com'
  )
$function$;

REVOKE ALL ON FUNCTION private.readyops_is_owner_admin() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION private.readyops_is_owner_admin() TO authenticated;

CREATE OR REPLACE FUNCTION public.qc_move_lead(
  p_lead_id uuid,
  p_company_id uuid,
  p_location_id uuid,
  p_date date,
  p_start_time text,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_lead public.portal_leads%ROWTYPE;
  v_appt public.portal_appointments%ROWTYPE;
  v_rule public.company_schedule_rules%ROWTYPE;
  v_start time;
  v_duration_minutes integer;
  v_settings public.company_portal_settings%ROWTYPE;
  v_old jsonb;
  v_cycle public.qc_review_cycles%ROWTYPE;
  v_next_cycle public.qc_review_cycles%ROWTYPE;
  v_actor_type text := private.readyops_profile_role();
  v_is_reschedule boolean;
BEGIN
  IF NOT private.readyops_is_owner_admin() THEN
    RAISE EXCEPTION 'Owner account access is required to move or reschedule a lead';
  END IF;
  IF p_company_id IS NULL OR p_date IS NULL OR nullif(trim(coalesce(p_start_time, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Company, appointment date, and appointment time are required';
  END IF;

  SELECT * INTO v_lead FROM public.portal_leads WHERE id = p_lead_id FOR UPDATE;
  SELECT * INTO v_appt FROM public.portal_appointments WHERE lead_id = p_lead_id FOR UPDATE;
  IF v_lead.id IS NULL OR v_appt.id IS NULL THEN RAISE EXCEPTION 'Lead or appointment not found'; END IF;
  IF NOT private.readyops_can_review_lead(p_lead_id) OR NOT private.readyops_can_review_company(p_company_id) THEN
    RAISE EXCEPTION 'Lead or target company access denied';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.roster_companies WHERE id = p_company_id AND account_status = 'Active') THEN
    RAISE EXCEPTION 'Target company is not active';
  END IF;
  IF p_location_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.company_locations WHERE id = p_location_id AND company_id = p_company_id AND active
  ) THEN RAISE EXCEPTION 'Target service area does not belong to the company'; END IF;

  v_start := p_start_time::time;

  -- The owner override intentionally bypasses closed/blocked-slot and capacity
  -- validation. Keep the target schedule's slot length when one is configured.
  v_rule := public.portal_find_rule(
    p_company_id,
    p_location_id,
    extract(dow FROM p_date)::integer
  );
  v_duration_minutes := coalesce(
    v_rule.slot_minutes,
    CASE
      WHEN v_appt.end_time > v_appt.start_time
        THEN greatest(1, floor(extract(epoch FROM (v_appt.end_time - v_appt.start_time)) / 60)::integer)
      ELSE 60
    END
  );

  SELECT * INTO v_settings FROM public.company_portal_settings WHERE company_id = p_company_id;
  SELECT * INTO v_cycle FROM public.qc_review_cycles WHERE lead_id = p_lead_id AND is_current FOR UPDATE;
  v_is_reschedule := v_appt.appointment_date <> p_date OR v_appt.start_time <> v_start;
  v_old := jsonb_build_object(
    'company_id', v_lead.company_id, 'location_id', v_lead.location_id,
    'date', v_appt.appointment_date, 'start_time', v_appt.start_time
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
    p_reason, (SELECT auth.uid()), v_lead.company_id, p_company_id,
    v_lead.location_id, p_location_id, v_cycle.id
  );

  IF v_cycle.id IS NOT NULL AND v_cycle.status IN ('approved', 'denied') THEN
    UPDATE public.qc_review_cycles SET is_current = false, updated_at = now() WHERE id = v_cycle.id;
    INSERT INTO public.qc_review_cycles (
      lead_id, appointment_id, company_id, location_id, cycle_number, status, reason
    ) VALUES (
      v_lead.id, v_appt.id, p_company_id, p_location_id, v_cycle.cycle_number + 1, 'pending', p_reason
    ) RETURNING * INTO v_next_cycle;
  ELSIF v_cycle.id IS NOT NULL THEN
    UPDATE public.qc_review_cycles
    SET company_id = p_company_id, location_id = p_location_id, status = 'pending',
      assigned_to = NULL, reviewer_id = NULL, started_at = NULL, completed_at = NULL,
      reason = nullif(trim(coalesce(p_reason, '')), ''), updated_at = now()
    WHERE id = v_cycle.id
    RETURNING * INTO v_next_cycle;
  ELSE
    INSERT INTO public.qc_review_cycles (
      lead_id, appointment_id, company_id, location_id, cycle_number, status, reason
    ) VALUES (
      v_lead.id, v_appt.id, p_company_id, p_location_id, 1, 'pending', p_reason
    ) RETURNING * INTO v_next_cycle;
  END IF;

  UPDATE public.portal_leads
  SET company_id = p_company_id, location_id = p_location_id,
    package_id = public.portal_active_package(p_company_id), qc_status = 'pending',
    qc_reason = nullif(trim(coalesce(p_reason, '')), ''), qc_notes = NULL,
    qc_reviewed_by = NULL, qc_reviewed_at = NULL, updated_at = now()
  WHERE id = p_lead_id
  RETURNING * INTO v_lead;

  UPDATE public.portal_appointments
  SET company_id = p_company_id, location_id = p_location_id,
    appointment_date = p_date, start_time = v_start,
    end_time = (v_start + make_interval(mins => v_duration_minutes))::time,
    timezone = coalesce(v_settings.timezone, 'America/Chicago'), status = 'qc_pending',
    representative_id = NULL, rep_status = 'unassigned', company_visible_at = NULL,
    updated_at = now()
  WHERE id = v_appt.id
  RETURNING * INTO v_appt;

  PERFORM public.portal_write_audit(
    p_company_id, v_actor_type, (SELECT auth.uid()), public.portal_actor_name_for_management(),
    CASE WHEN v_is_reschedule THEN 'appointment_rescheduled' ELSE 'qc_assignment_changed' END,
    'lead', v_lead.id, v_old,
    jsonb_build_object('company_id', p_company_id, 'location_id', p_location_id, 'date', p_date, 'start_time', v_start),
    jsonb_build_object(
      'reason', p_reason,
      'appointment_id', v_appt.id,
      'qc_review_id', v_next_cycle.id,
      'owner_override', true,
      'schedule_checks_bypassed', true
    )
  );

  RETURN jsonb_build_object('lead', to_jsonb(v_lead), 'appointment', to_jsonb(v_appt), 'qc_review', to_jsonb(v_next_cycle));
END;
$function$;

REVOKE ALL ON FUNCTION public.qc_move_lead(uuid, uuid, uuid, date, text, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.qc_move_lead(uuid, uuid, uuid, date, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.qc_admin_override_schedule(
  p_lead_id uuid,
  p_date date,
  p_start_time text,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
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
  IF NOT private.readyops_is_owner_admin() THEN
    RAISE EXCEPTION 'Owner account access is required to override an appointment time';
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
      'preserved_delivery_status', true,
      'owner_override', true,
      'schedule_checks_bypassed', true
    )
  );

  RETURN jsonb_build_object(
    'lead', to_jsonb(v_lead),
    'appointment', to_jsonb(v_updated),
    'qc_review', to_jsonb(v_cycle)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.qc_admin_override_schedule(uuid, date, text, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.qc_admin_override_schedule(uuid, date, text, text) TO authenticated;

COMMENT ON FUNCTION public.qc_move_lead(uuid, uuid, uuid, date, text, text)
IS 'Owner-account-only audited QC transfer/reschedule. The owner may bypass blocked-slot and capacity checks.';

COMMENT ON FUNCTION public.qc_admin_override_schedule(uuid, date, text, text)
IS 'Owner-account-only audited date/time override that preserves QC and delivery status.';
