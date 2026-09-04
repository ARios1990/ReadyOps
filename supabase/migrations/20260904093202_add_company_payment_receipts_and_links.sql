-- Company-facing payment links and private proof-of-payment uploads.

ALTER TABLE public.company_portal_settings
  ADD COLUMN IF NOT EXISTS stripe_payment_url text,
  ADD COLUMN IF NOT EXISTS paypal_payment_url text,
  ADD COLUMN IF NOT EXISTS other_payment_label text,
  ADD COLUMN IF NOT EXISTS other_payment_url text;

ALTER TABLE public.company_portal_settings
  DROP CONSTRAINT IF EXISTS company_portal_settings_stripe_payment_url_check,
  ADD CONSTRAINT company_portal_settings_stripe_payment_url_check
    CHECK (stripe_payment_url IS NULL OR stripe_payment_url ~ '^https://'),
  DROP CONSTRAINT IF EXISTS company_portal_settings_paypal_payment_url_check,
  ADD CONSTRAINT company_portal_settings_paypal_payment_url_check
    CHECK (paypal_payment_url IS NULL OR paypal_payment_url ~ '^https://'),
  DROP CONSTRAINT IF EXISTS company_portal_settings_other_payment_url_check,
  ADD CONSTRAINT company_portal_settings_other_payment_url_check
    CHECK (other_payment_url IS NULL OR other_payment_url ~ '^https://');

CREATE TABLE IF NOT EXISTS public.company_payment_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.roster_companies(id) ON DELETE CASCADE,
  package_id uuid REFERENCES public.company_packages(id) ON DELETE SET NULL,
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  payment_method text NOT NULL,
  reference text,
  notes text,
  storage_path text NOT NULL UNIQUE,
  file_name text NOT NULL,
  mime_type text NOT NULL,
  file_size bigint NOT NULL CHECK (file_size > 0 AND file_size <= 10485760),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'rejected')),
  uploaded_by text NOT NULL DEFAULT 'Company portal',
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.company_payment_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.company_payment_receipts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.company_payment_receipts TO service_role;

