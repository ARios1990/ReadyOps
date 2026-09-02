BEGIN;

ALTER TABLE public.company_packages
  ADD COLUMN IF NOT EXISTS amount_paid numeric(12,2) NOT NULL DEFAULT 0;

ALTER TABLE public.company_packages
  DROP CONSTRAINT IF EXISTS company_packages_payment_status_check;

UPDATE public.company_packages
SET
  package_total = round(lead_target::numeric * amount_per_lead, 2),
  amount_paid = CASE
    WHEN lower(payment_status) IN ('complete', 'completed', 'paid')
      THEN round(lead_target::numeric * amount_per_lead, 2)
    ELSE greatest(coalesce(amount_paid, 0), 0)
  END;

UPDATE public.company_packages
SET payment_status = CASE
  WHEN amount_paid <= 0 THEN 'unpaid'
  WHEN amount_paid < package_total THEN 'partial'
  ELSE 'paid'
END;

ALTER TABLE public.company_packages
  ADD CONSTRAINT company_packages_payment_status_check
  CHECK (payment_status IN ('unpaid', 'partial', 'paid')),
  DROP CONSTRAINT IF EXISTS company_packages_amount_paid_nonnegative_check,
  ADD CONSTRAINT company_packages_amount_paid_nonnegative_check
  CHECK (amount_paid >= 0);

CREATE TABLE IF NOT EXISTS public.company_package_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id uuid NOT NULL REFERENCES public.company_packages(id) ON DELETE CASCADE,
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  payment_date date NOT NULL DEFAULT CURRENT_DATE,
  method text,
  reference text,
  notes text,
  recorded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.company_package_payments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.company_package_payments FROM PUBLIC, anon, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.company_package_payments TO authenticated;

DROP POLICY IF EXISTS company_package_payments_admin_select
  ON public.company_package_payments;
CREATE POLICY company_package_payments_admin_select
ON public.company_package_payments
FOR SELECT TO authenticated
USING (
  coalesce(((SELECT auth.jwt())->>'is_anonymous')::boolean, false) = false
  AND (SELECT public.portal_is_admin())
);

DROP POLICY IF EXISTS company_package_payments_admin_insert
  ON public.company_package_payments;
CREATE POLICY company_package_payments_admin_insert
ON public.company_package_payments
FOR INSERT TO authenticated
WITH CHECK (
  coalesce(((SELECT auth.jwt())->>'is_anonymous')::boolean, false) = false
  AND (SELECT public.portal_is_admin())
);

DROP POLICY IF EXISTS company_package_payments_admin_update
  ON public.company_package_payments;
CREATE POLICY company_package_payments_admin_update
ON public.company_package_payments
FOR UPDATE TO authenticated
USING (
  coalesce(((SELECT auth.jwt())->>'is_anonymous')::boolean, false) = false
  AND (SELECT public.portal_is_admin())
)
WITH CHECK (
  coalesce(((SELECT auth.jwt())->>'is_anonymous')::boolean, false) = false
  AND (SELECT public.portal_is_admin())
);

DROP POLICY IF EXISTS company_package_payments_admin_delete
  ON public.company_package_payments;
CREATE POLICY company_package_payments_admin_delete
ON public.company_package_payments
FOR DELETE TO authenticated
USING (
  coalesce(((SELECT auth.jwt())->>'is_anonymous')::boolean, false) = false
  AND (SELECT public.portal_is_admin())
);

CREATE INDEX IF NOT EXISTS company_package_payments_package_date_idx
  ON public.company_package_payments(package_id, payment_date DESC, created_at DESC);

INSERT INTO public.company_package_payments(
  package_id, amount, payment_date, reference, notes, recorded_by
)
SELECT
  package.id,
  package.amount_paid,
  coalesce(package.payment_date, package.start_date, CURRENT_DATE),
  'Opening balance',
  'Migrated from the original package payment status.',
  package.created_by
FROM public.company_packages AS package
WHERE package.amount_paid > 0
  AND NOT EXISTS (
    SELECT 1
    FROM public.company_package_payments AS existing
    WHERE existing.package_id = package.id
  );

