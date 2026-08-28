-- Imported from the hosted ReadyOp Supabase migration history on 2026-08-28.
-- Schema only: no production table data is included.

REVOKE EXECUTE ON FUNCTION public.portal_slot_is_blocked(
  uuid, uuid, date, time without time zone, time without time zone
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.portal_slot_is_blocked(
  uuid, uuid, date, time without time zone, time without time zone
) TO service_role;
