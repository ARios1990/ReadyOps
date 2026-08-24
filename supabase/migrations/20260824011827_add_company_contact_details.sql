BEGIN;

ALTER TABLE public.roster_companies
  ADD COLUMN IF NOT EXISTS owner_email text,
  ADD COLUMN IF NOT EXISTS billing_email text,
  ADD COLUMN IF NOT EXISTS secondary_emails text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS billing_address text;

COMMENT ON COLUMN public.roster_companies.owner_email
IS 'Primary owner email supplied for the company.';

COMMENT ON COLUMN public.roster_companies.billing_email
IS 'Email address used for billing and account communication.';

COMMENT ON COLUMN public.roster_companies.secondary_emails
IS 'Additional company email addresses retained separately from the primary email.';

COMMENT ON COLUMN public.roster_companies.billing_address
IS 'Billing address supplied by the company; this is not an operational service location.';

COMMIT;