CREATE INDEX IF NOT EXISTS company_payment_receipts_company_created_idx
  ON public.company_payment_receipts(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS company_payment_receipts_package_idx
  ON public.company_payment_receipts(package_id)
  WHERE package_id IS NOT NULL;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'company-payment-receipts',
  'company-payment-receipts',
  false,
  10485760,
  ARRAY['application/pdf', 'image/png', 'image/jpeg', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE OR REPLACE FUNCTION public.get_company_payment_receipts(
  p_company_id uuid,
  p_access_token uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_company_id uuid;
BEGIN
  v_company_id := public.portal_resolve_company_access(p_company_id, p_access_token);

  RETURN coalesce((
    SELECT jsonb_agg(
      jsonb_build_object(
        'id', receipt.id,
        'package_id', receipt.package_id,
        'amount', receipt.amount,
        'payment_method', receipt.payment_method,
        'reference', receipt.reference,
        'notes', receipt.notes,
        'file_name', receipt.file_name,
        'mime_type', receipt.mime_type,
        'file_size', receipt.file_size,
        'status', receipt.status,
        'uploaded_by', receipt.uploaded_by,
        'created_at', receipt.created_at,
        'reviewed_at', receipt.reviewed_at
      ) ORDER BY receipt.created_at DESC
    )
    FROM public.company_payment_receipts AS receipt
    WHERE receipt.company_id = v_company_id
  ), '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.get_company_payment_receipts(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_company_payment_receipts(uuid, uuid) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.update_company_portal_settings(
  p_company_id uuid,
  p_access_token uuid,
  p_patch jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_company_id uuid;
  v_old public.company_portal_settings%ROWTYPE;
  v_new public.company_portal_settings%ROWTYPE;
  v_slug text;
BEGIN
  v_company_id := public.portal_resolve_company_access(p_company_id, p_access_token);
  SELECT * INTO v_old FROM public.company_portal_settings WHERE company_id = v_company_id FOR UPDATE;

  v_slug := CASE WHEN p_patch ? 'public_slug' THEN public.portal_slugify(p_patch->>'public_slug') ELSE v_old.public_slug END;
  IF v_slug = '' THEN RAISE EXCEPTION 'Public slug cannot be blank'; END IF;

  UPDATE public.company_portal_settings
  SET
    public_slug = v_slug,
    portal_enabled = CASE WHEN p_patch ? 'portal_enabled' THEN (p_patch->>'portal_enabled')::boolean ELSE portal_enabled END,
    allow_public_booking = CASE WHEN p_patch ? 'allow_public_booking' THEN (p_patch->>'allow_public_booking')::boolean ELSE allow_public_booking END,
    company_access_enabled = CASE WHEN p_patch ? 'company_access_enabled' THEN (p_patch->>'company_access_enabled')::boolean ELSE company_access_enabled END,
    timezone = CASE WHEN p_patch ? 'timezone' THEN coalesce(nullif(p_patch->>'timezone',''),'America/Chicago') ELSE timezone END,
    requirements_short = CASE WHEN p_patch ? 'requirements_short' THEN coalesce(p_patch->>'requirements_short','') ELSE requirements_short END,
    requirements_detail = CASE WHEN p_patch ? 'requirements_detail' THEN coalesce(p_patch->>'requirements_detail','') ELSE requirements_detail END,
    qualification_rules = CASE WHEN p_patch ? 'qualification_rules' THEN coalesce(p_patch->'qualification_rules',public.portal_default_qualification_rules()) ELSE qualification_rules END,
    form_mode = CASE WHEN p_patch ? 'form_mode' THEN p_patch->>'form_mode' ELSE form_mode END,
    form_schema = CASE WHEN p_patch ? 'form_schema' THEN coalesce(p_patch->'form_schema',public.portal_default_form_schema()) ELSE form_schema END,
    external_form_provider = CASE WHEN p_patch ? 'external_form_provider' THEN nullif(p_patch->>'external_form_provider','') ELSE external_form_provider END,
    external_form_url = CASE WHEN p_patch ? 'external_form_url' THEN nullif(p_patch->>'external_form_url','') ELSE external_form_url END,
    external_prefill_map = CASE WHEN p_patch ? 'external_prefill_map' THEN coalesce(p_patch->'external_prefill_map','{}'::jsonb) ELSE external_prefill_map END,
    external_submission_map = CASE WHEN p_patch ? 'external_submission_map' THEN coalesce(p_patch->'external_submission_map','{}'::jsonb) ELSE external_submission_map END,
    stripe_payment_url = CASE WHEN p_patch ? 'stripe_payment_url' THEN nullif(trim(p_patch->>'stripe_payment_url'), '') ELSE stripe_payment_url END,
    paypal_payment_url = CASE WHEN p_patch ? 'paypal_payment_url' THEN nullif(trim(p_patch->>'paypal_payment_url'), '') ELSE paypal_payment_url END,
    other_payment_label = CASE WHEN p_patch ? 'other_payment_label' THEN nullif(trim(p_patch->>'other_payment_label'), '') ELSE other_payment_label END,
    other_payment_url = CASE WHEN p_patch ? 'other_payment_url' THEN nullif(trim(p_patch->>'other_payment_url'), '') ELSE other_payment_url END,
    check_in_radius_m = CASE WHEN p_patch ? 'check_in_radius_m' THEN (p_patch->>'check_in_radius_m')::integer ELSE check_in_radius_m END,
    check_in_before_minutes = CASE WHEN p_patch ? 'check_in_before_minutes' THEN (p_patch->>'check_in_before_minutes')::integer ELSE check_in_before_minutes END,
    check_in_after_minutes = CASE WHEN p_patch ? 'check_in_after_minutes' THEN (p_patch->>'check_in_after_minutes')::integer ELSE check_in_after_minutes END
  WHERE company_id = v_company_id
  RETURNING * INTO v_new;

  PERFORM public.portal_write_audit(
    v_company_id,
    public.portal_actor_type_for_management(p_access_token),
    auth.uid(),
    public.portal_actor_name_for_management(),
    'portal_settings_updated','company_portal_settings',v_company_id,
    to_jsonb(v_old) - 'company_access_token' - 'external_webhook_secret',
    to_jsonb(v_new) - 'company_access_token' - 'external_webhook_secret',
    '{}'::jsonb
  );

  RETURN to_jsonb(v_new);
END;
$$;

REVOKE ALL ON FUNCTION public.update_company_portal_settings(uuid, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_company_portal_settings(uuid, uuid, jsonb) TO anon, authenticated, service_role;

COMMENT ON TABLE public.company_payment_receipts
  IS 'Private company-portal proof-of-payment uploads. Files are stored in the private company-payment-receipts bucket.';
COMMENT ON FUNCTION public.get_company_payment_receipts(uuid, uuid)
  IS 'Returns receipt metadata for a valid private company management link without exposing storage paths.';
