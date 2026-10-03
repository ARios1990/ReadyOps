-- Universal services use the existing portal_leads database and scheduling.
create table public.lead_service_templates(
 id text primary key check(id ~ '^[a-z][a-z0-9_]{1,59}$'),name text not null,
 template_title text not null,active boolean not null default true,
 form_schema jsonb not null check(jsonb_typeof(form_schema)='array'),
 qualification_rules jsonb not null default '{}'::jsonb check(jsonb_typeof(qualification_rules)='object'),
 updated_at timestamptz not null default now()
);
create table public.company_service_templates(
 company_id uuid not null references public.roster_companies(id) on delete cascade,
 service_id text not null references public.lead_service_templates(id),
 template_title text not null,enabled boolean not null default true,
 form_schema jsonb not null check(jsonb_typeof(form_schema)='array'),
 qualification_rules jsonb not null default '{}'::jsonb check(jsonb_typeof(qualification_rules)='object'),
 updated_at timestamptz not null default now(),primary key(company_id,service_id)
);
create index company_service_templates_service_idx on public.company_service_templates(service_id);
alter table public.lead_service_templates enable row level security;
alter table public.company_service_templates enable row level security;
revoke all on public.lead_service_templates,public.company_service_templates from anon;
grant select,insert,update,delete on public.lead_service_templates,public.company_service_templates to authenticated;
create policy admin_service_templates on public.lead_service_templates for all to authenticated using(public.is_admin()) with check(public.is_admin());
create policy admin_company_service_templates on public.company_service_templates for all to authenticated using(public.is_admin()) with check(public.is_admin());

create or replace function private.validate_service_template() returns trigger language plpgsql set search_path = '' as $$
declare v_field jsonb; v_keys text[]:='{}'; v_key text; v_rule jsonb;
begin
 if length(new.form_schema::text)>100000 or jsonb_array_length(new.form_schema)>20 or nullif(trim(new.template_title),'') is null then raise exception 'Invalid template'; end if;
 for v_field in select f from jsonb_array_elements(new.form_schema) s cross join lateral jsonb_array_elements(s->'fields') f loop
   v_key:=v_field->>'key';
   if v_key is null or v_key !~ '^[a-z][a-z0-9_]{0,99}$' or v_key=any(v_keys) or nullif(v_field->>'label','') is null then raise exception 'Invalid or duplicate field key'; end if;
   if coalesce(v_field->>'mode','optional') not in ('required','optional','hidden') then raise exception 'Invalid field visibility'; end if;
   v_keys:=array_append(v_keys,v_key);
 end loop;
 foreach v_key in array array['full_name','phone_number','address','service_needed'] loop
   if not v_key=any(v_keys) or not exists(select 1 from jsonb_array_elements(new.form_schema) s cross join lateral jsonb_array_elements(s->'fields') f
     where f->>'key'=v_key and coalesce(f->>'mode',case when (f->>'required')::boolean then 'required' else 'optional' end)='required') then
     raise exception 'Customer name, phone, address and requested service must stay required'; end if;
 end loop;
 if new.qualification_rules?'fields' then
   if jsonb_typeof(new.qualification_rules->'fields')<>'array' then raise exception 'Invalid qualifier rules'; end if;
   for v_rule in select * from jsonb_array_elements(new.qualification_rules->'fields') loop
     if not coalesce(v_rule->>'key','')=any(v_keys) or coalesce(v_rule->>'operator','') not in ('equals','one_of','min','max') or not v_rule?'value' then raise exception 'Invalid qualifier rule'; end if;
     if v_rule->>'operator'='one_of' and jsonb_typeof(v_rule->'value')<>'array' then raise exception 'one_of requires an array'; end if;
     if v_rule->>'operator' in ('min','max') and jsonb_typeof(v_rule->'value')<>'number' then raise exception 'Numeric qualifier requires a number'; end if;
   end loop;
 end if;
 new.updated_at:=now(); return new;
end $$;
create trigger validate_global_service before insert or update on public.lead_service_templates for each row execute function private.validate_service_template();
create trigger validate_company_service before insert or update on public.company_service_templates for each row execute function private.validate_service_template();

create or replace function public.get_public_service_templates(p_slug text) returns jsonb
language sql stable security definer set search_path = '' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'template_title',coalesce(cs.template_title,s.template_title),
 'active',s.active,'form_schema',coalesce(cs.form_schema,s.form_schema),'qualification_rules',coalesce(cs.qualification_rules,s.qualification_rules)) order by s.name),'[]'::jsonb)
 from public.company_portal_settings settings join public.roster_companies c on c.id=settings.company_id
 cross join public.lead_service_templates s left join public.company_service_templates cs on cs.company_id=c.id and cs.service_id=s.id
 where settings.public_slug=p_slug and settings.portal_enabled and settings.allow_public_booking and c.account_status='Active' and s.active and coalesce(cs.enabled,true)
$$;
revoke all on function public.get_public_service_templates(text) from public;
grant execute on function public.get_public_service_templates(text) to anon,authenticated;

