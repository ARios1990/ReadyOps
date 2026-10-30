-- Recover a missing browser draft only while no Google Submit has been observed.
create function public.roof_pros_manual_recover(p_lead_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p jsonb; d public.roof_pros_form_deliveries; s private.roof_pros_manual_sessions; session_id uuid; ticket uuid:=gen_random_uuid();
begin
 if auth.uid() is null or private.readyops_profile_role() is distinct from 'admin' then raise exception 'Admin access required';end if;
 perform 1 from public.portal_leads where id=p_lead_id for update;
 p:=private.roof_pros_manual_payload(p_lead_id);
 select * into d from public.roof_pros_form_deliveries where lead_id=p_lead_id for update;
 if d.id is null or d.status not in ('manual_preparing','manual_review') then
  raise exception 'Only an unsubmitted manual draft can be recovered';
 end if;
 select * into s from private.roof_pros_manual_sessions where delivery_id=d.id for update;
 if s.id is null or s.user_clicked_at is not null or s.receipt_at is not null then
  raise exception 'Submit may already have been observed. Review the existing outcome; do not prepare another form';
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
revoke all on function public.roof_pros_manual_recover(uuid) from public,anon;
grant execute on function public.roof_pros_manual_recover(uuid) to authenticated;

-- A replacement tab may need to upload the same verified recording again. This
-- remains safe only before Submit and keeps the delivery in manual review.
create or replace function public.roof_pros_manual_exchange(p_id uuid,p_token uuid,p_action text,p_evidence jsonb default '{}') returns jsonb
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
 if p_action='uncertain' and d.status in ('manual_review','manual_submitting') then
  update public.roof_pros_form_deliveries set status='uncertain',updated_at=now(),
   error_message=left(coalesce(p_evidence->>'message','Manual submission outcome needs review. Do not submit again.'),1000) where id=d.id;
  return jsonb_build_object('success',true,'status','uncertain');
 end if;
 if p_action='failed' then
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
  if d.status not in ('manual_preparing','manual_review') or s.user_clicked_at is not null
   or coalesce(p_evidence->>'filename','') !~ ('^'||d.lead_id::text||'\.[a-z0-9]+$')
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

comment on function public.roof_pros_manual_recover(uuid) is
'Admin-only recovery for a missing Roof Pros browser draft before any Google Submit is observed.';
