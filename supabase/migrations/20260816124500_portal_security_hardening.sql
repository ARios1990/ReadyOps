BEGIN;

/* Masters Ready Scheduler portal security hardening. */

DROP POLICY IF EXISTS portal_settings_admin_all ON public.company_portal_settings;
DROP POLICY IF EXISTS representatives_admin_all ON public.company_representatives;
DROP POLICY IF EXISTS schedule_exceptions_admin_all ON public.company_schedule_exceptions;
DROP POLICY IF EXISTS schedule_rules_admin_all ON public.company_schedule_rules;
DROP POLICY IF EXISTS company_portal_settings_admin_all ON public.company_portal_settings;
DROP POLICY IF EXISTS company_schedule_rules_admin_all ON public.company_schedule_rules;
DROP POLICY IF EXISTS company_schedule_exceptions_admin_all ON public.company_schedule_exceptions;
DROP POLICY IF EXISTS company_representatives_admin_all ON public.company_representatives;
DROP POLICY IF EXISTS portal_leads_admin_all ON public.portal_leads;
DROP POLICY IF EXISTS appointment_reservations_admin_all ON public.appointment_reservations;
DROP POLICY IF EXISTS portal_appointments_admin_all ON public.portal_appointments;
DROP POLICY IF EXISTS appointment_checkins_admin_all ON public.appointment_checkins;
DROP POLICY IF EXISTS portal_audit_logs_admin_all ON public.portal_audit_logs;
DROP POLICY IF EXISTS external_form_events_admin_all ON public.external_form_events;

CREATE POLICY company_portal_settings_admin_select ON public.company_portal_settings FOR SELECT TO authenticated USING (public.portal_is_admin());
CREATE POLICY company_portal_settings_admin_insert ON public.company_portal_settings FOR INSERT TO authenticated WITH CHECK (public.portal_is_admin());
CREATE POLICY company_portal_settings_admin_update ON public.company_portal_settings FOR UPDATE TO authenticated USING (public.portal_is_admin()) WITH CHECK (public.portal_is_admin());
CREATE POLICY company_portal_settings_admin_delete ON public.company_portal_settings FOR DELETE TO authenticated USING (public.portal_is_admin());

CREATE POLICY company_schedule_rules_admin_select ON public.company_schedule_rules FOR SELECT TO authenticated USING (public.portal_is_admin());
CREATE POLICY company_schedule_rules_admin_insert ON public.company_schedule_rules FOR INSERT TO authenticated WITH CHECK (public.portal_is_admin());
CREATE POLICY company_schedule_rules_admin_update ON public.company_schedule_rules FOR UPDATE TO authenticated USING (public.portal_is_admin()) WITH CHECK (public.portal_is_admin());
CREATE POLICY company_schedule_rules_admin_delete ON public.company_schedule_rules FOR DELETE TO authenticated USING (public.portal_is_admin());

CREATE POLICY company_schedule_exceptions_admin_select ON public.company_schedule_exceptions FOR SELECT TO authenticated USING (public.portal_is_admin());
CREATE POLICY company_schedule_exceptions_admin_insert ON public.company_schedule_exceptions FOR INSERT TO authenticated WITH CHECK (public.portal_is_admin());
CREATE POLICY company_schedule_exceptions_admin_update ON public.company_schedule_exceptions FOR UPDATE TO authenticated USING (public.portal_is_admin()) WITH CHECK (public.portal_is_admin());
CREATE POLICY company_schedule_exceptions_admin_delete ON public.company_schedule_exceptions FOR DELETE TO authenticated USING (public.portal_is_admin());

CREATE POLICY company_representatives_admin_select ON public.company_representatives FOR SELECT TO authenticated USING (public.portal_is_admin());
CREATE POLICY company_representatives_admin_insert ON public.company_representatives FOR INSERT TO authenticated WITH CHECK (public.portal_is_admin());
CREATE POLICY company_representatives_admin_update ON public.company_representatives FOR UPDATE TO authenticated USING (public.portal_is_admin()) WITH CHECK (public.portal_is_admin());
CREATE POLICY company_representatives_admin_delete ON public.company_representatives FOR DELETE TO authenticated USING (public.portal_is_admin());

