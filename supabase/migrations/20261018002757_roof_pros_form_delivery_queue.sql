-- One Google Form delivery per Roof Pros lead, independent of email delivery.
create table public.roof_pros_form_deliveries (
 id uuid primary key default gen_random_uuid(),
 lead_id uuid not null unique references public.portal_leads(id),
 company_id uuid not null default 'd12e8b8c-fd25-45c0-8d43-9b4aecdcda0c'
   check(company_id='d12e8b8c-fd25-45c0-8d43-9b4aecdcda0c'),
 status text not null default 'queued' check(status in ('queued','preparing','submitting','submitted','needs_info','uncertain')),
 queued_at timestamptz not null default now(),
 updated_at timestamptz not null default now(), submitted_at timestamptz,
 claim_token uuid, lease_expires_at timestamptz,
 error_message text, confirmation text,
 attempts integer not null default 0
);
alter table public.roof_pros_form_deliveries enable row level security;
revoke all on public.roof_pros_form_deliveries from public,anon,authenticated;
grant all on public.roof_pros_form_deliveries to service_role;
create policy roof_pros_form_admin_read on public.roof_pros_form_deliveries for select to authenticated
 using(private.readyops_profile_role()='admin');
grant select(id,lead_id,company_id,status,queued_at,updated_at,submitted_at,error_message,confirmation,attempts)
 on public.roof_pros_form_deliveries to authenticated;

