BEGIN;

CREATE OR REPLACE FUNCTION public.qc_delete_lead(
  p_lead_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_lead public.portal_leads%ROWTYPE;
  v_appt public.portal_appointments%ROWTYPE;
BEGIN
  IF NOT public.portal_is_qc_or_admin() THEN
    RAISE EXCEPTION 'QC or admin access required';
  END IF;

  SELECT * INTO v_lead
  FROM public.portal_leads
  WHERE id = p_lead_id
  FOR UPDATE;

  IF v_lead.id IS NULL THEN
    RAISE EXCEPTION 'Lead not found';
  END IF;

  SELECT * INTO v_appt
  FROM public.portal_appointments
  WHERE lead_id = p_lead_id
  FOR UPDATE;

  IF v_lead.qc_status = 'approved' OR v_appt.company_visible_at IS NOT NULL THEN
    RAISE EXCEPTION 'Approved or already-delivered leads cannot be deleted from QC';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.invoice_items
    WHERE lead_id = p_lead_id
  ) THEN
    RAISE EXCEPTION 'This lead is attached to an invoice and cannot be deleted';
  END IF;

  PERFORM public.portal_write_audit(
    v_lead.company_id,
    CASE WHEN public.portal_is_admin() THEN 'admin' ELSE 'qc' END,
    auth.uid(),
    public.portal_actor_name_for_management(),
    'qc_lead_deleted',
    'lead',
    v_lead.id,
    to_jsonb(v_lead),
    NULL,
    jsonb_build_object(
      'appointment_id', v_appt.id,
      'appointment_date', v_appt.appointment_date,
      'start_time', v_appt.start_time,
      'reason', nullif(trim(coalesce(p_reason,'')), '')
    )
  );

  DELETE FROM public.portal_leads
  WHERE id = p_lead_id;

  RETURN jsonb_build_object(
    'deleted', true,
    'lead_id', p_lead_id,
    'appointment_id', v_appt.id
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.qc_delete_lead(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.qc_delete_lead(uuid,text) TO authenticated;

COMMIT;
