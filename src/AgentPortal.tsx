import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Edit3,
  ExternalLink,
  Loader2,
  RefreshCw,
  Send,
  X,
  XCircle,
} from "lucide-react";
import { DynamicLeadForm, PortalFormSection } from "./DynamicLeadForm";
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

type RangeMode = "this" | "previous" | "all";
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
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-30 border-b bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-blue-600">
              Ready Ops Agent Portal
            </p>
            <h1 className="text-xl font-bold">{data.agent.name}</h1>
          </div>
          <button onClick={() => void load()} className="rounded-lg border p-2">
            <RefreshCw size={16} />
          </button>
        </div>
      </header>
      <main className="mx-auto max-w-6xl space-y-5 p-4">
        {message && (
          <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
            <CheckCircle2 size={17} />
            {message}
          </div>
        )}
        <section className="rounded-2xl border bg-white p-4">
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
            <label className="ml-auto text-xs font-bold text-slate-500">
              Payroll Pay Date
              <select
                value={payDate}
                onChange={(event) => setPayDate(event.target.value)}
                className="ml-2 rounded-lg border px-3 py-2 text-sm text-slate-800"
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
          <p className="mt-3 text-xs text-slate-500">
            Payroll week is Sunday–Saturday. A lead is assigned to payroll by
            its appointment date; the pay date is the following Saturday.
          </p>
        </section>
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
        />
        <LeadSection
          title="QC Pending"
          description="Submitted to QC. The appointment slot is held, but the company cannot see it yet."
          rows={pending}
          onOpenCorrection={openCorrection}
        />
        <LeadSection
          title="Approved Leads"
          description="QC approved. The company can now see and work these appointments."
          rows={approved}
          onOpenCorrection={openCorrection}
        />
        <LeadSection
          title="QC Denied"
          description="These remain in your history with the QC denial reason."
          rows={denied}
          onOpenCorrection={openCorrection}
        />
        <section className="rounded-2xl border bg-white p-4">
          <h2 className="font-bold">Book Another Appointment</h2>
          <p className="mt-1 text-sm text-slate-500">
            These links identify you automatically so new appointments are
            attached to this agent portal.
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {data.companies.map((company) => (
              <a
                key={company.id}
                href={`/book/${company.public_slug}?agent_token=${encodeURIComponent(token)}&agent=${encodeURIComponent(data.agent.name)}`}
                className="flex items-center justify-between rounded-xl border px-3 py-3 text-sm font-bold hover:border-blue-300 hover:bg-blue-50"
              >
                <span>
                  {company.name}
                  {company.state ? ` — ${company.state}` : ""}
                </span>
                <ExternalLink size={14} />
              </a>
            ))}
          </div>
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

function LeadSection({
  title,
  description,
  rows,
  onOpenCorrection,
}: {
  title: string;
  description: string;
  rows: LeadRow[];
  onOpenCorrection: (row: LeadRow) => void;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border bg-white">
      <div className="border-b p-4">
        <h2 className="font-bold">
          {title}{" "}
          <span className="ml-1 text-sm text-slate-400">({rows.length})</span>
        </h2>
        <p className="text-xs text-slate-500">{description}</p>
      </div>
      {rows.length === 0 ? (
        <div className="p-6 text-center text-sm text-slate-400">
          No appointments in this section.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px] text-sm">
            <thead>
              <tr className="text-left text-[10px] uppercase text-slate-400">
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
                  className={`border-t ${row.qc_status === "needs_correction" ? "cursor-pointer bg-orange-50/40 hover:bg-orange-50" : ""}`}
                >
                  <td className="p-3 font-bold">
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
        </div>
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
          : "border-amber-200 bg-amber-50 text-amber-800";
  return (
    <div className={`rounded-2xl border p-4 ${classes}`}>
      <p className="text-xs font-bold uppercase tracking-wide">{label}</p>
      <p className="mt-1 text-3xl font-black">{value}</p>
    </div>
  );
}
function btn(active: boolean) {
  return `rounded-lg px-3 py-2 text-xs font-bold ${active ? "bg-blue-600 text-white" : "border bg-white text-slate-600"}`;
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
