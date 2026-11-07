import { supabase } from './supabase';

export function validateRecordingFile(file: File) {
  if (file.size === 0) throw new Error('The recording is empty. Choose an audio file.');
  if (file.size > 100 * 1024 * 1024) throw new Error('Recording is too large. Maximum file size is 100 MB.');
}

export async function uploadBookingRecording(file: File, slug: string, sessionId: string, reservationToken?: string) {
  validateRecordingFile(file);
  if (!slug) throw new Error('Company form link is missing its company slug.');
  const { data, error } = await supabase.functions.invoke('agent-recording-upload-token', {
    body: { session_id: sessionId, slug, reservation_token: reservationToken, filename: file.name || 'recording.mp3' },
  });
  if (error || data?.error) throw new Error(data?.error || error?.message || 'Unable to authorize upload.');
  if (!data?.path || !data?.token || !data?.recording_url) throw new Error('Upload authorization was incomplete.');
  const { error: uploadError } = await supabase.storage.from('qc-recordings').uploadToSignedUrl(data.path, data.token, file, {
    contentType: file.type || 'application/octet-stream',
  });
  if (uploadError) throw uploadError;
  return String(data.recording_url);
}

export async function uploadQCRecording(file: File, leadId: string) {
  validateRecordingFile(file);
  const filename = file.name.replace(/[^a-zA-Z0-9._-]+/g, '-') || 'recording';
  const path = `${leadId}/${crypto.randomUUID()}-${filename}`;
  const { error } = await supabase.storage.from('qc-recordings').upload(path, file, {
    contentType: file.type || 'application/octet-stream', upsert: false,
  });
  if (error) throw error;
  return `storage://qc-recordings/${path}`;
}
