/*
# Move duplicate lead detection to QC / Admin review

1. Summary
- Duplicate detection is now only visible to QC reviewers and Admins, inside the QC Queue.
- Agents booking appointments no longer see a duplicate check.

2. Removed
- Function `check_public_lead_duplicates` (agent booking check). No data is affected.

3. New Functions
- `qc_find_lead_duplicates(p_lead_ids uuid[])` returns, for each requested lead, other leads with
  the same phone (last 10 digits), same full name, or same street address (normalized, 4+ chars).
  Each match includes full contact details, agent, company, QC status, submit date and the list of
  matched fields (`phone`, `name`, `address`, plus `agent` when the same agent submitted both).

4. Security
- SECURITY DEFINER with fixed search_path; raises unless `portal_is_qc_or_admin()` is true.
- EXECUTE revoked from PUBLIC/anon, granted to authenticated only.
- Requests are capped at 500 lead ids.
*/

DROP FUNCTION IF EXISTS public.check_public_lead_duplicates(uuid, uuid, jsonb, text);

CREATE OR REPLACE FUNCTION public.qc_find_lead_duplicates(p_lead_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT public.portal_is_qc_or_admin() THEN
    RAISE EXCEPTION 'Only QC and Admin users can review duplicate leads';
  END IF;
  IF p_lead_ids IS NULL OR cardinality(p_lead_ids) = 0 THEN
    RETURN '[]'::jsonb;
  END IF;
  IF cardinality(p_lead_ids) > 500 THEN
    RAISE EXCEPTION 'Too many leads requested';
  END IF;

  WITH source AS (
    SELECT l.id, l.agent_id, l.agent_profile_id,
      public.portal_normalize_phone(l.phone_number) AS n_phone,
      public.portal_normalize_text(l.full_name) AS n_name,
      CASE WHEN length(public.portal_normalize_text(split_part(coalesce(l.address, ''), ',', 1))) >= 4
        THEN public.portal_normalize_text(split_part(coalesce(l.address, ''), ',', 1)) END AS n_street,
      public.portal_normalize_text(l.agent_name) AS n_agent
    FROM public.portal_leads l
    WHERE l.id = ANY(p_lead_ids)
  ), candidates AS (
    SELECT s.id AS source_id, c.*,
      (s.n_phone IS NOT NULL AND public.portal_normalize_phone(c.phone_number) = s.n_phone) AS m_phone,
      (s.n_name IS NOT NULL AND public.portal_normalize_text(c.full_name) = s.n_name) AS m_name,
      (s.n_street IS NOT NULL AND public.portal_normalize_text(split_part(coalesce(c.address, ''), ',', 1)) = s.n_street) AS m_address,
      ((s.agent_id IS NOT NULL AND c.agent_id = s.agent_id)
        OR (s.agent_profile_id IS NOT NULL AND c.agent_profile_id = s.agent_profile_id)
        OR (s.n_agent IS NOT NULL AND public.portal_normalize_text(c.agent_name) = s.n_agent)) AS m_agent
    FROM source s
    JOIN public.portal_leads c ON c.id <> s.id
  ), ranked AS (
    SELECT m.*, row_number() OVER (
      PARTITION BY m.source_id
      ORDER BY (m.m_phone::int + m.m_name::int + m.m_address::int) DESC, m.created_at DESC
    ) AS rn
    FROM candidates m
    WHERE m.m_phone OR m.m_name OR m.m_address
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'lead_id', g.source_id,
    'matches', g.matches
  )), '[]'::jsonb) INTO v_result
  FROM (
    SELECT r.source_id, jsonb_agg(jsonb_build_object(
      'id', r.id,
      'lead_code', r.lead_code,
      'full_name', r.full_name,
      'phone_number', r.phone_number,
      'address', r.address,
      'city', r.city,
      'state', r.state,
      'zip_code', r.zip_code,
      'agent_name', coalesce(a.name, r.agent_name),
      'company_name', rc.name,
      'submitted_at', r.created_at,
      'qc_status', r.qc_status,
      'matched_on', to_jsonb(array_remove(ARRAY[
        CASE WHEN r.m_phone THEN 'phone' END,
        CASE WHEN r.m_name THEN 'name' END,
        CASE WHEN r.m_address THEN 'address' END,
        CASE WHEN r.m_agent THEN 'agent' END
      ], NULL))
    ) ORDER BY r.rn) AS matches
    FROM ranked r
    LEFT JOIN public.agents a ON a.id = r.agent_id
    LEFT JOIN public.roster_companies rc ON rc.id = r.company_id
    WHERE r.rn <= 10
    GROUP BY r.source_id
  ) g;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.qc_find_lead_duplicates(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.qc_find_lead_duplicates(uuid[]) TO authenticated;
