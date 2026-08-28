-- Imported from the hosted ReadyOp Supabase migration history on 2026-08-28.
-- Schema only: no production table data is included.

REVOKE ALL ON FUNCTION public.qc_delete_lead(uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.qc_delete_lead(uuid,text) FROM anon;
GRANT EXECUTE ON FUNCTION public.qc_delete_lead(uuid,text) TO authenticated;
