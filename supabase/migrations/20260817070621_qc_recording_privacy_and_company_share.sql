-- Imported from the hosted ReadyOp Supabase migration history on 2026-08-28.
-- Schema only: no production table data is included.

alter table public.portal_leads
  add column if not exists recording_url text,
  add column if not exists share_recording_with_company boolean not null default false;

update public.portal_leads
set recording_url = nullif(trim(coalesce(
  form_data->>'recording_url',
  form_data->>'recording',
  form_data->>'audio_url',
  form_data->>'call_recording',
  form_data->>'recording_link',
  ''
)), '')
where recording_url is null;

create or replace function public.submit_public_appointment(
  p_reservation_token uuid,
  p_session_id uuid,
  p_form_data jsonb,
  p_agent_name text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_res public.appointment_reservations%rowtype;
  v_settings public.company_portal_settings%rowtype;
  v_qualification jsonb;
  v_lead public.portal_leads%rowtype;
  v_appt public.portal_appointments%rowtype;
  v_sqft integer;
  v_home_value numeric;
  v_agent_id uuid;
  v_package_id uuid;
  v_recording_url text;
begin
  select * into v_res from public.appointment_reservations r
  where r.reservation_token=p_reservation_token for update;
  if v_res.id is null or v_res.session_id<>p_session_id then raise exception 'Reservation was not found for this agent session'; end if;
  if v_res.status<>'active' or v_res.expires_at<=now() then raise exception 'The reservation expired. Please select the time again.'; end if;

  select * into v_settings from public.company_portal_settings where company_id=v_res.company_id;
  v_qualification := public.portal_evaluate_qualification(v_settings.qualification_rules,p_form_data);

  if nullif(trim(coalesce(p_form_data->>'full_name','')),'') is null
     or nullif(trim(coalesce(p_form_data->>'phone_number','')),'') is null
     or nullif(trim(coalesce(p_form_data->>'address','')),'') is null then
    raise exception 'Full name, phone number and address are required';
  end if;

  v_sqft := nullif(regexp_replace(coalesce(p_form_data->>'sq_ft',''),'[^0-9]','','g'),'')::integer;
  v_home_value := nullif(regexp_replace(coalesce(p_form_data->>'home_value',''),'[^0-9.]','','g'),'')::numeric;
  v_agent_id := public.portal_resolve_agent_id(p_agent_name,p_form_data);
  v_package_id := public.portal_active_package(v_res.company_id);
  v_recording_url := nullif(trim(coalesce(
    p_form_data->>'recording_url',
    p_form_data->>'recording',
    p_form_data->>'audio_url',
    p_form_data->>'call_recording',
    p_form_data->>'recording_link',
    ''
  )), '');

  insert into public.portal_leads(
    company_id,original_company_id,location_id,agent_profile_id,agent_id,agent_name,session_id,package_id,
    service_needed,full_name,phone_number,address,city,state,zip_code,email,language,notes,home_value,sq_ft,web_url,
    property_latitude,property_longitude,recording_url,share_recording_with_company,form_data,qualification_status,qualification_reasons,external_form_status,
    qc_status,source,source_lead_id,source_disposition
  ) values (
    v_res.company_id,v_res.company_id,v_res.location_id,auth.uid(),v_agent_id,coalesce(nullif(trim(p_agent_name),''),v_res.agent_name),p_session_id,v_package_id,
    p_form_data->>'service_needed',trim(p_form_data->>'full_name'),trim(p_form_data->>'phone_number'),trim(p_form_data->>'address'),
    nullif(trim(coalesce(p_form_data->>'city','')),''),nullif(trim(coalesce(p_form_data->>'state','')),''),nullif(trim(coalesce(p_form_data->>'zip_code','')),''),
    nullif(lower(trim(coalesce(p_form_data->>'email',''))),''),nullif(trim(coalesce(p_form_data->>'language','')),''),nullif(trim(coalesce(p_form_data->>'notes','')),''),
    v_home_value,v_sqft,nullif(trim(coalesce(p_form_data->>'web_url','')),''),
    nullif(p_form_data->>'property_latitude','')::double precision,nullif(p_form_data->>'property_longitude','')::double precision,
    v_recording_url,false,p_form_data,v_qualification->>'status',v_qualification->'reasons',
    case when v_settings.form_mode='internal' then 'not_required' else 'pending' end,
    'pending',coalesce(nullif(p_form_data->>'_source',''),'ready_ops'),nullif(p_form_data->>'_source_lead_id',''),nullif(p_form_data->>'_source_disposition','')
  ) returning * into v_lead;

  insert into public.portal_appointments(
    lead_id,company_id,location_id,appointment_date,start_time,end_time,timezone,status,external_form_status
  ) values (
    v_lead.id,v_res.company_id,v_res.location_id,v_res.appointment_date,v_res.start_time,v_res.end_time,
    v_settings.timezone,'qc_pending',case when v_settings.form_mode='internal' then 'not_required' else 'pending' end
  ) returning * into v_appt;

  update public.appointment_reservations set status='converted',converted_appointment_id=v_appt.id where id=v_res.id;

  perform public.portal_write_audit(v_res.company_id,'agent',auth.uid(),v_lead.agent_name,
    'lead_submitted_for_qc','appointment',v_appt.id,null,
    jsonb_build_object('lead_code',v_lead.lead_code,'date',v_appt.appointment_date,'start_time',v_appt.start_time,'qc_status','pending','recording_attached',v_recording_url is not null),
    jsonb_build_object('reservation_id',v_res.id,'agent_id',v_agent_id));

  return jsonb_build_object(
    'appointment_id',v_appt.id,'manage_token',v_appt.manage_token,'lead_id',v_lead.id,'lead_code',v_lead.lead_code,
    'appointment_date',v_appt.appointment_date,'start_time',to_char(v_appt.start_time,'HH24:MI'),'end_time',to_char(v_appt.end_time,'HH24:MI'),
    'qualification_status',v_lead.qualification_status,'qualification_reasons',v_lead.qualification_reasons,
    'qc_status','pending','form_mode',v_settings.form_mode,'external_form_provider',v_settings.external_form_provider,
    'external_form_url',v_settings.external_form_url,'external_prefill_map',v_settings.external_prefill_map,
    'recording_attached',v_recording_url is not null,'form_data',v_lead.form_data
  );
end;
$function$;

create or replace function public.qc_update_lead(p_lead_id uuid, p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare v_old public.portal_leads%rowtype; v_new public.portal_leads%rowtype; v_form jsonb;
begin
  if not public.portal_is_qc_or_admin() then raise exception 'QC or admin access required'; end if;
  select * into v_old from public.portal_leads where id=p_lead_id for update;
  if v_old.id is null then raise exception 'Lead not found'; end if;
  v_form := v_old.form_data || coalesce(p_patch->'form_data','{}'::jsonb);
  update public.portal_leads set
    full_name=case when p_patch?'full_name' then trim(p_patch->>'full_name') else full_name end,
    phone_number=case when p_patch?'phone_number' then trim(p_patch->>'phone_number') else phone_number end,
    address=case when p_patch?'address' then trim(p_patch->>'address') else address end,
    city=case when p_patch?'city' then nullif(trim(p_patch->>'city'),'') else city end,
    state=case when p_patch?'state' then nullif(trim(p_patch->>'state'),'') else state end,
    zip_code=case when p_patch?'zip_code' then nullif(trim(p_patch->>'zip_code'),'') else zip_code end,
    email=case when p_patch?'email' then nullif(lower(trim(p_patch->>'email')),'') else email end,
    language=case when p_patch?'language' then nullif(trim(p_patch->>'language'),'') else language end,
    service_needed=case when p_patch?'service_needed' then nullif(trim(p_patch->>'service_needed'),'') else service_needed end,
    notes=case when p_patch?'notes' then nullif(trim(p_patch->>'notes'),'') else notes end,
    home_value=case when p_patch?'home_value' then nullif(regexp_replace(coalesce(p_patch->>'home_value',''),'[^0-9.]','','g'),'')::numeric else home_value end,
    sq_ft=case when p_patch?'sq_ft' then nullif(regexp_replace(coalesce(p_patch->>'sq_ft',''),'[^0-9]','','g'),'')::integer else sq_ft end,
    web_url=case when p_patch?'web_url' then nullif(trim(p_patch->>'web_url'),'') else web_url end,
    recording_url=case when p_patch?'recording_url' then nullif(trim(p_patch->>'recording_url'),'') else recording_url end,
    share_recording_with_company=case when p_patch?'share_recording_with_company' then coalesce((p_patch->>'share_recording_with_company')::boolean,false) else share_recording_with_company end,
    form_data=v_form,
    qc_notes=case when p_patch?'qc_notes' then nullif(trim(p_patch->>'qc_notes'),'') else qc_notes end
  where id=p_lead_id returning * into v_new;
  perform public.portal_write_audit(v_new.company_id,case when public.portal_is_admin() then 'admin' else 'qc' end,auth.uid(),public.portal_actor_name_for_management(),'qc_lead_edited','lead',v_new.id,to_jsonb(v_old),to_jsonb(v_new),'{}'::jsonb);
  return to_jsonb(v_new);
end;
$function$;

create or replace function public.get_company_management_portal(p_company_id uuid, p_access_token uuid, p_start_date date, p_end_date date)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public','pg_temp'
as $function$
declare v_company_id uuid;
begin
  v_company_id:=public.portal_resolve_company_access(p_company_id,p_access_token);
  return jsonb_build_object(
    'company',(select to_jsonb(c) from public.roster_companies c where c.id=v_company_id),
    'settings',(select to_jsonb(s) from public.company_portal_settings s where s.company_id=v_company_id),
    'locations',coalesce((select jsonb_agg(to_jsonb(l) order by l.sort_order,l.location_label) from public.company_locations l where l.company_id=v_company_id),'[]'::jsonb),
    'schedule_rules',coalesce((select jsonb_agg(to_jsonb(r) order by r.location_id nulls first,r.day_of_week) from public.company_schedule_rules r where r.company_id=v_company_id),'[]'::jsonb),
    'exceptions',coalesce((select jsonb_agg(to_jsonb(e) order by e.exception_date,e.start_time) from public.company_schedule_exceptions e where e.company_id=v_company_id and e.exception_date between p_start_date-30 and p_end_date+60),'[]'::jsonb),
    'representatives',coalesce((select jsonb_agg(to_jsonb(r) order by r.active desc,r.name) from public.company_representatives r where r.company_id=v_company_id),'[]'::jsonb),
    'packages',coalesce((select jsonb_agg(to_jsonb(cp) order by cp.start_date desc,cp.created_at desc) from public.company_packages cp where cp.company_id=v_company_id),'[]'::jsonb),
    'appointments',coalesce((select jsonb_agg(
      to_jsonb(a)||jsonb_build_object(
        'lead',
          (to_jsonb(l)-'recording_url'-'share_recording_with_company'-'form_data') ||
          jsonb_build_object(
            'form_data',coalesce(l.form_data,'{}'::jsonb)-'recording_url'-'recording'-'audio_url'-'call_recording'-'recording_link',
            'recording_url',case when l.share_recording_with_company then l.recording_url else null end,
            'recording_shared',l.share_recording_with_company
          ),
        'location_label',loc.location_label,
        'representative_name',rep.name,
        'latest_checkin',(select to_jsonb(ci) from public.appointment_checkins ci where ci.appointment_id=a.id order by ci.checked_in_at desc limit 1)
      ) order by a.appointment_date,a.start_time)
      from public.portal_appointments a
      join public.portal_leads l on l.id=a.lead_id
      left join public.company_locations loc on loc.id=a.location_id
      left join public.company_representatives rep on rep.id=a.representative_id
      where a.company_id=v_company_id and a.appointment_date between p_start_date and p_end_date and l.qc_status='approved' and a.company_visible_at is not null),'[]'::jsonb),
    'audit_logs',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (select * from public.portal_audit_logs al where al.company_id=v_company_id order by al.created_at desc limit 200)x),'[]'::jsonb)
  );
