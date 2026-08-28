-- Imported from the hosted ReadyOp Supabase migration history on 2026-08-28.
-- Schema only: no production table data is included.

-- Two-stage QC: managers review only their own teams and submit approved
-- leads to the main QC pool. Only admin/QC can release a lead to a company.

ALTER TABLE public.portal_leads
  DROP CONSTRAINT IF EXISTS portal_leads_qc_status_check;
ALTER TABLE public.portal_leads
  ADD CONSTRAINT portal_leads_qc_status_check
  CHECK (qc_status = ANY (ARRAY[
    'pending'::text,
    'in_review'::text,
    'manager_approved'::text,
    'approved'::text,
    'denied'::text,
    'needs_correction'::text
  ]));

ALTER TABLE public.qc_review_cycles
  DROP CONSTRAINT IF EXISTS qc_review_cycles_status_check;
ALTER TABLE public.qc_review_cycles
  ADD CONSTRAINT qc_review_cycles_status_check
  CHECK (status = ANY (ARRAY[
    'pending'::text,
    'in_review'::text,
    'manager_approved'::text,
    'approved'::text,
    'denied'::text,
    'needs_correction'::text
  ]));

CREATE OR REPLACE FUNCTION private.readyops_can_review_lead(p_lead_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles AS p
    JOIN public.portal_leads AS l ON l.id = p_lead_id
    LEFT JOIN public.agents AS a ON a.id = l.agent_id
    WHERE p.id = (SELECT auth.uid())
      AND (
        p.role IN ('admin', 'qc')
        OR (
          p.role = 'manager'
          AND p.team_id IS NOT NULL
          AND a.team_id = p.team_id
        )
      )
  )
$function$;

CREATE OR REPLACE FUNCTION private.readyops_can_view_lead(p_lead_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles AS p
    JOIN public.portal_leads AS l ON l.id = p_lead_id
    LEFT JOIN public.agents AS a ON a.id = l.agent_id
    WHERE p.id = (SELECT auth.uid())
      AND (
        p.role IN ('admin', 'qc')
        OR (
          p.role = 'manager'
          AND p.team_id IS NOT NULL
          AND a.team_id = p.team_id
        )
        OR (
          p.role = 'agent'
          AND (l.agent_profile_id = p.id OR (p.agent_id IS NOT NULL AND l.agent_id = p.agent_id))
        )
        OR (
          p.role = 'company'
          AND EXISTS (
            SELECT 1
            FROM public.company_user_access AS cua
            WHERE cua.user_id = p.id
              AND cua.company_id = l.company_id
          )
        )
      )
  )
$function$;

