-- Manual review jobs cannot be claimed by the automatic sender, even after expiry.
alter table public.roof_pros_form_deliveries drop constraint roof_pros_form_deliveries_status_check;
alter table public.roof_pros_form_deliveries add constraint roof_pros_form_deliveries_status_check
 check(status in ('queued','preparing','submitting','submitted','needs_info','uncertain','manual_preparing','manual_review','manual_submitting'));

create table private.roof_pros_manual_sessions (
 id uuid primary key default gen_random_uuid(),
 delivery_id uuid not null unique references public.roof_pros_form_deliveries(id),
 token_hash text not null,
 created_by uuid not null,
 created_at timestamptz not null default now(),
 expires_at timestamptz not null default now()+interval '2 hours',
 source_updated_at text not null,
 recording_url text not null,
 attachment jsonb,
 user_clicked_at timestamptz,
 receipt_at timestamptz
);
alter table private.roof_pros_manual_sessions enable row level security;
revoke all on private.roof_pros_manual_sessions from public,anon,authenticated;
grant all on private.roof_pros_manual_sessions to service_role;

create function private.roof_pros_manual_payload(p_lead_id uuid) returns jsonb
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
 if coalesce(p->>'recording_url','') not like 'storage://qc-recordings/'||p_lead_id::text||'/%'
  or p->>'recording_url' like '%..%' or strpos(p->>'recording_url',chr(92))>0 then
  raise exception 'Upload a private recording for this lead first';
 end if;
 if exists(select 1 from jsonb_each_text(p) e where e.key in ('name','address','city','state','zip','date','time','roof_type','roof_age') and nullif(btrim(e.value),'') is null) then
  raise exception 'Complete the required customer, roof and appointment details first';
 end if;
 return p;
end $$;
revoke all on function private.roof_pros_manual_payload(uuid) from public,anon,authenticated;

