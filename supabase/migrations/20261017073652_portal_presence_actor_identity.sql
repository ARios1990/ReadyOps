BEGIN;
CREATE TABLE public.company_portal_sessions (
 company_id uuid NOT NULL REFERENCES public.roster_companies(id) ON DELETE CASCADE,
 session_id uuid NOT NULL, actor_key text NOT NULL,
 actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 actor_kind text NOT NULL CHECK(actor_kind IN ('staff','company_verified','shared_link_unverified')),
 actor_name text, actor_role text,
 session_started_at timestamptz NOT NULL DEFAULT now(),
 last_seen_at timestamptz NOT NULL DEFAULT now(), current_section text,
 PRIMARY KEY(company_id,session_id,actor_key), CHECK(char_length(current_section)<=80)
);
CREATE INDEX company_portal_sessions_last_seen ON public.company_portal_sessions(last_seen_at DESC);
CREATE INDEX company_portal_sessions_actor ON public.company_portal_sessions(actor_user_id) WHERE actor_user_id IS NOT NULL;
ALTER TABLE public.company_portal_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.company_portal_sessions FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.company_portal_sessions TO authenticated;
CREATE POLICY company_portal_sessions_admin_read ON public.company_portal_sessions FOR SELECT TO authenticated USING(public.portal_is_admin());

CREATE FUNCTION public.record_company_portal_session(p_company_id uuid,p_access_token uuid,p_session_id uuid,p_current_section text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); kind text:='shared_link_unverified'; name text; role_name text; identity_key text:='unverified';
BEGIN
 IF p_session_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.company_portal_settings s WHERE s.company_id=p_company_id AND s.company_access_enabled AND s.company_access_token=p_access_token) THEN RETURN false; END IF;
 -- Identity always comes from the signed-in account, never a browser label,
 -- query parameter, user_metadata claim, IP address or a shared portal token.
 SELECT p.display_name,p.role INTO name,role_name FROM public.profiles p WHERE p.id=actor AND p.active;
 IF role_name IN ('admin','manager','qc','agent') THEN kind:='staff'; identity_key:=actor::text;
 ELSIF actor IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=actor AND NOT p.active) AND EXISTS(SELECT 1 FROM public.company_user_access a WHERE a.company_id=p_company_id AND a.user_id=actor) THEN kind:='company_verified';identity_key:=actor::text;
 ELSE actor:=NULL;name:=NULL;role_name:=NULL; END IF;
 INSERT INTO public.company_portal_sessions(company_id,session_id,actor_key,actor_user_id,actor_kind,actor_name,actor_role,current_section)
 VALUES(p_company_id,p_session_id,identity_key,actor,kind,name,role_name,left(nullif(trim(p_current_section),''),80))
 ON CONFLICT(company_id,session_id,actor_key) DO UPDATE SET
 actor_name=EXCLUDED.actor_name,actor_role=EXCLUDED.actor_role,actor_kind=EXCLUDED.actor_kind,
 session_started_at=CASE WHEN company_portal_sessions.last_seen_at<now()-interval '90 seconds' THEN now() ELSE company_portal_sessions.session_started_at END,
 last_seen_at=now(),current_section=EXCLUDED.current_section;
 RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.record_company_portal_session(uuid,uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_company_portal_session(uuid,uuid,uuid,text) TO anon,authenticated;

-- Older open portal tabs also get truthful identity attribution. Keep the
-- existing function signature; do not overwrite one company's other sessions.
CREATE OR REPLACE FUNCTION public.record_company_portal_presence(p_company_id uuid,p_access_token uuid,p_session_started_at timestamptz,p_current_section text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 RETURN public.record_company_portal_session(p_company_id,p_access_token,
 md5(p_company_id::text||coalesce(p_session_started_at::text,'legacy')||coalesce(auth.uid()::text,'unverified'))::uuid,p_current_section);
END;
$$;
REVOKE ALL ON FUNCTION public.record_company_portal_presence(uuid,uuid,timestamptz,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_company_portal_presence(uuid,uuid,timestamptz,text) TO anon,authenticated;
COMMIT;
