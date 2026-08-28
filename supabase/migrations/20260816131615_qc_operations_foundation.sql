-- Imported from the hosted ReadyOp Supabase migration history on 2026-08-28.
-- Schema only: no production table data is included.

BEGIN;

ALTER TABLE public.agents
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS portal_slug text,
  ADD COLUMN IF NOT EXISTS access_token uuid DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;

UPDATE public.agents
SET portal_slug = public.portal_slugify(name) || '-' || substr(id::text,1,6)
WHERE portal_slug IS NULL OR portal_slug = '';

UPDATE public.agents SET access_token = gen_random_uuid() WHERE access_token IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS agents_portal_slug_uidx ON public.agents(portal_slug);
CREATE UNIQUE INDEX IF NOT EXISTS agents_access_token_uidx ON public.agents(access_token);

CREATE TABLE IF NOT EXISTS public.company_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.roster_companies(id) ON DELETE CASCADE,
  package_name text NOT NULL DEFAULT 'Lead Package',
  lead_target integer NOT NULL CHECK (lead_target > 0),
  amount_per_lead numeric(12,2) NOT NULL DEFAULT 0 CHECK (amount_per_lead >= 0),
  package_total numeric(12,2) NOT NULL DEFAULT 0 CHECK (package_total >= 0),
  payment_date date,
  payment_status text NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending','complete')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','cancelled')),
  start_date date NOT NULL DEFAULT current_date,
  completed_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS company_packages_company_status_idx ON public.company_packages(company_id,status);

CREATE TABLE IF NOT EXISTS public.company_onboarding_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invite_token uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  invite_slug text NOT NULL UNIQUE,
  company_name_hint text,
  active boolean NOT NULL DEFAULT true,
  expires_at timestamptz,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz,
  company_id uuid REFERENCES public.roster_companies(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS public.company_notification_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.roster_companies(id) ON DELETE CASCADE,
  notification_date date NOT NULL,
  notification_type text NOT NULL CHECK (notification_type IN ('end_of_day','same_day')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','queued','sent','failed')),
  recipient_email text,
  lead_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  lead_count integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  error_message text
);

CREATE INDEX IF NOT EXISTS company_notification_batches_lookup_idx
  ON public.company_notification_batches(company_id,notification_date,notification_type,status);

ALTER TABLE public.portal_leads
  ADD COLUMN IF NOT EXISTS agent_id uuid REFERENCES public.agents(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS package_id uuid REFERENCES public.company_packages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS original_company_id uuid REFERENCES public.roster_companies(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS qc_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS qc_reason text,
  ADD COLUMN IF NOT EXISTS qc_notes text,
  ADD COLUMN IF NOT EXISTS qc_reviewed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS qc_reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'ready_ops',
  ADD COLUMN IF NOT EXISTS source_lead_id text,
  ADD COLUMN IF NOT EXISTS source_disposition text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname='portal_leads_qc_status_check'
  ) THEN
    ALTER TABLE public.portal_leads ADD CONSTRAINT portal_leads_qc_status_check
      CHECK (qc_status IN ('pending','approved','denied'));
  END IF;
END $$;

UPDATE public.portal_leads
SET original_company_id = company_id
WHERE original_company_id IS NULL;

UPDATE public.portal_leads l
SET agent_id = p.agent_id
FROM public.profiles p
WHERE l.agent_id IS NULL AND l.agent_profile_id = p.id AND p.agent_id IS NOT NULL;

UPDATE public.portal_leads l
SET agent_id = a.id
FROM public.agents a
WHERE l.agent_id IS NULL AND lower(trim(l.agent_name)) = lower(trim(a.name));

ALTER TABLE public.portal_appointments
  ADD COLUMN IF NOT EXISTS inspector_notes text,
  ADD COLUMN IF NOT EXISTS company_visible_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_company_update_at timestamptz;

ALTER TABLE public.portal_appointments DROP CONSTRAINT IF EXISTS portal_appointments_status_check;
ALTER TABLE public.portal_appointments ADD CONSTRAINT portal_appointments_status_check
  CHECK (status IN ('draft','qc_pending','qc_denied','confirmed','assigned','cancelled','rescheduled','completed'));

-- Preserve the one existing record as historically approved; all future submissions start pending.
UPDATE public.portal_leads SET qc_status='approved', qc_reviewed_at=coalesce(qc_reviewed_at,created_at)
WHERE created_at < now() AND qc_status='pending';
UPDATE public.portal_appointments a SET company_visible_at=coalesce(company_visible_at,a.created_at)
FROM public.portal_leads l WHERE l.id=a.lead_id AND l.qc_status='approved' AND a.company_visible_at IS NULL;

CREATE INDEX IF NOT EXISTS portal_leads_qc_idx ON public.portal_leads(qc_status,company_id,created_at);
CREATE INDEX IF NOT EXISTS portal_leads_agent_idx ON public.portal_leads(agent_id,created_at);
CREATE INDEX IF NOT EXISTS portal_leads_package_idx ON public.portal_leads(package_id,qc_status);
CREATE UNIQUE INDEX IF NOT EXISTS portal_leads_source_unique_idx
  ON public.portal_leads(source,source_lead_id)
  WHERE source_lead_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.portal_is_qc_or_admin()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path=public,pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id=auth.uid() AND p.role IN ('admin','qc')
  );
$$;

ALTER TABLE public.company_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_onboarding_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_notification_batches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS company_packages_admin_qc_select ON public.company_packages;
CREATE POLICY company_packages_admin_qc_select ON public.company_packages FOR SELECT
USING (public.portal_is_qc_or_admin());
DROP POLICY IF EXISTS company_packages_admin_all ON public.company_packages;
CREATE POLICY company_packages_admin_all ON public.company_packages FOR ALL
USING (public.portal_is_admin()) WITH CHECK (public.portal_is_admin());

DROP POLICY IF EXISTS onboarding_invites_admin_all ON public.company_onboarding_invites;
CREATE POLICY onboarding_invites_admin_all ON public.company_onboarding_invites FOR ALL
USING (public.portal_is_admin()) WITH CHECK (public.portal_is_admin());

DROP POLICY IF EXISTS notification_batches_admin_qc_select ON public.company_notification_batches;
CREATE POLICY notification_batches_admin_qc_select ON public.company_notification_batches FOR SELECT
USING (public.portal_is_qc_or_admin());
DROP POLICY IF EXISTS notification_batches_admin_qc_insert ON public.company_notification_batches;
CREATE POLICY notification_batches_admin_qc_insert ON public.company_notification_batches FOR INSERT
WITH CHECK (public.portal_is_qc_or_admin());
DROP POLICY IF EXISTS notification_batches_admin_update ON public.company_notification_batches;
CREATE POLICY notification_batches_admin_update ON public.company_notification_batches FOR UPDATE
USING (public.portal_is_admin()) WITH CHECK (public.portal_is_admin());

COMMIT;
