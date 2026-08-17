BEGIN;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'qc-recordings',
  'qc-recordings',
  false,
  104857600,
  ARRAY[
    'audio/mpeg',
    'audio/mp3',
    'audio/wav',
    'audio/x-wav',
    'audio/mp4',
    'audio/x-m4a',
    'audio/webm',
    'audio/ogg',
    'video/webm',
    'application/octet-stream'
  ]::text[]
)
ON CONFLICT (id) DO UPDATE
SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS qc_recordings_select ON storage.objects;
CREATE POLICY qc_recordings_select
ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'qc-recordings'
  AND public.portal_is_qc_or_admin()
);

DROP POLICY IF EXISTS qc_recordings_insert ON storage.objects;
CREATE POLICY qc_recordings_insert
ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'qc-recordings'
  AND public.portal_is_qc_or_admin()
);

DROP POLICY IF EXISTS qc_recordings_update ON storage.objects;
CREATE POLICY qc_recordings_update
ON storage.objects
FOR UPDATE TO authenticated
USING (
  bucket_id = 'qc-recordings'
  AND public.portal_is_qc_or_admin()
)
WITH CHECK (
  bucket_id = 'qc-recordings'
  AND public.portal_is_qc_or_admin()
);

DROP POLICY IF EXISTS qc_recordings_delete ON storage.objects;
CREATE POLICY qc_recordings_delete
ON storage.objects
FOR DELETE TO authenticated
USING (
  bucket_id = 'qc-recordings'
  AND public.portal_is_qc_or_admin()
);

COMMENT ON TABLE storage.objects IS 'Supabase-managed storage object metadata. ReadyOps QC recordings remain private and are writable/readable only by QC/admin through RLS; company playback uses a token-validated signed URL function.';

COMMIT;
