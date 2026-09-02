BEGIN;

CREATE INDEX IF NOT EXISTS company_package_payments_recorded_by_idx
  ON public.company_package_payments(recorded_by)
  WHERE recorded_by IS NOT NULL;

COMMIT;