alter table public.portal_leads add column if not exists service_type text;
create index portal_leads_service_type_idx on public.portal_leads(service_type);
create or replace function private.readyops_infer_service(p_value text) returns text language sql immutable set search_path = '' as $$
 select case when lower(p_value) ~ '(^|[^a-z])(lights?|lighting)([^a-z]|$)' then 'permanent_exterior_lighting'
 when lower(p_value) ~ '(^|[^a-z])(tree|stump)([^a-z]|$)' then 'tree_service' when lower(p_value) ~ '(^|[^a-z])solar([^a-z]|$)' then 'solar'
 when lower(p_value) ~ '(^|[^a-z])(pdr|dents?|paintless)([^a-z]|$)|vehicle_(year|make|model)' then 'pdr' when lower(p_value) ~ '(^|[^a-z])(water|filtration)([^a-z]|$)' then 'water_treatment'
 when lower(p_value) ~ 'home[ _]improvement|remodel|project_type' then 'home_improvement' else 'roofing' end
$$;

create or replace function private.apply_universal_lead_template() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_service public.lead_service_templates; v_override public.company_service_templates; v_schema jsonb; v_rules jsonb;
 v_field jsonb; v_rule jsonb; v_value text; v_reasons jsonb:='[]'; v_status text:='qualified'; v_legacy jsonb; v_section jsonb;
 v_template text; v_modern boolean:=coalesce(new.form_data->>'_universal_template','false')='true'; v_visible boolean;
begin
 if tg_op='UPDATE' and new.form_data is not distinct from old.form_data and new.company_id=old.company_id and new.service_type is not distinct from old.service_type then return new; end if;
 new.service_type:=coalesce(nullif(new.form_data->>'service_type',''),new.service_type,private.readyops_infer_service(coalesce(new.service_needed,'')));
 if not v_modern then return new; end if;
 select * into v_service from public.lead_service_templates where id=new.service_type and active;
 select * into v_override from public.company_service_templates where company_id=new.company_id and service_id=new.service_type;
 if v_service.id is null or (v_override.company_id is not null and not v_override.enabled) then raise exception 'Service is not available for this company'; end if;
 v_schema:=coalesce(v_override.form_schema,v_service.form_schema); v_rules:=coalesce(v_override.qualification_rules,v_service.qualification_rules);
 -- A forged/stale payload cannot retain fields from a different service.
 select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) into new.form_data from jsonb_each(new.form_data)
 where key in ('service_type','_universal_template','appointment_date','appointment_time','timezone','lead_type','property_latitude','property_longitude')
 or key like '\_source%' escape '\' or exists(select 1 from jsonb_array_elements(v_schema) s cross join lateral jsonb_array_elements(s->'fields') f where f->>'key'=key);
 for v_field in select f from jsonb_array_elements(v_schema) s cross join lateral jsonb_array_elements(s->'fields') f loop
   if v_field->>'mode'='hidden' then new.form_data:=new.form_data-(v_field->>'key'); continue; end if;
   v_visible:=not(v_field?'showWhen') or coalesce(v_field->'showWhen'->>'field','')='' or new.form_data->(v_field->'showWhen'->>'field')=v_field->'showWhen'->'equals';
   if not coalesce(v_visible,false) then new.form_data:=new.form_data-(v_field->>'key');continue;end if;
   if v_visible and coalesce(v_field->>'mode',case when (v_field->>'required')::boolean then 'required' else 'optional' end)='required'
     and (nullif(trim(new.form_data->>(v_field->>'key')),'') is null or new.form_data->(v_field->>'key')='[]'::jsonb) then raise exception '% is required',v_field->>'label'; end if;
 end loop;
 -- Existing company rules are applied only to their configured service.
 v_legacy:=public.portal_evaluate_qualification(v_rules,new.form_data);
 v_status:=v_legacy->>'status'; v_reasons:=v_legacy->'reasons';
 for v_rule in select * from jsonb_array_elements(coalesce(v_rules->'fields','[]')) loop
   select f into v_field from jsonb_array_elements(v_schema) s cross join lateral jsonb_array_elements(s->'fields') f where f->>'key'=v_rule->>'key';
   if v_field->>'mode'='hidden' then continue; end if;
   v_visible:=not(v_field?'showWhen') or coalesce(v_field->'showWhen'->>'field','')='' or new.form_data->(v_field->'showWhen'->>'field')=v_field->'showWhen'->'equals';
   if not coalesce(v_visible,false) then continue; end if;
   v_value:=new.form_data->>(v_rule->>'key');
   if nullif(trim(v_value),'') is null then
     if v_status='qualified' then v_status:='review_needed'; end if;
     v_reasons:=v_reasons||jsonb_build_array((v_field->>'label')||' needs review');
   elsif (v_rule->>'operator'='equals' and lower(trim(v_value))<>lower(trim(v_rule->>'value')))
     or (v_rule->>'operator'='one_of' and not exists(select 1 from jsonb_array_elements_text(v_rule->'value') x where lower(trim(x))=lower(trim(v_value))))
     or (v_rule->>'operator' in ('min','max') and (v_value !~ '^[0-9]+([.][0-9]+)?$' or
       case when v_value ~ '^[0-9]+([.][0-9]+)?$' then case when v_rule->>'operator'='min' then v_value::numeric<(v_rule->>'value')::numeric else v_value::numeric>(v_rule->>'value')::numeric end else true end)) then
     v_status:='do_not_book'; v_reasons:=v_reasons||jsonb_build_array((v_field->>'label')||' does not meet this company service rule');
   end if;
 end loop;
 new.qualification_status:=v_status;new.qualification_reasons:=v_reasons;
 new.form_data:=new.form_data||jsonb_build_object('service_type',new.service_type,'_service_template',jsonb_build_object('id',v_service.id,'name',v_service.name,
 'template_title',coalesce(v_override.template_title,v_service.template_title),'form_schema',v_schema,'qualification_rules',v_rules));
 v_template:='**'||coalesce(v_override.template_title,v_service.template_title)||'**'||E'\nService Type: '||v_service.name
 ||E'\nAppointment: '||coalesce(new.form_data->>'appointment_date','—')||' '||coalesce(new.form_data->>'appointment_time','—');
 for v_section in select * from jsonb_array_elements(v_schema) loop
   v_template:=v_template||E'\n\n**'||(v_section->>'title')||'**';
   for v_field in select * from jsonb_array_elements(v_section->'fields') loop
     if coalesce(v_field->>'mode','optional')<>'hidden' and v_field->>'type'<>'recording'
     and (not(v_field?'showWhen') or coalesce(v_field->'showWhen'->>'field','')='' or new.form_data->(v_field->'showWhen'->>'field')=v_field->'showWhen'->'equals') then
       v_template:=v_template||E'\n'||(v_field->>'label')||': '||coalesce(nullif(new.form_data->>(v_field->>'key'),''),'—');
     end if;
   end loop;
 end loop;
 new.form_data:=new.form_data||jsonb_build_object('lead_template',v_template);
 return new;
