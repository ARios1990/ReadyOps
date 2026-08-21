/*
# Track company portal activity

Records a company-level heartbeat for private company management portals. The
public client cannot read or write the table directly. A narrowly scoped RPC
validates the existing company access token before updating the heartbeat, and
authenticated admins are the only browser clients allowed to read the rows.
*/

CREATE TABLE IF NOT EXISTS public.company_portal_presence (
  company_id uuid PRIMARY KEY REFERENCES public.roster_companies(id) ON DELETE CASCADE,
  session_started_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  current_section text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT company_portal_presence_section_length CHECK (char_length(current_section) <= 80)
);

CREATE INDEX IF NOT EXISTS company_portal_presence_last_seen_idx
  ON public.company_portal_presence (last_seen_at DESC);

ALTER TABLE public.company_portal_presence ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.company_portal_presence FROM PUBLIC;
REVOKE ALL ON TABLE public.company_portal_presence FROM anon;
REVOKE ALL ON TABLE public.company_portal_presence FROM authenticated;
GRANT SELECT ON TABLE public.company_portal_presence TO authenticated;

DROP POLICY IF EXISTS "company_portal_presence_admin_select" ON public.company_portal_presence;
CREATE POLICY "company_portal_presence_admin_select"
  ON public.company_portal_presence
  FOR SELECT
  TO authenticated
  USING ((SELECT public.portal_is_admin()));

CREATE OR REPLACE FUNCTION public.record_company_portal_presence(
  p_company_id uuid,
  p_access_token uuid,
  p_session_started_at timestamptz,
  p_current_section text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_valid boolean;
  v_section text;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM public.company_portal_settings AS settings
    WHERE settings.company_id = p_company_id
      AND settings.company_access_enabled = true
      AND settings.company_access_token = p_access_token
  ) INTO v_valid;

  IF NOT v_valid THEN
    RETURN false;
  END IF;

  v_section := left(nullif(trim(coalesce(p_current_section, '')), ''), 80);

  INSERT INTO public.company_portal_presence (
    company_id,
    session_started_at,
    last_seen_at,
    current_section,
    updated_at
  )
  VALUES (
    p_company_id,
    coalesce(p_session_started_at, now()),
    now(),
    v_section,
    now()
  )
  ON CONFLICT (company_id) DO UPDATE SET
    session_started_at = CASE
      WHEN public.company_portal_presence.last_seen_at < now() - interval '90 seconds'
        THEN EXCLUDED.session_started_at
      ELSE public.company_portal_presence.session_started_at
    END,
    last_seen_at = now(),
    current_section = EXCLUDED.current_section,
    updated_at = now();

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.record_company_portal_presence(uuid, uuid, timestamptz, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_company_portal_presence(uuid, uuid, timestamptz, text) TO anon, authenticated;
