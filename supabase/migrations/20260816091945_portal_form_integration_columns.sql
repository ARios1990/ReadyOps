-- Imported from the hosted ReadyOp Supabase migration history on 2026-08-28.
-- Schema only: no production table data is included.

BEGIN;

CREATE OR REPLACE FUNCTION public.portal_default_form_schema()
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT jsonb_build_array(
    jsonb_build_object('id','appointment','title','Appointment','fields',jsonb_build_array(
      jsonb_build_object('key','service_needed','label','Services Needed','type','select','required',true,'options',jsonb_build_array('Roof Inspection','Roof Inspection With a Drone','Solar Evaluation','Tree Removal','Real Estate','PDR','Home Improvement Estimate','Repair Job Estimate','Siding Estimate','Window Estimate'))
    )),
    jsonb_build_object('id','customer','title','Customer Information','fields',jsonb_build_array(
      jsonb_build_object('key','full_name','label','Full Name','type','text','required',true),
      jsonb_build_object('key','phone_number','label','Phone Number','type','phone','required',true),
      jsonb_build_object('key','address','label','Address','type','address','required',true),
      jsonb_build_object('key','city','label','City','type','text','required',false),
      jsonb_build_object('key','state','label','State','type','text','required',false),
      jsonb_build_object('key','zip_code','label','ZIP Code','type','text','required',false),
      jsonb_build_object('key','email','label','Email','type','email','required',false),
      jsonb_build_object('key','language','label','Language','type','select','required',true,'options',jsonb_build_array('English','Spanish','Other'))
    )),
    jsonb_build_object('id','property','title','Property Details','fields',jsonb_build_array(
      jsonb_build_object('key','last_checked_on','label','Last Checked On','type','select','required',false,'options',jsonb_build_array('Never','Less Than 1 Year','1–2 Years','3–5 Years','5+ Years','Not Sure')),
      jsonb_build_object('key','home_type','label','Home Type','type','select','required',true,'options',jsonb_build_array('Single Family','Townhome','Duplex','Condo','Mobile Home','Other')),
      jsonb_build_object('key','roof_type','label','Roof Type','type','select','required',true,'options',jsonb_build_array('Shingles','Metal','Tile','Flat','Other','Not Sure')),
      jsonb_build_object('key','roof_age','label','Roof Age','type','select','required',true,'options',jsonb_build_array('0–3 Years','4–6 Years','7–10 Years','11–15 Years','16–20 Years','20+ Years','Not Sure')),
      jsonb_build_object('key','stories','label','Stories','type','select','required',false,'options',jsonb_build_array('1 Story','2 Stories','3+ Stories')),
      jsonb_build_object('key','insurance','label','Insurance','type','select','required',false,'options',jsonb_build_array('Yes','No','Not Sure')),
      jsonb_build_object('key','insurance_name','label','Insurance Name','type','text','required',false,'showWhen',jsonb_build_object('field','insurance','equals','Yes')),
      jsonb_build_object('key','claim_filed','label','File Claim','type','select','required',false,'options',jsonb_build_array('Yes','No','Not Yet','Not Sure')),
      jsonb_build_object('key','contract','label','Contract','type','select','required',false,'defaultValue','No','options',jsonb_build_array('No','Yes','Not Sure')),
      jsonb_build_object('key','hail_size','label','Size of Hail','type','select','required',false,'options',jsonb_build_array('None Known','Pea','Dime','Nickel','Quarter','Half Dollar','Golf Ball','2+ Inches','Not Sure')),
      jsonb_build_object('key','visible_damage','label','Visible Damage','type','select','required',false,'options',jsonb_build_array('Yes','No','Not Sure')),
      jsonb_build_object('key','damage_type','label','Type of Damage','type','multiselect','required',false,'options',jsonb_build_array('Missing Shingles','Lifted Shingles','Leaks','Water Stains','Hail Damage','Wind Damage','Granule Loss','Dents','Tree Damage','Other'),'showWhen',jsonb_build_object('field','visible_damage','equals','Yes')),
      jsonb_build_object('key','drone_approved','label','Drone Inspection Approved','type','select','required',false,'options',jsonb_build_array('Yes','No'),'showWhen',jsonb_build_object('field','service_needed','equals','Roof Inspection With a Drone')),
      jsonb_build_object('key','property_access','label','Property Access','type','select','required',false,'options',jsonb_build_array('Clear Access','Gated','Restricted','Not Sure'),'showWhen',jsonb_build_object('field','service_needed','equals','Roof Inspection With a Drone'))
    )),
    jsonb_build_object('id','additional','title','Additional Information','fields',jsonb_build_array(
      jsonb_build_object('key','notes','label','Notes','type','textarea','required',false),
      jsonb_build_object('key','home_value','label','Home Value','type','currency','required',false),
      jsonb_build_object('key','sq_ft','label','SQ FT','type','number','required',false),
      jsonb_build_object('key','web_url','label','Web URL','type','url','required',false),
      jsonb_build_object('key','additional_properties','label','Additional Properties','type','select','required',false,'options',jsonb_build_array('No','Yes')),
      jsonb_build_object('key','second_address','label','Second Address','type','address','required',false,'showWhen',jsonb_build_object('field','additional_properties','equals','Yes'))
    ))
  );
$$;

ALTER TABLE public.company_portal_settings
  ADD COLUMN IF NOT EXISTS form_schema jsonb NOT NULL DEFAULT public.portal_default_form_schema(),
  ADD COLUMN IF NOT EXISTS external_submission_map jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS external_webhook_secret uuid NOT NULL DEFAULT gen_random_uuid();

UPDATE public.company_portal_settings
SET form_schema = public.portal_default_form_schema()
WHERE form_schema IS NULL OR form_schema = '[]'::jsonb;

COMMIT;
