BEGIN;

ALTER FUNCTION public.save_company_package_admin(
  uuid, uuid, integer, numeric, date, uuid[], boolean
) SECURITY INVOKER;

ALTER FUNCTION public.record_company_package_payment(
  uuid, numeric, date, text, text, text
) SECURITY INVOKER;

ALTER FUNCTION public.complete_company_package_admin(uuid)
  SECURITY INVOKER;

COMMIT;
