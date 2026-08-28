-- Imported from the hosted ReadyOp Supabase migration history on 2026-08-28.
-- Schema only: no production table data is included.

BEGIN;

REVOKE EXECUTE ON FUNCTION public.get_qc_queue(date,date,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_qc_queue(date,date,uuid,text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_qc_reference_data() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_qc_reference_data() TO authenticated;

REVOKE EXECUTE ON FUNCTION public.qc_update_lead(uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.qc_update_lead(uuid,jsonb) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.qc_review_lead(uuid,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.qc_review_lead(uuid,text,text,text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.qc_move_lead(uuid,uuid,uuid,date,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.qc_move_lead(uuid,uuid,uuid,date,text,text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_company_operations_overview() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_company_operations_overview() TO authenticated;

REVOKE EXECUTE ON FUNCTION public.create_company_package(uuid,integer,numeric,numeric,date,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_company_package(uuid,integer,numeric,numeric,date,text,text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.update_company_package(uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_company_package(uuid,jsonb) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.create_company_onboarding_invite(text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_company_onboarding_invite(text,integer) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.prepare_company_end_of_day_notification(uuid,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.prepare_company_end_of_day_notification(uuid,date) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.portal_active_package(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.portal_complete_package_if_filled(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.portal_resolve_agent_id(text,jsonb) FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION public.sync_readymode_lead(uuid,text,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_readymode_lead(uuid,text,text,jsonb) TO service_role;

COMMIT;
