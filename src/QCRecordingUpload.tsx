import { useEffect, useState } from 'react';
import { ExternalLink, Headphones, Loader2, UploadCloud } from 'lucide-react';
import { supabase } from './supabase';

const BUCKET = 'qc-recordings';
const STORAGE_PREFIX = `storage://${BUCKET}/`;
const MAX_BYTES = 100 * 1024 * 1024;

function storagePath(value: string): string | null {
  return value.startsWith(STORAGE_PREFIX) ? value.slice(STORAGE_PREFIX.length) : null;
}

function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-');
}

export function QCRecordingUpload({
  leadId,
  value,
  shared,
  onChange,
  onShareChange,
}: {
  leadId: string;
  value: string;
  shared: boolean;
  onChange: (value: string) => void;
  onShareChange: (value: boolean) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [playbackUrl, setPlaybackUrl] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    async function resolvePlayback() {
      setPlaybackUrl('');
      setError('');
      if (!value) return;
      const path = storagePath(value);
      if (!path) {
        setPlaybackUrl(value);
        return;
      }
      const { data, error: signedError } = await supabase.storage.from(BUCKET).createSignedUrl(path, 60 * 60);
      if (!active) return;
      if (signedError || !data?.signedUrl) setError(signedError?.message || 'Unable to load recording.');
      else setPlaybackUrl(data.signedUrl);
    }
    void resolvePlayback();
    return () => { active = false; };
  }, [value]);

  async function upload(file: File) {
    setError('');
    if (file.size > MAX_BYTES) {
      setError('Recording is too large. Maximum file size is 100 MB.');
      return;
    }
    setUploading(true);
    const path = `${leadId}/${Date.now()}-${safeName(file.name || 'recording')}`;
    const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, file, {
      cacheControl: '3600',
      contentType: file.type || 'application/octet-stream',
      upsert: false,
    });
    if (uploadError) setError(uploadError.message);
    else onChange(`${STORAGE_PREFIX}${path}`);
    setUploading(false);
  }

  return (
    <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
      <div className="flex items-center gap-2"><Headphones size={16} className="text-blue-700"/><h3 className="font-bold text-blue-950">Appointment Recording</h3></div>
      <p className="mt-1 text-xs text-slate-500">Upload the ReadyMode call recording here. MP3, WAV, M4A, WebM and OGG are supported up to 100 MB.</p>

      <label className="mt-3 flex cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-blue-200 bg-white px-4 py-4 text-sm font-bold text-blue-700 hover:bg-blue-50">
        {uploading ? <Loader2 size={17} className="animate-spin"/> : <UploadCloud size={17}/>} {uploading ? 'Uploading recording…' : 'Upload Recording'}
        <input
          type="file"
          accept="audio/*,.mp3,.wav,.m4a,.webm,.ogg"
          disabled={uploading}
          className="hidden"
          onChange={event => {
            const file = event.target.files?.[0];
            if (file) void upload(file);
            event.currentTarget.value = '';
          }}
        />
      </label>

      <label className="mt-3 block text-[10px] font-bold uppercase tracking-wide text-slate-500">Recording URL (optional fallback)</label>
      <input
        value={value.startsWith(STORAGE_PREFIX) ? '' : value}
        onChange={event => onChange(event.target.value.trim())}
        placeholder="Paste ReadyMode recording URL or upload a file above"
        className="mt-1 w-full rounded-lg border border-blue-200 bg-white px-3 py-2 text-xs text-slate-700"
      />

      {value.startsWith(STORAGE_PREFIX) && <p className="mt-2 break-all text-[10px] font-semibold text-blue-700">Private upload attached.</p>}
      {playbackUrl && <><audio controls preload="none" src={playbackUrl} className="mt-3 w-full"/><a href={playbackUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-blue-700"><ExternalLink size={12}/> Open audio</a></>}
      {error && <p className="mt-2 text-xs font-semibold text-red-700">{error}</p>}

      <label className="mt-3 flex items-start gap-2 rounded-lg border border-blue-200 bg-white p-3 text-xs font-semibold text-slate-700">
        <input type="checkbox" checked={shared} onChange={event => onShareChange(event.target.checked)} className="mt-0.5"/>
        <span>Share recording with company after QC approval.<span className="mt-1 block font-normal text-slate-500">Off by default. If unchecked, the company and representative cannot see the audio.</span></span>
      </label>
    </div>
  );
}
