-- Keep DNC findings intact; an authenticated Admin may approve/release despite them.
CREATE OR REPLACE FUNCTION private.dnc_assert_clear(p_lead uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s jsonb;
BEGIN
 s := private.dnc_state(p_lead);
 IF (s->>'restricted')::boolean THEN
  IF auth.uid() IS NOT NULL AND public.portal_is_admin() THEN
   INSERT INTO public.dnc_audit(lead_id,phone,event,evidence,actor_id)
   VALUES(p_lead,s->>'phone','admin_advisory_continue',
    jsonb_build_object('lookup',s,'policy','DNC advisory for Admin QC and company delivery; original finding unchanged'),auth.uid());
   RETURN;
  END IF;
  RAISE EXCEPTION 'Compliance review required: DNC, dataset or consent evidence is unresolved';
 END IF;
END;
$$;
REVOKE ALL ON FUNCTION private.dnc_assert_clear(uuid) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.claim_readyops_lead_emails(p_limit integer DEFAULT 10)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_rows jsonb;
begin
 update public.lead_email_notifications set status='failed',next_attempt_at=null,error_message='Delivery uncertain after retry window; check provider history before deliberately resending'
 where status<>'sent' and first_attempt_at<now()-interval '20 hours' and next_attempt_at is not null;
 with picked as(select n.id from public.lead_email_notifications n
 join public.portal_leads l on l.id=n.lead_id
 where n.status<>'sent' and n.next_attempt_at<=now() and n.attempt_count<5
 and (n.claimed_at is null or n.claimed_at<now()-interval '5 minutes')
 and (n.first_attempt_at is null or n.first_attempt_at>now()-interval '20 hours')
 -- DNC is advisory for an already admin-approved, company-released lead.
 and l.company_id=n.company_id and l.qc_status='approved' and exists(select 1 from public.portal_appointments ap where ap.lead_id=l.id and ap.company_visible_at is not null)
 order by n.created_at limit greatest(1,least(p_limit,10)) for update of n skip locked),
 updated as(update public.lead_email_notifications n set status='pending',attempt_count=n.attempt_count+1,
 first_attempt_at=coalesce(n.first_attempt_at,now()),claimed_at=now(),claim_token=gen_random_uuid()
 from picked where n.id=picked.id returning n.*),
 attempts as(insert into public.lead_email_attempts(notification_id,attempt_number,claim_token) select id,attempt_count,claim_token from updated returning id)
 select coalesce(jsonb_agg(to_jsonb(updated)),'[]') into v_rows from updated;
 return v_rows;
end $function$
;
