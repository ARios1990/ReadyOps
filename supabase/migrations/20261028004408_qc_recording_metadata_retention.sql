-- Keep reviewed recording drafts through the existing service-form filter.
-- Public booking payloads cannot create or replace internal QC evidence.
DO $migration$
DECLARE definition text;
  declaration_anchor text := 'v_template text; v_modern boolean';
  filter_anchor text := '-- A forged/stale payload cannot retain fields from a different service.';
  field_anchor text := '''property_latitude'',''property_longitude'')';
  loop_anchor text := 'for v_field in select f from jsonb_array_elements(v_schema)';
BEGIN
  definition := pg_get_functiondef('private.apply_universal_lead_template()'::regprocedure);
  IF position('v_qc_metadata jsonb' in definition)>0 THEN RETURN; END IF;
  IF position(declaration_anchor in definition)=0 OR position(filter_anchor in definition)=0
     OR position(field_anchor in definition)=0 OR position(loop_anchor in definition)=0 THEN
    RAISE EXCEPTION 'Unexpected service form filter version';
  END IF;
  definition := replace(definition,declaration_anchor,'v_qc_metadata jsonb; '||declaration_anchor);
  definition := replace(definition,filter_anchor,$capture$
 -- Reviewers and maintenance workers may save QC evidence. Other callers retain
 -- the previous evidence unchanged; new public booking evidence is discarded.
 select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) into v_qc_metadata
 from jsonb_each(case
   when current_setting('role',true) in ('postgres','supabase_admin','service_role')
     or (session_user in ('postgres','supabase_admin') and current_setting('role',true)='none')
     or private.readyops_can_review_lead(new.id) then new.form_data
   when tg_op='UPDATE' then old.form_data else '{}'::jsonb end)
 where key in ('_qc_recording_review','_qc_recording_history','_qc_manual_fields',
   '_qc_summary_draft','_qc_recording_context','_qc_contact_confirmation');
 -- A forged/stale payload cannot retain fields from a different service.
$capture$);
  definition := replace(definition,field_anchor,$fields$'property_latitude','property_longitude','contact_name','contact_role')
 or (new.service_type='roofing' and key in ('public_adjuster_agreement','conditional_roofing_obligation'))$fields$);
  definition := replace(definition,loop_anchor,'new.form_data:=new.form_data||v_qc_metadata;'||E'\n '||loop_anchor);
  EXECUTE definition;
END;
$migration$;
