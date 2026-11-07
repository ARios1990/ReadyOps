-- Both QC uploads and uploads made during this lead's booking are valid.
-- The converted reservation binds an agent upload to the exact lead; a URL
-- supplied by the browser, a matching company, or a matching session alone
-- must never authorize another customer's audio.
create function private.lead_recording_path(p_lead_id uuid) returns text
language sql stable security invoker set search_path='' as $$
 select substring(l.recording_url from length('storage://qc-recordings/') + 1)
 from public.portal_leads l
 where l.id=p_lead_id
   and l.recording_url like 'storage://qc-recordings/%'
   and strpos(l.recording_url, '..')=0
   and strpos(l.recording_url, chr(92))=0
   and (
     l.recording_url like 'storage://qc-recordings/'||l.id::text||'/%'
     or exists (
       select 1 from public.appointment_reservations r
       join public.portal_appointments a on a.id=r.converted_appointment_id
       where a.lead_id=l.id and r.status='converted'
         and l.recording_url like 'storage://qc-recordings/'||r.company_id::text||'/agent/'||r.id::text||'/%'
     )
   )
   and exists (
     select 1 from storage.objects o where o.bucket_id='qc-recordings'
       and o.name=substring(l.recording_url from length('storage://qc-recordings/') + 1)
   );
$$;
revoke all on function private.lead_recording_path(uuid) from public,anon,authenticated;
grant execute on function private.lead_recording_path(uuid) to service_role;

-- Used only by the server's existing leased Roof Pros worker. This is an
-- invoker function: it does not confer table access or sign a recording URL.
create function public.roof_pros_recording_path(p_lead_id uuid) returns text
language sql stable security invoker set search_path='' as $$
 select private.lead_recording_path(l.id) from public.portal_leads l
 where l.id=p_lead_id and l.company_id='d12e8b8c-fd25-45c0-8d43-9b4aecdcda0c'
   and l.qc_status='approved' and exists (
     select 1 from public.portal_appointments a where a.lead_id=l.id and a.company_visible_at is not null
   );
$$;
revoke all on function public.roof_pros_recording_path(uuid) from public,anon,authenticated;
grant execute on function public.roof_pros_recording_path(uuid) to service_role;

create or replace function private.roof_pros_manual_payload(p_lead_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p jsonb;
begin
 if p_lead_id in ('44f9d82b-2247-4185-bae6-44ca6a2aa013','c1fc6f84-4c9f-469e-a036-8d08e7c4b53d',
 '52123081-6cc7-48d0-bad8-8fc96ebf0141','9f158006-8bce-4928-aa13-8c686d00d91a') then
  raise exception 'This lead was manually completed and must never be resent';
 end if;
 p:=private.roof_pros_form_payload(p_lead_id);
 if p is null or p->>'company_id' is distinct from 'd12e8b8c-fd25-45c0-8d43-9b4aecdcda0c'
  or p->>'qc_status' is distinct from 'approved' or nullif(p->>'sent_at','') is null then
  raise exception 'Approve and Send this Roof Pros lead in ReadyOps first';
 end if;
 if private.lead_recording_path(p_lead_id) is null then
  raise exception 'Upload a private recording for this lead first';
 end if;
 if exists(select 1 from jsonb_each_text(p) e where e.key in ('name','address','city','state','zip','date','time','roof_type','roof_age') and nullif(btrim(e.value),'') is null) then
  raise exception 'Complete the required customer, roof and appointment details first';
 end if;
 return p;
end $$;
revoke all on function private.roof_pros_manual_payload(uuid) from public,anon,authenticated;
