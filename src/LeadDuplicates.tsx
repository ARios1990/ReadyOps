import { formatDateTime } from './dateDisplay';
import { AlertTriangle, Building2, Calendar, MapPin, Phone, UserRound } from "lucide-react";
import { composeAddress } from "./inspectorNote";
import type { DuplicateField, LeadDuplicateMatch } from "./useLeadDuplicates";

const FIELD_LABELS: Record<DuplicateField, string> = {
  phone: "Same phone",
  name: "Same name",
  address: "Same address",
  agent: "Same agent",
};

function describeFields(matches: LeadDuplicateMatch[]): string {
  const fields = new Set(matches.flatMap((match) => match.matched_on));
  return (Object.keys(FIELD_LABELS) as DuplicateField[])
    .filter((field) => fields.has(field))
    .map((field) => FIELD_LABELS[field].replace("Same ", ""))
    .join(", ");
}

/** Compact queue-row flag for a lead that has possible duplicates. */
export function DuplicateBadge({ matches, onClick }: { matches: LeadDuplicateMatch[]; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={`Matches ${matches.length} other lead${matches.length === 1 ? "" : "s"} by ${describeFields(matches)}`}
      className="mt-1 inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800 ring-1 ring-amber-200 transition hover:bg-amber-200"
    >
      <AlertTriangle size={11} />
      Possible duplicate ({matches.length})
    </button>
  );
}

/** Review-dialog panel listing every lead that looks like the same customer. */
export function DuplicateMatchesPanel({ matches }: { matches: LeadDuplicateMatch[] }) {
  return (
    <section className="mb-4 rounded-2xl border border-amber-200 bg-amber-50/70 p-4" aria-label="Possible duplicate leads">
      <div className="flex items-start gap-3">
        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700">
          <AlertTriangle size={18} />
        </span>
        <div>
          <h3 className="text-sm font-black text-amber-900">
            Possible duplicate — {matches.length} matching lead{matches.length === 1 ? "" : "s"}
          </h3>
          <p className="mt-0.5 text-xs leading-5 text-amber-800">
            Matched by {describeFields(matches)}. Compare before approving; use the "Duplicate Lead or Appointment" reason to deny.
          </p>
        </div>
      </div>
      <ul className="mt-3 max-h-80 space-y-2 overflow-y-auto pr-1">
        {matches.map((match) => {
          const address = composeAddress({ address: match.address, city: match.city, state: match.state, zipCode: match.zip_code });
          return (
            <li key={match.id} className="rounded-xl border border-amber-200 bg-white p-3 text-xs text-slate-700">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <strong className="text-sm text-slate-900">{match.full_name || "Unnamed lead"}</strong>
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-600">{match.lead_code || "No code"}</span>
                </div>
                {match.qc_status && (
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-600">
                    QC {match.qc_status.replace(/_/g, " ")}
                  </span>
                )}
              </div>
              <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
                <span className="flex items-center gap-1.5"><Phone size={12} className="shrink-0 text-slate-400" />{match.phone_number || "—"}</span>
                <span className="flex items-center gap-1.5"><UserRound size={12} className="shrink-0 text-slate-400" />{match.agent_name || "Unknown agent"}</span>
                <span className="flex items-center gap-1.5 sm:col-span-2"><MapPin size={12} className="shrink-0 text-slate-400" />{address || "—"}</span>
                <span className="flex items-center gap-1.5"><Building2 size={12} className="shrink-0 text-slate-400" />{match.company_name || "Unknown company"}</span>
                <span className="flex items-center gap-1.5">
                  <Calendar size={12} className="shrink-0 text-slate-400" />
                  Submitted {formatDateTime(match.submitted_at)}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {match.matched_on.map((field) => (
                  <span key={field} className={`rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ${field === "agent" ? "bg-sky-50 text-sky-800 ring-sky-200" : "bg-amber-50 text-amber-800 ring-amber-200"}`}>
                    {FIELD_LABELS[field]}
                  </span>
                ))}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
