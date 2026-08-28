-- Imported from the hosted ReadyOp Supabase migration history on 2026-08-28.
-- Schema only: no production table data is included.

CREATE OR REPLACE FUNCTION public.sync_readymode_lead(p_secret uuid, p_source_lead_id text, p_disposition text, p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_secret uuid;
  v_lead public.portal_leads%ROWTYPE;
  v_appt public.portal_appointments%ROWTYPE;
  v_patch jsonb;
  v_recording_url text;
BEGIN
  SELECT webhook_secret INTO v_secret
  FROM public.readymode_integration_settings
  WHERE id=true AND enabled;

  IF v_secret IS NULL OR p_secret<>v_secret THEN
    RAISE EXCEPTION 'Invalid integration secret';
  END IF;

  SELECT * INTO v_lead
  FROM public.portal_leads
  WHERE source='readymode' AND source_lead_id=p_source_lead_id
  FOR UPDATE;

  IF v_lead.id IS NULL THEN
    RAISE EXCEPTION 'ReadyMode lead has not been submitted into Ready Ops yet';
  END IF;

  SELECT * INTO v_appt
  FROM public.portal_appointments
  WHERE lead_id=v_lead.id
  FOR UPDATE;

  v_patch := v_lead.form_data || coalesce(p_payload,'{}'::jsonb);
  v_recording_url := nullif(trim(coalesce(
    p_payload->>'recording_url',
    p_payload->>'recording',
    p_payload->>'recording_link',
    p_payload->>'audio_url',
    p_payload->>'call_recording',
    v_lead.recording_url,
    ''
  )), '');

  UPDATE public.portal_leads
  SET
    form_data=v_patch,
    source_disposition=p_disposition,
    service_needed=coalesce(nullif(p_payload->>'service_needed',''),service_needed),
    language=coalesce(nullif(p_payload->>'language',''),language),
    notes=coalesce(nullif(p_payload->>'notes',''),notes),
    home_value=coalesce(nullif(regexp_replace(coalesce(p_payload->>'home_value',''),'[^0-9.]','','g'),'')::numeric,home_value),
    sq_ft=coalesce(nullif(regexp_replace(coalesce(p_payload->>'sq_ft',''),'[^0-9]','','g'),'')::integer,sq_ft),
    web_url=coalesce(nullif(p_payload->>'web_url',''),web_url),
    recording_url=coalesce(v_recording_url,recording_url)
  WHERE id=v_lead.id
  RETURNING * INTO v_lead;

  IF lower(coalesce(p_disposition,'')) IN ('qc denied','qc_denied','qc-denied') THEN
    UPDATE public.portal_leads
    SET qc_status='denied',
        qc_reason=coalesce(nullif(p_payload->>'qc_reason',''),'ReadyMode QC Denied'),
        qc_reviewed_at=now()
    WHERE id=v_lead.id
    RETURNING * INTO v_lead;

    UPDATE public.portal_appointments
    SET status='cancelled',company_visible_at=NULL,representative_id=NULL,rep_status='unassigned'
    WHERE id=v_appt.id
    RETURNING * INTO v_appt;
  END IF;

  RETURN jsonb_build_object('lead',to_jsonb(v_lead),'appointment',to_jsonb(v_appt));
END;
$function$;
