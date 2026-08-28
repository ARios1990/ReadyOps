-- Imported from the hosted ReadyOp Supabase migration history on 2026-08-28.
-- Schema only: no production table data is included.

BEGIN;

/* Authenticated Admin/QC-only RPCs: remove anonymous execute permission. */
REVOKE EXECUTE ON FUNCTION public.get_qc_queue(date,date,uuid,text) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_qc_queue(date,date,uuid,text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_qc_reference_data() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_qc_reference_data() TO authenticated;

REVOKE EXECUTE ON FUNCTION public.qc_update_lead(uuid,jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.qc_update_lead(uuid,jsonb) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.qc_review_lead(uuid,text,text,text) FROM anon;
GRANT EXECUTE ON FUNCTION public.qc_review_lead(uuid,text,text,text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.qc_move_lead(uuid,uuid,uuid,date,text,text) FROM anon;
GRANT EXECUTE ON FUNCTION public.qc_move_lead(uuid,uuid,uuid,date,text,text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_company_operations_overview() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_company_operations_overview() TO authenticated;

REVOKE EXECUTE ON FUNCTION public.create_company_package(uuid,integer,numeric,numeric,date,text,text) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_company_package(uuid,integer,numeric,numeric,date,text,text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.update_company_package(uuid,jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_company_package(uuid,jsonb) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.create_company_onboarding_invite(text,integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_company_onboarding_invite(text,integer) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.prepare_company_end_of_day_notification(uuid,date) FROM anon;
GRANT EXECUTE ON FUNCTION public.prepare_company_end_of_day_notification(uuid,date) TO authenticated;

/* Internal helper RPCs are never intended to be called by browser clients. */
REVOKE EXECUTE ON FUNCTION public.portal_active_package(uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.portal_complete_package_if_filled(uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.portal_resolve_agent_id(text,jsonb) FROM anon, authenticated;

/* ReadyMode synchronization is only called by the service-role Edge Function. */
REVOKE EXECUTE ON FUNCTION public.sync_readymode_lead(uuid,text,text,jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_readymode_lead(uuid,text,text,jsonb) TO service_role;

/* Scope the new table policies explicitly to signed-in staff. */
DROP POLICY IF EXISTS company_packages_admin_qc_select ON public.company_packages;
CREATE POLICY company_packages_admin_qc_select ON public.company_packages
  FOR SELECT TO authenticated USING (public.portal_is_qc_or_admin());
DROP POLICY IF EXISTS company_packages_admin_all ON public.company_packages;
CREATE POLICY company_packages_admin_all ON public.company_packages
  FOR ALL TO authenticated USING (public.portal_is_admin()) WITH CHECK (public.portal_is_admin());

DROP POLICY IF EXISTS onboarding_invites_admin_all ON public.company_onboarding_invites;
CREATE POLICY onboarding_invites_admin_all ON public.company_onboarding_invites
  FOR ALL TO authenticated USING (public.portal_is_admin()) WITH CHECK (public.portal_is_admin());

DROP POLICY IF EXISTS notification_batches_admin_qc_select ON public.company_notification_batches;
CREATE POLICY notification_batches_admin_qc_select ON public.company_notification_batches
  FOR SELECT TO authenticated USING (public.portal_is_qc_or_admin());
DROP POLICY IF EXISTS notification_batches_admin_qc_insert ON public.company_notification_batches;
CREATE POLICY notification_batches_admin_qc_insert ON public.company_notification_batches
  FOR INSERT TO authenticated WITH CHECK (public.portal_is_qc_or_admin());
DROP POLICY IF EXISTS notification_batches_admin_update ON public.company_notification_batches;
CREATE POLICY notification_batches_admin_update ON public.company_notification_batches
  FOR UPDATE TO authenticated USING (public.portal_is_admin()) WITH CHECK (public.portal_is_admin());

DROP POLICY IF EXISTS readymode_settings_admin_select ON public.readymode_integration_settings;
CREATE POLICY readymode_settings_admin_select ON public.readymode_integration_settings
  FOR SELECT TO authenticated USING (public.portal_is_admin());

COMMIT;
