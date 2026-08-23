export type LeadOutcomeRecord = {
  client_status?: unknown;
  canonical_status?: unknown;
  sales_outcome?: unknown;
  attendance_status?: unknown;
};

export type LeadOutcome =
  | "signed_contract"
  | "no_show"
  | "bad"
  | "good"
  | "rescheduled"
  | "pending";

function statusValues(row: LeadOutcomeRecord): string[] {
  return [
    row.client_status,
    row.canonical_status,
    row.sales_outcome,
    row.attendance_status,
  ].map(value => String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_"));
}

export function normalizeLeadOutcome(row: LeadOutcomeRecord): LeadOutcome {
  const values = statusValues(row);
  if (values.includes("signed_contract") || values.includes("signed")) return "signed_contract";
  if (values.some(value => value === "no_show" || value.includes("no_show"))) return "no_show";
  if (values.includes("bad") || values.includes("lost")) return "bad";
  if (values.includes("good") || values.includes("good_inspected")) return "good";
  if (values.includes("rescheduled")) return "rescheduled";
  return "pending";
}

export function isLeadOutcome(row: LeadOutcomeRecord, outcome: LeadOutcome): boolean {
  return normalizeLeadOutcome(row) === outcome;
}

export function isoLocalDate(value: Date): string {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

export function defaultReportDateRange(now = new Date()): { startDate: string; endDate: string } {
  return {
    startDate: isoLocalDate(new Date(now.getTime() - 30 * 86_400_000)),
    endDate: isoLocalDate(now),
  };
}