end $$;
create trigger apply_universal_lead_template before insert or update of form_data,company_id,service_type on public.portal_leads for each row execute function private.apply_universal_lead_template();
insert into public.lead_service_templates(id,name,template_title,active,form_schema,qualification_rules) values('roofing','Roofing','Roof Inspection',true,'[{"id":"customer","title":"Customer Information","fields":[{"key":"full_name","label":"Customer Name","type":"text","required":true},{"key":"phone_number","label":"Phone Number","type":"phone","required":true},{"key":"address","label":"Address","type":"address","required":true},{"key":"city","label":"City","type":"text"},{"key":"state","label":"State","type":"text"},{"key":"zip_code","label":"ZIP Code","type":"text"},{"key":"email","label":"Customer Email","type":"email"},{"key":"language","label":"Language","type":"select","options":["English","Spanish","Other"]},{"key":"service_needed","label":"Service Requested","type":"text","required":true}]},{"id":"service","title":"Roofing Qualifiers & Property Details","fields":[{"key":"homeowner_authority","label":"Are you the homeowner or authorized decision-maker?","type":"select","options":["Yes","No","Unknown"]},{"key":"roof_age","label":"Roof Age","type":"text"},{"key":"roof_type","label":"Roof Type","type":"select","options":["Shingle","Metal","Tile","Flat","Other"]},{"key":"last_checked_on","label":"Last Roof Inspection","type":"text"},{"key":"visible_damage","label":"Visible Roof Damage","type":"text"},{"key":"damage_type","label":"Damage Type","type":"text"},{"key":"hail_size","label":"Hail Size","type":"text"},{"key":"storm_date","label":"Storm Date","type":"date"},{"key":"contract","label":"Signed with another contractor?","type":"select","options":["Yes","No","Unknown"]},{"key":"insurance_name","label":"Insurance Carrier","type":"text"},{"key":"stories","label":"Stories","type":"number"},{"key":"home_type","label":"Home Type","type":"text"},{"key":"home_value","label":"Home Value","type":"currency"},{"key":"sq_ft","label":"Square Footage","type":"number"},{"key":"web_url","label":"Property Link","type":"url"}]},{"id":"additional","title":"Additional Information","fields":[{"key":"notes","label":"Appointment Notes","type":"textarea"},{"key":"recording_url","label":"Call Recording (QC only)","type":"recording"}]}]'::jsonb,'{}'::jsonb);
insert into public.lead_service_templates(id,name,template_title,active,form_schema,qualification_rules) values('permanent_exterior_lighting','Permanent Exterior Lighting','Exterior Lighting Appointment',true,'[{"id":"customer","title":"Customer Information","fields":[{"key":"full_name","label":"Customer Name","type":"text","required":true},{"key":"phone_number","label":"Phone Number","type":"phone","required":true},{"key":"address","label":"Address","type":"address","required":true},{"key":"city","label":"City","type":"text"},{"key":"state","label":"State","type":"text"},{"key":"zip_code","label":"ZIP Code","type":"text"},{"key":"email","label":"Customer Email","type":"email"},{"key":"language","label":"Language","type":"select","options":["English","Spanish","Other"]},{"key":"service_needed","label":"Service Requested","type":"text","required":true}]},{"id":"service","title":"Lighting Qualifiers & Design","fields":[{"key":"homeowner_authority","label":"Authorized property decision-maker?","type":"select","options":["Yes","No","Unknown"]},{"key":"lighting_type","label":"Lighting Type","type":"select","options":["Permanent Exterior Lighting","Seasonal Holiday Lighting","Both"]},{"key":"lighting_areas","label":"Areas to Light","type":"multiselect","options":["Roofline","Patio","Landscape","Other"]},{"key":"stories","label":"Stories","type":"number"},{"key":"lighting_length","label":"Estimated Linear Feet","type":"number"},{"key":"power_access","label":"Available Power Access","type":"text"},{"key":"budget","label":"Budget","type":"currency"},{"key":"project_timeline","label":"Desired Installation Timeline","type":"text"}]},{"id":"additional","title":"Additional Information","fields":[{"key":"notes","label":"Appointment Notes","type":"textarea"},{"key":"recording_url","label":"Call Recording (QC only)","type":"recording"}]}]'::jsonb,'{}'::jsonb);
insert into public.lead_service_templates(id,name,template_title,active,form_schema,qualification_rules) values('tree_service','Tree Service','Tree Service Appointment',true,'[{"id":"customer","title":"Customer Information","fields":[{"key":"full_name","label":"Customer Name","type":"text","required":true},{"key":"phone_number","label":"Phone Number","type":"phone","required":true},{"key":"address","label":"Address","type":"address","required":true},{"key":"city","label":"City","type":"text"},{"key":"state","label":"State","type":"text"},{"key":"zip_code","label":"ZIP Code","type":"text"},{"key":"email","label":"Customer Email","type":"email"},{"key":"language","label":"Language","type":"select","options":["English","Spanish","Other"]},{"key":"service_needed","label":"Service Requested","type":"text","required":true}]},{"id":"service","title":"Tree Service Qualifiers","fields":[{"key":"homeowner_authority","label":"Authorized property decision-maker?","type":"select","options":["Yes","No","Unknown"]},{"key":"tree_work","label":"Work Requested","type":"select","options":["Trimming","Removal","Stump Grinding","Storm Cleanup","Other"]},{"key":"tree_count","label":"Number of Trees","type":"number"},{"key":"tree_size","label":"Approximate Tree Size","type":"text"},{"key":"hazard_near_structure","label":"Near structures or utility lines?","type":"select","options":["Yes","No","Unknown"]},{"key":"site_access","label":"Site Access","type":"text"},{"key":"project_timeline","label":"Desired Work Timeline","type":"text"}]},{"id":"additional","title":"Additional Information","fields":[{"key":"notes","label":"Appointment Notes","type":"textarea"},{"key":"recording_url","label":"Call Recording (QC only)","type":"recording"}]}]'::jsonb,'{}'::jsonb);
insert into public.lead_service_templates(id,name,template_title,active,form_schema,qualification_rules) values('solar','Solar','Solar Appointment',true,'[{"id":"customer","title":"Customer Information","fields":[{"key":"full_name","label":"Customer Name","type":"text","required":true},{"key":"phone_number","label":"Phone Number","type":"phone","required":true},{"key":"address","label":"Address","type":"address","required":true},{"key":"city","label":"City","type":"text"},{"key":"state","label":"State","type":"text"},{"key":"zip_code","label":"ZIP Code","type":"text"},{"key":"email","label":"Customer Email","type":"email"},{"key":"language","label":"Language","type":"select","options":["English","Spanish","Other"]},{"key":"service_needed","label":"Service Requested","type":"text","required":true}]},{"id":"service","title":"Solar Qualifiers","fields":[{"key":"homeowner_authority","label":"Are you the homeowner?","type":"select","options":["Yes","No","Unknown"]},{"key":"monthly_electric_bill","label":"Monthly Electric Bill","type":"currency"},{"key":"utility_provider","label":"Utility Provider","type":"text"},{"key":"roof_condition","label":"Roof Condition","type":"text"},{"key":"existing_solar","label":"Existing solar system?","type":"select","options":["Yes","No","Unknown"]},{"key":"shade_conditions","label":"Roof Shading","type":"text"},{"key":"solar_interest","label":"Solar Goals","type":"text"},{"key":"project_timeline","label":"Project Timeline","type":"text"}]},{"id":"additional","title":"Additional Information","fields":[{"key":"notes","label":"Appointment Notes","type":"textarea"},{"key":"recording_url","label":"Call Recording (QC only)","type":"recording"}]}]'::jsonb,'{}'::jsonb);
insert into public.lead_service_templates(id,name,template_title,active,form_schema,qualification_rules) values('pdr','PDR','Paintless Dent Repair Appointment',true,'[{"id":"customer","title":"Customer Information","fields":[{"key":"full_name","label":"Customer Name","type":"text","required":true},{"key":"phone_number","label":"Phone Number","type":"phone","required":true},{"key":"address","label":"Address","type":"address","required":true},{"key":"city","label":"City","type":"text"},{"key":"state","label":"State","type":"text"},{"key":"zip_code","label":"ZIP Code","type":"text"},{"key":"email","label":"Customer Email","type":"email"},{"key":"language","label":"Language","type":"select","options":["English","Spanish","Other"]},{"key":"service_needed","label":"Service Requested","type":"text","required":true}]},{"id":"service","title":"PDR Qualifiers & Vehicle Details","fields":[{"key":"vehicle_authority","label":"Vehicle owner or authorized decision-maker?","type":"select","options":["Yes","No","Unknown"]},{"key":"vehicle_year","label":"Vehicle Year","type":"number"},{"key":"vehicle_make","label":"Vehicle Make","type":"text"},{"key":"vehicle_model","label":"Vehicle Model","type":"text"},{"key":"dent_location","label":"Dent Location","type":"text"},{"key":"damage_cause","label":"Damage Cause","type":"select","options":["Hail","Door Ding","Other"]},{"key":"paint_damage","label":"Paint damage present?","type":"select","options":["Yes","No","Unknown"]},{"key":"insurance_name","label":"Insurance Carrier","type":"text"},{"key":"claim_status","label":"Claim Status","type":"text"}]},{"id":"additional","title":"Additional Information","fields":[{"key":"notes","label":"Appointment Notes","type":"textarea"},{"key":"recording_url","label":"Call Recording (QC only)","type":"recording"}]}]'::jsonb,'{}'::jsonb);
insert into public.lead_service_templates(id,name,template_title,active,form_schema,qualification_rules) values('home_improvement','Home Improvement','Home Improvement Appointment',true,'[{"id":"customer","title":"Customer Information","fields":[{"key":"full_name","label":"Customer Name","type":"text","required":true},{"key":"phone_number","label":"Phone Number","type":"phone","required":true},{"key":"address","label":"Address","type":"address","required":true},{"key":"city","label":"City","type":"text"},{"key":"state","label":"State","type":"text"},{"key":"zip_code","label":"ZIP Code","type":"text"},{"key":"email","label":"Customer Email","type":"email"},{"key":"language","label":"Language","type":"select","options":["English","Spanish","Other"]},{"key":"service_needed","label":"Service Requested","type":"text","required":true}]},{"id":"service","title":"Home Improvement Qualifiers","fields":[{"key":"homeowner_authority","label":"Authorized property decision-maker?","type":"select","options":["Yes","No","Unknown"]},{"key":"project_type","label":"Project Type","type":"text"},{"key":"project_scope","label":"Project Scope","type":"textarea"},{"key":"budget","label":"Project Budget","type":"currency"},{"key":"project_timeline","label":"Project Timeline","type":"text"},{"key":"decision_makers","label":"Decision-makers Attending","type":"text"},{"key":"contract","label":"Signed with another contractor?","type":"select","options":["Yes","No","Unknown"]}]},{"id":"additional","title":"Additional Information","fields":[{"key":"notes","label":"Appointment Notes","type":"textarea"},{"key":"recording_url","label":"Call Recording (QC only)","type":"recording"}]}]'::jsonb,'{}'::jsonb);
insert into public.lead_service_templates(id,name,template_title,active,form_schema,qualification_rules) values('water_treatment','Water Treatment','Water Treatment Appointment',true,'[{"id":"customer","title":"Customer Information","fields":[{"key":"full_name","label":"Customer Name","type":"text","required":true},{"key":"phone_number","label":"Phone Number","type":"phone","required":true},{"key":"address","label":"Address","type":"address","required":true},{"key":"city","label":"City","type":"text"},{"key":"state","label":"State","type":"text"},{"key":"zip_code","label":"ZIP Code","type":"text"},{"key":"email","label":"Customer Email","type":"email"},{"key":"language","label":"Language","type":"select","options":["English","Spanish","Other"]},{"key":"service_needed","label":"Service Requested","type":"text","required":true}]},{"id":"service","title":"Water Treatment Qualifiers","fields":[{"key":"homeowner_authority","label":"Are you the homeowner?","type":"select","options":["Yes","No","Unknown"]},{"key":"water_source","label":"Water Source","type":"select","options":["City","Well","Other"]},{"key":"water_concerns","label":"Water Concerns","type":"textarea"},{"key":"existing_system","label":"Existing Treatment System","type":"text"},{"key":"household_size","label":"Household Size","type":"number"}]},{"id":"additional","title":"Additional Information","fields":[{"key":"notes","label":"Appointment Notes","type":"textarea"},{"key":"recording_url","label":"Call Recording (QC only)","type":"recording"}]}]'::jsonb,'{}'::jsonb);
-- Preserve existing client-specific schemas/rules on their current service.
-- Newly introduced services inherit global defaults until Admin customizes them.
do $$
declare v_setting record;v_id text;v_schema jsonb;v_defaults jsonb;v_section jsonb;v_field jsonb;v_missing jsonb;
begin
 for v_setting in select company_id,form_schema,qualification_rules from public.company_portal_settings where jsonb_typeof(form_schema)='array' loop
   v_id:=private.readyops_infer_service(v_setting.form_schema::text);
   select form_schema into v_defaults from public.lead_service_templates where id=v_id;
   v_schema:=v_setting.form_schema;v_missing:='[]';
   for v_field in select f from jsonb_array_elements(v_defaults) s cross join lateral jsonb_array_elements(s->'fields') f where f->>'key' in ('full_name','phone_number','address','service_needed') loop
     if not exists(select 1 from jsonb_array_elements(v_schema) s cross join lateral jsonb_array_elements(s->'fields') f where f->>'key'=v_field->>'key') then v_missing:=v_missing||jsonb_build_array(v_field);end if;
   end loop;
   if jsonb_array_length(v_missing)>0 then v_schema:=jsonb_build_array(jsonb_build_object('id','required_customer','title','Customer Information','fields',v_missing))||v_schema;end if;
   -- Mandatory universal identity fields also remain mandatory in legacy configs.
   select jsonb_agg(s||jsonb_build_object('fields',(select jsonb_agg(case when f->>'key' in ('full_name','phone_number','address','service_needed') then f||'{"required":true,"mode":"required"}'::jsonb else f end order by fi)
     from jsonb_array_elements(s->'fields') with ordinality fields(f,fi))) order by si) into v_schema from jsonb_array_elements(v_schema) with ordinality sections(s,si);
   insert into public.company_service_templates(company_id,service_id,template_title,form_schema,qualification_rules)
   select v_setting.company_id,v_id,template_title,v_schema,coalesce(v_setting.qualification_rules,'{}'::jsonb) from public.lead_service_templates where id=v_id;
 end loop;
