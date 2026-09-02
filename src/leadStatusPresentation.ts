export type LeadDisposition =
  | "pending"
  | "good"
  | "bad"
  | "no_show"
  | "signed_contract"
  | "rescheduled";

export type LeadStatusConfig = {
  internalValue: LeadDisposition;
  agentLabel: string;
  clientLabel: string;
  backgroundColor: string;
  textColor: "white" | "dark";
  dashboardCategory: LeadDisposition;
  exportValue: string;
  className: string;
};

// One authoritative palette for every ReadyOps status surface. These exact
// colors are intentionally a little brighter than the previous Tailwind tones.
export const LEAD_STATUS_CONFIG: Record<LeadDisposition, LeadStatusConfig> = {
  pending: {
    internalValue: "pending",
    agentLabel: "PENDING",
    clientLabel: "Pending",
    backgroundColor: "#0EA5E9",
    textColor: "white",
    dashboardCategory: "pending",
    exportValue: "Pending",
    className: "border-[#0284C7] bg-[#0EA5E9] text-white shadow-sm",
  },
  good: {
    internalValue: "good",
    agentLabel: "GOOD",
    clientLabel: "Inspected",
    backgroundColor: "#059669",
    textColor: "white",
    dashboardCategory: "good",
    exportValue: "Good",
    className: "border-[#047857] bg-[#059669] text-white shadow-sm",
  },
  bad: {
    internalValue: "bad",
    agentLabel: "BAD",
    clientLabel: "Bad / Canceled",
    backgroundColor: "#E52420",
    textColor: "white",
    dashboardCategory: "bad",
    exportValue: "Bad",
    className: "border-[#B91C1C] bg-[#E52420] text-white shadow-sm",
  },
  no_show: {
    internalValue: "no_show",
    agentLabel: "NO SHOW",
    clientLabel: "No Show",
    backgroundColor: "#FBBF24",
    textColor: "dark",
    dashboardCategory: "no_show",
    exportValue: "No Show",
    className: "border-[#D97706] bg-[#FBBF24] text-slate-950 shadow-sm",
  },
  signed_contract: {
    internalValue: "signed_contract",
    agentLabel: "SIGNED CONTRACT",
    clientLabel: "Signed Contract",
    backgroundColor: "#006B3C",
    textColor: "white",
    dashboardCategory: "signed_contract",
    exportValue: "Signed Contract",
    className: "border-[#00512E] bg-[#006B3C] text-white shadow-sm",
  },
  rescheduled: {
    internalValue: "rescheduled",
    agentLabel: "RESCHEDULED",
    clientLabel: "Rescheduled",
    backgroundColor: "#FF7A1A",
    textColor: "dark",
    dashboardCategory: "rescheduled",
    exportValue: "Rescheduled",
    className: "border-[#EA580C] bg-[#FF7A1A] text-slate-950 shadow-sm",
  },
};

const DISPOSITION_ALIASES: Record<string, LeadDisposition> = {
  pending: "pending",
  pending_qc: "pending",
  confirmed: "pending",
  assigned: "pending",
  good: "good",
  good_inspected: "good",
  inspected: "good",
  inspection_completed: "good",
  completed: "good",
  bad: "bad",
  lost: "bad",
  cancelled: "bad",
  canceled: "bad",
  homeowner_cancelled: "bad",
  no_show: "no_show",
  homeowner_no_show: "no_show",
  signed: "signed_contract",
  signed_contract: "signed_contract",
  signed_claim_filed: "signed_contract",
  reschedule: "rescheduled",
  rescheduled: "rescheduled",
};

export function normalizeLeadStatus(value: unknown): string {
  return String(value || "pending")
    .trim()
    .toLowerCase()
    .replace(/[\s/-]+/g, "_");
}

export function normalizeLeadDisposition(
  value: unknown,
): LeadDisposition | null {
  return DISPOSITION_ALIASES[normalizeLeadStatus(value)] || null;
}

export function leadStatusConfig(value: unknown): LeadStatusConfig | null {
  const disposition = normalizeLeadDisposition(value);
  return disposition ? LEAD_STATUS_CONFIG[disposition] : null;
}

export function leadStatusLabel(
  value: unknown,
  audience: "agent" | "client" = "agent",
): string {
  const status = normalizeLeadStatus(value);
  if (status === "manager_approved") return "AWAITING FINAL QC";
  if (status === "denied" || status === "qc_denied") return "QC DENIED";
  if (status === "needs_correction") return "NEEDS CORRECTION";
  if (status === "in_review") return "IN REVIEW";
  if (status === "approved") return "APPROVED";
  const config = leadStatusConfig(status);
  if (config) {
    return audience === "client" ? config.clientLabel : config.agentLabel;
  }
  return status.replace(/_/g, " ").toUpperCase();
}

export function clientLeadStatusLabel(value: unknown): string {
  return leadStatusLabel(value, "client");
}

export function leadStatusExportValue(value: unknown): string {
  return leadStatusConfig(value)?.exportValue || leadStatusLabel(value);
}

export function leadStatusClasses(value: unknown): string {
  const status = normalizeLeadStatus(value);
  const config = leadStatusConfig(status);
  if (config) return config.className;
  if (status === "approved")
    return "border-[#047857] bg-[#059669] text-white shadow-sm";
  if (status === "denied" || status === "qc_denied")
    return "border-[#B91C1C] bg-[#E52420] text-white shadow-sm";
  if (status === "needs_correction")
    return "border-[#EA580C] bg-[#FF7A1A] text-slate-950 shadow-sm";
  if (status === "in_review")
    return "border-violet-300 bg-violet-200 text-violet-950";
  if (status === "manager_approved")
    return "border-violet-600 bg-violet-500 text-white shadow-sm";
  return "border-slate-200 bg-slate-100 text-slate-700";
}