CREATE OR REPLACE FUNCTION private.normalize_company_package_financials()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_delivered integer := 0;
BEGIN
  IF NEW.lead_target IS NULL OR NEW.lead_target <= 0 THEN
    RAISE EXCEPTION 'Package leads must be greater than zero';
  END IF;
  IF NEW.amount_per_lead IS NULL OR NEW.amount_per_lead < 0 THEN
    RAISE EXCEPTION 'Price per lead cannot be negative';
  END IF;
  IF NEW.amount_paid IS NULL OR NEW.amount_paid < 0 THEN
    RAISE EXCEPTION 'Amount paid cannot be negative';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    v_delivered := public.readyops_delivered_lead_count(OLD.id);
    IF NEW.amount_per_lead IS DISTINCT FROM OLD.amount_per_lead
       AND v_delivered > 0
       AND NOT private.readyops_is_owner_admin() THEN
      RAISE EXCEPTION 'Price per lead is locked after delivery begins; owner override required';
    END IF;
    IF NEW.lead_target < v_delivered THEN
      RAISE EXCEPTION 'Package leads cannot be lower than the delivered lead count (%)', v_delivered;
    END IF;
  END IF;

  NEW.package_total := round(NEW.lead_target::numeric * NEW.amount_per_lead, 2);
  NEW.amount_paid := round(NEW.amount_paid, 2);
  NEW.payment_status := CASE
    WHEN NEW.amount_paid <= 0 THEN 'unpaid'
    WHEN NEW.amount_paid < NEW.package_total THEN 'partial'
    ELSE 'paid'
  END;
  IF NEW.amount_paid > 0 AND NEW.payment_date IS NULL THEN
    NEW.payment_date := CURRENT_DATE;
  ELSIF NEW.amount_paid = 0 THEN
    NEW.payment_date := NULL;
  END IF;
  IF NEW.status = 'active' AND v_delivered >= NEW.lead_target THEN
    NEW.status := 'completed';
    NEW.completed_at := coalesce(NEW.completed_at, now());
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION private.normalize_company_package_financials() FROM PUBLIC;

DROP TRIGGER IF EXISTS normalize_company_package_financials
  ON public.company_packages;
CREATE TRIGGER normalize_company_package_financials
BEFORE INSERT OR UPDATE OF lead_target, amount_per_lead, amount_paid, payment_date, status
ON public.company_packages
FOR EACH ROW
EXECUTE FUNCTION private.normalize_company_package_financials();

CREATE OR REPLACE FUNCTION private.sync_company_package_payment_total()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_package_id uuid;
BEGIN
  v_package_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.package_id ELSE NEW.package_id END;
  UPDATE public.company_packages AS package
  SET
    amount_paid = coalesce((
      SELECT sum(payment.amount)
      FROM public.company_package_payments AS payment
      WHERE payment.package_id = v_package_id
    ), 0),
    payment_date = (
      SELECT max(payment.payment_date)
      FROM public.company_package_payments AS payment
      WHERE payment.package_id = v_package_id
    )
  WHERE package.id = v_package_id;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION private.sync_company_package_payment_total() FROM PUBLIC;

DROP TRIGGER IF EXISTS sync_company_package_payment_total
  ON public.company_package_payments;
CREATE TRIGGER sync_company_package_payment_total
AFTER INSERT OR UPDATE OR DELETE ON public.company_package_payments
FOR EACH ROW
EXECUTE FUNCTION private.sync_company_package_payment_total();

