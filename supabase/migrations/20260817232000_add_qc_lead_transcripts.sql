BEGIN;

CREATE TABLE IF NOT EXISTS public.qc_lead_transcripts (
  lead_id uuid PRIMARY KEY REFERENCES public.portal_leads(id) ON DELETE CASCADE,
  transcript text NOT NULL DEFAULT '',
  summary text NOT NULL DEFAULT '',
  language text,
  method text NOT NULL DEFAULT 'manual',
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.qc_lead_transcripts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS qc_lead_transcripts_select ON public.qc_lead_transcripts;
CREATE POLICY qc_lead_transcripts_select
ON public.qc_lead_transcripts
FOR SELECT TO authenticated
USING (public.portal_is_qc_or_admin());

DROP POLICY IF EXISTS qc_lead_transcripts_insert ON public.qc_lead_transcripts;
CREATE POLICY qc_lead_transcripts_insert
ON public.qc_lead_transcripts
FOR INSERT TO authenticated
WITH CHECK (public.portal_is_qc_or_admin());

DROP POLICY IF EXISTS qc_lead_transcripts_update ON public.qc_lead_transcripts;
CREATE POLICY qc_lead_transcripts_update
ON public.qc_lead_transcripts
FOR UPDATE TO authenticated
USING (public.portal_is_qc_or_admin())
WITH CHECK (public.portal_is_qc_or_admin());

DROP POLICY IF EXISTS qc_lead_transcripts_delete ON public.qc_lead_transcripts;
CREATE POLICY qc_lead_transcripts_delete
ON public.qc_lead_transcripts
FOR DELETE TO authenticated
USING (public.portal_is_qc_or_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.qc_lead_transcripts TO authenticated;

COMMENT ON TABLE public.qc_lead_transcripts IS
'Internal QC-only call transcripts and deterministic rule-based summaries. Company and representative portals do not read this table.';

COMMIT;