CREATE POLICY portal_leads_admin_select ON public.portal_leads FOR SELECT TO authenticated USING (public.portal_is_admin());
CREATE POLICY portal_leads_admin_insert ON public.portal_leads FOR INSERT TO authenticated WITH CHECK (public.portal_is_admin());
CREATE POLICY portal_leads_admin_update ON public.portal_leads FOR UPDATE TO authenticated USING (public.portal_is_admin()) WITH CHECK (public.portal_is_admin());
CREATE POLICY portal_leads_admin_delete ON public.portal_leads FOR DELETE TO authenticated USING (public.portal_is_admin());

CREATE POLICY appointment_reservations_admin_select ON public.appointment_reservations FOR SELECT TO authenticated USING (public.portal_is_admin());
CREATE POLICY appointment_reservations_admin_insert ON public.appointment_reservations FOR INSERT TO authenticated WITH CHECK (public.portal_is_admin());
CREATE POLICY appointment_reservations_admin_update ON public.appointment_reservations FOR UPDATE TO authenticated USING (public.portal_is_admin()) WITH CHECK (public.portal_is_admin());
CREATE POLICY appointment_reservations_admin_delete ON public.appointment_reservations FOR DELETE TO authenticated USING (public.portal_is_admin());

CREATE POLICY portal_appointments_admin_select ON public.portal_appointments FOR SELECT TO authenticated USING (public.portal_is_admin());
CREATE POLICY portal_appointments_admin_insert ON public.portal_appointments FOR INSERT TO authenticated WITH CHECK (public.portal_is_admin());
CREATE POLICY portal_appointments_admin_update ON public.portal_appointments FOR UPDATE TO authenticated USING (public.portal_is_admin()) WITH CHECK (public.portal_is_admin());
CREATE POLICY portal_appointments_admin_delete ON public.portal_appointments FOR DELETE TO authenticated USING (public.portal_is_admin());

CREATE POLICY appointment_checkins_admin_select ON public.appointment_checkins FOR SELECT TO authenticated USING (public.portal_is_admin());
CREATE POLICY appointment_checkins_admin_insert ON public.appointment_checkins FOR INSERT TO authenticated WITH CHECK (public.portal_is_admin());
CREATE POLICY appointment_checkins_admin_update ON public.appointment_checkins FOR UPDATE TO authenticated USING (public.portal_is_admin()) WITH CHECK (public.portal_is_admin());
CREATE POLICY appointment_checkins_admin_delete ON public.appointment_checkins FOR DELETE TO authenticated USING (public.portal_is_admin());

CREATE POLICY portal_audit_logs_admin_select ON public.portal_audit_logs FOR SELECT TO authenticated USING (public.portal_is_admin());
CREATE POLICY external_form_events_admin_select ON public.external_form_events FOR SELECT TO authenticated USING (public.portal_is_admin());

CREATE OR REPLACE FUNCTION public.portal_prevent_evidence_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION '% records are immutable and cannot be updated or deleted', TG_TABLE_NAME;
END;
$$;

DROP TRIGGER IF EXISTS portal_audit_logs_immutable ON public.portal_audit_logs;
CREATE TRIGGER portal_audit_logs_immutable
BEFORE UPDATE OR DELETE ON public.portal_audit_logs
FOR EACH ROW EXECUTE FUNCTION public.portal_prevent_evidence_mutation();

DROP TRIGGER IF EXISTS external_form_events_immutable ON public.external_form_events;
CREATE TRIGGER external_form_events_immutable
BEFORE UPDATE OR DELETE ON public.external_form_events
FOR EACH ROW EXECUTE FUNCTION public.portal_prevent_evidence_mutation();

REVOKE ALL ON TABLE public.company_portal_settings FROM anon;
REVOKE ALL ON TABLE public.company_schedule_rules FROM anon;
REVOKE ALL ON TABLE public.company_schedule_exceptions FROM anon;
REVOKE ALL ON TABLE public.company_representatives FROM anon;
REVOKE ALL ON TABLE public.portal_leads FROM anon;
REVOKE ALL ON TABLE public.appointment_reservations FROM anon;
REVOKE ALL ON TABLE public.portal_appointments FROM anon;
REVOKE ALL ON TABLE public.appointment_checkins FROM anon;
REVOKE ALL ON TABLE public.portal_audit_logs FROM anon;
REVOKE ALL ON TABLE public.external_form_events FROM anon;

GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE public.company_portal_settings TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE public.company_schedule_rules TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE public.company_schedule_exceptions TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE public.company_representatives TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE public.portal_leads TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE public.appointment_reservations TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE public.portal_appointments TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE public.appointment_checkins TO authenticated;
REVOKE INSERT,UPDATE,DELETE ON TABLE public.portal_audit_logs FROM authenticated;
GRANT SELECT ON TABLE public.portal_audit_logs TO authenticated;
REVOKE INSERT,UPDATE,DELETE ON TABLE public.external_form_events FROM authenticated;
GRANT SELECT ON TABLE public.external_form_events TO authenticated;

CREATE OR REPLACE FUNCTION public.regenerate_external_webhook_secret(
  p_company_id uuid,
  p_access_token uuid
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_company_id uuid;
  v_new_secret uuid := gen_random_uuid();
BEGIN
  v_company_id := public.portal_resolve_company_access(p_company_id,p_access_token);
  UPDATE public.company_portal_settings
  SET external_webhook_secret=v_new_secret
  WHERE company_id=v_company_id;
  PERFORM public.portal_write_audit(
    v_company_id,
    public.portal_actor_type_for_management(p_access_token),
    auth.uid(),
    public.portal_actor_name_for_management(),
    'external_webhook_secret_regenerated',
    'company_portal_settings',
    v_company_id,
    NULL,NULL,'{}'::jsonb
  );
  RETURN v_new_secret;
END;
$$;

GRANT EXECUTE ON FUNCTION public.regenerate_external_webhook_secret(uuid,uuid) TO anon,authenticated;

ALTER FUNCTION public.get_public_booking_portal(text,uuid,date,date) SET search_path=public,pg_temp;
ALTER FUNCTION public.reserve_public_appointment_slot(text,uuid,date,text,uuid,text) SET search_path=public,pg_temp;
ALTER FUNCTION public.refresh_public_reservation(uuid,uuid) SET search_path=public,pg_temp;
ALTER FUNCTION public.undo_public_reservation_action(uuid,uuid) SET search_path=public,pg_temp;
ALTER FUNCTION public.move_public_reservation_slot(uuid,uuid,uuid,date,text) SET search_path=public,pg_temp;
ALTER FUNCTION public.submit_public_appointment(uuid,uuid,jsonb,text) SET search_path=public,pg_temp;
ALTER FUNCTION public.reschedule_public_appointment(uuid,uuid,date,text,text) SET search_path=public,pg_temp;
ALTER FUNCTION public.mark_external_form_opened(uuid) SET search_path=public,pg_temp;
ALTER FUNCTION public.get_company_management_portal(uuid,uuid,date,date) SET search_path=public,pg_temp;
ALTER FUNCTION public.update_company_portal_settings(uuid,uuid,jsonb) SET search_path=public,pg_temp;
ALTER FUNCTION public.regenerate_company_access_token(uuid,uuid) SET search_path=public,pg_temp;
ALTER FUNCTION public.regenerate_external_webhook_secret(uuid,uuid) SET search_path=public,pg_temp;
ALTER FUNCTION public.upsert_company_schedule_rule(uuid,uuid,jsonb) SET search_path=public,pg_temp;
ALTER FUNCTION public.create_company_schedule_exception(uuid,uuid,jsonb) SET search_path=public,pg_temp;
ALTER FUNCTION public.delete_company_schedule_exception(uuid,uuid,uuid) SET search_path=public,pg_temp;
ALTER FUNCTION public.create_company_representative(uuid,uuid,jsonb) SET search_path=public,pg_temp;
ALTER FUNCTION public.update_company_representative(uuid,uuid,uuid,jsonb) SET search_path=public,pg_temp;
ALTER FUNCTION public.assign_appointment_representative(uuid,uuid,uuid,uuid) SET search_path=public,pg_temp;
ALTER FUNCTION public.company_update_appointment_status(uuid,uuid,uuid,text) SET search_path=public,pg_temp;
ALTER FUNCTION public.get_representative_portal(uuid,date,date) SET search_path=public,pg_temp;
ALTER FUNCTION public.representative_update_appointment(uuid,uuid,text,text) SET search_path=public,pg_temp;
ALTER FUNCTION public.representative_check_in(uuid,uuid,double precision,double precision,double precision,text) SET search_path=public,pg_temp;
ALTER FUNCTION public.sync_external_form_submission(uuid,uuid,text,text,jsonb) SET search_path=public,pg_temp;

COMMIT;