end;
$function$;

create or replace function public.get_representative_portal(p_access_token uuid, p_start_date date, p_end_date date)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public','pg_temp'
as $function$
declare v_rep public.company_representatives%rowtype;
begin
  select * into v_rep from public.company_representatives r where r.access_token=p_access_token and r.active;
  if v_rep.id is null then raise exception 'Representative link is invalid or disabled'; end if;
  return jsonb_build_object(
    'representative',to_jsonb(v_rep)-'access_token',
    'company',(select to_jsonb(c) from public.roster_companies c where c.id=v_rep.company_id),
    'settings',(select jsonb_build_object('timezone',s.timezone,'check_in_radius_m',s.check_in_radius_m,'check_in_before_minutes',s.check_in_before_minutes,'check_in_after_minutes',s.check_in_after_minutes) from public.company_portal_settings s where s.company_id=v_rep.company_id),
    'appointments',coalesce((select jsonb_agg(
      to_jsonb(a)||jsonb_build_object(
        'lead',
          (to_jsonb(l)-'recording_url'-'share_recording_with_company'-'form_data') ||
          jsonb_build_object(
            'form_data',coalesce(l.form_data,'{}'::jsonb)-'recording_url'-'recording'-'audio_url'-'call_recording'-'recording_link',
            'recording_url',case when l.share_recording_with_company then l.recording_url else null end,
            'recording_shared',l.share_recording_with_company
          ),
        'location_label',loc.location_label,
        'latest_checkin',(select to_jsonb(ci) from public.appointment_checkins ci where ci.appointment_id=a.id order by ci.checked_in_at desc limit 1),
        'timeline',coalesce((select jsonb_agg(to_jsonb(al) order by al.created_at) from public.portal_audit_logs al where al.entity_type='appointment' and al.entity_id=a.id),'[]'::jsonb)
      ) order by a.appointment_date,a.start_time)
      from public.portal_appointments a
      join public.portal_leads l on l.id=a.lead_id
      left join public.company_locations loc on loc.id=a.location_id
      where a.representative_id=v_rep.id and a.appointment_date between p_start_date and p_end_date and a.status not in ('cancelled','rescheduled','qc_denied') and l.qc_status='approved' and a.company_visible_at is not null),'[]'::jsonb)
  );
end;
$function$;

revoke execute on function public.get_company_management_portal(uuid,uuid,date,date) from public;
revoke execute on function public.get_representative_portal(uuid,date,date) from public;
revoke execute on function public.qc_update_lead(uuid,jsonb) from anon, public;
grant execute on function public.qc_update_lead(uuid,jsonb) to authenticated, service_role;
