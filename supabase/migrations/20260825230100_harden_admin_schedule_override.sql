DROP POLICY IF EXISTS appointment_reschedule_history_admin_insert
ON public.appointment_reschedule_history;

CREATE POLICY appointment_reschedule_history_admin_insert
ON public.appointment_reschedule_history
FOR INSERT
TO authenticated
WITH CHECK ((SELECT public.portal_is_admin()));

ALTER FUNCTION public.qc_admin_override_schedule(uuid, date, text, text)
SECURITY INVOKER;

COMMENT ON FUNCTION public.qc_admin_override_schedule(uuid, date, text, text)
IS 'Admin-only audited date/time override. Runs with caller RLS permissions and preserves QC status and company delivery visibility.';
