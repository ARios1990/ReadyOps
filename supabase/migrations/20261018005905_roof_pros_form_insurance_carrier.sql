create or replace function private.roof_pros_form_payload(p_lead_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('lead_id',l.id,'lead_code',l.lead_code,'company_id',l.company_id,
  'qc_status',l.qc_status,'sent_at',a.company_visible_at,
  'agent',coalesce(ag.name,l.agent_name,''),'name',l.full_name,'phone',l.phone_number,
  'email',coalesce(l.email,l.form_data->>'email',''),'address',l.address,
  'city',l.city,'state',l.state,'zip',l.zip_code,
  'date',a.appointment_date,'time',a.start_time,
  'roof_type',case when l.form_data->>'roof_type'='Other' then coalesce(l.form_data->>'roof_type_other','Other') else l.form_data->>'roof_type' end,
  'roof_age',l.form_data->>'roof_age','contract',l.form_data->>'contract',
  'insurance',concat_ws(' — ',nullif(l.form_data->>'insurance',''),nullif(case when l.form_data->>'insurance_name'='Other' then coalesce(nullif(l.form_data->>'insurance_name_other',''),'Other') else l.form_data->>'insurance_name' end,'')),
  'notes',coalesce(nullif(a.inspector_notes,''),nullif(l.form_data->>'summary_notes',''),nullif(l.form_data->>'recording_notes',''),l.notes,''),
  'recording_url',l.recording_url,'source_updated_at',greatest(l.updated_at,a.updated_at))
 from public.portal_leads l left join public.agents ag on ag.id=l.agent_id
 left join lateral(select * from public.portal_appointments a where a.lead_id=l.id order by created_at desc,id limit 1) a on true
 where l.id=p_lead_id;
$$;
