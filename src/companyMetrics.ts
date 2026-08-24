/**
 * Canonical numeric helpers for the Companies & Scheduling operations screen.
 *
 * The Postgres RPC `get_company_operations_overview` already applies the
 * project's canonical predicates when it aggregates:
 *   - Total Leads  = QC-approved leads with a delivered, non-terminal appointment
 *                    (company_visible_at IS NOT NULL AND status NOT IN
 *                     ('draft','qc_pending','qc_denied','cancelled','rescheduled'))
 *   - Scheduled upcoming = same predicate, appointment_date >= current_date
 *   - Package delivered  = count of the above restricted to that package
 *   - Package pending    = greatest(lead_target - delivered, 0)
 *
 * These helpers wrap the RPC output so every consumer on the admin page reads
 * the same field with the same coercion. Do NOT recompute these on the client
 * from raw `portal_appointments` rows: that path silently omits company_visible_at
 * and qc_status filters and produces looser numbers than the RPC.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CompanyOverview = Record<string, any>;

export type CompanyPackagePaymentState = "paid" | "pending" | "none";

const PAID_STATES = new Set(["complete", "paid", "completed"]);
const PENDING_STATES = new Set([
  "pending",
  "unpaid",
  "not_yet_active",
  "awaiting_payment",
]);

function normalize(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function toFiniteInt(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

export function totalLeads(company: CompanyOverview): number {
  return toFiniteInt(company?.total_leads);
}

export function activeOpenLeads(company: CompanyOverview): number {
  return toFiniteInt(company?.scheduled_upcoming);
}

export function hasActivePackage(company: CompanyOverview): boolean {
  return Boolean(company?.active_package) && !!company?.package;
}

export function packagePaymentState(
  company: CompanyOverview,
): CompanyPackagePaymentState {
  if (!company?.package) return "none";
  const status = normalize(company.package.payment_status);
  if (PAID_STATES.has(status)) return "paid";
  return "pending";
}

export function isPendingPackage(company: CompanyOverview): boolean {
  if (!company?.package) return false;
  return PENDING_STATES.has(normalize(company.package.payment_status));
}

export function packageDelivered(company: CompanyOverview): number {
  if (!company?.package) return 0;
  return toFiniteInt(company.package.delivered_leads);
}

export function packageTarget(company: CompanyOverview): number {
  if (!company?.package) return 0;
  return toFiniteInt(company.package.lead_target);
}

export function packageRemaining(company: CompanyOverview): number {
  if (!company?.package) return 0;
  const explicit = Number(company.package.pending_leads);
  if (Number.isFinite(explicit)) return Math.max(0, Math.floor(explicit));
  return Math.max(0, packageTarget(company) - packageDelivered(company));
}
