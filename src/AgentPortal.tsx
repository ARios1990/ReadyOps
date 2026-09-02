import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock3,
  Edit3,
  Eye,
  EyeOff,
  ExternalLink,
  Loader2,
  RefreshCw,
  Send,
  X,
  XCircle,
} from "lucide-react";
import { DynamicLeadForm, PortalFormSection } from "./DynamicLeadForm";
import { HorizontalScrollFrame } from "./HorizontalScrollFrame";
import { supabase } from "./supabase";
import {
  addDays,
  buildLeadTemplate,
  calendarWeekStart,
  formatDateLong,
  formatTime,
  localDate,
  rpcError,
} from "./portalUtils";
import { leadStatusClasses, leadStatusLabel } from "./leadStatusPresentation";
import { READYOPS_LOGO_DATA_URI } from "./brand";

type RangeMode = "this" | "previous" | "all";
type AgentSectionKey =
  | "corrections"
  | "pending"
  | "booked"
  | "denied"
  | "other";

const DEFAULT_AGENT_SECTIONS: Record<AgentSectionKey, boolean> = {
  corrections: true,
  pending: true,
  booked: true,
  denied: true,
  other: true,
};
type LeadRow = {
  lead_id: string;
  lead_code?: string;
  company_name: string;
  name: string;
  phone: string;
  address: string;
  appointment_date: string;
  start_time: string;
  qc_status: string;
  client_status?: string | null;
  appointment_status?: string | null;
  qc_reason?: string | null;
  inspector_notes?: string | null;
  payroll_week_start: string;
  payroll_week_end: string;
  pay_date: string;
};
type PortalCompany = {
  id: string;
  public_slug: string;
  name: string;
  state?: string | null;
};
type AgentPortalData = {
  agent: { name: string; portal_slug: string };
  appointments: LeadRow[];
  companies: PortalCompany[];
};
type CorrectionData = {
  lead_id: string;
  lead_code: string;
  company_name: string;
  company_slug: string;
  appointment_date: string;
  start_time: string;
  end_time: string;
  correction_reason?: string | null;
  correction_attempt: number;
  form_schema: PortalFormSection[];
  values: Record<string, unknown>;
};

