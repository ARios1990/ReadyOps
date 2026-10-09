begin;
with updated as (
 select t.ctid row_id,jsonb_agg(section.value || jsonb_build_object('fields',(
 select jsonb_agg(case when field.value->>'key'='language' and jsonb_typeof(field.value->'options')='array' and not (field.value->'options' ? 'Bilingual') then jsonb_set(field.value,'{options}',(field.value->'options')||'["Bilingual"]'::jsonb) else field.value end order by field.position)
 from jsonb_array_elements(section.value->'fields') with ordinality field(value,position))) order by section.position) schema
 from public.lead_service_templates t cross join lateral jsonb_array_elements(t.form_schema) with ordinality section(value,position)
 where t.form_schema is not null group by t.ctid
) update public.lead_service_templates t set form_schema=u.schema,updated_at=now() from updated u where t.ctid=u.row_id and t.form_schema is distinct from u.schema;
with updated as (
 select t.ctid row_id,jsonb_agg(section.value || jsonb_build_object('fields',(
 select jsonb_agg(case when field.value->>'key'='language' and jsonb_typeof(field.value->'options')='array' and not (field.value->'options' ? 'Bilingual') then jsonb_set(field.value,'{options}',(field.value->'options')||'["Bilingual"]'::jsonb) else field.value end order by field.position)
 from jsonb_array_elements(section.value->'fields') with ordinality field(value,position))) order by section.position) schema
 from public.company_service_templates t cross join lateral jsonb_array_elements(t.form_schema) with ordinality section(value,position)
 where t.form_schema is not null group by t.ctid
) update public.company_service_templates t set form_schema=u.schema,updated_at=now() from updated u where t.ctid=u.row_id and t.form_schema is distinct from u.schema;
commit;
