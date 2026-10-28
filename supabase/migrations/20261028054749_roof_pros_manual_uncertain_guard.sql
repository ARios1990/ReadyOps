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
