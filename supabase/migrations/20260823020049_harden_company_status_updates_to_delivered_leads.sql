-- Imported from the hosted ReadyOp Supabase migration history on 2026-08-28.
-- Schema only: no production table data is included.

BEGIN;

CREATE OR REPLACE FUNCTION public.company_update_appointment_status(
  p_company_id uuid,
  p_access_token uuid,
  p_appointment_id uuid,
  p_status text
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
BEGIN
  v_company_id := public.portal_resolve_company_access(p_company_id, p_access_token);

  IF p_status NOT IN ('confirmed', 'assigned', 'cancelled', 'completed') THEN
    RAISE EXCEPTION 'Invalid appointment status';
  END IF;

  SELECT a.* INTO v_old
  FROM public.portal_appointments AS a
  JOIN public.portal_leads AS l ON l.id = a.lead_id
  WHERE a.id = p_appointment_id
    AND a.company_id = v_company_id
    AND l.qc_status = 'approved'
    AND a.company_visible_at IS NOT NULL
  FOR UPDATE OF a;

  IF v_old.id IS NULL THEN
    RAISE EXCEPTION 'Delivered appointment not found';
  END IF;

  UPDATE public.portal_appointments
  SET status = p_status
  WHERE id = v_old.id
  RETURNING * INTO v_new;

  PERFORM public.portal_write_audit(
    v_company_id,
    public.portal_actor_type_for_management(p_access_token),
    auth.uid(),
    public.portal_actor_name_for_management(),
    'appointment_status_updated',
    'appointment',
    v_new.id,
    jsonb_build_object('status', v_old.status),
    jsonb_build_object('status', v_new.status),
    jsonb_build_object('company_action', v_new.company_action)
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
  v_company uuid;
  v_old public.portal_appointments%ROWTYPE;
  v_new public.portal_appointments%ROWTYPE;
  v_action text := lower(trim(coalesce(p_client_status, '')));
  v_client_status text;
BEGIN
  v_company := public.portal_resolve_company_access(p_company_id, p_access_token);

  IF v_action NOT IN (
    'pending', 'contacted', 'confirmed', 'inspected', 'no_show', 'rescheduled',
    'estimate_given', 'claim_filed', 'signed_contract', 'lost',
    'good', 'bad', 'reschedule', 'follow_up'
  ) THEN
    RAISE EXCEPTION 'Invalid company lead status';
  END IF;

  SELECT a.* INTO v_old
  FROM public.portal_appointments AS a
  JOIN public.portal_leads AS l ON l.id = a.lead_id
  WHERE a.id = p_appointment_id
    AND a.company_id = v_company
    AND l.qc_status = 'approved'
    AND a.company_visible_at IS NOT NULL
  FOR UPDATE OF a;

  IF v_old.id IS NULL THEN
    RAISE EXCEPTION 'Delivered appointment not found';
  END IF;

  v_client_status := CASE v_action
    WHEN 'inspected' THEN 'good'
    WHEN 'no_show' THEN 'no_show'
    WHEN 'rescheduled' THEN 'reschedule'
    WHEN 'signed_contract' THEN 'signed_contract'
    WHEN 'lost' THEN 'bad'
    WHEN 'good' THEN 'good'
    WHEN 'bad' THEN 'bad'
    WHEN 'reschedule' THEN 'reschedule'
    ELSE 'pending'
  END;

  UPDATE public.portal_appointments
  SET company_action = v_action,
      client_status = v_client_status,
      inspector_notes = CASE
        WHEN nullif(trim(coalesce(p_notes, '')), '') IS NULL THEN inspector_notes
        ELSE trim(p_notes)
      END,
      last_company_update_at = now(),
      status = CASE WHEN v_action = 'confirmed' THEN 'confirmed' ELSE status END,
      attendance_status = CASE
        WHEN v_action = 'no_show' THEN 'homeowner_no_show'
        ELSE attendance_status
      END,
      inspection_status = CASE
        WHEN v_action = 'inspected' THEN 'completed'
        ELSE inspection_status
      END,
      sales_outcome = CASE
        WHEN v_action = 'signed_contract' THEN 'signed_contract'
        WHEN v_action = 'lost' THEN 'lost'
        WHEN v_action IN ('estimate_given', 'claim_filed', 'follow_up') THEN 'follow_up'
        ELSE sales_outcome
      END
  WHERE id = v_old.id
  RETURNING * INTO v_new;

  PERFORM public.portal_write_audit(
    v_company,
    'company',
    NULL,
    'Company',
    'company_lead_outcome_updated',
    'appointment',
    v_new.id,
    to_jsonb(v_old),
    to_jsonb(v_new),
    jsonb_build_object('company_action', v_action)
  );

  RETURN to_jsonb(v_new);
END;
$function$;

REVOKE ALL ON FUNCTION public.company_update_appointment_status(uuid, uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.company_update_appointment_status(uuid, uuid, uuid, text)
  TO anon, authenticated;

REVOKE ALL ON FUNCTION public.company_update_lead_outcome(uuid, uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.company_update_lead_outcome(uuid, uuid, uuid, text, text)
  TO anon, authenticated;

COMMENT ON FUNCTION public.company_update_appointment_status(uuid, uuid, uuid, text)
  IS 'Updates appointment workflow status only for an approved lead explicitly sent to the company.';
COMMENT ON FUNCTION public.company_update_lead_outcome(uuid, uuid, uuid, text, text)
  IS 'Updates company lead outcomes only for an approved lead explicitly sent to the company.';

COMMIT;


