-- Imported from the hosted ReadyOp Supabase migration history on 2026-08-28.
-- Schema only: no production table data is included.

-- Harden: portal_validate_slot is directly callable via PostgREST RPC by anon/authenticated
-- roles (pre-existing, required for the public booking widget). Since it now accepts
-- p_allow_past, make sure that bypass only takes effect for QC/admin callers, regardless
-- of what a caller passes, so the public booking flow's past-date protection can't be
-- bypassed by calling this helper function directly.
CREATE OR REPLACE FUNCTION public.portal_validate_slot(p_company_id uuid, p_location_id uuid, p_date date, p_start time without time zone, p_allow_past boolean DEFAULT false)
 RETURNS company_schedule_rules
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_rule public.company_schedule_rules%ROWTYPE;
  v_end time;
  v_start_minutes integer;
  v_rule_start_minutes integer;
BEGIN
  IF p_date < current_date AND NOT (p_allow_past AND public.portal_is_qc_or_admin()) THEN
    RAISE EXCEPTION 'Past appointment dates are not available';
  END IF;

  v_rule := public.portal_find_rule(p_company_id, p_location_id, extract(dow FROM p_date)::integer);
  IF v_rule.id IS NULL OR NOT v_rule.is_open THEN
    RAISE EXCEPTION 'The company is closed on this date';
  END IF;

  v_end := (p_start + make_interval(mins => v_rule.slot_minutes))::time;
  IF p_start < v_rule.start_time OR v_end > v_rule.end_time THEN
    RAISE EXCEPTION 'The requested time is outside company hours';
  END IF;

  v_start_minutes := extract(hour FROM p_start)::integer * 60 + extract(minute FROM p_start)::integer;
  v_rule_start_minutes := extract(hour FROM v_rule.start_time)::integer * 60 + extract(minute FROM v_rule.start_time)::integer;
  IF mod(v_start_minutes - v_rule_start_minutes, v_rule.slot_minutes) <> 0 THEN
    RAISE EXCEPTION 'The requested time does not match the company appointment interval';
  END IF;

  IF public.portal_slot_is_blocked(p_company_id, p_location_id, p_date, p_start, v_end) THEN
    RAISE EXCEPTION 'The requested time is blocked';
  END IF;

  RETURN v_rule;
END;
$function$;

