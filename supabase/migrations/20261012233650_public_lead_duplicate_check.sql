/*
# Duplicate lead detection for the agent booking portal

1. Summary
   Before an agent submits an appointment, the booking page asks the database whether
   a matching lead was already submitted. A lead is considered a possible duplicate when
   any of these match an existing lead (any company):
   - Phone number (last 10 digits, formatting ignored)
   - Customer first + last name (case and spacing ignored)
   - Street address (case, punctuation and spacing ignored)
   The agent name is compared too and reported as "same agent" so the agent can tell
   whether they or a teammate submitted it.

2. New Functions
   - `check_public_lead_duplicates(p_reservation_token uuid, p_session_id uuid, p_form_data jsonb, p_agent_name text)`
     Returns a jsonb array (max 5) of matches with: lead_code, agent_name, submitted_at,
     qc_status, same_company, same_agent, matched_on (array of field names).
   - `portal_normalize_phone(text)`, `portal_normalize_text(text)` immutable helpers.

3. Security
   - SECURITY DEFINER with fixed search_path.
   - Requires an ACTIVE, unexpired reservation owned by the caller's session, the same
     gate used by `submit_public_appointment`, so it cannot be used to probe arbitrary data.
   - Returns no customer contact details (only lead code, agent, date, status, match flags).
   - EXECUTE revoked from PUBLIC; granted to anon and authenticated (booking portal is public).

4. Indexes
   - Expression index on normalized phone for fast lookups.
*/

CREATE OR REPLACE FUNCTION public.portal_normalize_phone(p text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT nullif(right(regexp_replace(coalesce(p, ''), '\D', '', 'g'), 10), '')
$$;

CREATE OR REPLACE FUNCTION public.portal_normalize_text(p text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT nullif(regexp_replace(lower(coalesce(p, '')), '[^a-z0-9]', '', 'g'), '')
$$;

CREATE INDEX IF NOT EXISTS portal_leads_normalized_phone_idx
  ON public.portal_leads (public.portal_normalize_phone(phone_number));

CREATE OR REPLACE FUNCTION public.check_public_lead_duplicates(
  p_reservation_token uuid,
  p_session_id uuid,
  p_form_data jsonb,
  p_agent_name text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_res public.appointment_reservations%rowtype;
  v_phone text := public.portal_normalize_phone(p_form_data->>'phone_number');
  v_name text := public.portal_normalize_text(
    coalesce(nullif(trim(p_form_data->>'full_name'), ''),
             concat_ws(' ', p_form_data->>'first_name', p_form_data->>'last_name')));
  v_street text := public.portal_normalize_text(split_part(coalesce(p_form_data->>'address', ''), ',', 1));
  v_agent text := public.portal_normalize_text(p_agent_name);
  v_result jsonb;
BEGIN
  SELECT * INTO v_res FROM public.appointment_reservations r
  WHERE r.reservation_token = p_reservation_token;
  IF v_res.id IS NULL OR v_res.session_id <> p_session_id
     OR v_res.status <> 'active' OR v_res.expires_at <= now() THEN
    RAISE EXCEPTION 'Reservation was not found for this agent session';
  END IF;

  IF v_phone IS NULL AND v_name IS NULL AND (v_street IS NULL OR length(v_street) < 4) THEN
    RETURN '[]'::jsonb;
  END IF;

  WITH candidates AS (
    SELECT l.*,
      (v_phone IS NOT NULL AND public.portal_normalize_phone(l.phone_number) = v_phone) AS m_phone,
      (v_name IS NOT NULL AND public.portal_normalize_text(l.full_name) = v_name) AS m_name,
      (v_street IS NOT NULL AND length(v_street) >= 4
        AND public.portal_normalize_text(split_part(coalesce(l.address, ''), ',', 1)) = v_street) AS m_address
    FROM public.portal_leads l
  ), matches AS (
    SELECT c.*, (v_agent IS NOT NULL AND public.portal_normalize_text(c.agent_name) = v_agent) AS m_agent
    FROM candidates c
    WHERE c.m_phone OR c.m_name OR c.m_address
    ORDER BY (c.m_phone::int + c.m_name::int + c.m_address::int) DESC, c.created_at DESC
    LIMIT 5
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'lead_code', m.lead_code,
    'agent_name', m.agent_name,
    'submitted_at', m.created_at,
    'qc_status', m.qc_status,
    'same_company', m.company_id = v_res.company_id,
    'same_agent', m.m_agent,
    'matched_on', to_jsonb(array_remove(ARRAY[
      CASE WHEN m.m_phone THEN 'phone' END,
      CASE WHEN m.m_name THEN 'name' END,
      CASE WHEN m.m_address THEN 'address' END,
      CASE WHEN m.m_agent THEN 'agent' END
    ], NULL))
  )), '[]'::jsonb) INTO v_result
  FROM matches m;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.check_public_lead_duplicates(uuid, uuid, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_public_lead_duplicates(uuid, uuid, jsonb, text) TO anon, authenticated;
