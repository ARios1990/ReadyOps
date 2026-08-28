-- Imported from the hosted ReadyOp Supabase migration history on 2026-08-28.
-- Schema only: no production table data is included.

-- Make the legacy red/green weekly schedule part of the portal's canonical
-- availability check. The public listing and every reserve/move/reschedule RPC
-- already call this helper through portal_validate_slot.

CREATE OR REPLACE FUNCTION public.portal_slot_is_blocked(
  p_company_id uuid,
  p_location_id uuid,
  p_date date,
  p_start time without time zone,
  p_end time without time zone
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT
    EXISTS (
      SELECT 1
      FROM public.company_schedule_exceptions AS e
      WHERE e.company_id = p_company_id
        AND e.exception_date = p_date
        AND (e.location_id IS NULL OR e.location_id = p_location_id)
        AND (
          e.is_closed
          OR (
            e.start_time IS NOT NULL
            AND e.end_time IS NOT NULL
            AND p_start < e.end_time
            AND p_end > e.start_time
          )
        )
    )
    OR EXISTS (
      SELECT 1
      FROM public.company_bookings AS b
      WHERE b.company_id = p_company_id
        AND b.day = trim(to_char(p_date, 'Day'))
        AND b.time_slot = to_char(p_start, 'FMHH12')
        AND extract(minute FROM p_start) = 0
        AND (b.location_id IS NULL OR b.location_id = p_location_id)
    );
$function$;

COMMENT ON FUNCTION public.portal_slot_is_blocked(uuid, uuid, date, time without time zone, time without time zone)
IS 'Returns true for schedule exceptions or recurring legacy company_bookings; used by public availability and all portal slot mutations.';