export function AgentPortal({ slug, token }: { slug: string; token: string }) {
  const [data, setData] = useState<AgentPortalData | null>(null);
  const [mode, setMode] = useState<RangeMode>("this");
  const [payDate, setPayDate] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [correctionLead, setCorrectionLead] = useState<LeadRow | null>(null);
  const [correction, setCorrection] = useState<CorrectionData | null>(null);
  const [correctionValues, setCorrectionValues] = useState<
    Record<string, unknown>
  >({});
  const [correctionLoading, setCorrectionLoading] = useState(false);
  const [correctionSaving, setCorrectionSaving] = useState(false);
  const [correctionError, setCorrectionError] = useState("");
  const sectionStorageKey = `readyops-agent-sections:${slug}`;
  const [sectionOpen, setSectionOpen] = useState<
    Record<AgentSectionKey, boolean>
  >(() => {
    if (typeof window === "undefined") return DEFAULT_AGENT_SECTIONS;
    try {
      const saved = JSON.parse(
        window.localStorage.getItem(`readyops-agent-sections:${slug}`) || "{}",
      ) as Partial<Record<AgentSectionKey, boolean>>;
      return { ...DEFAULT_AGENT_SECTIONS, ...saved };
    } catch {
      return DEFAULT_AGENT_SECTIONS;
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(
        sectionStorageKey,
        JSON.stringify(sectionOpen),
      );
    } catch {
      // The controls still work for the current visit if storage is disabled.
    }
  }, [sectionOpen, sectionStorageKey]);

  const toggleSection = (key: AgentSectionKey) =>
    setSectionOpen((current) => ({ ...current, [key]: !current[key] }));

  const range = useMemo(() => {
    const monday = calendarWeekStart();
    const sunday = addDays(monday, -1);
    if (mode === "previous")
      return {
        start: localDate(addDays(sunday, -7)),
        end: localDate(addDays(sunday, -1)),
      };
    if (mode === "all")
      return {
        start: localDate(addDays(sunday, -90)),
        end: localDate(addDays(sunday, 45)),
      };
    return { start: localDate(sunday), end: localDate(addDays(sunday, 6)) };
  }, [mode]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const { data: response, error: portalError } = await supabase.rpc(
      "get_agent_portal",
      {
        p_access_token: token,
        p_start_date: range.start,
        p_end_date: range.end,
      },
    );
    const portalData = response as AgentPortalData | null;
    if (portalError) {
      setError(portalError.message);
      setData(null);
    } else if (portalData?.agent?.portal_slug !== slug) {
      setError("Agent link name does not match this access token.");
      setData(null);
    } else {
      setData(portalData);
    }
    setLoading(false);
  }, [range.end, range.start, slug, token]);

  useEffect(() => {
    void load();
  }, [load]);

  async function openCorrection(row: LeadRow) {
    if (row.qc_status !== "needs_correction") return;
    setCorrectionLead(row);
    setCorrection(null);
    setCorrectionValues({});
    setCorrectionError("");
    setCorrectionLoading(true);
    const { data: response, error: correctionLoadError } = await supabase.rpc(
      "get_agent_correction",
      {
        p_access_token: token,
        p_lead_id: row.lead_id,
      },
    );
    if (correctionLoadError) {
      setCorrectionError(rpcError(correctionLoadError));
    } else {
      const nextCorrection = response as CorrectionData;
      setCorrection(nextCorrection);
      setCorrectionValues(nextCorrection.values || {});
    }
    setCorrectionLoading(false);
  }

  function closeCorrection() {
    if (correctionSaving) return;
    setCorrectionLead(null);
    setCorrection(null);
    setCorrectionValues({});
    setCorrectionError("");
  }

  async function resubmitCorrection() {
    if (!correction) return;
    setCorrectionSaving(true);
    setCorrectionError("");
    const formData = {
      ...correctionValues,
      lead_template: buildLeadTemplate(correctionValues),
    };
    const { error: resubmitError } = await supabase.rpc(
      "agent_resubmit_correction",
      {
        p_access_token: token,
        p_lead_id: correction.lead_id,
        p_form_data: formData,
      },
    );
    if (resubmitError) {
      setCorrectionError(rpcError(resubmitError));
      setCorrectionSaving(false);
      return;
    }
    setCorrectionLead(null);
    setCorrection(null);
    setCorrectionValues({});
    setMessage(`${correction.lead_code} was corrected and sent back to QC.`);
    await load();
    setCorrectionSaving(false);
  }

  const appointments = useMemo(
    () => data?.appointments || [],
    [data?.appointments],
  );
  const payDates = useMemo(
    () =>
      [...new Set(appointments.map((item) => item.pay_date).filter(Boolean))]
        .sort()
        .reverse(),
    [appointments],
  );
  const visible = payDate
    ? appointments.filter((item) => item.pay_date === payDate)
    : appointments;
  const corrections = visible.filter(
    (item) => item.qc_status === "needs_correction",
  );
  const pending = visible.filter((item) =>
    ["pending", "in_review", "manager_approved"].includes(item.qc_status),
  );
  const approved = visible.filter((item) => item.qc_status === "approved");
  const denied = visible.filter((item) => item.qc_status === "denied");

  if (loading && !data)
    return <State title="Loading your appointments..." loading />;
  if (!data)
    return (
      <State
        title="Agent portal unavailable"
        detail={error || "This private link may be disabled."}
      />
    );

  return (
    <div className="readyops-agent-portal body-text min-h-screen bg-slate-50 text-slate-900">
      <header className="readyops-agent-header sticky top-0 z-30 border-b bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1500px] items-center justify-between gap-3 px-3 py-3 sm:px-6 sm:py-4">
          <div className="flex min-w-0 items-center gap-3 sm:gap-5">
            <img
              src={READYOPS_LOGO_DATA_URI}
              alt="ReadyOps"
              className="h-8 w-auto shrink-0 sm:h-10"
            />
            <div className="min-w-0">
              <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
                Ready Ops Agent Portal
              </p>
              <h1 className="truncate text-lg font-black text-slate-950 sm:text-xl">
                {data.agent.name}
              </h1>
            </div>
          </div>
          <button
            type="button"
            aria-label="Refresh agent portal"
            onClick={() => void load()}
            className="readyops-icon-button rounded-lg border bg-white p-2 text-slate-700"
          >
            <RefreshCw size={16} />
          </button>
        </div>
      </header>
      <main className="mx-auto max-w-[1500px] space-y-5 px-3 pb-8 pt-4 sm:px-6 sm:py-5">
        {message && (
          <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
            <CheckCircle2 size={17} />
            {message}
          </div>
        )}
        <section className="readyops-agent-range-nav sticky top-[57px] z-20 rounded-xl border border-[#17314d] bg-[#06152b] p-2 shadow-sm sm:top-[73px]">
          <div className="flex flex-wrap items-end gap-2">
            <button
              onClick={() => setMode("this")}
              className={btn(mode === "this")}
            >
              This Week
            </button>
            <button
              onClick={() => setMode("previous")}
              className={btn(mode === "previous")}
            >
              Previous Week
            </button>
            <button
              onClick={() => setMode("all")}
              className={btn(mode === "all")}
            >
              All Recent
            </button>
            <label className="ml-auto text-xs font-bold text-blue-100">
              Payroll Pay Date
              <select
                value={payDate}
                onChange={(event) => setPayDate(event.target.value)}
                className="ml-2 rounded-lg border border-white/25 bg-white px-3 py-2 text-sm text-slate-900"
              >
                <option value="">All in date filter</option>
                {payDates.map((date) => (
                  <option key={date} value={date}>
                    {formatDateLong(date)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="mt-3 px-1 text-xs text-blue-100">
            Payroll week is Sunday–Saturday. A lead is assigned to payroll by
            its appointment date; the pay date is the following Saturday.
          </p>
        </section>
        <section className="readyops-agent-metrics grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric
            label="Needs Correction"
            value={corrections.length}
            tone="orange"
          />
          <Metric label="QC Pending" value={pending.length} tone="amber" />
          <Metric label="Approved" value={approved.length} tone="green" />
          <Metric label="QC Denied" value={denied.length} tone="red" />
        </section>
        <LeadSection
          title="Needs Correction"
          description="Open the original lead, make the changes requested by QC, and submit the same lead again."
          rows={corrections}
          onOpenCorrection={openCorrection}
          tone="orange"
          open={sectionOpen.corrections}
          onToggle={() => toggleSection("corrections")}
        />
        <LeadSection
          title="QC Pending"
          description="Submitted to QC. The appointment slot is held, but the company cannot see it yet."
          rows={pending}
          onOpenCorrection={openCorrection}
          tone="amber"
          open={sectionOpen.pending}
          onToggle={() => toggleSection("pending")}
        />
        <LeadSection
          title="Booked / Approved Appointments"
          description="QC approved. The company can now see and work these appointments."
          rows={approved}
          onOpenCorrection={openCorrection}
          tone="green"
          open={sectionOpen.booked}
          onToggle={() => toggleSection("booked")}
        />
        <LeadSection
          title="QC Denied"
          description="These remain in your history with the QC denial reason."
          rows={denied}
          onOpenCorrection={openCorrection}
          tone="red"
          open={sectionOpen.denied}
          onToggle={() => toggleSection("denied")}
        />
        <section className="readyops-agent-section overflow-hidden rounded-2xl border bg-white shadow-sm">
          <div className="flex items-start justify-between gap-3 border-b border-[#17314d] bg-[#071525] px-4 py-3 text-white">
            <div>
              <h2 className="section-title">Other Appointments</h2>
              <p className="mt-0.5 text-xs text-blue-100">
                Book another appointment with an agent-linked company form.
              </p>
            </div>
            <SectionToggle
              open={sectionOpen.other}
              onToggle={() => toggleSection("other")}
              label="Other Appointments"
              inverted
            />
          </div>
          {sectionOpen.other && (
            <div className="p-4">
              <p className="text-sm text-slate-500">
                These links identify you automatically so new appointments are
                attached to this agent portal.
              </p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {data.companies.map((company) => (
                  <a
                    key={company.id}
                    href={`/book/${company.public_slug}?agent_token=${encodeURIComponent(token)}&agent=${encodeURIComponent(data.agent.name)}`}
                    className="company-link flex items-center justify-between rounded-xl border bg-slate-50 px-3 py-3 hover:border-blue-300 hover:bg-blue-50"
                  >
                    <span>
                      {company.name}
                      {company.state ? ` — ${company.state}` : ""}
                    </span>
                    <ExternalLink size={14} />
                  </a>
                ))}
              </div>
            </div>
          )}
        </section>
      </main>
      {correctionLead && (
        <CorrectionModal
          row={correctionLead}
          correction={correction}
          values={correctionValues}
          loading={correctionLoading}
          saving={correctionSaving}
          error={correctionError}
          onChange={(key, value) =>
            setCorrectionValues((current) => ({ ...current, [key]: value }))
          }
          onSubmit={() => void resubmitCorrection()}
          onClose={closeCorrection}
        />
      )}
    </div>
  );
}

function CorrectionModal({
  row,
  correction,
  values,
  loading,
  saving,
  error,
  onChange,
  onSubmit,
  onClose,
}: {
  row: LeadRow;
  correction: CorrectionData | null;
  values: Record<string, unknown>;
  loading: boolean;
  saving: boolean;
  error: string;
  onChange: (key: string, value: unknown) => void;
  onSubmit: () => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/60 p-3 sm:p-6">
      <div className="mx-auto max-w-5xl overflow-hidden rounded-2xl bg-slate-50 shadow-2xl">
        <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b bg-white px-5 py-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-orange-600">
              Needs Correction
            </p>
            <h2 className="text-xl font-bold">
              {correction?.lead_code || row.lead_code || row.name}
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              Edit this same lead and submit it back to QC. A duplicate lead
              will not be created.
            </p>
          </div>
          <button
            disabled={saving}
            onClick={onClose}
            className="rounded-lg border p-2 text-slate-500"
          >
            <X size={18} />
          </button>
        </header>
        <div className="p-4 sm:p-5">
          {loading && (
            <div className="flex min-h-64 items-center justify-center gap-2 text-sm font-semibold text-slate-500">
              <Loader2 className="animate-spin" size={20} />
              Loading the original lead form...
            </div>
          )}
          {!loading && error && !correction && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">
              {error}
            </div>
          )}
          {correction && (
            <div className="space-y-5">
              <section className="rounded-2xl border border-orange-200 bg-orange-50 p-4">
                <div className="flex items-start gap-3">
                  <AlertTriangle
                    className="mt-0.5 shrink-0 text-orange-600"
                    size={20}
                  />
                  <div>
                    <h3 className="font-bold text-orange-950">
                      QC requested a correction
                    </h3>
                    <p className="mt-1 whitespace-pre-line text-sm text-orange-900">
                      {correction.correction_reason ||
                        "Review the lead information and correct the requested fields."}
                    </p>
                    <p className="mt-2 text-xs font-semibold text-orange-700">
                      Correction attempt {correction.correction_attempt} •{" "}
                      {formatDateLong(correction.appointment_date)} at{" "}
                      {formatTime(correction.start_time)} •{" "}
                      {correction.company_name}
                    </p>
                  </div>
                </div>
              </section>
              {error && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
                  {error}
                </div>
              )}
              <DynamicLeadForm
                schema={correction.form_schema || []}
                values={values}
                disabled={saving}
                recordingUploadSlug={correction.company_slug}
                onChange={onChange}
                onSubmit={onSubmit}
                submitLabel={
                  saving
                    ? "Submitting Correction..."
                    : "Submit Correction to QC"
                }
              />
              <div className="flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-xs text-slate-200">
                <Send size={15} />
                <span>
                  This updates the existing lead and returns it to Pending QC.
                  The company will still not see it until final approval.
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SectionToggle({
  open,
  onToggle,
  label,
  inverted = false,
}: {
  open: boolean;
  onToggle: () => void;
  label: string;
  inverted?: boolean;
}) {
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-label={`${open ? "Hide" : "Show"} ${label}`}
      onClick={onToggle}
      className={`inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-bold transition ${
        inverted
          ? "border-white/30 bg-white/10 text-white hover:bg-white/20"
          : "border-[#17314d] bg-white text-[#071525] hover:bg-slate-50"
      }`}
    >
      {open ? <EyeOff size={14} /> : <Eye size={14} />}
      {open ? "Hide" : "Show"}
      {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
    </button>
  );
}

function LeadSection({
  title,
  description,
  rows,
  onOpenCorrection,
  tone,
  open,
  onToggle,
}: {
  title: string;
  description: string;
  rows: LeadRow[];
  onOpenCorrection: (row: LeadRow) => void;
  tone: "orange" | "amber" | "green" | "red";
  open: boolean;
  onToggle: () => void;
}) {
  const borderTone =
    tone === "green"
      ? "border-emerald-300"
      : tone === "red"
        ? "border-red-300"
        : tone === "orange"
          ? "border-orange-300"
          : "border-amber-300";
  return (
    <section className={`readyops-agent-section overflow-hidden rounded-2xl border bg-white shadow-sm ${borderTone}`}>
      <div className="flex items-start justify-between gap-3 border-b border-[#17314d] bg-[#071525] px-4 py-3 text-white">
        <div>
          <h2 className="section-title">
            {title}{" "}
            <span className="ml-1 text-sm text-blue-200">({rows.length})</span>
          </h2>
          <p className="text-xs text-blue-100">{description}</p>
        </div>
        <SectionToggle
          open={open}
          onToggle={onToggle}
          label={title}
          inverted
        />
      </div>
      {!open ? null : rows.length === 0 ? (
        <div className="p-6 text-center text-sm text-slate-400">
          No appointments in this section.
        </div>
      ) : (
        <HorizontalScrollFrame
          ariaLabel={`${title} appointments horizontal scroll`}
        >
          <table className="readyops-agent-table w-full min-w-[1100px] text-sm">
            <thead className="table-header bg-[#0b223a] text-white">
              <tr className="text-left text-[10px] uppercase tracking-wide">
                <th className="p-3">Company</th>
                <th>Name</th>
                <th>Phone</th>
                <th>Address</th>
                <th>Appointment</th>
                <th>Status</th>
                <th>Inspector Notes / QC Reason</th>
                <th>Payroll</th>
                <th className="pr-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.lead_id}
                  onClick={() =>
                    row.qc_status === "needs_correction" &&
                    onOpenCorrection(row)
                  }
                  className={`border-t bg-slate-50 even:bg-slate-100/80 ${row.qc_status === "needs_correction" ? "cursor-pointer hover:bg-orange-50" : "hover:bg-blue-50"}`}
                >
                  <td className="company-link p-3">
                        {row.company_name}
                  </td>
                  <td>{row.name}</td>
                  <td>{row.phone}</td>
                  <td className="max-w-[240px] truncate">{row.address}</td>
                  <td>
                    <div className="font-semibold">
                      {formatDateLong(row.appointment_date)}
                    </div>
                    <div className="text-xs text-blue-600">
                      {formatTime(row.start_time)}
                    </div>
                  </td>
                  <td>
                    <span
                      className={`inline-flex rounded-md border px-2.5 py-1 text-[10px] font-black ${leadStatusClasses(row.qc_status === "approved" ? row.client_status || row.appointment_status || "pending" : row.qc_status)}`}
                    >
                      {leadStatusLabel(
                        row.qc_status === "approved"
                          ? row.client_status ||
                              row.appointment_status ||
                              "pending"
                          : row.qc_status,
                      )}
                    </span>
                  </td>
                  <td className="max-w-[260px] text-xs text-slate-600">
                    {["denied", "needs_correction"].includes(row.qc_status)
                      ? row.qc_reason ||
                        (row.qc_status === "denied"
                          ? "QC denied"
                          : "Correction requested")
                      : row.inspector_notes || "—"}
                  </td>
                  <td className="text-xs">
                    <div>
                      {row.payroll_week_start} → {row.payroll_week_end}
                    </div>
                    <div className="font-bold text-slate-700">
                      Pay: {row.pay_date}
                    </div>
                  </td>
                  <td className="pr-3 text-right">
                    {row.qc_status === "needs_correction" ? (
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          onOpenCorrection(row);
                        }}
                        className="inline-flex items-center gap-1 rounded-lg bg-orange-600 px-3 py-2 text-xs font-bold text-white hover:bg-orange-700"
                      >
                        <Edit3 size={13} />
                        Open & Correct
                      </button>
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </HorizontalScrollFrame>
      )}
    </section>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: string;
}) {
  const classes =
    tone === "green"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
      : tone === "red"
        ? "border-red-200 bg-red-50 text-red-800"
        : tone === "orange"
          ? "border-orange-200 bg-orange-50 text-orange-800"
          : "readyops-kpi-neutral border-slate-200 bg-white text-slate-800";
  const Icon =
    tone === "green"
      ? CheckCircle2
      : tone === "red"
        ? XCircle
        : tone === "orange"
          ? AlertTriangle
          : Clock3;
  return (
    <div className={`readyops-agent-metric relative min-h-[102px] rounded-2xl border p-4 ${classes}`}>
      <Icon
        size={31}
        strokeWidth={1.8}
        className="absolute right-4 top-1/2 -translate-y-1/2"
      />
      <p className="kpi-title max-w-[75%] uppercase tracking-wide">{label}</p>
      <p className="kpi-number mt-1">{value}</p>
    </div>
  );
}
function btn(active: boolean) {
  return `rounded-lg border px-4 py-2.5 text-xs font-bold transition ${active ? "border-blue-500 bg-blue-600 text-white shadow-sm" : "border-transparent bg-transparent text-white hover:border-white/20 hover:bg-white/10"}`;
}
function State({
  title,
  detail,
  loading,
}: {
  title: string;
  detail?: string;
  loading?: boolean;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
      <div className="text-center">
        {loading ? (
          <Loader2 className="mx-auto mb-3 animate-spin text-blue-600" />
        ) : (
          <XCircle className="mx-auto mb-3 text-red-500" />
        )}
        <h1 className="font-bold">{title}</h1>
        {detail && <p className="mt-2 text-sm text-slate-500">{detail}</p>}
        <button
          onClick={() => {
            location.href = "/";
          }}
          className="mt-4 inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-xs font-bold"
        >
          <ArrowLeft size={13} /> Back
        </button>
      </div>
    </div>
  );
}