create function private.enqueue_roof_pros_form(p_lead_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 insert into public.roof_pros_form_deliveries(lead_id)
 select l.id from public.portal_leads l where l.id=p_lead_id
 and l.company_id='d12e8b8c-fd25-45c0-8d43-9b4aecdcda0c' and l.qc_status='approved'
 and exists(select 1 from public.portal_appointments a where a.lead_id=l.id and a.company_visible_at is not null)
 on conflict(lead_id) do nothing;
end $$;
revoke all on function private.enqueue_roof_pros_form(uuid) from public,anon,authenticated;

create function private.queue_roof_pros_form_after_send() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.company_visible_at is not null and old.company_visible_at is distinct from new.company_visible_at then
  perform private.enqueue_roof_pros_form(new.lead_id);
 end if;
 return new;
end $$;
revoke all on function private.queue_roof_pros_form_after_send() from public,anon,authenticated;
create trigger roof_pros_form_after_send after update of company_visible_at on public.portal_appointments
 for each row execute function private.queue_roof_pros_form_after_send();

create function public.roof_pros_form_status(p_lead_id uuid,p_retry boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v public.roof_pros_form_deliveries;
begin
 if private.readyops_profile_role() is distinct from 'admin' then raise exception 'Admin access required';end if;
 if p_retry then
  perform private.enqueue_roof_pros_form(p_lead_id);
  update public.roof_pros_form_deliveries set status='queued',error_message=null,updated_at=now()
   where lead_id=p_lead_id and status='needs_info';
 end if;
 select * into v from public.roof_pros_form_deliveries where lead_id=p_lead_id;
 if v.id is null then return null;end if;
 return jsonb_build_object('id',v.id,'status',v.status,'submitted_at',v.submitted_at,
  'error_message',v.error_message,'confirmation',v.confirmation);
end $$;
revoke all on function public.roof_pros_form_status(uuid,boolean) from public,anon;
grant execute on function public.roof_pros_form_status(uuid,boolean) to authenticated;

-- Service worker claims are short lived and never exposed to app clients.
create function private.claim_roof_pros_form() returns jsonb
language plpgsql security definer set search_path='' as $$
declare v public.roof_pros_form_deliveries;
begin
 update public.roof_pros_form_deliveries set status='uncertain',updated_at=now(),
  error_message='Submission confirmation was not recorded. Review Google Form responses before retrying.'
  where status='submitting' and lease_expires_at<now();
 select * into v from public.roof_pros_form_deliveries
  where status='queued' or (status='preparing' and lease_expires_at<now())
  order by queued_at,id for update skip locked limit 1;
 if v.id is null then return null;end if;
 update public.roof_pros_form_deliveries set status='preparing',claim_token=gen_random_uuid(),
  lease_expires_at=now()+interval '15 minutes',updated_at=now(),attempts=attempts+1
  where id=v.id returning * into v;
 return to_jsonb(v);
end $$;
revoke all on function private.claim_roof_pros_form() from public,anon,authenticated;
grant execute on function private.claim_roof_pros_form() to service_role;

create function private.roof_pros_form_payload(p_lead_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('lead_id',l.id,'lead_code',l.lead_code,'company_id',l.company_id,
  'qc_status',l.qc_status,'sent_at',a.company_visible_at,
  'agent',coalesce(ag.name,l.agent_name,''),'name',l.full_name,'phone',l.phone_number,
  'email',coalesce(l.email,l.form_data->>'email',''),'address',l.address,
  'city',l.city,'state',l.state,'zip',l.zip_code,
  'date',a.appointment_date,'time',a.start_time,
  'roof_type',case when l.form_data->>'roof_type'='Other' then coalesce(l.form_data->>'roof_type_other','Other') else l.form_data->>'roof_type' end,
  'roof_age',l.form_data->>'roof_age','contract',l.form_data->>'contract',
  'insurance',concat_ws(' — ',nullif(l.form_data->>'insurance',''),nullif(l.form_data->>'insurance_name','')),
  'notes',coalesce(nullif(a.inspector_notes,''),nullif(l.form_data->>'summary_notes',''),nullif(l.form_data->>'recording_notes',''),l.notes,''),
  'recording_url',l.recording_url,'source_updated_at',greatest(l.updated_at,a.updated_at))
 from public.portal_leads l left join public.agents ag on ag.id=l.agent_id
 left join lateral(select * from public.portal_appointments a where a.lead_id=l.id order by created_at desc,id limit 1) a on true
 where l.id=p_lead_id;
$$;
revoke all on function private.roof_pros_form_payload(uuid) from public,anon,authenticated;
grant execute on function private.roof_pros_form_payload(uuid) to service_role;

create function private.finish_roof_pros_form(p_id uuid,p_token uuid,p_status text,p_message text default null) returns boolean
language plpgsql security definer set search_path='' as $$
declare v public.roof_pros_form_deliveries; v_payload jsonb;
begin
 select * into v from public.roof_pros_form_deliveries where id=p_id for update;
 if v.claim_token is distinct from p_token or v.lease_expires_at<=now() or v.status not in ('preparing','submitting') then
  raise exception 'Stale or invalid form claim';
 end if;
 if p_status='submitting' and v.status='preparing' then
  v_payload:=private.roof_pros_form_payload(v.lead_id);
  if p_message is distinct from v_payload->>'source_updated_at' then
   raise exception 'Lead details changed. Reload the form before submitting';end if;
  if v_payload->>'company_id'<>'d12e8b8c-fd25-45c0-8d43-9b4aecdcda0c' or v_payload->>'qc_status'<>'approved' or v_payload->>'sent_at' is null then
   raise exception 'Lead must still be approved and sent to Roof Pros';end if;
 elsif p_status='submitted' and v.status='submitting' and length(coalesce(p_message,''))>0 then null;
 elsif p_status in ('needs_info','queued') and v.status='preparing' then null;
 elsif p_status='uncertain' and v.status='submitting' then null;
 else raise exception 'Invalid form transition';end if;
 update public.roof_pros_form_deliveries set status=p_status,updated_at=now(),
  error_message=case when p_status in ('needs_info','uncertain') then left(p_message,1000) end,
  confirmation=case when p_status='submitted' then left(p_message,2000) else confirmation end,
  submitted_at=case when p_status='submitted' then now() else submitted_at end,
  claim_token=case when p_status='submitting' then claim_token end,
  lease_expires_at=case when p_status='submitting' then lease_expires_at end
 where id=p_id;
 return true;
end $$;
revoke all on function private.finish_roof_pros_form(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function private.finish_roof_pros_form(uuid,uuid,text,text) to service_role;
