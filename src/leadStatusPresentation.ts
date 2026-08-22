const GREEN_STATUSES = new Set(['approved', 'good', 'good_inspected', 'completed', 'signed_contract']);
const RED_STATUSES = new Set(['bad', 'denied', 'cancelled', 'canceled']);
const BLUE_STATUSES = new Set(['pending', 'pending_qc', 'confirmed', 'assigned']);
const YELLOW_STATUSES = new Set(['no_show', 'homeowner_no_show']);
const ORANGE_STATUSES = new Set(['needs_correction', 'reschedule', 'rescheduled', 'follow_up']);

export function normalizeLeadStatus(value: unknown): string {
  return String(value || 'pending').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

export function leadStatusLabel(value: unknown): string {
  const status = normalizeLeadStatus(value);
  if (status === 'good_inspected') return 'GOOD';
  if (status === 'homeowner_no_show') return 'NO SHOW';
  return status.replace(/_/g, ' ').toUpperCase();
}

export function leadStatusClasses(value: unknown): string {
  const status = normalizeLeadStatus(value);
  if (GREEN_STATUSES.has(status)) return 'border-emerald-700 bg-emerald-600 text-white shadow-sm';
  if (RED_STATUSES.has(status)) return 'border-red-600 bg-red-500 text-white shadow-sm';
  if (BLUE_STATUSES.has(status)) return 'border-sky-200 bg-sky-200 text-blue-950';
  if (YELLOW_STATUSES.has(status)) return 'border-yellow-400 bg-yellow-300 text-slate-950';
  if (ORANGE_STATUSES.has(status)) return 'border-orange-200 bg-orange-100 text-orange-800';
  if (status === 'in_review') return 'border-violet-200 bg-violet-100 text-violet-800';
  return 'border-slate-200 bg-slate-100 text-slate-700';
}
