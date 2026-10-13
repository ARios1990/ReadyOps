import { useState } from 'react';
import { Headphones } from 'lucide-react';
import { SharedRecordingPlayer } from './SharedRecordingPlayer';

export function CompanyRecordingCell({ companyId, token, lead }: { companyId: string; token: string; lead: { id: string; recording_url: string | null; recording_shared?: boolean } }) {
  const [open, setOpen] = useState(false);
  if (!lead.recording_shared) return <span className="text-xs text-slate-500">Not shared by QC</span>;
  if (!lead.recording_url) return <span className="text-xs text-slate-500">No recording</span>;
  return <div className="min-w-0"><button type="button" aria-expanded={open} onClick={() => setOpen(value => !value)} className="inline-flex items-center gap-1.5 rounded-lg border border-blue-300 bg-white px-2.5 py-1.5 text-xs font-bold text-blue-700"><Headphones size={14} />{open ? 'Hide recording' : 'Play recording'}</button>{open && <div className="mt-2"><SharedRecordingPlayer companyId={companyId} token={token} leadId={lead.id} recordingUrl={lead.recording_url} shared={lead.recording_shared} /></div>}</div>;
}
