import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowLeft, Loader2, Send, X, XCircle } from "lucide-react";
import { AgentWorkspace } from "./AgentWorkspace";
import { DynamicLeadForm, PortalFormSection } from "./DynamicLeadForm";
import { supabase } from "./supabase";
import {
  addDays,
  buildLeadTemplate,
  calendarWeekStart,
  formatDateLong,
  formatTime,
  localDate,
  normalizePropertyUnits,
  rpcError,
} from "./portalUtils";

type RangeMode = "this" | "previous" | "all";
export type LeadRow = {
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
  const [mode, setMode] = useState<RangeMode>("all");
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
        start: "0001-01-01",
        end: "9999-12-31",
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
      ...normalizePropertyUnits(correctionValues),
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
    <div>
      <AgentWorkspace name={data.agent.name} token={token} rows={visible} companies={data.companies}
        mode={mode} setMode={setMode} payDate={payDate} setPayDate={setPayDate} payDates={payDates}
        range={range} loading={loading} message={message} error={error} reload={() => void load()}
        correct={row => void openCorrection(row)} />
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
                schema={(correction.values._service_template as { form_schema?: PortalFormSection[] } | undefined)?.form_schema || correction.form_schema || []}
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