end $$;
update public.portal_leads set service_type=private.readyops_infer_service(coalesce(form_data->>'service_type',service_needed,'')) where service_type is null;

-- Durable client-notification outbox. It is not tied to a browser tab.
alter table public.roster_companies add column if not exists notification_emails text[];
grant select(notification_emails),update(notification_emails) on public.roster_companies to authenticated;
create table public.lead_email_notifications(
 id uuid primary key default gen_random_uuid(),lead_id uuid not null references public.portal_leads(id) on delete cascade,
 company_id uuid not null references public.roster_companies(id),request_key text not null,
 recipients text[] not null,snapshot jsonb not null,status text not null default 'pending' check(status in ('pending','sent','failed')),
 created_at timestamptz not null default now(),created_by uuid references public.profiles(id),sent_at timestamptz,
 provider_id text,error_message text,attempt_count integer not null default 0,first_attempt_at timestamptz,
 claimed_at timestamptz,claim_token uuid,next_attempt_at timestamptz default now(),unique(lead_id,company_id,request_key)
);
create index lead_email_queue_idx on public.lead_email_notifications(next_attempt_at,created_at) where status<>'sent';
create index lead_email_history_idx on public.lead_email_notifications(lead_id,created_at desc);
create index lead_email_company_idx on public.lead_email_notifications(company_id);
create index lead_email_creator_idx on public.lead_email_notifications(created_by);
create table public.lead_email_attempts(
 id uuid primary key default gen_random_uuid(),notification_id uuid not null references public.lead_email_notifications(id) on delete cascade,
 attempt_number integer not null,claim_token uuid not null,started_at timestamptz not null default now(),completed_at timestamptz,
 status text not null default 'pending' check(status in ('pending','sent','failed')),error_message text,provider_id text,
 unique(notification_id,attempt_number)
);
alter table public.lead_email_notifications enable row level security;
alter table public.lead_email_attempts enable row level security;
revoke all on public.lead_email_notifications,public.lead_email_attempts from anon,authenticated;
grant select on public.lead_email_notifications,public.lead_email_attempts to authenticated;
create policy scoped_email_history on public.lead_email_notifications for select to authenticated
 using(public.current_profile_role() in ('admin','manager') and private.readyops_can_review_lead(lead_id));
