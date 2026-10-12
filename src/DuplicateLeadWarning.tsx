import { AlertTriangle, Loader2, X } from 'lucide-react';

/** A previously submitted lead that matches the lead being booked. */
export interface DuplicateLeadMatch {
  lead_code: string | null;
  agent_name: string | null;
  submitted_at: string;
  qc_status: string | null;
  same_company: boolean;
  same_agent: boolean;
  matched_on: Array<'phone' | 'name' | 'address' | 'agent'>;
}

const MATCH_LABELS: Record<DuplicateLeadMatch['matched_on'][number], string> = {
  phone: 'Phone number',
  name: 'First & last name',
  address: 'Address',
  agent: 'Agent name',
};

/** Validates the duplicate-check response before it reaches the UI. */
export function parseDuplicateMatches(value: unknown): DuplicateLeadMatch[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is DuplicateLeadMatch =>
    Boolean(item) && typeof item === 'object' && Array.isArray((item as DuplicateLeadMatch).matched_on) && typeof (item as DuplicateLeadMatch).submitted_at === 'string');
}

/** Confirmation dialog shown when a lead may already have been submitted. */
export function DuplicateLeadWarning({ matches, busy, onCancel, onConfirm }: {
  matches: DuplicateLeadMatch[];
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-slate-950/50 p-0 sm:items-center sm:p-4" onClick={onCancel}>
      <div role="alertdialog" aria-modal="true" aria-labelledby="duplicate-lead-title" onClick={event => event.stopPropagation()} className="max-h-[90dvh] w-full overflow-y-auto rounded-t-3xl bg-white p-5 text-slate-900 shadow-2xl sm:max-w-lg sm:rounded-2xl">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700"><AlertTriangle size={20} /></span>
            <div>
              <h2 id="duplicate-lead-title" className="text-lg font-bold">Possible duplicate lead</h2>
              <p className="mt-1 text-sm text-slate-600">This customer may already have been submitted. Review the {matches.length === 1 ? 'match' : `${matches.length} matches`} below before confirming.</p>
            </div>
          </div>
          <button type="button" aria-label="Close" onClick={onCancel} className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100"><X size={18} /></button>
        </div>
        <ul className="mt-4 space-y-3">
          {matches.map((match, index) => (
            <li key={`${match.lead_code || 'lead'}-${index}`} className="rounded-xl border border-amber-200 bg-amber-50/60 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <strong className="text-sm">{match.lead_code || 'Lead'}</strong>
                <span className="text-xs text-slate-500">{new Date(match.submitted_at).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
              </div>
              <p className="mt-1 text-sm text-slate-700">
                Submitted by <strong>{match.agent_name || 'Unknown agent'}</strong>{match.same_agent ? ' (you)' : ''} · {match.same_company ? 'this company' : 'another company'}{match.qc_status ? ` · QC ${match.qc_status.replace(/_/g, ' ')}` : ''}
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {match.matched_on.map(field => (
                  <span key={field} className="rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-amber-800 ring-1 ring-amber-200">Same {MATCH_LABELS[field].toLowerCase()}</span>
                ))}
              </div>
            </li>
          ))}
        </ul>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" disabled={busy} onClick={onCancel} className="min-h-11 rounded-xl border border-slate-300 px-4 text-sm font-bold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50">Go back and review</button>
          <button type="button" disabled={busy} onClick={onConfirm} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-amber-600 px-4 text-sm font-bold text-white transition hover:bg-amber-700 disabled:opacity-50">{busy && <Loader2 size={15} className="animate-spin" />}Not a duplicate — submit anyway</button>
        </div>
      </div>
    </div>
  );
}