CREATE OR REPLACE FUNCTION private.readyops_can_review_recording_path(p_name text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_lead_id_text text := split_part(coalesce(p_name, ''), '/', 1);
BEGIN
  IF v_lead_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    RETURN false;
  END IF;
  RETURN private.readyops_can_review_lead(v_lead_id_text::uuid);
END;
$function$;

-- Keep the original calendar query as an internal implementation, then
-- enforce agent-team scoping and recompute all status totals in the public API.
ALTER FUNCTION public.get_qc_calendar_queue(date, date, uuid, uuid, uuid, text, text, text, text, text)
  SET SCHEMA private;
ALTER FUNCTION private.get_qc_calendar_queue(date, date, uuid, uuid, uuid, text, text, text, text, text)
  RENAME TO get_qc_calendar_queue_unscoped;
REVOKE ALL ON FUNCTION private.get_qc_calendar_queue_unscoped(date, date, uuid, uuid, uuid, text, text, text, text, text)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_qc_calendar_queue(
  p_start_date date,
  p_end_date date,
  p_company_id uuid DEFAULT NULL,
  p_location_id uuid DEFAULT NULL,
  p_agent_id uuid DEFAULT NULL,
  p_qc_status text DEFAULT NULL,
  p_appointment_status text DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_state text DEFAULT NULL,
  p_service_area text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_role text := private.readyops_profile_role();
  v_team_id uuid;
  v_payload jsonb;
  v_rows jsonb;
  v_days jsonb;
  v_summary jsonb;
  v_scheduled integer;
  v_approved integer;
  v_denied integer;
BEGIN
  IF v_role NOT IN ('admin', 'qc', 'manager') THEN
    RAISE EXCEPTION 'QC reviewer access required';
  END IF;

  SELECT p.team_id INTO v_team_id
  FROM public.profiles AS p
  WHERE p.id = (SELECT auth.uid());

  v_payload := private.get_qc_calendar_queue_unscoped(
    p_start_date, p_end_date, p_company_id, p_location_id, p_agent_id,
    p_qc_status, p_appointment_status, p_search, p_state, p_service_area
  );

  SELECT coalesce(jsonb_agg(r.value), '[]'::jsonb)
  INTO v_rows
  FROM jsonb_array_elements(coalesce(v_payload->'rows', '[]'::jsonb)) AS r(value)
  WHERE v_role IN ('admin', 'qc')
    OR (
      v_role = 'manager'
      AND v_team_id IS NOT NULL
      AND r.value#>>'{agent,team_id}' = v_team_id::text
    );

  SELECT coalesce(jsonb_agg(
    d.value || jsonb_build_object(
      'scheduled', (
        SELECT count(*)
        FROM jsonb_array_elements(v_rows) AS r(value)
        WHERE r.value#>>'{appointment,appointment_date}' = d.value->>'date'
      ),
      'pending_qc', (
        SELECT count(*)
        FROM jsonb_array_elements(v_rows) AS r(value)
        WHERE r.value#>>'{appointment,appointment_date}' = d.value->>'date'
          AND coalesce(r.value#>>'{qc_review,status}', r.value#>>'{lead,qc_status}')
            IN ('pending', 'in_review', 'manager_approved')
      )
    ) ORDER BY d.value->>'date'
  ), '[]'::jsonb)
  INTO v_days
  FROM jsonb_array_elements(coalesce(v_payload->'days', '[]'::jsonb)) AS d(value);

  SELECT count(*) INTO v_scheduled FROM jsonb_array_elements(v_rows);
  SELECT count(*) INTO v_approved
  FROM jsonb_array_elements(v_rows) AS r(value)
  WHERE coalesce(r.value#>>'{qc_review,status}', r.value#>>'{lead,qc_status}') = 'approved';
  SELECT count(*) INTO v_denied
  FROM jsonb_array_elements(v_rows) AS r(value)
  WHERE coalesce(r.value#>>'{qc_review,status}', r.value#>>'{lead,qc_status}') = 'denied';

  SELECT jsonb_build_object(
    'companies', count(DISTINCT r.value#>>'{company,id}'),
    'scheduled', v_scheduled,
    'pending', count(*) FILTER (WHERE coalesce(r.value#>>'{qc_review,status}', r.value#>>'{lead,qc_status}') = 'pending'),
    'in_review', count(*) FILTER (WHERE coalesce(r.value#>>'{qc_review,status}', r.value#>>'{lead,qc_status}') = 'in_review'),
    'manager_approved', count(*) FILTER (WHERE coalesce(r.value#>>'{qc_review,status}', r.value#>>'{lead,qc_status}') = 'manager_approved'),
    'approved', v_approved,
    'denied', v_denied,
    'needs_correction', count(*) FILTER (WHERE coalesce(r.value#>>'{qc_review,status}', r.value#>>'{lead,qc_status}') = 'needs_correction'),
    'rescheduled', count(*) FILTER (WHERE coalesce(r.value#>>'{appointment,canonical_status}', r.value#>>'{appointment,status}') = 'rescheduled'),
    'completion_percentage', CASE
      WHEN v_scheduled = 0 THEN 0
      ELSE round(((v_approved + v_denied)::numeric / v_scheduled::numeric) * 100, 1)
    END
  )
  INTO v_summary
  FROM jsonb_array_elements(v_rows) AS r(value);

  RETURN jsonb_build_object('days', v_days, 'summary', v_summary, 'rows', v_rows);
END;
$function$;

REVOKE ALL ON FUNCTION public.get_qc_calendar_queue(date, date, uuid, uuid, uuid, text, text, text, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_qc_calendar_queue(date, date, uuid, uuid, uuid, text, text, text, text, text)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.qc_review_lead(
  p_lead_id uuid,
  p_decision text,
  p_reason text DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_lead public.portal_leads%ROWTYPE;
  v_appt public.portal_appointments%ROWTYPE;
  v_cycle public.qc_review_cycles%ROWTYPE;
  v_today date;
  v_same_day boolean := false;
  v_role text := private.readyops_profile_role();
  v_effective_decision text;
  v_correction_assignee uuid;
BEGIN
  IF p_decision NOT IN ('approved', 'denied', 'needs_correction') THEN
    RAISE EXCEPTION 'Decision must be approved, denied, or needs_correction';
  END IF;
  IF p_decision IN ('denied', 'needs_correction') AND nullif(trim(coalesce(p_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'A reason is required for this QC decision';
  END IF;
  IF v_role NOT IN ('admin', 'qc', 'manager') THEN
    RAISE EXCEPTION 'QC reviewer access required';
  END IF;
  IF NOT private.readyops_can_review_lead(p_lead_id) THEN
    RAISE EXCEPTION 'QC reviewer access required for this team';
  END IF;

  v_effective_decision := CASE
    WHEN v_role = 'manager' AND p_decision = 'approved' THEN 'manager_approved'
    ELSE p_decision
  END;

  SELECT * INTO v_lead FROM public.portal_leads WHERE id = p_lead_id FOR UPDATE;
  IF v_lead.id IS NULL THEN RAISE EXCEPTION 'Lead not found'; END IF;
  SELECT * INTO v_appt FROM public.portal_appointments WHERE lead_id = p_lead_id FOR UPDATE;
  SELECT * INTO v_cycle FROM public.qc_review_cycles WHERE lead_id = p_lead_id AND is_current FOR UPDATE;
  IF v_appt.id IS NULL OR v_cycle.id IS NULL THEN RAISE EXCEPTION 'Appointment or active QC cycle not found'; END IF;
  IF v_role = 'manager' AND v_cycle.status = 'manager_approved' THEN
    RAISE EXCEPTION 'This lead is already waiting for final QC';
  END IF;

  v_correction_assignee := v_lead.agent_profile_id;
  IF v_correction_assignee IS NULL THEN
    SELECT p.id INTO v_correction_assignee
    FROM public.profiles AS p
    WHERE p.agent_id = v_lead.agent_id
    LIMIT 1;
  END IF;

  UPDATE public.qc_review_cycles
  SET
    status = v_effective_decision,
    reviewer_id = (SELECT auth.uid()),
    started_at = coalesce(started_at, now()),
    completed_at = CASE WHEN v_effective_decision IN ('approved', 'denied') THEN now() ELSE NULL END,
    correction_assignee_id = CASE WHEN v_effective_decision = 'needs_correction' THEN v_correction_assignee ELSE NULL END,
    correction_attempt = correction_attempt + CASE WHEN v_effective_decision = 'needs_correction' THEN 1 ELSE 0 END,
    reason = nullif(trim(coalesce(p_reason, '')), ''),
    notes = nullif(trim(coalesce(p_notes, '')), ''),
    updated_at = now()
  WHERE id = v_cycle.id
  RETURNING * INTO v_cycle;

  UPDATE public.portal_leads
  SET
    qc_status = v_effective_decision,
    qc_reason = nullif(trim(coalesce(p_reason, '')), ''),
    qc_notes = nullif(trim(coalesce(p_notes, '')), ''),
    qc_reviewed_by = (SELECT auth.uid()),
    qc_reviewed_at = now(),
    updated_at = now()
  WHERE id = p_lead_id
  RETURNING * INTO v_lead;

  IF v_effective_decision = 'approved' THEN
    IF v_role NOT IN ('admin', 'qc') THEN
      RAISE EXCEPTION 'Only Admin or Main QC can release leads to clients';
    END IF;
    IF v_lead.package_id IS NULL THEN
      UPDATE public.portal_leads
      SET package_id = public.portal_active_package(v_lead.company_id)
      WHERE id = v_lead.id
      RETURNING * INTO v_lead;
    END IF;
    UPDATE public.portal_appointments
    SET status = CASE WHEN representative_id IS NULL THEN 'confirmed' ELSE 'assigned' END,
      company_visible_at = now(), updated_at = now()
    WHERE id = v_appt.id
    RETURNING * INTO v_appt;
    PERFORM public.portal_complete_package_if_filled(v_lead.package_id);

    SELECT (now() AT TIME ZONE coalesce((
      SELECT timezone FROM public.company_portal_settings WHERE company_id = v_lead.company_id
    ), 'America/Chicago'))::date INTO v_today;
    v_same_day := v_appt.appointment_date = v_today;
    IF v_same_day AND NOT EXISTS (
      SELECT 1 FROM public.company_notification_batches AS b
      WHERE b.notification_type = 'same_day'
        AND v_lead.id = ANY (b.lead_ids)
        AND b.status IN ('queued', 'sent')
    ) THEN
      INSERT INTO public.company_notification_batches (
        company_id, notification_date, notification_type, status,
        recipient_email, lead_ids, lead_count, created_by
      )
      SELECT v_lead.company_id, v_today, 'same_day', 'queued', c.email,
        ARRAY[v_lead.id], 1, (SELECT auth.uid())
      FROM public.roster_companies AS c
      WHERE c.id = v_lead.company_id;
    END IF;
  ELSIF v_effective_decision = 'denied' THEN
    UPDATE public.portal_appointments
    SET status = 'qc_denied', company_visible_at = NULL, representative_id = NULL,
      rep_status = 'unassigned', updated_at = now()
    WHERE id = v_appt.id
    RETURNING * INTO v_appt;
  ELSE
    UPDATE public.portal_appointments
    SET status = 'qc_pending', company_visible_at = NULL, updated_at = now()
    WHERE id = v_appt.id
    RETURNING * INTO v_appt;
  END IF;

  PERFORM public.portal_write_audit(
    v_lead.company_id,
    v_role,
    (SELECT auth.uid()),
    public.portal_actor_name_for_management(),
    CASE v_effective_decision
      WHEN 'manager_approved' THEN 'manager_qc_submitted'
      WHEN 'approved' THEN 'qc_approved'
      WHEN 'denied' THEN 'qc_denied'
      ELSE 'qc_correction_requested'
    END,
    'lead',
    v_lead.id,
    NULL,
    jsonb_build_object('qc_status', v_effective_decision, 'reason', p_reason, 'appointment_status', v_appt.status),
    jsonb_build_object(
      'appointment_id', v_appt.id,
      'qc_review_id', v_cycle.id,
      'correction_assignee_id', v_cycle.correction_assignee_id,
      'correction_attempt', v_cycle.correction_attempt,
      'released_to_company', v_effective_decision = 'approved'
    )
  );

  RETURN jsonb_build_object(
    'lead', to_jsonb(v_lead),
    'appointment', to_jsonb(v_appt),
    'qc_review', to_jsonb(v_cycle),
    'released_to_company', v_effective_decision = 'approved',
    'same_day_notification_queued', v_same_day AND v_effective_decision = 'approved'
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.qc_resubmit_correction(p_lead_id uuid, p_notes text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_lead public.portal_leads%ROWTYPE;
  v_cycle public.qc_review_cycles%ROWTYPE;
  v_profile public.profiles%ROWTYPE;
BEGIN
  SELECT * INTO v_profile FROM public.profiles WHERE id = (SELECT auth.uid());
  SELECT * INTO v_lead FROM public.portal_leads WHERE id = p_lead_id FOR UPDATE;
  SELECT * INTO v_cycle FROM public.qc_review_cycles WHERE lead_id = p_lead_id AND is_current FOR UPDATE;
  IF v_lead.id IS NULL OR v_cycle.id IS NULL OR v_cycle.status <> 'needs_correction' THEN
    RAISE EXCEPTION 'A Needs Correction review was not found';
  END IF;
  IF NOT (
    private.readyops_can_review_lead(p_lead_id)
    OR (
      v_profile.role = 'agent'
      AND (v_lead.agent_profile_id = v_profile.id OR (v_profile.agent_id IS NOT NULL AND v_lead.agent_id = v_profile.agent_id))
    )
  ) THEN RAISE EXCEPTION 'Correction resubmission access denied'; END IF;

  UPDATE public.qc_review_cycles
  SET status = 'pending', assigned_to = NULL, reviewer_id = NULL, started_at = NULL,
    completed_at = NULL, notes = coalesce(nullif(trim(p_notes), ''), notes), updated_at = now()
  WHERE id = v_cycle.id
  RETURNING * INTO v_cycle;
  UPDATE public.portal_leads SET qc_status = 'pending', qc_notes = coalesce(nullif(trim(p_notes), ''), qc_notes),
    qc_reviewed_by = NULL, qc_reviewed_at = NULL, updated_at = now()
  WHERE id = p_lead_id;

  INSERT INTO public.portal_audit_logs (
    company_id, actor_type, actor_id, actor_name, action, entity_type, entity_id, new_value, metadata
  ) VALUES (
    v_lead.company_id, v_profile.role, v_profile.id,
    coalesce(nullif(v_profile.display_name, ''), 'ReadyOps User'),
    'qc_correction_resubmitted', 'lead', p_lead_id,
    jsonb_build_object('qc_status', 'pending', 'notes', p_notes),
    jsonb_build_object('appointment_id', v_cycle.appointment_id, 'qc_review_id', v_cycle.id, 'correction_attempt', v_cycle.correction_attempt)
  );
  RETURN to_jsonb(v_cycle);
END;
$function$;

REVOKE ALL ON FUNCTION private.readyops_can_review_lead(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.readyops_can_view_lead(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.readyops_can_review_recording_path(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.readyops_can_review_lead(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.readyops_can_view_lead(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.readyops_can_review_recording_path(text) TO authenticated;

DROP POLICY IF EXISTS portal_leads_team_select ON public.portal_leads;
CREATE POLICY portal_leads_team_select
ON public.portal_leads
FOR SELECT
TO authenticated
USING (private.readyops_can_view_lead(id));

DROP POLICY IF EXISTS portal_appointments_team_select ON public.portal_appointments;
CREATE POLICY portal_appointments_team_select
ON public.portal_appointments
FOR SELECT
TO authenticated
USING (private.readyops_can_view_lead(lead_id));

DROP POLICY IF EXISTS qc_review_cycles_authorized_select ON public.qc_review_cycles;
CREATE POLICY qc_review_cycles_authorized_select
ON public.qc_review_cycles
FOR SELECT
TO authenticated
USING (private.readyops_can_view_lead(lead_id));

DROP POLICY IF EXISTS qc_lead_transcripts_select ON public.qc_lead_transcripts;
CREATE POLICY qc_lead_transcripts_select
ON public.qc_lead_transcripts
FOR SELECT TO authenticated
USING (private.readyops_can_review_lead(lead_id));

DROP POLICY IF EXISTS qc_lead_transcripts_insert ON public.qc_lead_transcripts;
CREATE POLICY qc_lead_transcripts_insert
ON public.qc_lead_transcripts
FOR INSERT TO authenticated
WITH CHECK (private.readyops_can_review_lead(lead_id));

DROP POLICY IF EXISTS qc_lead_transcripts_update ON public.qc_lead_transcripts;
CREATE POLICY qc_lead_transcripts_update
ON public.qc_lead_transcripts
FOR UPDATE TO authenticated
USING (private.readyops_can_review_lead(lead_id))
WITH CHECK (private.readyops_can_review_lead(lead_id));

DROP POLICY IF EXISTS qc_lead_transcripts_delete ON public.qc_lead_transcripts;
CREATE POLICY qc_lead_transcripts_delete
ON public.qc_lead_transcripts
FOR DELETE TO authenticated
USING (private.readyops_can_review_lead(lead_id));

DROP POLICY IF EXISTS qc_recordings_select ON storage.objects;
CREATE POLICY qc_recordings_select
ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'qc-recordings'
  AND private.readyops_can_review_recording_path(name)
);

DROP POLICY IF EXISTS qc_recordings_insert ON storage.objects;
CREATE POLICY qc_recordings_insert
ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'qc-recordings'
  AND private.readyops_can_review_recording_path(name)
);

DROP POLICY IF EXISTS qc_recordings_update ON storage.objects;
CREATE POLICY qc_recordings_update
ON storage.objects
FOR UPDATE TO authenticated
USING (
  bucket_id = 'qc-recordings'
  AND private.readyops_can_review_recording_path(name)
)
WITH CHECK (
  bucket_id = 'qc-recordings'
  AND private.readyops_can_review_recording_path(name)
);

DROP POLICY IF EXISTS qc_recordings_delete ON storage.objects;
CREATE POLICY qc_recordings_delete
ON storage.objects
FOR DELETE TO authenticated
USING (
  bucket_id = 'qc-recordings'
  AND private.readyops_can_review_recording_path(name)
);

CREATE OR REPLACE FUNCTION public.qc_start_review(p_lead_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_lead public.portal_leads%ROWTYPE;
  v_cycle public.qc_review_cycles%ROWTYPE;
  v_actor_type text;
BEGIN
  SELECT * INTO v_lead FROM public.portal_leads WHERE id = p_lead_id FOR UPDATE;
  IF v_lead.id IS NULL THEN RAISE EXCEPTION 'Lead not found'; END IF;
  IF NOT private.readyops_can_review_lead(p_lead_id) THEN RAISE EXCEPTION 'QC reviewer access required for this team'; END IF;

  SELECT * INTO v_cycle
  FROM public.qc_review_cycles
  WHERE lead_id = p_lead_id AND is_current
  FOR UPDATE;

  IF v_cycle.id IS NULL THEN RAISE EXCEPTION 'Active QC review cycle not found'; END IF;
  IF v_cycle.status IN ('approved', 'denied') THEN RAISE EXCEPTION 'Reopen the completed QC review before editing it'; END IF;
  IF v_cycle.status = 'manager_approved' AND private.readyops_profile_role() = 'manager' THEN
    RAISE EXCEPTION 'This lead is already waiting for final QC';
  END IF;

  UPDATE public.qc_review_cycles
  SET status = 'in_review', reviewer_id = (SELECT auth.uid()), started_at = coalesce(started_at, now()), updated_at = now()
  WHERE id = v_cycle.id
  RETURNING * INTO v_cycle;

  UPDATE public.portal_leads
  SET qc_status = 'in_review', updated_at = now()
  WHERE id = p_lead_id;

  v_actor_type := private.readyops_profile_role();
  PERFORM public.portal_write_audit(
    v_lead.company_id, v_actor_type, (SELECT auth.uid()), public.portal_actor_name_for_management(),
    'qc_review_started', 'lead', p_lead_id, NULL,
    jsonb_build_object('qc_status', 'in_review'),
    jsonb_build_object('qc_review_id', v_cycle.id, 'appointment_id', v_cycle.appointment_id)
  );

  RETURN to_jsonb(v_cycle);
END;
$function$;

CREATE OR REPLACE FUNCTION public.qc_update_lead(p_lead_id uuid, p_patch jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_old public.portal_leads%ROWTYPE;
  v_new public.portal_leads%ROWTYPE;
  v_form jsonb;
  v_role text := private.readyops_profile_role();
BEGIN
  IF NOT private.readyops_can_review_lead(p_lead_id) THEN
    RAISE EXCEPTION 'QC reviewer access required for this team';
  END IF;
  SELECT * INTO v_old FROM public.portal_leads WHERE id = p_lead_id FOR UPDATE;
  IF v_old.id IS NULL THEN RAISE EXCEPTION 'Lead not found'; END IF;
  IF v_role = 'manager' AND v_old.qc_status = 'manager_approved' THEN
    RAISE EXCEPTION 'This lead is already waiting for final QC';
  END IF;
  v_form := v_old.form_data || coalesce(p_patch->'form_data', '{}'::jsonb);

  UPDATE public.portal_leads SET
    full_name = CASE WHEN p_patch?'full_name' THEN trim(p_patch->>'full_name') ELSE full_name END,
    phone_number = CASE WHEN p_patch?'phone_number' THEN trim(p_patch->>'phone_number') ELSE phone_number END,
    address = CASE WHEN p_patch?'address' THEN trim(p_patch->>'address') ELSE address END,
    city = CASE WHEN p_patch?'city' THEN nullif(trim(p_patch->>'city'), '') ELSE city END,
    state = CASE WHEN p_patch?'state' THEN nullif(trim(p_patch->>'state'), '') ELSE state END,
    zip_code = CASE WHEN p_patch?'zip_code' THEN nullif(trim(p_patch->>'zip_code'), '') ELSE zip_code END,
    email = CASE WHEN p_patch?'email' THEN nullif(lower(trim(p_patch->>'email')), '') ELSE email END,
    language = CASE WHEN p_patch?'language' THEN nullif(trim(p_patch->>'language'), '') ELSE language END,
    service_needed = CASE WHEN p_patch?'service_needed' THEN nullif(trim(p_patch->>'service_needed'), '') ELSE service_needed END,
    notes = CASE WHEN p_patch?'notes' THEN nullif(trim(p_patch->>'notes'), '') ELSE notes END,
    home_value = CASE WHEN p_patch?'home_value' THEN nullif(regexp_replace(coalesce(p_patch->>'home_value', ''), '[^0-9.]', '', 'g'), '')::numeric ELSE home_value END,
    sq_ft = CASE WHEN p_patch?'sq_ft' THEN nullif(regexp_replace(coalesce(p_patch->>'sq_ft', ''), '[^0-9]', '', 'g'), '')::integer ELSE sq_ft END,
    web_url = CASE WHEN p_patch?'web_url' THEN nullif(trim(p_patch->>'web_url'), '') ELSE web_url END,
    recording_url = CASE WHEN p_patch?'recording_url' THEN nullif(trim(p_patch->>'recording_url'), '') ELSE recording_url END,
    share_recording_with_company = CASE WHEN p_patch?'share_recording_with_company' THEN coalesce((p_patch->>'share_recording_with_company')::boolean, false) ELSE share_recording_with_company END,
    form_data = v_form,
    qc_notes = CASE WHEN p_patch?'qc_notes' THEN nullif(trim(p_patch->>'qc_notes'), '') ELSE qc_notes END,
    updated_at = now()
  WHERE id = p_lead_id
  RETURNING * INTO v_new;

  PERFORM public.portal_write_audit(
    v_new.company_id, v_role, (SELECT auth.uid()), public.portal_actor_name_for_management(),
    'qc_lead_edited', 'lead', v_new.id, to_jsonb(v_old), to_jsonb(v_new), '{}'::jsonb
  );
  RETURN to_jsonb(v_new);
END;
$function$;

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
  v_settings public.company_portal_settings%ROWTYPE;
  v_old jsonb;
  v_cycle public.qc_review_cycles%ROWTYPE;
  v_next_cycle public.qc_review_cycles%ROWTYPE;
  v_actor_type text := private.readyops_profile_role();
  v_is_reschedule boolean;
BEGIN
  SELECT * INTO v_lead FROM public.portal_leads WHERE id = p_lead_id FOR UPDATE;
  SELECT * INTO v_appt FROM public.portal_appointments WHERE lead_id = p_lead_id FOR UPDATE;
  IF v_lead.id IS NULL OR v_appt.id IS NULL THEN RAISE EXCEPTION 'Lead or appointment not found'; END IF;
  IF NOT private.readyops_can_review_lead(p_lead_id) OR NOT private.readyops_can_review_company(p_company_id) THEN
    RAISE EXCEPTION 'QC reviewer access required for this team and target company';
  END IF;
  IF v_actor_type = 'manager' AND v_lead.qc_status = 'manager_approved' THEN
    RAISE EXCEPTION 'This lead is already waiting for final QC';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.roster_companies WHERE id = p_company_id AND account_status = 'Active') THEN
    RAISE EXCEPTION 'Target company is not active';
  END IF;
  IF p_location_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.company_locations WHERE id = p_location_id AND company_id = p_company_id AND active
  ) THEN RAISE EXCEPTION 'Target service area does not belong to the company'; END IF;

  v_start := p_start_time::time;
  v_rule := public.portal_assert_slot_capacity(
    p_company_id, p_location_id, p_date, v_start, NULL,
    CASE WHEN v_appt.company_id = p_company_id THEN v_appt.id ELSE NULL END,
    true
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
    p_date, v_start, (v_start + make_interval(mins => v_rule.slot_minutes))::time,
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
    end_time = (v_start + make_interval(mins => v_rule.slot_minutes))::time,
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
    jsonb_build_object('reason', p_reason, 'appointment_id', v_appt.id, 'qc_review_id', v_next_cycle.id)
  );

  RETURN jsonb_build_object('lead', to_jsonb(v_lead), 'appointment', to_jsonb(v_appt), 'qc_review', to_jsonb(v_next_cycle));
END;
$function$;

REVOKE ALL ON FUNCTION public.qc_start_review(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.qc_update_lead(uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.qc_review_lead(uuid, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.qc_resubmit_correction(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.qc_move_lead(uuid, uuid, uuid, date, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.qc_start_review(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.qc_update_lead(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.qc_review_lead(uuid, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.qc_resubmit_correction(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.qc_move_lead(uuid, uuid, uuid, date, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_manager_team_overview(
  p_team_id uuid DEFAULT NULL,
  p_start_date date DEFAULT NULL,
  p_end_date date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_role text;
  v_team_id uuid;
  v_start date := coalesce(p_start_date, current_date - 14);
  v_end date := coalesce(p_end_date, current_date + 45);
BEGIN
  SELECT p.role, coalesce(p.team_id, a.team_id)
  INTO v_role, v_team_id
  FROM public.profiles AS p
  LEFT JOIN public.agents AS a ON a.id = p.agent_id
  WHERE p.id = (SELECT auth.uid());

  IF v_role IS NULL THEN RAISE EXCEPTION 'Authenticated profile required'; END IF;
  IF v_role = 'admin' THEN
    v_team_id := coalesce(p_team_id, v_team_id);
  ELSIF v_role <> 'manager' THEN
    RAISE EXCEPTION 'Manager or admin access required';
  END IF;
  IF v_team_id IS NULL THEN RAISE EXCEPTION 'A team must be assigned to this manager'; END IF;

  RETURN jsonb_build_object(
    'team', (
      SELECT jsonb_build_object('id', t.id, 'name', t.name, 'abbreviation', t.abbreviation)
      FROM public.teams AS t WHERE t.id = v_team_id
    ),
    'agents', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', a.id, 'name', a.name, 'email', a.email, 'active', a.active,
        'portal_slug', a.portal_slug, 'access_token', a.access_token, 'team_id', a.team_id,
        'total_leads', (SELECT count(*) FROM public.portal_leads l JOIN public.portal_appointments ap ON ap.lead_id=l.id WHERE l.agent_id=a.id AND ap.appointment_date BETWEEN v_start AND v_end),
        'qc_pending', (SELECT count(*) FROM public.portal_leads l JOIN public.portal_appointments ap ON ap.lead_id=l.id WHERE l.agent_id=a.id AND l.qc_status IN ('pending','in_review','needs_correction') AND ap.appointment_date BETWEEN v_start AND v_end),
        'awaiting_final_qc', (SELECT count(*) FROM public.portal_leads l JOIN public.portal_appointments ap ON ap.lead_id=l.id WHERE l.agent_id=a.id AND l.qc_status='manager_approved' AND ap.appointment_date BETWEEN v_start AND v_end),
        'approved', (SELECT count(*) FROM public.portal_leads l JOIN public.portal_appointments ap ON ap.lead_id=l.id WHERE l.agent_id=a.id AND l.qc_status='approved' AND ap.appointment_date BETWEEN v_start AND v_end),
        'denied', (SELECT count(*) FROM public.portal_leads l JOIN public.portal_appointments ap ON ap.lead_id=l.id WHERE l.agent_id=a.id AND l.qc_status='denied' AND ap.appointment_date BETWEEN v_start AND v_end)
      ) ORDER BY a.name)
      FROM public.agents AS a
      WHERE a.team_id = v_team_id
    ), '[]'::jsonb),
    'companies', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name, 'state', c.state, 'public_slug', s.public_slug, 'account_status', c.account_status
      ) ORDER BY c.name)
      FROM public.roster_companies AS c
      LEFT JOIN public.company_portal_settings AS s ON s.company_id = c.id
      WHERE EXISTS (SELECT 1 FROM public.company_teams ct WHERE ct.company_id=c.id AND ct.team_id=v_team_id)
        OR (NOT EXISTS (SELECT 1 FROM public.company_teams ct2 WHERE ct2.company_id=c.id) AND c.team_id=v_team_id)
    ), '[]'::jsonb),
    'range', jsonb_build_object('start_date', v_start, 'end_date', v_end)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_manager_link_overview(
  p_access_token uuid,
  p_start_date date DEFAULT NULL,
  p_end_date date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_manager public.manager_portal_links%ROWTYPE;
  v_start date := coalesce(p_start_date, current_date - 14);
  v_end date := coalesce(p_end_date, current_date + 45);
BEGIN
  SELECT * INTO v_manager
  FROM public.manager_portal_links AS m
  WHERE m.access_token = p_access_token AND m.active;
  IF v_manager.id IS NULL THEN RAISE EXCEPTION 'Manager link is invalid or disabled'; END IF;

  RETURN jsonb_build_object(
    'manager', jsonb_build_object('id', v_manager.id, 'name', v_manager.name, 'portal_slug', v_manager.portal_slug),
    'team', (SELECT jsonb_build_object('id', t.id, 'name', t.name, 'abbreviation', t.abbreviation) FROM public.teams t WHERE t.id=v_manager.team_id),
    'agents', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', a.id, 'name', a.name, 'email', a.email, 'active', a.active,
        'portal_slug', a.portal_slug, 'access_token', a.access_token, 'team_id', a.team_id,
        'total_leads', (SELECT count(*) FROM public.portal_leads l JOIN public.portal_appointments ap ON ap.lead_id=l.id WHERE l.agent_id=a.id AND ap.appointment_date BETWEEN v_start AND v_end),
        'qc_pending', (SELECT count(*) FROM public.portal_leads l JOIN public.portal_appointments ap ON ap.lead_id=l.id WHERE l.agent_id=a.id AND l.qc_status IN ('pending','in_review','needs_correction') AND ap.appointment_date BETWEEN v_start AND v_end),
        'awaiting_final_qc', (SELECT count(*) FROM public.portal_leads l JOIN public.portal_appointments ap ON ap.lead_id=l.id WHERE l.agent_id=a.id AND l.qc_status='manager_approved' AND ap.appointment_date BETWEEN v_start AND v_end),
        'approved', (SELECT count(*) FROM public.portal_leads l JOIN public.portal_appointments ap ON ap.lead_id=l.id WHERE l.agent_id=a.id AND l.qc_status='approved' AND ap.appointment_date BETWEEN v_start AND v_end),
        'denied', (SELECT count(*) FROM public.portal_leads l JOIN public.portal_appointments ap ON ap.lead_id=l.id WHERE l.agent_id=a.id AND l.qc_status='denied' AND ap.appointment_date BETWEEN v_start AND v_end)
      ) ORDER BY a.name)
      FROM public.agents AS a WHERE a.team_id=v_manager.team_id AND a.active
    ), '[]'::jsonb),
    'companies', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name, 'state', c.state, 'public_slug', s.public_slug, 'account_status', c.account_status
      ) ORDER BY c.name)
      FROM public.roster_companies AS c
      LEFT JOIN public.company_portal_settings AS s ON s.company_id=c.id
      WHERE EXISTS (SELECT 1 FROM public.company_teams ct WHERE ct.company_id=c.id AND ct.team_id=v_manager.team_id)
        OR (NOT EXISTS (SELECT 1 FROM public.company_teams ct2 WHERE ct2.company_id=c.id) AND c.team_id=v_manager.team_id)
    ), '[]'::jsonb),
    'range', jsonb_build_object('start_date', v_start, 'end_date', v_end)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_manager_team_overview(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_manager_team_overview(uuid, date, date) TO authenticated;