create policy scoped_email_attempts on public.lead_email_attempts for select to authenticated
 using(exists(select 1 from public.lead_email_notifications n where n.id=notification_id
 and public.current_profile_role() in ('admin','manager') and private.readyops_can_review_lead(n.lead_id)));

create or replace function private.queue_lead_email(p_lead_id uuid,p_request_key text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_lead public.portal_leads;v_ap public.portal_appointments;v_company public.roster_companies;v_recipients text[];v_id uuid;v_error text;
begin
 select * into v_lead from public.portal_leads where id=p_lead_id;
 select * into v_ap from public.portal_appointments where lead_id=p_lead_id and company_visible_at is not null order by created_at desc limit 1;
 select * into v_company from public.roster_companies where id=v_lead.company_id;
 if v_lead.qc_status<>'approved' or v_ap.id is null or v_ap.company_id<>v_lead.company_id then raise exception 'Lead has not been approved and sent to this client';end if;
 select coalesce(array_agg(distinct lower(trim(email))),'{}'::text[]) into v_recipients
 from unnest(coalesce(v_company.notification_emails,array_prepend(coalesce(nullif(v_company.email,''),v_company.owner_email),coalesce(v_company.secondary_emails,'{}'::text[])))) email
 where nullif(trim(email),'') is not null;
 if cardinality(v_recipients)=0 then v_error:='No client notification email is configured';
 elsif cardinality(v_recipients)>50 or exists(select 1 from unnest(v_recipients) e where e !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$') then v_error:='Client notification email list is invalid';end if;
 insert into public.lead_email_notifications(lead_id,company_id,request_key,recipients,snapshot,created_by,status,error_message,next_attempt_at)
 values(v_lead.id,v_lead.company_id,p_request_key,v_recipients,jsonb_build_object('lead_code',v_lead.lead_code,'company_name',v_company.name,
 'customer_name',v_lead.full_name,'phone_number',v_lead.phone_number,'address',concat_ws(', ',v_lead.address,v_lead.city,v_lead.state,v_lead.zip_code),
 'appointment_date',v_ap.appointment_date,'appointment_time',v_ap.start_time,'timezone',v_ap.timezone,'service_requested',v_lead.service_needed,
 'service_type',v_lead.service_type,'agent',v_lead.agent_name,'notes',v_lead.notes,
 'service_template',v_lead.form_data->'_service_template','form_data',v_lead.form_data-'recording_url'-'recording'-'audio_url'-'call_recording'-'recording_link'),
 auth.uid(),case when v_error is null then 'pending' else 'failed' end,v_error,case when v_error is null then now() else null end)
 on conflict(lead_id,company_id,request_key) do nothing returning id into v_id;
 if v_id is null then select id into v_id from public.lead_email_notifications where lead_id=p_lead_id and company_id=v_lead.company_id and request_key=p_request_key; end if;
 return v_id;
end $$;
revoke all on function private.queue_lead_email(uuid,text) from public,anon,authenticated;

create or replace function private.queue_sent_lead_email() returns trigger language plpgsql security definer set search_path = '' as $$
begin
 if new.company_visible_at is not null and (tg_op='INSERT' or old.company_visible_at is null) then
   perform private.queue_lead_email(new.lead_id,'initial');
 end if;
 return new;
end $$;
create trigger email_on_client_release after insert or update of company_visible_at on public.portal_appointments for each row execute function private.queue_sent_lead_email();

create or replace function public.request_lead_email_resend(p_lead_id uuid,p_request_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
begin
 if public.current_profile_role() not in ('admin','manager') or not private.readyops_can_review_lead(p_lead_id) then raise exception 'Lead unavailable for this account';end if;
 if p_request_id is null then raise exception 'Resend request ID is required';end if;
 if exists(select 1 from public.lead_email_notifications where lead_id=p_lead_id and created_at>now()-interval '1 minute' and request_key<>'resend:'||p_request_id::text) then raise exception 'Wait one minute before requesting another email';end if;
 return private.queue_lead_email(p_lead_id,'resend:'||p_request_id::text);
end $$;
revoke all on function public.request_lead_email_resend(uuid,uuid) from public,anon;
grant execute on function public.request_lead_email_resend(uuid,uuid) to authenticated;

-- Claims are service-only and transactionally locked; concurrent workers cannot
-- send the same job. Retries use one stable provider idempotency key and payload.
create or replace function public.claim_readyops_lead_emails(p_limit integer default 10) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_rows jsonb;
begin
 update public.lead_email_notifications set status='failed',next_attempt_at=null,error_message='Delivery uncertain after retry window; check provider history before deliberately resending'
 where status<>'sent' and first_attempt_at<now()-interval '20 hours' and next_attempt_at is not null;
 with picked as(select n.id from public.lead_email_notifications n
 join public.portal_leads l on l.id=n.lead_id
 where n.status<>'sent' and n.next_attempt_at<=now() and n.attempt_count<5
 and (n.claimed_at is null or n.claimed_at<now()-interval '5 minutes')
 and (n.first_attempt_at is null or n.first_attempt_at>now()-interval '20 hours')
 and l.company_id=n.company_id and l.qc_status='approved' and exists(select 1 from public.portal_appointments ap where ap.lead_id=l.id and ap.company_visible_at is not null)
 order by n.created_at limit greatest(1,least(p_limit,10)) for update of n skip locked),
 updated as(update public.lead_email_notifications n set status='pending',attempt_count=n.attempt_count+1,
 first_attempt_at=coalesce(n.first_attempt_at,now()),claimed_at=now(),claim_token=gen_random_uuid()
 from picked where n.id=picked.id returning n.*),
 attempts as(insert into public.lead_email_attempts(notification_id,attempt_number,claim_token) select id,attempt_count,claim_token from updated returning id)
 select coalesce(jsonb_agg(to_jsonb(updated)),'[]') into v_rows from updated;
 return v_rows;
end $$;
create or replace function public.finish_readyops_lead_email(p_id uuid,p_claim_token uuid,p_provider_id text,p_error text,p_retry boolean default false) returns void
language plpgsql security definer set search_path = '' as $$
declare v_row public.lead_email_notifications;
begin
 select * into v_row from public.lead_email_notifications where id=p_id and claim_token=p_claim_token for update;
 if v_row.id is null then raise exception 'Email claim is stale';end if;
 update public.lead_email_attempts set completed_at=now(),status=case when p_error is null then 'sent' else 'failed' end,
 error_message=left(p_error,500),provider_id=p_provider_id where notification_id=p_id and claim_token=p_claim_token;
 update public.lead_email_notifications set status=case when p_error is null then 'sent' else 'failed' end,
 sent_at=case when p_error is null then now() else null end,provider_id=p_provider_id,error_message=left(p_error,500),claimed_at=null,claim_token=null,
 next_attempt_at=case when p_error is not null and p_retry and attempt_count<5 and first_attempt_at>now()-interval '20 hours'
 then now()+make_interval(mins=>least(60,attempt_count*attempt_count)) else null end where id=p_id;
end $$;
revoke all on function public.claim_readyops_lead_emails(integer),public.finish_readyops_lead_email(uuid,uuid,text,text,boolean) from public,anon,authenticated;
grant execute on function public.claim_readyops_lead_emails(integer),public.finish_readyops_lead_email(uuid,uuid,text,text,boolean) to service_role;

-- Replace the legacy same-day batch enqueue with the universal outbox trigger.
-- Keep the QC/package/audit workflow and response contract unchanged; do not
-- delete or send previously queued legacy batches during this migration.
create or replace function public.qc_send_lead_to_client(p_lead_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
 v_lead public.portal_leads;v_appt public.portal_appointments;v_cycle public.qc_review_cycles;
 v_role text:=private.readyops_profile_role();
begin
 if v_role is distinct from 'admin' then raise exception 'Only an Admin can send approved leads to clients';end if;
 select * into v_lead from public.portal_leads where id=p_lead_id for update;
 select * into v_appt from public.portal_appointments where lead_id=p_lead_id for update;
 select * into v_cycle from public.qc_review_cycles where lead_id=p_lead_id and is_current for update;
 if v_lead.id is null or v_appt.id is null or v_cycle.id is null then raise exception 'Lead, appointment, or active QC cycle not found';end if;
 if v_lead.qc_status is distinct from 'approved' or v_cycle.status is distinct from 'approved' then raise exception 'The lead must be QC Approved before it can be sent';end if;
 if v_appt.company_visible_at is not null then
   return jsonb_build_object('lead_id',v_lead.id,'appointment_id',v_appt.id,'released_to_company',true,
     'already_sent',true,'same_day_notification_queued',false);
 end if;
 if v_lead.package_id is null then
   update public.portal_leads set package_id=public.portal_active_package(v_lead.company_id),updated_at=now()
   where id=v_lead.id returning * into v_lead;
 end if;
 update public.portal_appointments set status=case when representative_id is null then 'confirmed' else 'assigned' end,
 company_visible_at=now(),updated_at=now() where id=v_appt.id returning * into v_appt;
 perform public.portal_complete_package_if_filled(v_lead.package_id);
 perform public.portal_write_audit(v_lead.company_id,v_role,auth.uid(),public.portal_actor_name_for_management(),
 'lead_sent_to_client','lead',v_lead.id,
 jsonb_build_object('company_visible_at',null,'appointment_status','qc_pending'),
 jsonb_build_object('company_visible_at',v_appt.company_visible_at,'appointment_status',v_appt.status),
 jsonb_build_object('appointment_id',v_appt.id,'qc_review_id',v_cycle.id,'package_id',v_lead.package_id,
 'same_day_notification_queued',false,'lead_email_notification_queued',true));
 return jsonb_build_object('lead_id',v_lead.id,'appointment_id',v_appt.id,'released_to_company',true,'already_sent',false,
 'same_day_notification_queued',false,'lead_email_notification_queued',true,'company_visible_at',v_appt.company_visible_at);
end $$;
revoke all on function public.qc_send_lead_to_client(uuid) from public,anon;
grant execute on function public.qc_send_lead_to_client(uuid) to authenticated;

-- Automatic dispatch and retries follow Supabase's pg_net + pg_cron + Vault
-- architecture. Secrets are provisioned separately; absence leaves jobs Pending.
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;
create or replace function private.dispatch_readyops_lead_emails() returns bigint
language plpgsql security definer set search_path = '' as $$
declare v_url text;v_token text;v_request bigint;
begin
 if not exists(select 1 from public.lead_email_notifications where status<>'sent' and next_attempt_at<=now()) then return null;end if;
 select decrypted_secret into v_url from vault.decrypted_secrets where name='readyops_project_url';
 select decrypted_secret into v_token from vault.decrypted_secrets where name='readyops_email_worker_token';
 if v_url is null or v_token is null then return null;end if;
 select net.http_post(url:=v_url||'/functions/v1/send-lead-emails',headers:=jsonb_build_object('Content-Type','application/json','x-readyops-worker-token',v_token),body:='{}'::jsonb,timeout_milliseconds:=60000) into v_request;
 return v_request;
exception when others then
 raise warning 'ReadyOps email dispatch unavailable; queued job retained';return null;
end $$;
revoke all on function private.dispatch_readyops_lead_emails() from public,anon,authenticated;
create or replace function private.dispatch_queued_lead_email() returns trigger language plpgsql security definer set search_path = '' as $$
begin perform private.dispatch_readyops_lead_emails();return new;end $$;
create trigger dispatch_queued_email after insert on public.lead_email_notifications for each statement execute function private.dispatch_queued_lead_email();
select cron.schedule('readyops-lead-email-worker','* * * * *','select private.dispatch_readyops_lead_emails();');
