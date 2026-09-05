BEGIN;

ALTER TABLE public.portal_appointments
  ADD COLUMN IF NOT EXISTS client_received boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS received_at timestamptz,
  ADD COLUMN IF NOT EXISTS received_by text;

COMMENT ON COLUMN public.portal_appointments.client_received
  IS 'Receipt acknowledgement only; it does not change the lead disposition.';
COMMENT ON COLUMN public.portal_appointments.received_at
  IS 'Time the company or assigned representative acknowledged receipt.';
COMMENT ON COLUMN public.portal_appointments.received_by
  IS 'Human-readable company or representative actor that acknowledged receipt.';

-- Preserve legacy acknowledgements before normalizing company_action to the
-- six supported dispositions.
UPDATE public.portal_appointments
SET client_received = true,
    received_at = coalesce(received_at, last_company_update_at, updated_at, now()),
    received_by = coalesce(received_by, 'Legacy company confirmation')
WHERE company_action IN ('confirmed', 'contacted');

UPDATE public.portal_appointments
SET inspector_notes = concat_ws(
      E'\n',
      nullif(trim(coalesce(inspector_notes, '')), ''),
      'Legacy claim-filed status preserved as a note.'
    )
WHERE company_action = 'claim_filed'
  AND coalesce(sales_outcome, '') <> 'signed_contract';

UPDATE public.portal_appointments
SET company_action = CASE
      WHEN company_action IN ('inspected', 'good_inspected') THEN 'good'
      WHEN company_action IN ('lost', 'cancelled', 'canceled') THEN 'bad'
      WHEN company_action = 'reschedule' THEN 'rescheduled'
      WHEN company_action IN ('signed_claim_filed', 'claim_filed')
        AND sales_outcome = 'signed_contract' THEN 'signed_contract'
      WHEN company_action IN ('confirmed', 'contacted', 'claim_filed') THEN
        CASE
          WHEN client_status = 'good' OR canonical_status = 'good_inspected' THEN 'good'
          WHEN client_status = 'bad' OR canonical_status = 'bad' THEN 'bad'
          WHEN client_status = 'no_show' OR canonical_status = 'no_show' THEN 'no_show'
          WHEN client_status = 'signed_contract' OR canonical_status = 'signed_contract' THEN 'signed_contract'
          WHEN client_status IN ('reschedule', 'rescheduled') OR canonical_status = 'rescheduled' THEN 'rescheduled'
          ELSE 'pending'
        END
      ELSE company_action
    END
WHERE company_action IN (
  'inspected', 'good_inspected', 'lost', 'cancelled', 'canceled',
  'reschedule', 'signed_claim_filed', 'claim_filed', 'confirmed', 'contacted'
);

UPDATE public.portal_appointments
SET client_status = CASE
      WHEN client_status IN ('inspected', 'good_inspected') THEN 'good'
      WHEN client_status IN ('lost', 'cancelled', 'canceled') THEN 'bad'
      WHEN client_status = 'signed_claim_filed' THEN 'signed_contract'
      WHEN client_status = 'rescheduled' THEN 'reschedule'
      ELSE client_status
    END
WHERE client_status IN (
  'inspected', 'good_inspected', 'lost', 'cancelled', 'canceled',
  'signed_claim_filed', 'rescheduled'
);

