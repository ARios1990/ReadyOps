-- Imported from the hosted ReadyOp Supabase migration history on 2026-08-28.
-- Schema only: no production table data is included.

-- The previous migration added new overloads (with p_allow_past) instead of replacing
-- the originals, which made every existing 4/6-arg call site ambiguous and broke the
-- public booking flow. Drop the old overloads so only the new signature (with the
-- p_allow_past boolean DEFAULT false) remains for each function name.
DROP FUNCTION IF EXISTS public.portal_validate_slot(uuid, uuid, date, time without time zone);
DROP FUNCTION IF EXISTS public.portal_assert_slot_capacity(uuid, uuid, date, time without time zone, uuid, uuid);