CREATE OR REPLACE FUNCTION public.save_company_package_admin(
  p_company_id uuid,
  p_package_id uuid,
  p_lead_target integer,
  p_amount_per_lead numeric,
  p_start_date date,
  p_location_ids uuid[],
  p_override_price boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_package public.company_packages%ROWTYPE;
  v_before jsonb;
  v_delivered integer := 0;
  v_package_number integer;
BEGIN
  IF auth.uid() IS NULL OR NOT public.portal_is_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;
  IF p_lead_target IS NULL OR p_lead_target <= 0 THEN
    RAISE EXCEPTION 'Package leads must be greater than zero';
  END IF;
  IF p_amount_per_lead IS NULL OR p_amount_per_lead < 0 THEN
    RAISE EXCEPTION 'Price per lead cannot be negative';
  END IF;
  IF p_start_date IS NULL THEN
    RAISE EXCEPTION 'Start date is required';
  END IF;
  IF EXISTS (
    SELECT requested.location_id
    FROM unnest(coalesce(p_location_ids, '{}'::uuid[])) AS requested(location_id)
    EXCEPT
    SELECT location.id
    FROM public.company_locations AS location
    WHERE location.company_id = p_company_id AND location.active
  ) THEN
    RAISE EXCEPTION 'Every selected location must be active and belong to the company';
  END IF;

  PERFORM 1 FROM public.roster_companies WHERE id = p_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Company not found'; END IF;

  IF p_package_id IS NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.company_packages
      WHERE company_id = p_company_id AND status = 'active' AND archived_at IS NULL
    ) THEN
      RAISE EXCEPTION 'Complete the active package before creating another one';
    END IF;
    SELECT coalesce(max(package_number), 0) + 1
    INTO v_package_number
    FROM public.company_packages
    WHERE company_id = p_company_id;
    INSERT INTO public.company_packages(
      company_id, package_name, package_number, lead_target,
      amount_per_lead, package_total, amount_paid, payment_status,
      status, start_date, created_by
    ) VALUES (
      p_company_id, 'Lead Package', v_package_number, p_lead_target,
      p_amount_per_lead, 0, 0, 'unpaid', 'active', p_start_date, auth.uid()
    ) RETURNING * INTO v_package;
    v_before := NULL;
  ELSE
    SELECT * INTO v_package
    FROM public.company_packages
    WHERE id = p_package_id AND company_id = p_company_id AND archived_at IS NULL
    FOR UPDATE;
    IF v_package.id IS NULL THEN RAISE EXCEPTION 'Package not found'; END IF;
    IF v_package.status <> 'active' THEN RAISE EXCEPTION 'Only an active package can be edited'; END IF;
    v_before := to_jsonb(v_package);
    v_delivered := public.readyops_delivered_lead_count(v_package.id);
    IF p_amount_per_lead IS DISTINCT FROM v_package.amount_per_lead
       AND v_delivered > 0
       AND NOT (p_override_price AND private.readyops_is_owner_admin()) THEN
      RAISE EXCEPTION 'Price per lead is locked after delivery begins; owner override required';
    END IF;
    UPDATE public.company_packages
    SET lead_target = p_lead_target,
        amount_per_lead = p_amount_per_lead,
        start_date = p_start_date
    WHERE id = v_package.id
    RETURNING * INTO v_package;
  END IF;

  DELETE FROM public.company_package_locations WHERE package_id = v_package.id;
  INSERT INTO public.company_package_locations(package_id, location_id)
  SELECT v_package.id, selected.location_id
  FROM (
    SELECT DISTINCT unnest(coalesce(p_location_ids, '{}'::uuid[])) AS location_id
  ) AS selected;

  PERFORM public.portal_write_audit(
    p_company_id, 'admin', auth.uid(), public.portal_actor_name_for_management(),
    CASE WHEN p_package_id IS NULL THEN 'package_created' ELSE 'package_updated' END,
    'company_package', v_package.id, v_before, to_jsonb(v_package), '{}'::jsonb
  );

  v_delivered := public.readyops_delivered_lead_count(v_package.id);
  RETURN to_jsonb(v_package) || jsonb_build_object(
    'delivered_leads', v_delivered,
    'remaining_leads', greatest(v_package.lead_target - v_delivered, 0),
    'remaining_balance', greatest(v_package.package_total - v_package.amount_paid, 0),
    'completion_percentage', round(least(v_delivered::numeric / v_package.lead_target::numeric * 100, 100), 1)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.save_company_package_admin(
  uuid, uuid, integer, numeric, date, uuid[], boolean
) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.save_company_package_admin(
  uuid, uuid, integer, numeric, date, uuid[], boolean
) TO authenticated;

CREATE OR REPLACE FUNCTION public.record_company_package_payment(
  p_package_id uuid,
  p_amount numeric,
  p_payment_date date DEFAULT CURRENT_DATE,
  p_method text DEFAULT NULL,
  p_reference text DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_package public.company_packages%ROWTYPE;
  v_payment public.company_package_payments%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT public.portal_is_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Payment amount must be greater than zero';
  END IF;
  SELECT * INTO v_package
  FROM public.company_packages
  WHERE id = p_package_id AND archived_at IS NULL
  FOR UPDATE;
  IF v_package.id IS NULL THEN RAISE EXCEPTION 'Package not found'; END IF;

  INSERT INTO public.company_package_payments(
    package_id, amount, payment_date, method, reference, notes, recorded_by
  ) VALUES (
    p_package_id, p_amount, coalesce(p_payment_date, CURRENT_DATE),
    nullif(trim(coalesce(p_method, '')), ''),
    nullif(trim(coalesce(p_reference, '')), ''),
    nullif(trim(coalesce(p_notes, '')), ''), auth.uid()
  ) RETURNING * INTO v_payment;

  SELECT * INTO v_package FROM public.company_packages WHERE id = p_package_id;
  PERFORM public.portal_write_audit(
    v_package.company_id, 'admin', auth.uid(), public.portal_actor_name_for_management(),
    'package_payment_recorded', 'company_package', v_package.id, NULL,
    jsonb_build_object('payment', to_jsonb(v_payment), 'package', to_jsonb(v_package)),
    '{}'::jsonb
  );
  RETURN to_jsonb(v_package) || jsonb_build_object('payment', to_jsonb(v_payment));
END;
$function$;

REVOKE ALL ON FUNCTION public.record_company_package_payment(
  uuid, numeric, date, text, text, text
) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.record_company_package_payment(
  uuid, numeric, date, text, text, text
) TO authenticated;

CREATE OR REPLACE FUNCTION public.complete_company_package_admin(p_package_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_package public.company_packages%ROWTYPE;
  v_before jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.portal_is_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;
  SELECT * INTO v_package
  FROM public.company_packages
  WHERE id = p_package_id AND archived_at IS NULL
  FOR UPDATE;
  IF v_package.id IS NULL THEN RAISE EXCEPTION 'Package not found'; END IF;
  v_before := to_jsonb(v_package);
  UPDATE public.company_packages
  SET status = 'completed', completed_at = coalesce(completed_at, now())
  WHERE id = p_package_id
  RETURNING * INTO v_package;
  PERFORM public.portal_write_audit(
    v_package.company_id, 'admin', auth.uid(), public.portal_actor_name_for_management(),
    'package_completed', 'company_package', v_package.id,
    v_before, to_jsonb(v_package), '{}'::jsonb
  );
  RETURN to_jsonb(v_package);
END;
$function$;

REVOKE ALL ON FUNCTION public.complete_company_package_admin(uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.complete_company_package_admin(uuid)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.portal_complete_package_if_filled(p_package_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_target integer;
  v_count integer;
BEGIN
  IF p_package_id IS NULL THEN RETURN; END IF;
  SELECT lead_target INTO v_target
  FROM public.company_packages
  WHERE id = p_package_id AND status = 'active';
  IF v_target IS NULL THEN RETURN; END IF;
  v_count := public.readyops_delivered_lead_count(p_package_id);
  IF v_count >= v_target THEN
    UPDATE public.company_packages
    SET status = 'completed', completed_at = coalesce(completed_at, now())
    WHERE id = p_package_id AND status = 'active';
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.portal_complete_package_if_filled(uuid)
  FROM PUBLIC, anon, authenticated;

UPDATE public.company_packages AS package
SET status = 'completed', completed_at = coalesce(package.completed_at, now())
WHERE package.status = 'active'
  AND public.readyops_delivered_lead_count(package.id) >= package.lead_target;

CREATE OR REPLACE FUNCTION public.get_company_management_dashboard_summary(
  p_company_id uuid,
  p_access_token uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_company public.roster_companies%ROWTYPE;
  v_package public.company_packages%ROWTYPE;
  v_total integer := 0;
  v_good integer := 0;
  v_signed integer := 0;
  v_no_show integer := 0;
  v_bad integer := 0;
  v_rescheduled integer := 0;
  v_pending integer := 0;
  v_delivered integer := 0;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.company_portal_settings AS setting
    WHERE setting.company_id = p_company_id
      AND setting.company_access_enabled
      AND setting.company_access_token = p_access_token
  ) THEN
    RAISE EXCEPTION 'Invalid or disabled company management link';
  END IF;
  SELECT * INTO v_company FROM public.roster_companies WHERE id = p_company_id;
  SELECT
    count(DISTINCT appointment.id),
    count(DISTINCT appointment.id) FILTER (WHERE appointment.canonical_status = 'good_inspected' OR appointment.client_status IN ('good','inspected','good_inspected') OR appointment.company_action IN ('good','inspected','good_inspected')),
    count(DISTINCT appointment.id) FILTER (WHERE appointment.canonical_status = 'signed_contract' OR appointment.client_status IN ('signed','signed_contract') OR appointment.company_action IN ('signed','signed_contract')),
    count(DISTINCT appointment.id) FILTER (WHERE appointment.canonical_status = 'no_show' OR appointment.client_status = 'no_show' OR appointment.company_action = 'no_show'),
    count(DISTINCT appointment.id) FILTER (WHERE appointment.canonical_status = 'bad' OR appointment.client_status IN ('bad','cancelled','canceled','lost') OR appointment.company_action IN ('bad','cancelled','canceled','lost')),
    count(DISTINCT appointment.id) FILTER (WHERE appointment.canonical_status IN ('rescheduled','reschedule') OR appointment.client_status IN ('rescheduled','reschedule') OR appointment.company_action IN ('rescheduled','reschedule')),
    count(DISTINCT appointment.id) FILTER (WHERE coalesce(appointment.company_action,'pending') = 'pending' AND coalesce(appointment.canonical_status,'pending') NOT IN ('good_inspected','signed_contract','no_show','bad','rescheduled','reschedule'))
  INTO v_total, v_good, v_signed, v_no_show, v_bad, v_rescheduled, v_pending
  FROM public.portal_appointments AS appointment
  JOIN public.portal_leads AS lead ON lead.id = appointment.lead_id
  WHERE appointment.company_id = p_company_id
    AND lead.qc_status = 'approved'
    AND appointment.company_visible_at IS NOT NULL
    AND appointment.status NOT IN ('draft','qc_pending','qc_denied');

  SELECT * INTO v_package
  FROM public.company_packages AS package
  WHERE package.company_id = p_company_id
    AND package.status IN ('active', 'completed')
    AND package.archived_at IS NULL
  ORDER BY CASE WHEN package.status = 'active' THEN 0 ELSE 1 END,
    package.package_number DESC NULLS LAST, package.created_at DESC
  LIMIT 1;
  IF v_package.id IS NOT NULL THEN
    v_delivered := public.readyops_delivered_lead_count(v_package.id);
  END IF;

  RETURN jsonb_build_object(
    'company', jsonb_build_object('id',v_company.id,'name',v_company.name,'state',v_company.state,'logo_path',v_company.logo_path),
    'performance', jsonb_build_object(
      'total_leads',v_total,'good_inspected',v_good,'signed_contracts',v_signed,
      'no_shows',v_no_show,'bad_leads',v_bad,'rescheduled',v_rescheduled,
      'pending_updates',v_pending,
      'inspection_rate',CASE WHEN v_total=0 THEN 0 ELSE round(((v_good+v_signed)::numeric/v_total::numeric)*100,1) END,
      'close_rate',CASE WHEN (v_good+v_signed)=0 THEN 0 ELSE round((v_signed::numeric/(v_good+v_signed)::numeric)*100,1) END
    ),
    'active_package', CASE WHEN v_package.id IS NULL THEN NULL ELSE to_jsonb(v_package) || jsonb_build_object(
      'delivered_leads',v_delivered,
      'remaining_leads',greatest(v_package.lead_target-v_delivered,0),
      'remaining_balance',greatest(v_package.package_total-v_package.amount_paid,0),
      'completion_date',v_package.completed_at::date,
      'completion_percentage',CASE WHEN v_package.lead_target=0 THEN 0 ELSE round(least(v_delivered::numeric/v_package.lead_target::numeric*100,100),1) END
    ) END,
    'package_history',coalesce((
      SELECT jsonb_agg(to_jsonb(history) || jsonb_build_object(
        'delivered_leads',public.readyops_delivered_lead_count(history.id),
        'remaining_balance',greatest(history.package_total-history.amount_paid,0),
        'completion_date',history.completed_at::date
      ) ORDER BY history.package_number DESC NULLS LAST,history.created_at DESC)
      FROM public.company_packages AS history
      WHERE history.company_id=p_company_id AND history.archived_at IS NULL
    ),'[]'::jsonb),
    'last_updated_at',greatest(
      coalesce((SELECT max(appointment.updated_at) FROM public.portal_appointments AS appointment WHERE appointment.company_id=p_company_id),'-infinity'::timestamptz),
      coalesce((SELECT max(package.updated_at) FROM public.company_packages AS package WHERE package.company_id=p_company_id),now())
    )
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_company_management_dashboard_summary(uuid, uuid)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_company_management_dashboard_summary(uuid, uuid)
  TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.submit_company_onboarding(
  p_invite_slug text,
  p_invite_token uuid,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_invite public.company_onboarding_invites%ROWTYPE;
  v_company public.roster_companies%ROWTYPE;
  v_slug text;
  v_location uuid;
  i integer;
BEGIN
  SELECT * INTO v_invite
  FROM public.company_onboarding_invites
  WHERE invite_slug = p_invite_slug
    AND invite_token = p_invite_token
    AND active
    AND submitted_at IS NULL
    AND (expires_at IS NULL OR expires_at > now())
  FOR UPDATE;
  IF v_invite.id IS NULL THEN RAISE EXCEPTION 'Invite is invalid or expired'; END IF;
  IF nullif(trim(coalesce(p_payload->>'name','')), '') IS NULL THEN
    RAISE EXCEPTION 'Company name is required';
  END IF;

  INSERT INTO public.roster_companies(
    name, state, contact_name, phone, email, website,
    requirements_note, notes, account_status
  ) VALUES (
    trim(p_payload->>'name'),
    nullif(trim(coalesce(p_payload->>'state','')), ''),
    nullif(trim(coalesce(p_payload->>'contact_name','')), ''),
    nullif(trim(coalesce(p_payload->>'phone','')), ''),
    nullif(lower(trim(coalesce(p_payload->>'email',''))), ''),
    nullif(trim(coalesce(p_payload->>'website','')), ''),
    nullif(trim(coalesce(p_payload->>'requirements','')), ''),
    nullif(trim(coalesce(p_payload->>'notes','')), ''),
    'Active'
  ) RETURNING * INTO v_company;

  v_slug := public.portal_slugify(v_company.name) || '-' || substr(v_company.id::text, 1, 6);
  INSERT INTO public.company_portal_settings(
    company_id, public_slug, portal_enabled, allow_public_booking,
    requirements_short, requirements_detail, form_mode
  ) VALUES (
    v_company.id, v_slug, true, true,
    coalesce(p_payload->>'requirements',''), '', 'internal'
  ) ON CONFLICT(company_id) DO NOTHING;

  IF nullif(trim(coalesce(p_payload->>'location','')), '') IS NOT NULL THEN
    INSERT INTO public.company_locations(company_id, location_label, state)
    VALUES (
      v_company.id,
      trim(p_payload->>'location'),
      nullif(trim(coalesce(p_payload->>'state','')), '')
    ) RETURNING id INTO v_location;
  END IF;

  FOR i IN 0..6 LOOP
    INSERT INTO public.company_schedule_rules(
      company_id, day_of_week, is_open, start_time, end_time,
      slot_minutes, max_per_slot, max_per_day
    ) VALUES (
      v_company.id, i, CASE WHEN i = 0 THEN false ELSE true END,
      '09:00', '18:00', 60, 1, 9
    ) ON CONFLICT DO NOTHING;
  END LOOP;

  UPDATE public.company_onboarding_invites
  SET active = false, submitted_at = now(), company_id = v_company.id
  WHERE id = v_invite.id;

  RETURN jsonb_build_object(
    'company_id', v_company.id,
    'company_name', v_company.name,
    'public_slug', v_slug,
    'agent_link', '/book/' || v_slug,
    'company_link', '/company/' || v_slug || '/manage/' || (
      SELECT company_access_token
      FROM public.company_portal_settings
      WHERE company_id = v_company.id
    )
  );
END;
$function$;

COMMENT ON FUNCTION public.submit_company_onboarding(text, uuid, jsonb)
  IS 'Creates the company profile from a private invite; package pricing and payments remain admin-managed.';

COMMENT ON COLUMN public.company_packages.amount_paid
  IS 'Admin-managed package payments received; synchronized from company_package_payments.';
COMMENT ON FUNCTION public.save_company_package_admin(uuid, uuid, integer, numeric, date, uuid[], boolean)
  IS 'Creates or updates an active lead package, calculates its total, and enforces the delivery-time price lock.';
COMMENT ON FUNCTION public.record_company_package_payment(uuid, numeric, date, text, text, text)
  IS 'Admin-only append-only package payment recorder that updates the package balance and status.';

COMMIT;