create function public.roof_pros_manual_prepare(p_lead_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p jsonb; d public.roof_pros_form_deliveries; session_id uuid; ticket uuid:=gen_random_uuid();
begin
 if auth.uid() is null or private.readyops_profile_role() is distinct from 'admin' then raise exception 'Admin access required';end if;
 -- Serialize against lead edits and the worker claim; do not change approval or Send.
 perform 1 from public.portal_leads where id=p_lead_id for update;
 p:=private.roof_pros_manual_payload(p_lead_id);
 perform private.enqueue_roof_pros_form(p_lead_id);
 select * into d from public.roof_pros_form_deliveries where lead_id=p_lead_id for update;
 if d.id is null or d.status not in ('queued','needs_info') or coalesce(d.error_message,'') like 'MANUAL_REVIEW_HOLD:%' then
  raise exception 'This form is already completed, held for review, or being prepared. Refresh its status; do not create another submission';
 end if;
 insert into private.roof_pros_manual_sessions(delivery_id,token_hash,created_by,source_updated_at,recording_url)
 values(d.id,encode(sha256(convert_to(ticket::text,'UTF8')),'hex'),auth.uid(),p->>'source_updated_at',p->>'recording_url')
 on conflict(delivery_id) do update set id=gen_random_uuid(),token_hash=excluded.token_hash,created_by=excluded.created_by,
  created_at=now(),expires_at=now()+interval '2 hours',source_updated_at=excluded.source_updated_at,
  recording_url=excluded.recording_url,attachment=null,user_clicked_at=null,receipt_at=null
 returning id into session_id;
 update public.roof_pros_form_deliveries set status='manual_preparing',updated_at=now(),attempts=attempts+1,
  claim_token=null,lease_expires_at=null,error_message=null where id=d.id;
 return jsonb_build_object('id',session_id,'token',ticket,'delivery_id',d.id,'lead_id',p_lead_id);
end $$;
revoke all on function public.roof_pros_manual_prepare(uuid) from public,anon;
grant execute on function public.roof_pros_manual_prepare(uuid) to authenticated;

-- Accessible only through the capability-validating Edge Function; no staff JWT leaves ReadyOps.
create function public.roof_pros_manual_exchange(p_id uuid,p_token uuid,p_action text,p_evidence jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare s private.roof_pros_manual_sessions; d public.roof_pros_form_deliveries; p jsonb;
begin
 select * into s from private.roof_pros_manual_sessions where id=p_id for update;
 if s.id is null or s.token_hash is distinct from encode(sha256(convert_to(p_token::text,'UTF8')),'hex') then raise exception 'Invalid manual preparation ticket';end if;
 select * into d from public.roof_pros_form_deliveries where id=s.delivery_id for update;
 if d.company_id is distinct from 'd12e8b8c-fd25-45c0-8d43-9b4aecdcda0c' then raise exception 'Roof Pros only';end if;
 if p_action='receipt' and d.status='submitted' and s.receipt_at is not null then return jsonb_build_object('success',true,'status','submitted');end if;
 if s.expires_at<=now() then raise exception 'Manual preparation expired. Review the existing Google tab before any retry';end if;
 if d.status not in ('manual_preparing','manual_review','manual_submitting') then raise exception 'Manual draft is no longer available';end if;
 if p_action='failed' then
  -- A failure can release a preparation only before the user is given Submit access.
  update public.roof_pros_form_deliveries set status=case when status='manual_preparing' then 'needs_info' else status end,
   updated_at=now(),error_message=left(coalesce(p_evidence->>'message','Manual preparation needs review'),1000) where id=d.id;
  return jsonb_build_object('success',true);
 end if;
 if p_action='receipt' then
  if d.status<>'manual_submitting' or s.user_clicked_at is null or s.attachment is null
   or p_evidence->>'receipt' is distinct from 'Your response has been recorded.' then raise exception 'A user Submit and visible Google receipt are required';end if;
  update public.roof_pros_form_deliveries set status='submitted',submitted_at=now(),updated_at=now(),error_message=null,
   confirmation='Manual submission by user. Google Form: Your response has been recorded. Helper verified the matching recording attachment.' where id=d.id;
  update private.roof_pros_manual_sessions set receipt_at=now() where id=s.id;
  return jsonb_build_object('success',true,'status','submitted');
 end if;
 p:=private.roof_pros_manual_payload(d.lead_id);
 if p->>'source_updated_at' is distinct from s.source_updated_at or p->>'recording_url' is distinct from s.recording_url then
  raise exception 'Lead details or recording changed. Review the existing draft before submitting';
 end if;
 if p_action='context' then return jsonb_build_object('payload',p);end if;
 if p_action='ready' then
  if d.status<>'manual_preparing' or coalesce(p_evidence->>'filename','') !~ ('^'||d.lead_id::text||'\.[a-z0-9]+$')
   or coalesce(p_evidence->>'sha256','') !~ '^[a-f0-9]{64}$'
   or coalesce(p_evidence->>'bytes','') !~ '^[0-9]+$' then raise exception 'Verify the attached lead recording first';end if;
  if (p_evidence->>'bytes')::bigint not between 1 and 10485760 then raise exception 'Recording must be between 1 byte and 10 MB';end if;
  update private.roof_pros_manual_sessions set attachment=p_evidence where id=s.id;
  update public.roof_pros_form_deliveries set status='manual_review',updated_at=now(),error_message=null where id=d.id;
 elsif p_action='user_submit' then
  if d.status not in ('manual_review','manual_submitting') or s.attachment is null then raise exception 'Prepare and verify the form first';end if;
  update private.roof_pros_manual_sessions set user_clicked_at=coalesce(user_clicked_at,now()) where id=s.id;
  update public.roof_pros_form_deliveries set status='manual_submitting',updated_at=now() where id=d.id;
 else raise exception 'Invalid manual preparation action';end if;
 return jsonb_build_object('success',true);
end $$;
revoke all on function public.roof_pros_manual_exchange(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.roof_pros_manual_exchange(uuid,uuid,text,jsonb) to service_role;
