-- Imported from the hosted ReadyOp Supabase migration history on 2026-08-28.
-- Schema only: no production table data is included.

BEGIN;
DROP TABLE IF EXISTS public.portal_checkins CASCADE;
DROP TABLE IF EXISTS public.portal_appointments CASCADE;
DROP TABLE IF EXISTS public.portal_reservations CASCADE;
DROP TABLE IF EXISTS public.portal_leads CASCADE;
DROP TABLE IF EXISTS public.portal_audit_logs CASCADE;
COMMIT;
