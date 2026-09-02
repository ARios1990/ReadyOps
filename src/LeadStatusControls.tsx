import { CheckCircle2 } from "lucide-react";
import {
  LEAD_STATUS_CONFIG,
  leadStatusClasses,
  leadStatusLabel,
  normalizeLeadDisposition,
  type LeadDisposition,
} from "./leadStatusPresentation";

const CLIENT_DISPOSITIONS: Exclude<LeadDisposition, "pending">[] = [
  "good",
  "no_show",
  "bad",
  "signed_contract",
  "rescheduled",
];

export function LeadStatusBadge({
  value,
  audience = "agent",
  className = "",
}: {
  value: unknown;
  audience?: "agent" | "client";
  className?: string;
}) {
  return (
    <span
      className={`inline-flex whitespace-nowrap rounded-md border px-2.5 py-1 text-[10px] font-black ${leadStatusClasses(value)} ${className}`}
    >
      {leadStatusLabel(value, audience)}
    </span>
  );
}

export function LeadReceivedIndicator({ received }: { received: boolean }) {
  if (!received) return null;
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-black text-emerald-700">
      <CheckCircle2 size={13} aria-hidden="true" /> Lead Received
    </span>
  );
}

export function ClientStatusActions({
  currentStatus,
  received,
  disabled,
  onConfirm,
  onDisposition,
  className = "",
}: {
  currentStatus: unknown;
  received: boolean;
  disabled?: boolean;
  onConfirm: () => void;
  onDisposition: (status: Exclude<LeadDisposition, "pending">) => void;
  className?: string;
}) {
  const current = normalizeLeadDisposition(currentStatus);
  return (
    <div className={`grid grid-cols-2 gap-2 sm:grid-cols-3 ${className}`}>
      <button
        type="button"
        disabled={disabled || received}
        onClick={onConfirm}
        className={`min-h-11 rounded-lg border px-3 py-2 text-xs font-black transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0EA5E9] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 ${LEAD_STATUS_CONFIG.pending.className}`}
      >
        {received ? "Lead Received" : "Confirm Lead"}
      </button>
      {CLIENT_DISPOSITIONS.map((status) => {
        const config = LEAD_STATUS_CONFIG[status];
        return (
          <button
            key={status}
            type="button"
            aria-pressed={current === status}
            disabled={disabled}
            onClick={() => onDisposition(status)}
            className={`min-h-11 rounded-lg border px-3 py-2 text-xs font-black transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0EA5E9] focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-60 ${config.className} ${current === status ? "ring-2 ring-slate-950/30 ring-offset-1" : "hover:brightness-105"}`}
          >
            {config.clientLabel}
          </button>
        );
      })}
    </div>
  );
}
