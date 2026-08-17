BEGIN;

DROP POLICY IF EXISTS company_package_locations_admin_all
  ON public.company_package_locations;
DROP POLICY IF EXISTS company_package_locations_qc_select
  ON public.company_package_locations;

CREATE POLICY company_package_locations_qc_or_admin_select
ON public.company_package_locations
FOR SELECT TO authenticated
USING (public.portal_is_qc_or_admin());

CREATE POLICY company_package_locations_admin_insert
ON public.company_package_locations
FOR INSERT TO authenticated
WITH CHECK (public.portal_is_admin());

CREATE POLICY company_package_locations_admin_update
ON public.company_package_locations
FOR UPDATE TO authenticated
USING (public.portal_is_admin())
WITH CHECK (public.portal_is_admin());

CREATE POLICY company_package_locations_admin_delete
ON public.company_package_locations
FOR DELETE TO authenticated
USING (public.portal_is_admin());

COMMIT;
