-- Imported from the hosted ReadyOp Supabase migration history on 2026-08-28.
-- Schema only: no production table data is included.

ALTER TABLE public.portal_audit_logs DROP CONSTRAINT IF EXISTS portal_audit_logs_actor_type_check;
ALTER TABLE public.portal_audit_logs ADD CONSTRAINT portal_audit_logs_actor_type_check
CHECK (actor_type IN ('masters_admin','company_admin','representative','agent','system','external_form','admin','qc','company'));
