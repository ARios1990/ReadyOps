-- Imported from the hosted ReadyOp Supabase migration history on 2026-08-28.
-- Schema only: no production table data is included.

-- The team-aware SELECT policies created by the preceding migration already
-- include admins and Main QC. Remove the older admin-only SELECT duplicates so
-- every authenticated read is evaluated through one authorization policy.
DROP POLICY IF EXISTS portal_leads_admin_select ON public.portal_leads;
DROP POLICY IF EXISTS portal_appointments_admin_select ON public.portal_appointments;


