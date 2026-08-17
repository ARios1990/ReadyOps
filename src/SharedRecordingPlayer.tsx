import { useEffect, useState } from 'react';
import { ExternalLink, Headphones, Loader2 } from 'lucide-react';
import { supabase } from './supabase';

const STORAGE_PREFIX = 'storage://qc-recordings/';

function isStoredRecording(value: string): boolean {
  return value.startsWith(STORAGE_PREFIX);
}

export function SharedRecordingPlayer({
  companyId,
  token,
  leadId,
  recordingUrl,
  shared,
}: {
  companyId: string;
  token: string;
  leadId: string;
  recordingUrl: string | null;
  shared?: boolean;
}) {
  const [playbackUrl, setPlaybackUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;

    async function resolve() {
      setPlaybackUrl('');
      setError('');
      if (!shared || !recordingUrl) return;

      if (!isStoredRecording(recordingUrl)) {
        setPlaybackUrl(recordingUrl);
        return;
      }

      setLoading(true);
      const { data, error: invokeError } = await supabase.functions.invoke('shared-recording-url', {
        body: {
          company_id: companyId,
          access_token: token,
          lead_id: leadId,
        },
      });
      if (!active) return;
      if (invokeError || data?.error || !data?.signed_url) {
        setError(data?.error || invokeError?.message || 'Recording is temporarily unavailable.');
      } else {
        setPlaybackUrl(String(data.signed_url));
      }
      setLoading(false);
    }

    void resolve();
    return () => { active = false; };
  }, [companyId, token, leadId, recordingUrl, shared]);

  if (!shared || !recordingUrl) return null;

  return (
    <section className="rounded-2xl border border-blue-200 bg-blue-50 p-4">
      <div className="flex items-center gap-2 text-blue-900">
        <Headphones size={16} />
        <h3 className="text-sm font-black">Call Recording</h3>
      </div>
      {loading ? (
        <div className="mt-3 inline-flex items-center gap-2 text-xs font-semibold text-blue-700"><Loader2 size={14} className="animate-spin" /> Loading recording…</div>
      ) : error ? (
        <p className="mt-3 text-xs font-semibold text-red-700">{error}</p>
      ) : playbackUrl ? (
        <>
          <audio controls preload="none" src={playbackUrl} className="mt-3 w-full" />
          <a href={playbackUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-blue-700">
            <ExternalLink size={12} /> Open audio
          </a>
        </>
      ) : null}
    </section>
  );
}
