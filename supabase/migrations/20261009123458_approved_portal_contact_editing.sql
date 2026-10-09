-- Existing capability links remain limited to released, QC-approved appointments.
CREATE OR REPLACE FUNCTION public.portal_update_lead_contact(
  p_appointment_id uuid, p_access_token uuid, p_company_id uuid,
  p_representative boolean, p_phone text, p_email text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_company uuid;
  v_rep uuid;
  v_lead uuid;
BEGIN
  IF p_representative THEN
    SELECT id, company_id INTO v_rep, v_company FROM public.company_representatives
    WHERE access_token = p_access_token AND active;
    IF v_rep IS NULL THEN RAISE EXCEPTION 'Representative link is invalid or disabled'; END IF;
  ELSE
    v_company := public.portal_resolve_company_access(p_company_id, p_access_token);
  END IF;
  SELECT l.id INTO v_lead FROM public.portal_appointments a
  JOIN public.portal_leads l ON l.id = a.lead_id
  WHERE a.id = p_appointment_id AND a.company_id = v_company AND l.company_id = v_company
    AND l.qc_status = 'approved' AND a.company_visible_at IS NOT NULL
    AND (NOT p_representative OR a.representative_id = v_rep)
  FOR UPDATE OF l;
  IF v_lead IS NULL THEN RAISE EXCEPTION 'Delivered appointment is not accessible through this link'; END IF;
  IF length(btrim(coalesce(p_phone,''))) < 7 OR length(p_phone) > 50 THEN
    RAISE EXCEPTION 'Enter a valid phone number';
  END IF;
  IF length(coalesce(p_email,'')) > 254 OR (btrim(coalesce(p_email,'')) <> '' AND p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') THEN
    RAISE EXCEPTION 'Enter a valid email address';
  END IF;
  UPDATE public.portal_leads SET phone_number = btrim(p_phone), email = nullif(btrim(p_email),''),
    form_data = coalesce(form_data,'{}'::jsonb) || jsonb_build_object('phone_number',btrim(p_phone),'email',coalesce(btrim(p_email),'')),
    updated_at = now() WHERE id = v_lead;
  RETURN jsonb_build_object('saved',true);
END;
$$;
REVOKE ALL ON FUNCTION public.portal_update_lead_contact(uuid,uuid,uuid,boolean,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.portal_update_lead_contact(uuid,uuid,uuid,boolean,text,text) TO anon, authenticated;

-- Normalize future Lighting forms; past lead snapshots remain intact.
UPDATE public.lead_service_templates SET name='Permanent Lighting Appointment', template_title='Permanent Lighting Appointment', form_schema=$schema$[{"id":"customer","title":"Customer Information","fields":[{"key":"full_name","label":"Full Name","type":"text","required":true},{"key":"phone_number","label":"Phone","type":"phone","required":true},{"key":"address","label":"Address","type":"address","required":true},{"key":"email","label":"Email","type":"email"},{"key":"language","label":"Language","type":"select","options":["English","Spanish","Bilingual","Other"]}]},{"id":"project","title":"Project Information","fields":[{"key":"service_needed","label":"Service Requested","type":"select","options":["Free Design & Estimate"],"defaultValue":"Free Design & Estimate","required":true},{"key":"home_type","label":"Home Type","type":"select","options":["Single Family Home","Town Home","Multifamily Home","Commercial","Mobile Home","Other"],"allowOther":true},{"key":"stories","label":"Number of Stories","type":"select","options":["1","1.5","2","2.5","3"]},{"key":"decision_makers","label":"Decision Maker Present","type":"select","options":["Homeowner is the Sole Decision Maker","Both Will be Present","Only Husband","Only Wife","Other"],"allowOther":true},{"key":"additional_properties","label":"Additional Properties","type":"select","options":["Yes","No"]},{"key":"second_address","label":"2nd Address","type":"address","showWhen":{"field":"additional_properties","equals":"Yes"}},{"key":"home_value","label":"Home Value","type":"currency"},{"key":"sq_ft","label":"Square Feet","type":"number"},{"key":"web_url","label":"Property Link","type":"url"}]},{"id":"additional","title":"Customer Notes","fields":[{"key":"notes","label":"Customer Notes","type":"textarea"},{"key":"recording_url","label":"Call Recording (QC only)","type":"recording"}]}]$schema$::jsonb WHERE id='permanent_exterior_lighting';
UPDATE public.company_service_templates c SET template_title='Permanent Lighting Appointment',
 form_schema=(SELECT jsonb_agg(section || jsonb_build_object('fields',
   (SELECT jsonb_agg(field || coalesce((SELECT jsonb_build_object('mode',old_field->'mode') FROM jsonb_array_elements(c.form_schema) old_section CROSS JOIN LATERAL jsonb_array_elements(old_section->'fields') old_field WHERE old_field->>'key'=field->>'key' AND old_field ? 'mode' LIMIT 1),'{}'::jsonb))
    FROM jsonb_array_elements(section->'fields') field))) FROM jsonb_array_elements($schema$[{"id":"customer","title":"Customer Information","fields":[{"key":"full_name","label":"Full Name","type":"text","required":true},{"key":"phone_number","label":"Phone","type":"phone","required":true},{"key":"address","label":"Address","type":"address","required":true},{"key":"email","label":"Email","type":"email"},{"key":"language","label":"Language","type":"select","options":["English","Spanish","Bilingual","Other"]}]},{"id":"project","title":"Project Information","fields":[{"key":"service_needed","label":"Service Requested","type":"select","options":["Free Design & Estimate"],"defaultValue":"Free Design & Estimate","required":true},{"key":"home_type","label":"Home Type","type":"select","options":["Single Family Home","Town Home","Multifamily Home","Commercial","Mobile Home","Other"],"allowOther":true},{"key":"stories","label":"Number of Stories","type":"select","options":["1","1.5","2","2.5","3"]},{"key":"decision_makers","label":"Decision Maker Present","type":"select","options":["Homeowner is the Sole Decision Maker","Both Will be Present","Only Husband","Only Wife","Other"],"allowOther":true},{"key":"additional_properties","label":"Additional Properties","type":"select","options":["Yes","No"]},{"key":"second_address","label":"2nd Address","type":"address","showWhen":{"field":"additional_properties","equals":"Yes"}},{"key":"home_value","label":"Home Value","type":"currency"},{"key":"sq_ft","label":"Square Feet","type":"number"},{"key":"web_url","label":"Property Link","type":"url"}]},{"id":"additional","title":"Customer Notes","fields":[{"key":"notes","label":"Customer Notes","type":"textarea"},{"key":"recording_url","label":"Call Recording (QC only)","type":"recording"}]}]$schema$::jsonb) section)
 WHERE service_id='permanent_exterior_lighting';
