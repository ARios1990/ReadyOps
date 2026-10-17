BEGIN;
CREATE TABLE public.dnc_datasets (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), provider text NOT NULL, version text NOT NULL,
 source_kind text NOT NULL CHECK(source_kind IN ('registry_import','lookup_results_import')),
 refreshed_on date NOT NULL CHECK(refreshed_on <= current_date), area_codes text[] NOT NULL DEFAULT '{}',
 expected_rows integer NOT NULL CHECK(expected_rows>0), active boolean NOT NULL DEFAULT false,
 imported_by uuid NOT NULL REFERENCES auth.users(id), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(provider,version)
);
CREATE TABLE public.dnc_records (
 dataset_id uuid NOT NULL REFERENCES public.dnc_datasets(id), phone text NOT NULL CHECK(phone ~ '^[2-9][0-9]{9}$'),
 matched boolean NOT NULL, PRIMARY KEY(dataset_id,phone)
);
CREATE TABLE public.dnc_suppressions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), phone text NOT NULL CHECK(phone ~ '^[2-9][0-9]{9}$'),
 lead_id uuid REFERENCES public.portal_leads(id), reason text NOT NULL CHECK(length(trim(reason))>=5),
 recorded_by uuid REFERENCES auth.users(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX dnc_suppressions_phone ON public.dnc_suppressions(phone);
CREATE INDEX dnc_records_phone ON public.dnc_records(phone);
CREATE TABLE public.dnc_audit (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), lead_id uuid REFERENCES public.portal_leads(id), phone text,
 event text NOT NULL, evidence jsonb NOT NULL, actor_id uuid REFERENCES auth.users(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.dnc_reviews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), lead_id uuid NOT NULL REFERENCES public.portal_leads(id),
 phone text NOT NULL, fingerprint text NOT NULL, decision text NOT NULL CHECK(decision IN ('clear','restricted')),
 evidence text NOT NULL CHECK(length(trim(evidence))>=20), evidence_source text NOT NULL CHECK(length(trim(evidence_source))>=5),
 reviewer_id uuid NOT NULL REFERENCES auth.users(id), expires_at timestamptz NOT NULL,
 override_restriction boolean NOT NULL DEFAULT false, findings jsonb NOT NULL DEFAULT '[]', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX dnc_reviews_lead ON public.dnc_reviews(lead_id,created_at DESC);
ALTER TABLE public.dnc_datasets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dnc_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dnc_suppressions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dnc_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dnc_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.dnc_datasets,public.dnc_records,public.dnc_suppressions,public.dnc_reviews,public.dnc_audit FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.dnc_datasets,public.dnc_suppressions,public.dnc_reviews,public.dnc_audit TO authenticated;
CREATE POLICY dnc_datasets_read ON public.dnc_datasets FOR SELECT TO authenticated USING(public.portal_is_qc_or_admin());
CREATE POLICY dnc_suppressions_read ON public.dnc_suppressions FOR SELECT TO authenticated USING(public.portal_is_qc_or_admin());
CREATE POLICY dnc_reviews_read ON public.dnc_reviews FOR SELECT TO authenticated USING(public.portal_is_qc_or_admin());
CREATE POLICY dnc_audit_read ON public.dnc_audit FOR SELECT TO authenticated USING(public.portal_is_qc_or_admin());

CREATE FUNCTION private.dnc_phone(p text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT CASE WHEN length(n)=11 AND left(n,1)='1' THEN substr(n,2) WHEN length(n)=10 THEN n ELSE NULL END
 FROM (SELECT regexp_replace(coalesce(p,''),'[^0-9]','','g') n) s;
$$;
CREATE FUNCTION private.dnc_append_only() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN RAISE EXCEPTION 'Compliance history is append-only'; END;
$$;
CREATE TRIGGER dnc_audit_immutable BEFORE UPDATE OR DELETE ON public.dnc_audit FOR EACH ROW EXECUTE FUNCTION private.dnc_append_only();
CREATE TRIGGER dnc_reviews_immutable BEFORE UPDATE OR DELETE ON public.dnc_reviews FOR EACH ROW EXECUTE FUNCTION private.dnc_append_only();
CREATE TRIGGER dnc_suppressions_immutable BEFORE UPDATE OR DELETE ON public.dnc_suppressions FOR EACH ROW EXECUTE FUNCTION private.dnc_append_only();

CREATE FUNCTION private.dnc_state(p_lead uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE l public.portal_leads; ph text; ds public.dnc_datasets; result text; matched boolean:=false;
 suppression timestamptz; signature text; review public.dnc_reviews; transcript_updated timestamptz; duplicate_count int;
BEGIN
 SELECT * INTO l FROM public.portal_leads WHERE id=p_lead;
 IF NOT FOUND THEN RAISE EXCEPTION 'Lead not found'; END IF;
 ph:=private.dnc_phone(l.phone_number);
 SELECT max(created_at) INTO suppression FROM public.dnc_suppressions WHERE phone=ph;
 SELECT * INTO ds FROM public.dnc_datasets d WHERE active AND
 (left(ph,3)=ANY(d.area_codes) OR EXISTS(SELECT 1 FROM public.dnc_records r WHERE r.dataset_id=d.id AND r.phone=ph))
 ORDER BY refreshed_on DESC,created_at DESC LIMIT 1;
 SELECT max(updated_at) INTO transcript_updated FROM public.qc_lead_transcripts WHERE lead_id=p_lead;
 IF suppression IS NOT NULL THEN result:='match'; matched:=true;
 ELSIF ph IS NULL THEN result:='failed';
 ELSE
   -- Keep previous positive findings restricted even when data has gone stale.
   SELECT EXISTS(SELECT 1 FROM public.dnc_records r JOIN public.dnc_datasets d ON d.id=r.dataset_id WHERE d.active AND r.phone=ph AND r.matched) INTO matched;
   IF matched THEN result:='match';
   ELSIF ds.id IS NULL THEN result:='not_checked';
   ELSIF ds.refreshed_on < current_date-31 THEN result:='failed';
   ELSIF ds.source_kind='registry_import' AND left(ph,3)=ANY(ds.area_codes) THEN result:='not_found';
   ELSIF EXISTS(SELECT 1 FROM public.dnc_records WHERE dataset_id=ds.id AND phone=ph AND NOT dnc_records.matched) THEN result:='not_found';
   ELSE result:='not_checked'; END IF;
 END IF;
 signature:=md5(concat_ws('|',ph,result,ds.id::text,ds.refreshed_on::text,suppression::text,transcript_updated::text));
 SELECT * INTO review FROM public.dnc_reviews WHERE lead_id=p_lead AND phone=ph AND fingerprint=signature AND expires_at>now() ORDER BY created_at DESC LIMIT 1;
 SELECT count(*) INTO duplicate_count FROM public.portal_leads x WHERE x.id<>p_lead AND private.dnc_phone(x.phone_number)=ph;
 RETURN jsonb_build_object('status',result,'phone',ph,'fingerprint',signature,'provider',ds.provider,'version',ds.version,
 'refreshed_on',ds.refreshed_on,'source_kind',ds.source_kind,'lookup_mode','imported_dataset','internal_opt_out',suppression IS NOT NULL,
 'duplicate_count',duplicate_count,'review',CASE WHEN review.id IS NULL THEN NULL ELSE to_jsonb(review) END,
 'restricted',NOT coalesce(review.decision='clear' AND (result='not_found' OR review.override_restriction),false));
END;
$$;

CREATE FUNCTION public.qc_dnc_check(p_lead_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT public.portal_is_qc_or_admin() THEN RAISE EXCEPTION 'QC access required'; END IF;
 s:=private.dnc_state(p_lead_id);
 INSERT INTO public.dnc_audit(lead_id,phone,event,evidence,actor_id) VALUES(p_lead_id,s->>'phone','dataset_lookup',s,auth.uid());
 RETURN s;
END;
$$;
CREATE FUNCTION public.qc_record_opt_out(p_lead_id uuid,p_reason text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ph text;
BEGIN
 IF auth.uid() IS NULL OR NOT public.portal_is_qc_or_admin() THEN RAISE EXCEPTION 'QC access required'; END IF;
 SELECT private.dnc_phone(phone_number) INTO ph FROM public.portal_leads WHERE id=p_lead_id;
 IF ph IS NULL THEN RAISE EXCEPTION 'Valid phone required'; END IF;
 INSERT INTO public.dnc_suppressions(phone,lead_id,reason,recorded_by) VALUES(ph,p_lead_id,p_reason,auth.uid());
 INSERT INTO public.dnc_audit(lead_id,phone,event,evidence,actor_id) VALUES(p_lead_id,ph,'internal_opt_out',jsonb_build_object('reason',p_reason),auth.uid());
 RETURN private.dnc_state(p_lead_id);
END;
$$;
CREATE FUNCTION public.qc_dnc_review(p_lead_id uuid,p_fingerprint text,p_decision text,p_evidence text,p_source text,p_override boolean DEFAULT false,p_findings jsonb DEFAULT '[]') RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT public.portal_is_qc_or_admin() THEN RAISE EXCEPTION 'QC access required'; END IF;
 s:=private.dnc_state(p_lead_id);
 IF s->>'fingerprint' IS DISTINCT FROM p_fingerprint THEN RAISE EXCEPTION 'Compliance data changed. Recheck before review.'; END IF;
 IF jsonb_typeof(p_findings)<>'array' OR octet_length(p_findings::text)>30000 THEN RAISE EXCEPTION 'Invalid advisory findings'; END IF;
 IF p_decision='clear' AND s->>'status'<>'not_found' AND (NOT p_override OR NOT public.portal_is_admin()) THEN RAISE EXCEPTION 'Restricted or unavailable data requires documented Admin override'; END IF;
 INSERT INTO public.dnc_reviews(lead_id,phone,fingerprint,decision,evidence,evidence_source,reviewer_id,expires_at,override_restriction,findings)
 VALUES(p_lead_id,s->>'phone',p_fingerprint,p_decision,p_evidence,p_source,auth.uid(),now()+interval '1 day',p_override AND public.portal_is_admin(),p_findings);
 INSERT INTO public.dnc_audit(lead_id,phone,event,evidence,actor_id) VALUES(p_lead_id,s->>'phone','review_decision',jsonb_build_object('lookup',s,'decision',p_decision,'evidence',p_evidence,'source',p_source,'override',p_override,'advisory_findings',p_findings),auth.uid());
 RETURN private.dnc_state(p_lead_id);
END;
$$;

CREATE FUNCTION public.admin_dnc_import(p_provider text,p_version text,p_kind text,p_refreshed date,p_area_codes text[],p_expected int,p_rows jsonb,p_activate boolean DEFAULT false) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ds public.dnc_datasets; item jsonb; ph text; n int;
BEGIN
 IF auth.uid() IS NULL OR NOT public.portal_is_admin() THEN RAISE EXCEPTION 'Admin required'; END IF;
 IF length(trim(p_provider))<3 OR length(trim(p_version))<1 OR jsonb_array_length(p_rows)>5000 THEN RAISE EXCEPTION 'Invalid import metadata/batch'; END IF;
 IF EXISTS(SELECT 1 FROM unnest(p_area_codes) a WHERE a !~ '^[2-9][0-9]{2}$') THEN RAISE EXCEPTION 'Invalid area code'; END IF;
 INSERT INTO public.dnc_datasets(provider,version,source_kind,refreshed_on,area_codes,expected_rows,imported_by)
 VALUES(trim(p_provider),trim(p_version),p_kind,p_refreshed,p_area_codes,p_expected,auth.uid()) ON CONFLICT(provider,version) DO NOTHING;
 SELECT * INTO ds FROM public.dnc_datasets WHERE provider=trim(p_provider) AND version=trim(p_version) FOR UPDATE;
 IF ds.source_kind<>p_kind OR ds.refreshed_on<>p_refreshed OR ds.expected_rows<>p_expected OR ds.area_codes<>p_area_codes THEN RAISE EXCEPTION 'Dataset version metadata differs'; END IF;
 IF ds.active THEN
   FOR item IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
     IF NOT EXISTS(SELECT 1 FROM public.dnc_records WHERE dataset_id=ds.id AND phone=private.dnc_phone(item->>'phone') AND matched=(item->>'matched')::boolean) THEN RAISE EXCEPTION 'Activated dataset is immutable. Use a new version.'; END IF;
   END LOOP;
   RETURN ds.id;
 END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
   ph:=private.dnc_phone(item->>'phone');
   IF ph IS NULL OR ph !~ '^[2-9][0-9]{9}$' OR jsonb_typeof(item->'matched')<>'boolean' THEN RAISE EXCEPTION 'Invalid phone/result'; END IF;
   IF p_kind='registry_import' AND ((item->>'matched')::boolean IS NOT TRUE OR NOT left(ph,3)=ANY(p_area_codes)) THEN RAISE EXCEPTION 'Registry entries must be matches within declared coverage'; END IF;
   INSERT INTO public.dnc_records VALUES(ds.id,ph,(item->>'matched')::boolean) ON CONFLICT(dataset_id,phone) DO NOTHING;
   IF EXISTS(SELECT 1 FROM public.dnc_records WHERE dataset_id=ds.id AND phone=ph AND matched<>(item->>'matched')::boolean) THEN RAISE EXCEPTION 'Contradictory duplicate result'; END IF;
 END LOOP;
 SELECT count(*) INTO n FROM public.dnc_records WHERE dataset_id=ds.id;
 IF p_activate THEN
   IF n<>ds.expected_rows THEN RAISE EXCEPTION 'Incomplete dataset: expected %, found %',ds.expected_rows,n; END IF;
   UPDATE public.dnc_datasets SET active=true WHERE id=ds.id;
 END IF;
 INSERT INTO public.dnc_audit(event,evidence,actor_id) VALUES('dataset_import',jsonb_build_object('dataset',ds.id,'rows',n,'active',p_activate),auth.uid());
 RETURN ds.id;
END;
$$;

CREATE FUNCTION private.dnc_assert_clear(p_lead uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF (private.dnc_state(p_lead)->>'restricted')::boolean THEN RAISE EXCEPTION 'Compliance review required: DNC, dataset or consent evidence is unresolved'; END IF;
END;
$$;
CREATE FUNCTION private.dnc_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_TABLE_NAME='portal_leads' THEN
   IF NEW.qc_status='approved' AND (TG_OP='INSERT' OR OLD.qc_status IS DISTINCT FROM NEW.qc_status) THEN PERFORM private.dnc_assert_clear(NEW.id); END IF;
 ELSIF TG_TABLE_NAME='qc_review_cycles' THEN
   IF NEW.status='approved' AND (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN PERFORM private.dnc_assert_clear(NEW.lead_id); END IF;
 ELSIF TG_TABLE_NAME='portal_appointments' THEN
   IF NEW.company_visible_at IS NOT NULL AND (TG_OP='INSERT' OR OLD.company_visible_at IS DISTINCT FROM NEW.company_visible_at) THEN PERFORM private.dnc_assert_clear(NEW.lead_id); END IF;
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER dnc_guard_lead BEFORE INSERT OR UPDATE OF qc_status ON public.portal_leads FOR EACH ROW EXECUTE FUNCTION private.dnc_guard();
CREATE TRIGGER dnc_guard_qc BEFORE INSERT OR UPDATE OF status ON public.qc_review_cycles FOR EACH ROW EXECUTE FUNCTION private.dnc_guard();
CREATE TRIGGER dnc_guard_delivery BEFORE INSERT OR UPDATE OF company_visible_at ON public.portal_appointments FOR EACH ROW EXECUTE FUNCTION private.dnc_guard();
REVOKE ALL ON FUNCTION private.dnc_phone(text),private.dnc_append_only(),private.dnc_state(uuid),private.dnc_assert_clear(uuid),private.dnc_guard() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.qc_dnc_check(uuid),public.qc_record_opt_out(uuid,text),public.qc_dnc_review(uuid,text,text,text,text,boolean,jsonb),public.admin_dnc_import(text,text,text,date,text[],integer,jsonb,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.qc_dnc_check(uuid),public.qc_record_opt_out(uuid,text),public.qc_dnc_review(uuid,text,text,text,text,boolean,jsonb),public.admin_dnc_import(text,text,text,date,text[],integer,jsonb,boolean) TO authenticated;
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
 and not (private.dnc_state(l.id)->>'restricted')::boolean
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
CREATE OR REPLACE FUNCTION public.request_lead_email_resend(p_lead_id uuid, p_request_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if public.current_profile_role() not in ('admin','manager') or not private.readyops_can_review_lead(p_lead_id) then raise exception 'Lead unavailable for this account';end if;
 if p_request_id is null then raise exception 'Resend request ID is required';end if;
 if exists(select 1 from public.lead_email_notifications where lead_id=p_lead_id and created_at>now()-interval '1 minute' and request_key<>'resend:'||p_request_id::text) then raise exception 'Wait one minute before requesting another email';end if;
 perform private.dnc_assert_clear(p_lead_id);
 return private.queue_lead_email(p_lead_id,'resend:'||p_request_id::text);
end $function$
;
CREATE FUNCTION private.dnc_cache_lead_check() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s jsonb;
BEGIN
 s:=private.dnc_state(NEW.id);
 INSERT INTO public.dnc_audit(lead_id,phone,event,evidence,actor_id) VALUES(NEW.id,s->>'phone','automatic_dataset_check',s,auth.uid());
 RETURN NEW;
END;
$$;
CREATE TRIGGER dnc_check_phone AFTER INSERT OR UPDATE OF phone_number ON public.portal_leads FOR EACH ROW EXECUTE FUNCTION private.dnc_cache_lead_check();
CREATE FUNCTION public.assert_lead_contact_clear(p_lead_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN PERFORM private.dnc_assert_clear(p_lead_id); END;
$$;
REVOKE ALL ON FUNCTION public.assert_lead_contact_clear(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.assert_lead_contact_clear(uuid) TO service_role;
REVOKE ALL ON FUNCTION private.dnc_cache_lead_check() FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.qc_review_lead(p_lead_id uuid, p_decision text, p_reason text DEFAULT NULL::text, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_lead public.portal_leads%ROWTYPE;
  v_appt public.portal_appointments%ROWTYPE;
  v_cycle public.qc_review_cycles%ROWTYPE;
  v_role text := private.readyops_profile_role();
  v_effective_decision text;
  v_correction_assignee uuid;
BEGIN
  IF p_decision NOT IN ('approved', 'denied', 'needs_correction') THEN
    RAISE EXCEPTION 'Decision must be approved, denied, or needs_correction';
  END IF;
  IF p_decision IN ('denied', 'needs_correction')
     AND nullif(trim(coalesce(p_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'A reason is required for this QC decision';
  END IF;
  IF v_role NOT IN ('admin', 'qc', 'manager') THEN
    RAISE EXCEPTION 'QC reviewer access required';
  END IF;
  IF NOT private.readyops_can_review_lead(p_lead_id) THEN
    RAISE EXCEPTION 'QC reviewer access required for this team';
  END IF;

  v_effective_decision := CASE
    WHEN v_role = 'manager' AND p_decision = 'approved' THEN 'manager_approved'
    ELSE p_decision
  END;

  SELECT * INTO v_lead
  FROM public.portal_leads
  WHERE id = p_lead_id
  FOR UPDATE;
  IF v_lead.id IS NULL THEN RAISE EXCEPTION 'Lead not found'; END IF;

  IF p_decision='denied' AND lower(coalesce(p_reason,'')) ~ '(do not call|dnc|do not contact)' THEN
    INSERT INTO public.dnc_suppressions(phone,lead_id,reason,recorded_by)
    VALUES(private.dnc_phone(v_lead.phone_number),v_lead.id,p_reason,auth.uid());
    INSERT INTO public.dnc_audit(lead_id,phone,event,evidence,actor_id)
    VALUES(v_lead.id,private.dnc_phone(v_lead.phone_number),'qc_dnc_denial',jsonb_build_object('reason',p_reason),auth.uid());
  END IF;
  SELECT * INTO v_appt
  FROM public.portal_appointments
  WHERE lead_id = p_lead_id
  FOR UPDATE;

  SELECT * INTO v_cycle
  FROM public.qc_review_cycles
  WHERE lead_id = p_lead_id AND is_current
  FOR UPDATE;

  IF v_appt.id IS NULL OR v_cycle.id IS NULL THEN
    RAISE EXCEPTION 'Appointment or active QC cycle not found';
  END IF;
  IF v_role = 'manager' AND v_cycle.status = 'manager_approved' THEN
    RAISE EXCEPTION 'This lead is already waiting for final QC';
  END IF;

  v_correction_assignee := v_lead.agent_profile_id;
  IF v_correction_assignee IS NULL THEN
    SELECT profile.id
    INTO v_correction_assignee
    FROM public.profiles AS profile
    WHERE profile.agent_id = v_lead.agent_id
    LIMIT 1;
  END IF;

  UPDATE public.qc_review_cycles
  SET status = v_effective_decision,
      reviewer_id = (SELECT auth.uid()),
      started_at = coalesce(started_at, now()),
      completed_at = CASE WHEN v_effective_decision IN ('approved', 'denied') THEN now() ELSE NULL END,
      correction_assignee_id = CASE WHEN v_effective_decision = 'needs_correction' THEN v_correction_assignee ELSE NULL END,
      correction_attempt = correction_attempt + CASE WHEN v_effective_decision = 'needs_correction' THEN 1 ELSE 0 END,
      reason = nullif(trim(coalesce(p_reason, '')), ''),
      notes = nullif(trim(coalesce(p_notes, '')), ''),
      updated_at = now()
  WHERE id = v_cycle.id
  RETURNING * INTO v_cycle;

  UPDATE public.portal_leads
  SET qc_status = v_effective_decision,
      qc_reason = nullif(trim(coalesce(p_reason, '')), ''),
      qc_notes = nullif(trim(coalesce(p_notes, '')), ''),
      qc_reviewed_by = (SELECT auth.uid()),
      qc_reviewed_at = now(),
      updated_at = now()
  WHERE id = p_lead_id
  RETURNING * INTO v_lead;

  IF v_effective_decision = 'denied' THEN
    UPDATE public.portal_appointments
    SET status = 'qc_denied',
        company_visible_at = NULL,
        representative_id = NULL,
        rep_status = 'unassigned',
        updated_at = now()
    WHERE id = v_appt.id
    RETURNING * INTO v_appt;
  ELSE
    UPDATE public.portal_appointments
    SET status = 'qc_pending',
        company_visible_at = NULL,
        updated_at = now()
    WHERE id = v_appt.id
    RETURNING * INTO v_appt;
  END IF;

  PERFORM public.portal_write_audit(
    v_lead.company_id,
    v_role,
    (SELECT auth.uid()),
    public.portal_actor_name_for_management(),
    CASE v_effective_decision
      WHEN 'manager_approved' THEN 'manager_qc_submitted'
      WHEN 'approved' THEN 'qc_approved_awaiting_send'
      WHEN 'denied' THEN 'qc_denied'
      ELSE 'qc_correction_requested'
    END,
    'lead',
    v_lead.id,
    NULL,
    jsonb_build_object(
      'qc_status', v_effective_decision,
      'reason', p_reason,
      'appointment_status', v_appt.status
    ),
    jsonb_build_object(
      'appointment_id', v_appt.id,
      'qc_review_id', v_cycle.id,
      'correction_assignee_id', v_cycle.correction_assignee_id,
      'correction_attempt', v_cycle.correction_attempt,
      'released_to_company', false,
      'awaiting_admin_send', v_effective_decision = 'approved'
    )
  );

  RETURN jsonb_build_object(
    'lead', to_jsonb(v_lead),
    'appointment', to_jsonb(v_appt),
    'qc_review', to_jsonb(v_cycle),
    'released_to_company', false,
    'awaiting_admin_send', v_effective_decision = 'approved',
    'same_day_notification_queued', false
  );
END;
$function$
;
COMMIT;