CREATE OR REPLACE FUNCTION public.company_confirm_lead_received(
  p_company_id uuid,
  p_access_token uuid,
  p_appointment_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_company_id uuid;
  v_old public.portal_appointments%ROWTYPE;
  v_new public.portal_appointments%ROWTYPE;
  v_actor_type text;
  v_actor_name text;
BEGIN
  v_company_id := public.portal_resolve_company_access(p_company_id, p_access_token);

  SELECT appointment.* INTO v_old
  FROM public.portal_appointments AS appointment
  JOIN public.portal_leads AS lead ON lead.id = appointment.lead_id
  WHERE appointment.id = p_appointment_id
    AND appointment.company_id = v_company_id
    AND lead.qc_status = 'approved'
    AND appointment.company_visible_at IS NOT NULL
  FOR UPDATE OF appointment;

  IF v_old.id IS NULL THEN
    RAISE EXCEPTION 'Delivered appointment not found';
  END IF;

  v_actor_type := public.portal_actor_type_for_management(p_access_token);
  v_actor_name := coalesce(public.portal_actor_name_for_management(), 'Company');

  UPDATE public.portal_appointments
  SET client_received = true,
      received_at = coalesce(received_at, now()),
      received_by = coalesce(received_by, v_actor_name),
      last_company_update_at = now()
  WHERE id = v_old.id
  RETURNING * INTO v_new;

  PERFORM public.portal_write_audit(
    v_company_id,
    v_actor_type,
    auth.uid(),
    v_actor_name,
    'lead_received_confirmed',
    'appointment',
    v_new.id,
    jsonb_build_object('client_received', v_old.client_received),
    jsonb_build_object(
      'client_received', v_new.client_received,
      'received_at', v_new.received_at,
      'received_by', v_new.received_by
    ),
    jsonb_build_object('disposition_unchanged', v_new.canonical_status)
  );

  RETURN to_jsonb(v_new);
END;
$function$;

CREATE OR REPLACE FUNCTION public.company_update_lead_outcome(
  p_company_id uuid,
  p_access_token uuid,
  p_appointment_id uuid,
  p_client_status text,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_company_id uuid;
  v_old public.portal_appointments%ROWTYPE;
  v_new public.portal_appointments%ROWTYPE;
  v_action text := lower(trim(coalesce(p_client_status, '')));
  v_canonical text;
BEGIN
  v_company_id := public.portal_resolve_company_access(p_company_id, p_access_token);

  IF v_action NOT IN (
    'pending', 'good', 'bad', 'no_show', 'signed_contract', 'rescheduled'
  ) THEN
    RAISE EXCEPTION 'Invalid company lead status';
  END IF;

  SELECT appointment.* INTO v_old
  FROM public.portal_appointments AS appointment
  JOIN public.portal_leads AS lead ON lead.id = appointment.lead_id
  WHERE appointment.id = p_appointment_id
    AND appointment.company_id = v_company_id
    AND lead.qc_status = 'approved'
    AND appointment.company_visible_at IS NOT NULL
  FOR UPDATE OF appointment;

  IF v_old.id IS NULL THEN
    RAISE EXCEPTION 'Delivered appointment not found';
  END IF;

  v_canonical := CASE v_action
    WHEN 'good' THEN 'good_inspected'
    ELSE v_action
  END;

  PERFORM set_config('readyops.status_source', 'company_portal', true);

  UPDATE public.portal_appointments
  SET company_action = v_action,
      canonical_status = v_canonical,
      inspector_notes = CASE
        WHEN nullif(trim(coalesce(p_notes, '')), '') IS NULL THEN inspector_notes
        ELSE trim(p_notes)
      END,
      last_company_update_at = now(),
      status = CASE
        WHEN v_action IN ('good', 'signed_contract') THEN 'completed'
        WHEN v_action = 'bad' THEN 'cancelled'
        WHEN v_action = 'rescheduled' THEN 'rescheduled'
        ELSE status
      END
  WHERE id = v_old.id
  RETURNING * INTO v_new;

  PERFORM public.portal_write_audit(
    v_company_id,
    public.portal_actor_type_for_management(p_access_token),
    auth.uid(),
    coalesce(public.portal_actor_name_for_management(), 'Company'),
    'company_lead_outcome_updated',
    'appointment',
    v_new.id,
    to_jsonb(v_old),
    to_jsonb(v_new),
    jsonb_build_object(
      'company_action', v_action,
      'canonical_status', v_new.canonical_status
    )
  );

  RETURN to_jsonb(v_new);
END;
$function$;

CREATE OR REPLACE FUNCTION public.representative_update_appointment(
  p_access_token uuid,
  p_appointment_id uuid,
  p_action text,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_rep public.company_representatives%ROWTYPE;
  v_old public.portal_appointments%ROWTYPE;
  v_new public.portal_appointments%ROWTYPE;
  v_canonical text;
BEGIN
  SELECT representative.* INTO v_rep
  FROM public.company_representatives AS representative
  WHERE representative.access_token = p_access_token
    AND representative.active;

  IF v_rep.id IS NULL THEN
    RAISE EXCEPTION 'Representative link is invalid or disabled';
  END IF;

  IF p_action NOT IN (
    'confirmed', 'inspection_completed', 'homeowner_no_show',
    'homeowner_cancelled', 'signed_contract', 'rescheduled'
  ) THEN
    RAISE EXCEPTION 'Unsupported representative action';
  END IF;

  SELECT appointment.* INTO v_old
  FROM public.portal_appointments AS appointment
  JOIN public.portal_leads AS lead ON lead.id = appointment.lead_id
  WHERE appointment.id = p_appointment_id
    AND appointment.representative_id = v_rep.id
    AND lead.qc_status = 'approved'
    AND appointment.company_visible_at IS NOT NULL
  FOR UPDATE OF appointment;

  IF v_old.id IS NULL THEN
    RAISE EXCEPTION 'QC Approved appointment is not assigned to this representative';
  END IF;

  IF p_action = 'confirmed' THEN
    UPDATE public.portal_appointments
    SET client_received = true,
        received_at = coalesce(received_at, now()),
        received_by = coalesce(received_by, 'Representative: ' || v_rep.name),
        last_company_update_at = now()
    WHERE id = v_old.id
    RETURNING * INTO v_new;
  ELSE
    v_canonical := CASE p_action
      WHEN 'inspection_completed' THEN 'good_inspected'
      WHEN 'homeowner_no_show' THEN 'no_show'
      WHEN 'homeowner_cancelled' THEN 'bad'
      WHEN 'signed_contract' THEN 'signed_contract'
      WHEN 'rescheduled' THEN 'rescheduled'
    END;

    PERFORM set_config('readyops.status_source', 'representative', true);

    UPDATE public.portal_appointments
    SET company_action = CASE p_action
          WHEN 'inspection_completed' THEN 'good'
          WHEN 'homeowner_no_show' THEN 'no_show'
          WHEN 'homeowner_cancelled' THEN 'bad'
          WHEN 'signed_contract' THEN 'signed_contract'
          WHEN 'rescheduled' THEN 'rescheduled'
        END,
        canonical_status = v_canonical,
        inspector_notes = CASE
          WHEN nullif(trim(coalesce(p_note, '')), '') IS NULL THEN inspector_notes
          ELSE trim(p_note)
        END,
        last_company_update_at = now(),
        status = CASE
          WHEN p_action IN ('inspection_completed', 'signed_contract') THEN 'completed'
          WHEN p_action = 'homeowner_cancelled' THEN 'cancelled'
          WHEN p_action = 'rescheduled' THEN 'rescheduled'
          ELSE status
        END
    WHERE id = v_old.id
    RETURNING * INTO v_new;
  END IF;

  PERFORM public.portal_write_audit(
    v_rep.company_id,
    'representative',
    v_rep.id,
    v_rep.name,
    CASE
      WHEN p_action = 'confirmed' THEN 'lead_received_confirmed'
      ELSE 'representative_lead_outcome_updated'
    END,
    'appointment',
    v_new.id,
    to_jsonb(v_old),
    to_jsonb(v_new),
    jsonb_build_object(
      'requested_action', p_action,
      'disposition', v_new.company_action,
      'note', p_note
    )
  );

  RETURN to_jsonb(v_new);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_representative_portal(
  p_access_token uuid,
  p_start_date date,
  p_end_date date
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_rep public.company_representatives%ROWTYPE;
BEGIN
  SELECT representative.* INTO v_rep
  FROM public.company_representatives AS representative
  WHERE representative.access_token = p_access_token
    AND representative.active;

  IF v_rep.id IS NULL THEN
    RAISE EXCEPTION 'Representative link is invalid or disabled';
  END IF;

  RETURN jsonb_build_object(
    'representative', to_jsonb(v_rep) - 'access_token',
    'company', (
      SELECT to_jsonb(company)
      FROM public.roster_companies AS company
      WHERE company.id = v_rep.company_id
    ),
    'settings', (
      SELECT jsonb_build_object('timezone', settings.timezone)
      FROM public.company_portal_settings AS settings
      WHERE settings.company_id = v_rep.company_id
    ),
    'appointments', coalesce((
      SELECT jsonb_agg(
        to_jsonb(appointment) || jsonb_build_object(
          'lead',
            (to_jsonb(lead) - 'recording_url' - 'share_recording_with_company' - 'form_data') ||
            jsonb_build_object(
              'form_data', coalesce(lead.form_data, '{}'::jsonb)
                - 'recording_url' - 'recording' - 'audio_url'
                - 'call_recording' - 'recording_link',
              'recording_url', CASE
                WHEN lead.share_recording_with_company THEN lead.recording_url
                ELSE NULL
              END,
              'recording_shared', lead.share_recording_with_company
            )
        )
        ORDER BY appointment.appointment_date, appointment.start_time
      )
      FROM public.portal_appointments AS appointment
      JOIN public.portal_leads AS lead ON lead.id = appointment.lead_id
      WHERE appointment.representative_id = v_rep.id
        AND appointment.appointment_date BETWEEN p_start_date AND p_end_date
        AND appointment.status NOT IN ('cancelled', 'rescheduled', 'qc_denied')
        AND lead.qc_status = 'approved'
        AND appointment.company_visible_at IS NOT NULL
    ), '[]'::jsonb)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.company_confirm_lead_received(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.company_confirm_lead_received(uuid, uuid, uuid)
  TO anon, authenticated;

REVOKE ALL ON FUNCTION public.company_update_lead_outcome(uuid, uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.company_update_lead_outcome(uuid, uuid, uuid, text, text)
  TO anon, authenticated;

REVOKE ALL ON FUNCTION public.representative_update_appointment(uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.representative_update_appointment(uuid, uuid, text, text)
  TO anon, authenticated;

REVOKE ALL ON FUNCTION public.get_representative_portal(uuid, date, date)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_representative_portal(uuid, date, date)
  TO anon, authenticated;

DROP FUNCTION IF EXISTS public.representative_check_in(
  uuid, uuid, double precision, double precision, double precision, text
);

COMMENT ON FUNCTION public.company_confirm_lead_received(uuid, uuid, uuid)
  IS 'Records company receipt acknowledgement without changing disposition.';
COMMENT ON FUNCTION public.company_update_lead_outcome(uuid, uuid, uuid, text, text)
  IS 'Updates one of the six standardized dispositions for a delivered lead.';
COMMENT ON FUNCTION public.representative_update_appointment(uuid, uuid, text, text)
  IS 'Records representative receipt or one standardized lead disposition.';

COMMIT;
