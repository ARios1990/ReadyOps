import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Download,
  ExternalLink,
  FileText,
  Headphones,
  History,
  Home,
  Loader2,
  Pencil,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
  X,
} from "lucide-react";
import { AdminWorkspaceShell } from "./AdminWorkspaceShell";
import { supabase } from "./supabase";
import { formatDateLong, formatTime, rpcError } from "./portalUtils";
import { leadStatusClasses, leadStatusLabel } from "./leadStatusPresentation";

// RPC payloads intentionally stay flexible because legacy form_data keys remain visible in CRM.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Obj = Record<string, any>;
type CrmData = {
  rows: Obj[];
  total: number;
  limit: number;
  offset: number;
  summary: Obj;
  companies: Obj[];
  sources: string[];
};
type ReferenceData = { agents: Obj[]; companies: Obj[]; locations: Obj[] };

const PAGE_SIZE = 50;
const EMPTY_DATA: CrmData = {
  rows: [],
  total: 0,
  limit: PAGE_SIZE,
  offset: 0,
  summary: {},
  companies: [],
  sources: [],
};

export function AdminLeadCRM() {
  const [data, setData] = useState<CrmData>(EMPTY_DATA);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [qcStatus, setQcStatus] = useState("all");
  const [clientStatus, setClientStatus] = useState("all");
  const [source, setSource] = useState("all");
  const [dateBasis, setDateBasis] = useState<"received" | "appointment">(
    "received",
  );
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [offset, setOffset] = useState(0);
  const [selectedId, setSelectedId] = useState("");
  const [startEditing, setStartEditing] = useState(false);
  const [detail, setDetail] = useState<Obj | null>(null);
  const [references, setReferences] = useState<ReferenceData>({
    agents: [],
    companies: [],
    locations: [],
  });
  const [detailLoading, setDetailLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(
    async (quiet = false) => {
      if (!quiet) setLoading(true);
      setError("");
      const [crmResult, referenceResult] = await Promise.all([
        supabase.rpc("get_admin_lead_crm", {
          p_search: search || null,
          p_company_id: companyId || null,
          p_qc_status: qcStatus === "all" ? null : qcStatus,
          p_client_status: clientStatus === "all" ? null : clientStatus,
          p_source: source === "all" ? null : source,
          p_date_basis: dateBasis,
          p_start_date: startDate || null,
          p_end_date: endDate || null,
          p_limit: PAGE_SIZE,
          p_offset: offset,
        }),
        supabase.rpc("get_qc_reference_data"),
      ]);
      if (crmResult.error || referenceResult.error)
        setError(rpcError(crmResult.error || referenceResult.error));
      else {
        setData((crmResult.data || EMPTY_DATA) as CrmData);
        setReferences(
          (referenceResult.data || {
            agents: [],
            companies: [],
            locations: [],
          }) as ReferenceData,
        );
      }
      setLoading(false);
    },
    [
      clientStatus,
      companyId,
      dateBasis,
      endDate,
      offset,
      qcStatus,
      search,
      source,
      startDate,
    ],
  );

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    const channel = supabase
      .channel("readyops-admin-crm-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "portal_leads" },
        () => void load(true),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "portal_appointments" },
        () => void load(true),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "qc_review_cycles" },
        () => void load(true),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [load]);

  const totalPages = Math.max(
    1,
    Math.ceil(Number(data.total || 0) / PAGE_SIZE),
  );
  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const visibleRange = data.total
    ? `${offset + 1}–${Math.min(offset + data.rows.length, data.total)} of ${data.total}`
    : "0 records";

  async function openDetail(leadId: string, edit = false) {
    setSelectedId(leadId);
    setStartEditing(edit);
    setDetail(null);
    setDetailLoading(true);
    setError("");
    const { data: result, error: detailError } = await supabase.rpc(
      "get_admin_lead_crm_detail",
      { p_lead_id: leadId },
    );
    if (detailError) {
      setError(rpcError(detailError));
      setSelectedId("");
    } else setDetail(result as Obj);
    setDetailLoading(false);
  }

  async function saveLeadEdits(
    leadId: string,
    leadPatch: Obj,
    appointmentPatch: Obj,
  ): Promise<boolean> {
    setError("");
    const { error: updateError } = await supabase.rpc("admin_update_lead_crm", {
      p_lead_id: leadId,
      p_lead_patch: leadPatch,
      p_appointment_patch: appointmentPatch,
    });
    if (updateError) {
      setError(rpcError(updateError));
      return false;
    }
    await load(true);
    await openDetail(leadId, false);
    return true;
  }

  function updateFilter(action: () => void) {
    setOffset(0);
    action();
  }

  function exportCsv() {
    const headers = [
      "Lead ID",
      "Status",
      "Homeowner Name",
      "Phone",
      "Email",
      "Address",
      "City",
      "State",
      "ZIP",
      "Appointment Date",
      "Appointment Time",
      "Company",
      "Agent",
      "Service",
      "Roof Age",
      "Roof Type",
      "Insurance",
      "Insurance Carrier",
      "Visible Damage",
      "Storm / Hail Date",
      "QC Status",
      "Inspector Status",
      "Client Status",
      "Source",
      "Notes",
    ];
    const rows = data.rows.map((row) => {
      const form = row.lead.form_data || {};
      return [
        row.lead.lead_code,
        primaryStatus(row),
        row.lead.full_name,
        row.lead.phone_number,
        row.lead.email,
        row.lead.address,
        row.lead.city,
        row.lead.state,
        row.lead.zip_code,
        row.appointment.appointment_date,
        row.appointment.start_time,
        displayCompanyName(row.lead.qc_status, row.company.name),
        row.agent.name,
        row.lead.service_needed,
        form.roof_age,
        form.roof_type,
        form.insurance,
        form.insurance_name,
        form.visible_damage,
        form.storm_date || form.hail_date || form.last_checked_on,
        row.lead.qc_status,
        row.appointment.inspection_status,
        row.appointment.client_status || row.appointment.canonical_status,
        row.lead.source,
        row.lead.notes,
      ]
        .map(csvCell)
        .join(",");
    });
    const blob = new Blob(
      [[headers.map(csvCell).join(","), ...rows].join("\n")],
      { type: "text/csv;charset=utf-8" },
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `readyops-admin-crm-${dateBasis}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const actions = (
    <>
      <button
        className="readyops-ref-secondary"
        onClick={exportCsv}
        disabled={!data.rows.length}
      >
        <Download size={14} /> Export Page
      </button>
      <button className="readyops-ref-secondary" onClick={() => void load()}>
        <RefreshCw size={14} /> Refresh
      </button>
    </>
  );

  return (
    <AdminWorkspaceShell
      active="leads"
      title="All Leads"
      subtitle="Spreadsheet view of every submitted company lead. Corrections update the shared QC and company record."
      actions={actions}
    >
      {error && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <section className="readyops-ref-metrics">
        <Metric
          icon={<FileText />}
          tone="blue"
          label="Lead Records"
          value={data.summary?.total || 0}
        />
        <Metric
          icon={<ShieldCheck />}
          tone="orange"
          label="Pending QC"
          value={data.summary?.pending_qc || 0}
        />
        <Metric
          icon={<ShieldCheck />}
          tone="green"
          label="QC Approved"
          value={data.summary?.approved || 0}
        />
        <Metric
          icon={<ExternalLink />}
          tone="blue"
          label="Sent to Client"
          value={data.summary?.sent_to_client || 0}
        />
        <Metric
          icon={<Home />}
          tone="purple"
          label="Signed Contracts"
          value={data.summary?.signed_contracts || 0}
        />
        <Metric
          icon={<CircleDollarSign />}
          tone="green"
          label="Lead Revenue"
          value={money(data.summary?.revenue)}
        />
      </section>

      <section className="mb-4 rounded-2xl border bg-white/95 p-3 shadow-sm">
        <div className="grid gap-2 md:grid-cols-3 xl:grid-cols-6">
          <form
            className="relative md:col-span-2"
            onSubmit={(event) => {
              event.preventDefault();
              updateFilter(() => setSearch(searchInput.trim()));
            }}
          >
            <Search
              size={14}
              className="absolute left-3 top-3 text-slate-400"
            />
            <input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Search lead ID, homeowner, phone, address…"
              className="h-10 w-full rounded-lg border bg-white pl-9 pr-3 text-xs"
            />
          </form>
          <Filter
            value={companyId}
            onChange={(value) => updateFilter(() => setCompanyId(value))}
            label="All Companies"
            options={data.companies.map((company) => ({
              value: company.id,
              label: company.name,
            }))}
          />
          <Filter
            value={qcStatus}
            onChange={(value) => updateFilter(() => setQcStatus(value))}
            label="All QC Statuses"
            options={[
              ["pending", "Pending QC"],
              ["in_review", "In Review"],
              ["manager_approved", "Awaiting Final QC"],
              ["approved", "Approved"],
              ["needs_correction", "Needs Correction"],
              ["denied", "Denied"],
            ].map(([value, label]) => ({ value, label }))}
          />
          <Filter
            value={clientStatus}
            onChange={(value) => updateFilter(() => setClientStatus(value))}
            label="All Client Statuses"
            options={[
              ["pending", "Pending"],
              ["confirmed", "Confirmed"],
              ["good_inspected", "Good / Inspected"],
              ["signed_contract", "Signed Contract"],
              ["no_show", "No Show"],
              ["bad", "Bad"],
              ["rescheduled", "Rescheduled"],
            ].map(([value, label]) => ({ value, label }))}
          />
          <Filter
            value={source}
            onChange={(value) => updateFilter(() => setSource(value))}
            label="All Sources"
            options={data.sources.map((value) => ({ value, label: value }))}
          />
          <Filter
            value={dateBasis}
            onChange={(value) =>
              updateFilter(() =>
                setDateBasis(
                  value === "appointment" ? "appointment" : "received",
                ),
              )
            }
            label="Lead Received Date"
            allValue="received"
            options={[{ value: "appointment", label: "Appointment Date" }]}
          />
          <label className="text-[10px] font-bold uppercase text-slate-500">
            From
            <input
              type="date"
              value={startDate}
              onChange={(event) =>
                updateFilter(() => setStartDate(event.target.value))
              }
              className="mt-1 h-10 w-full rounded-lg border bg-white px-3 text-xs font-semibold"
            />
          </label>
          <label className="text-[10px] font-bold uppercase text-slate-500">
            Through
            <input
              type="date"
              value={endDate}
              onChange={(event) =>
                updateFilter(() => setEndDate(event.target.value))
              }
              className="mt-1 h-10 w-full rounded-lg border bg-white px-3 text-xs font-semibold"
            />
          </label>
          <button
            onClick={() => {
              setSearchInput("");
              setSearch("");
              setCompanyId("");
              setQcStatus("all");
              setClientStatus("all");
              setSource("all");
              setDateBasis("received");
              setStartDate("");
              setEndDate("");
              setOffset(0);
            }}
            className="h-10 self-end rounded-lg border bg-slate-50 px-3 text-xs font-bold text-slate-600"
          >
            Clear Filters
          </button>
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
          <div>
            <h3 className="font-black">All Companies Lead Spreadsheet</h3>
            <p className="text-xs text-slate-500">
              {visibleRange} • click a row for the complete record or use Edit
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs font-bold">
            <button
              disabled={page <= 1 || loading}
              onClick={() =>
                setOffset((value) => Math.max(0, value - PAGE_SIZE))
              }
              className="rounded-lg border p-2 disabled:opacity-40"
            >
              <ChevronLeft size={15} />
            </button>
            Page {page} of {totalPages}
            <button
              disabled={page >= totalPages || loading}
              onClick={() => setOffset((value) => value + PAGE_SIZE)}
              className="rounded-lg border p-2 disabled:opacity-40"
            >
              <ChevronRight size={15} />
            </button>
          </div>
        </div>
        {loading ? (
          <div className="grid min-h-72 place-items-center">
            <Loader2 className="animate-spin text-blue-600" />
          </div>
        ) : !data.rows.length ? (
          <div className="grid min-h-72 place-items-center text-center">
            <div>
              <FileText className="mx-auto text-slate-300" size={34} />
              <p className="mt-3 font-bold">No leads match these filters.</p>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[3500px] border-separate border-spacing-0 text-xs">
              <thead className="sticky top-0 bg-slate-50 text-left text-[10px] uppercase tracking-wide text-slate-500">
                <tr>
                  {[
                    "Lead ID",
                    "Status",
                    "Homeowner Name",
                    "Phone",
                    "Email",
                    "Address",
                    "City",
                    "State",
                    "ZIP",
                    "Appointment Date",
                    "Appointment Time",
                    "Lead Received",
                    "Company",
                    "Agent",
                    "Service",
                    "Roof Age",
                    "Roof Type",
                    "Insurance",
                    "Insurance Carrier",
                    "Visible Damage",
                    "Storm / Hail Date",
                    "QC Status",
                    "Inspector Status",
                    "Client Status",
                    "Source",
                    "Notes",
                    "Actions",
                  ].map((label, index, labels) => (
                    <th
                      key={label}
                      className={`whitespace-nowrap border-b px-3 py-3 ${index === 0 ? "sticky left-0 z-20 bg-slate-50" : ""} ${index === labels.length - 1 ? "sticky right-0 z-20 bg-slate-50" : ""}`}
                    >
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row) => (
                  <LeadRow
                    key={row.lead.id}
                    row={row}
                    onOpen={() => void openDetail(row.lead.id, true)}
                    onEdit={() => void openDetail(row.lead.id, true)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {selectedId && (
        <LeadDetailModal
          detail={detail}
          loading={detailLoading}
          close={() => {
            setSelectedId("");
            setDetail(null);
          }}
          agents={references.agents}
          companies={references.companies}
          locations={references.locations}
          initialEditing={startEditing}
          onSave={saveLeadEdits}
        />
      )}
    </AdminWorkspaceShell>
  );
}

function LeadRow({
  row,
  onOpen,
  onEdit,
}: {
  row: Obj;
  onOpen: () => void;
  onEdit: () => void;
}) {
  const form = row.lead.form_data || {};
  const stormDate = form.storm_date || form.hail_date || form.last_checked_on;
  return (
    <tr
      onClick={onOpen}
      className="cursor-pointer border-t align-top hover:bg-blue-50/50"
    >
      <Cell className="sticky left-0 z-10 border-r bg-white font-black text-blue-700">
        {row.lead.lead_code || shortId(row.lead.id)}
      </Cell>
      <Cell>
        <Status value={primaryStatus(row)} />
      </Cell>
      <Cell className="font-bold">{value(row.lead.full_name)}</Cell>
      <Cell>{value(row.lead.phone_number)}</Cell>
      <Cell>{value(row.lead.email)}</Cell>
      <Cell className="max-w-[260px]">{value(row.lead.address)}</Cell>
      <Cell>{value(row.lead.city)}</Cell>
      <Cell>{value(row.lead.state)}</Cell>
      <Cell>{value(row.lead.zip_code)}</Cell>
      <Cell>{dateValue(row.appointment.appointment_date)}</Cell>
      <Cell>{timeValue(row.appointment.start_time)}</Cell>
      <Cell>
        {row.lead.created_at
          ? new Date(row.lead.created_at).toLocaleString()
          : "—"}
      </Cell>
      <Cell className="font-semibold">
        {row.lead.qc_status === "denied" ? (
          <span className="font-black text-red-700">QC Denied</span>
        ) : (
          <a
            href={`/admin/operations?company=${row.company.id}`}
            onClick={(event) => event.stopPropagation()}
            className="inline-flex items-center gap-1 text-blue-700 hover:underline"
            title="Open this company in Companies & Scheduling"
          >
            {value(row.company.name)} <ExternalLink size={11} />
          </a>
        )}
      </Cell>
      <Cell>{value(row.agent.name)}</Cell>
      <Cell>{value(row.lead.service_needed)}</Cell>
      <Cell>{value(form.roof_age)}</Cell>
      <Cell>{value(form.roof_type)}</Cell>
      <Cell>{value(form.insurance)}</Cell>
      <Cell>{value(form.insurance_name)}</Cell>
      <Cell>{value(form.visible_damage)}</Cell>
      <Cell>{value(stormDate)}</Cell>
      <Cell>
        <Status value={row.lead.qc_status} />
      </Cell>
      <Cell>
        <Status value={row.appointment.inspection_status} />
      </Cell>
      <Cell>
        <Status
          value={
            row.appointment.client_status || row.appointment.canonical_status
          }
        />
      </Cell>
      <Cell>{value(row.lead.source)}</Cell>
      <Cell className="max-w-[300px] truncate" title={row.lead.notes || ""}>
        {value(row.lead.notes)}
      </Cell>
      <Cell className="sticky right-0 z-10 border-l bg-white">
        <button
          onClick={(event) => {
            event.stopPropagation();
            onEdit();
          }}
          className="inline-flex items-center gap-1 rounded-lg border border-blue-300 bg-blue-50 px-3 py-1.5 font-bold text-blue-700"
        >
          <Pencil size={12} /> Edit
        </button>
      </Cell>
    </tr>
  );
}

function LeadDetailModal({
  detail,
  loading,
  close,
  agents,
  companies,
  locations,
  initialEditing,
  onSave,
}: {
  detail: Obj | null;
  loading: boolean;
  close: () => void;
  agents: Obj[];
  companies: Obj[];
  locations: Obj[];
  initialEditing: boolean;
  onSave: (
    leadId: string,
    leadPatch: Obj,
    appointmentPatch: Obj,
  ) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(initialEditing);
  const [draft, setDraft] = useState<Obj>({});
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState("");
  useEffect(() => {
    if (detail) {
      setDraft(buildEditDraft(detail));
      setEditing(initialEditing);
      setEditError("");
    }
  }, [detail, initialEditing]);

  async function save() {
    if (!detail?.lead?.id) return;
    setSaving(true);
    setEditError("");
    const form = draft.form_data || {};
    const leadPatch = {
      full_name: draft.full_name,
      phone_number: draft.phone_number,
      email: draft.email,
      address: draft.address,
      city: draft.city,
      state: draft.state,
      zip_code: draft.zip_code,
      service_needed: draft.service_needed,
      language: draft.language,
      notes: draft.notes,
      home_value: draft.home_value,
      sq_ft: draft.sq_ft,
      web_url: draft.web_url,
      source: draft.source,
      source_lead_id: draft.source_lead_id,
      source_disposition: draft.source_disposition,
      qualification_status: draft.qualification_status,
      qualification_reasons: draft.qualification_reasons,
      company_id: draft.company_id,
      location_id: draft.location_id,
      agent_id: draft.agent_id,
      qc_status: draft.qc_status,
      qc_reason: draft.qc_reason,
      qc_notes: draft.qc_notes,
      recording_url: draft.recording_url,
      share_recording_with_company: Boolean(draft.share_recording_with_company),
      form_data: form,
    };
    const appointmentPatch = detail.appointment?.id
      ? {
          appointment_date: draft.appointment_date,
          start_time: draft.start_time,
          status: draft.appointment_status,
          client_status: draft.client_status,
          attendance_status: draft.attendance_status,
          inspection_status: draft.inspection_status,
          sales_outcome: draft.sales_outcome,
          inspector_notes: draft.inspector_notes,
          company_action: draft.company_action,
        }
      : {};
    const saved = await onSave(detail.lead.id, leadPatch, appointmentPatch);
    if (!saved)
      setEditError(
        "The record could not be saved. Review the message above and try again.",
      );
    setSaving(false);
  }

  if (loading || !detail)
    return (
      <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/55 p-6">
        <section className="grid min-h-40 w-full max-w-md place-items-center rounded-2xl bg-white shadow-2xl">
          <Loader2 className="animate-spin text-blue-600" />
        </section>
      </div>
    );
  const lead = detail.lead || {};
  const appointment = detail.appointment || {};
  const form = lead.form_data || {};
  const currentStatus =
    appointment.client_status || appointment.canonical_status || lead.qc_status;
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/55 p-3 sm:p-6">
      <section className="mx-auto max-w-7xl overflow-hidden rounded-2xl bg-white shadow-2xl">
        <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b bg-white px-5 py-4">
          <div>
            <p className="text-xs font-black uppercase tracking-wider text-blue-600">
              {lead.lead_code || shortId(lead.id)}
            </p>
            <h2 className="text-xl font-black">
              {value(lead.full_name)} —{" "}
              {displayCompanyName(lead.qc_status, detail.company?.name)}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            {lead.qc_status !== "denied" && (
              <a
                href={`/admin/operations?company=${detail.company?.id}`}
                className="inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-xs font-bold text-blue-700"
              >
                <ExternalLink size={13} /> Open Company
              </a>
            )}
            {!editing && (
              <button
                onClick={() => setEditing(true)}
                className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white"
              >
                <Pencil size={13} /> Edit Record
              </button>
            )}
            <button onClick={close} className="rounded-lg border p-2">
              <X size={18} />
            </button>
          </div>
        </header>
        <div className="space-y-5 p-5">
          {editing ? (
            <LeadEditForm
              detail={detail}
              draft={draft}
              setDraft={setDraft}
              agents={agents}
              companies={companies}
              locations={locations}
              saving={saving}
              error={editError}
              cancel={() => {
                setDraft(buildEditDraft(detail));
                setEditing(false);
                setEditError("");
              }}
              save={() => void save()}
            />
          ) : (
            <>
              <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <HeroValue
                  label="Lead ID / Status"
                  value={
                    <>
                      <strong>{lead.lead_code || shortId(lead.id)}</strong>
                      <Status value={currentStatus} />
                    </>
                  }
                />
                <HeroValue label="Homeowner" value={value(lead.full_name)} />
                <HeroValue
                  label="Phone / Email"
                  value={
                    <div>
                      <a
                        className="font-bold text-blue-700"
                        href={`tel:${lead.phone_number || ""}`}
                      >
                        {value(lead.phone_number)}
                      </a>
                      <p className="text-xs text-slate-500">
                        {value(lead.email)}
                      </p>
                    </div>
                  }
                />
                <HeroValue
                  label="Property"
                  value={
                    [lead.address, lead.city, lead.state, lead.zip_code]
                      .filter(Boolean)
                      .join(", ") || "—"
                  }
                />
                <HeroValue
                  label="Appointment"
                  value={
                    appointment.appointment_date
                      ? `${formatDateLong(appointment.appointment_date)} · ${timeValue(appointment.start_time)}`
                      : "Not scheduled"
                  }
                />
                <HeroValue
                  label="Company / Inspector"
                  value={
                    <div>
                      {displayCompanyName(
                        lead.qc_status,
                        detail.company?.name,
                      )}
                      <p className="text-xs text-slate-500">
                        Inspector: {value(detail.inspector?.name)}
                      </p>
                    </div>
                  }
                />
                <HeroValue
                  label="Agent / Setter"
                  value={value(detail.agent?.name || lead.agent_name)}
                />
                <HeroValue
                  label="Lead Received"
                  value={
                    lead.created_at
                      ? new Date(lead.created_at).toLocaleString()
                      : "—"
                  }
                />
              </section>

              <div className="grid gap-5 xl:grid-cols-3">
                <RecordSection
                  title="Property & Qualification"
                  icon={<Home size={17} />}
                >
                  <RecordGrid
                    entries={[
                      ["Service / Lead Type", lead.service_needed],
                      ["Roof Age", form.roof_age],
                      ["Roof Type", form.roof_type],
                      ["Stories", form.stories],
                      ["Home Type", form.home_type],
                      ["SQ FT", lead.sq_ft || form.sq_ft],
                      ["Home Value", money(lead.home_value || form.home_value)],
                      ["Insurance", form.insurance],
                      ["Carrier", form.insurance_name],
                      ["Claim Filed", form.claim_filed],
                      ["Visible Damage", form.visible_damage],
                      ["Damage Type", form.damage_type],
                      ["Hail Size", form.hail_size],
                      ["Last Checked", form.last_checked_on],
                      ["Contract", form.contract],
                      ["Qualification", lead.qualification_status],
                    ]}
                  />
                </RecordSection>
                <RecordSection
                  title="Operations"
                  icon={<ShieldCheck size={17} />}
                >
                  <RecordGrid
                    entries={[
                      ["QC Status", lead.qc_status],
                      ["QC Reason", lead.qc_reason],
                      ["Inspector Status", appointment.inspection_status],
                      ["Client Status", appointment.client_status],
                      [
                        "Appointment Status",
                        appointment.canonical_status || appointment.status,
                      ],
                      [
                        "Sent to Client",
                        appointment.company_visible_at
                          ? new Date(
                              appointment.company_visible_at,
                            ).toLocaleString()
                          : "Not sent",
                      ],
                      ["Attendance", appointment.attendance_status],
                      ["Appointment Result", appointment.sales_outcome],
                      [
                        "Signed Contract",
                        appointment.sales_outcome === "signed_contract" ||
                        appointment.canonical_status === "signed_contract"
                          ? "Yes"
                          : "No",
                      ],
                      ["Source", lead.source],
                      ["Source Lead ID", lead.source_lead_id],
                      ["Source Disposition", lead.source_disposition],
                    ]}
                  />
                </RecordSection>
                <RecordSection
                  title="Financial Outcome"
                  icon={<CircleDollarSign size={17} />}
                >
                  <RecordGrid
                    entries={[
                      ["Package", detail.package?.package_name],
                      [
                        "Lead Price",
                        money(
                          detail.invoice?.unit_rate ||
                            detail.package?.amount_per_lead,
                        ),
                      ],
                      [
                        "Revenue",
                        money(
                          detail.invoice?.line_total ||
                            detail.package?.amount_per_lead,
                        ),
                      ],
                      ["Invoice", detail.invoice?.invoice_number],
                      ["Invoice Status", detail.invoice?.status],
                      ["Amount Paid", money(detail.invoice?.amount_paid)],
                      ["Balance", money(detail.invoice?.balance)],
                      ["Due Date", detail.invoice?.due_date],
                    ]}
                  />
                </RecordSection>
              </div>

              <div className="grid gap-5 lg:grid-cols-2">
                <RecordSection
                  title="Notes & Recording"
                  icon={<Headphones size={17} />}
                >
                  <p className="whitespace-pre-wrap text-sm text-slate-700">
                    {value(lead.notes)}
                  </p>
                  {lead.recording_url ? (
                    <a
                      href={lead.recording_url}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-4 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-xs font-bold text-white"
                    >
                      <Headphones size={14} /> Open Call Recording
                    </a>
                  ) : (
                    <p className="mt-4 text-xs font-semibold text-slate-400">
                      No recording attached.
                    </p>
                  )}
                </RecordSection>
                <RecordSection
                  title="Record History"
                  icon={<History size={17} />}
                >
                  <HistoryList
                    qc={detail.qc_history || []}
                    reschedules={detail.reschedule_history || []}
                    audits={detail.audit_history || []}
                  />
                </RecordSection>
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}

function LeadEditForm({
  detail,
  draft,
  setDraft,
  agents,
  companies,
  locations,
  saving,
  error,
  cancel,
  save,
}: {
  detail: Obj;
  draft: Obj;
  setDraft: (value: Obj) => void;
  agents: Obj[];
  companies: Obj[];
  locations: Obj[];
  saving: boolean;
  error: string;
  cancel: () => void;
  save: () => void;
}) {
  const set = (key: string, next: string | boolean) =>
    setDraft({ ...draft, [key]: next });
  const setForm = (key: string, next: string) =>
    setDraft({
      ...draft,
      form_data: { ...(draft.form_data || {}), [key]: next },
    });
  const form = draft.form_data || {};
  const companyLocations = locations.filter(
    (location) => location.company_id === draft.company_id,
  );
  return (
    <section className="space-y-5">
      <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-xs text-blue-800">
        You are editing the shared lead record. Saving here updates QC, company
        portals, reports, and every other screen that uses this lead. Every save
        is recorded in the audit history. QC-denied leads use this exact same
        editor—City, State, ZIP, Company, and all other business fields remain
        editable.
      </div>
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-semibold text-red-700">
          {error}
        </div>
      )}

      <EditSection title="Homeowner & Property">
        <EditField
          label="Homeowner Name"
          value={draft.full_name}
          onChange={(value) => set("full_name", value)}
          required
        />
        <EditField
          label="Phone"
          value={draft.phone_number}
          onChange={(value) => set("phone_number", value)}
          required
        />
        <EditField
          label="Email"
          type="email"
          value={draft.email}
          onChange={(value) => set("email", value)}
        />
        <EditField
          label="Property Address"
          value={draft.address}
          onChange={(value) => set("address", value)}
          required
          wide
        />
        <EditField
          label="City"
          value={draft.city}
          onChange={(value) => set("city", value)}
        />
        <EditField
          label="State"
          value={draft.state}
          onChange={(value) => set("state", value)}
        />
        <EditField
          label="ZIP"
          value={draft.zip_code}
          onChange={(value) => set("zip_code", value)}
        />
        <EditField
          label="Service / Lead Type"
          value={draft.service_needed}
          onChange={(value) => set("service_needed", value)}
        />
        <EditField
          label="Language"
          value={draft.language}
          onChange={(value) => set("language", value)}
        />
        <EditField
          label="Home Value"
          value={draft.home_value}
          onChange={(value) => set("home_value", value)}
        />
        <EditField
          label="SQ FT"
          value={draft.sq_ft}
          onChange={(value) => set("sq_ft", value)}
        />
        <EditField
          label="Web Link"
          type="url"
          value={draft.web_url}
          onChange={(value) => set("web_url", value)}
          wide
        />
      </EditSection>

      <EditSection title="Assignment & Source">
        <EditSelect
          label="Company"
          value={draft.company_id}
          onChange={(nextCompanyId) =>
            setDraft({
              ...draft,
              company_id: nextCompanyId,
              location_id: locations.some(
                (location) =>
                  location.id === draft.location_id &&
                  location.company_id === nextCompanyId,
              )
                ? draft.location_id
                : "",
            })
          }
          options={companies.map((company) => ({
            value: company.id,
            label: company.name,
          }))}
        />
        <EditSelect
          label="Company Location"
          value={draft.location_id}
          onChange={(value) => set("location_id", value)}
          options={[
            { value: "", label: "No location" },
            ...companyLocations.map((location) => ({
              value: location.id,
              label: location.label,
            })),
          ]}
        />
        <EditSelect
          label="Assigned Agent"
          value={draft.agent_id}
          onChange={(value) => set("agent_id", value)}
          options={[
            { value: "", label: "Unassigned" },
            ...agents.map((agent) => ({ value: agent.id, label: agent.name })),
          ]}
        />
        <EditField
          label="Source / Campaign"
          value={draft.source}
          onChange={(value) => set("source", value)}
        />
        <EditField
          label="Source Lead ID"
          value={draft.source_lead_id}
          onChange={(value) => set("source_lead_id", value)}
        />
        <EditField
          label="Source Disposition"
          value={draft.source_disposition}
          onChange={(value) => set("source_disposition", value)}
        />
        <EditSelect
          label="Qualification Status"
          value={draft.qualification_status}
          onChange={(value) => set("qualification_status", value)}
          options={statusOptions(["qualified", "review_needed", "do_not_book"])}
        />
      </EditSection>

      <EditSection title="QC & Recording">
        <EditSelect
          label="QC Status"
          value={draft.qc_status}
          onChange={(value) => set("qc_status", value)}
          options={statusOptions([
            "pending",
            "in_review",
            "manager_approved",
            "approved",
            "denied",
            "needs_correction",
          ])}
        />
        <EditField
          label="QC Reason"
          value={draft.qc_reason}
          onChange={(value) => set("qc_reason", value)}
        />
        <EditTextArea
          label="QC Notes"
          value={draft.qc_notes}
          onChange={(value) => set("qc_notes", value)}
          wide
        />
        <EditField
          label="Recording URL"
          type="url"
          value={draft.recording_url}
          onChange={(value) => set("recording_url", value)}
          wide
        />
        <EditCheckbox
          label="Share recording with company"
          checked={draft.share_recording_with_company}
          onChange={(value) => set("share_recording_with_company", value)}
        />
      </EditSection>

      {detail.appointment?.id && (
        <EditSection title="Appointment & Outcome">
          <EditField
            label="Appointment Date"
            type="date"
            value={draft.appointment_date}
            onChange={(value) => set("appointment_date", value)}
            required
          />
          <EditField
            label="Appointment Time"
            type="time"
            value={draft.start_time}
            onChange={(value) => set("start_time", value)}
            required
          />
          <EditSelect
            label="Appointment Status"
            value={draft.appointment_status}
            onChange={(value) => set("appointment_status", value)}
            options={statusOptions([
              "confirmed",
              "assigned",
              "completed",
              "cancelled",
              "qc_pending",
              "qc_denied",
            ])}
          />
          <EditSelect
            label="Client Status"
            value={draft.client_status}
            onChange={(value) => set("client_status", value)}
            options={statusOptions([
              "pending",
              "good",
              "bad",
              "no_show",
              "reschedule",
              "signed_contract",
            ])}
          />
          <EditSelect
            label="Attendance"
            value={draft.attendance_status}
            onChange={(value) => set("attendance_status", value)}
            options={statusOptions([
              "unknown",
              "verified_show",
              "unverified_show",
              "homeowner_no_show",
              "rep_no_show",
              "cancelled",
            ])}
          />
          <EditSelect
            label="Inspection Status"
            value={draft.inspection_status}
            onChange={(value) => set("inspection_status", value)}
            options={statusOptions([
              "not_started",
              "started",
              "completed",
              "not_completed",
            ])}
          />
          <EditSelect
            label="Sales Outcome"
            value={draft.sales_outcome}
            onChange={(value) => set("sales_outcome", value)}
            options={statusOptions([
              "pending",
              "follow_up",
              "signed_contract",
              "lost",
              "not_applicable",
            ])}
          />
          <EditSelect
            label="Company Action"
            value={draft.company_action}
            onChange={(value) => set("company_action", value)}
            options={statusOptions([
              "pending",
              "contacted",
              "confirmed",
              "inspected",
              "no_show",
              "rescheduled",
              "estimate_given",
              "claim_filed",
              "signed_contract",
              "lost",
            ])}
          />
          <EditTextArea
            label="Inspector / Company Notes"
            value={draft.inspector_notes}
            onChange={(value) => set("inspector_notes", value)}
            wide
          />
        </EditSection>
      )}

      <EditSection title="Roofing & Qualification Details">
        {[
          ["roof_age", "Roof Age"],
          ["roof_type", "Roof Type"],
          ["stories", "Stories"],
          ["home_type", "Home Type"],
          ["insurance", "Insurance"],
          ["insurance_name", "Insurance Carrier"],
          ["claim_filed", "Claim Filed"],
          ["visible_damage", "Visible Damage"],
          ["damage_type", "Damage Type"],
          ["hail_size", "Hail Size"],
          ["storm_date", "Storm / Hail Date"],
          ["last_checked_on", "Last Checked"],
          ["contract", "Contract"],
        ].map(([key, label]) => (
          <EditField
            key={key}
            label={label}
            value={form[key]}
            onChange={(value) => setForm(key, value)}
          />
        ))}
      </EditSection>

      <EditSection title="Lead Notes">
        <EditTextArea
          label="Internal / Lead Notes"
          value={draft.notes}
          onChange={(value) => set("notes", value)}
          wide
        />
      </EditSection>

      <div className="sticky bottom-0 flex justify-end gap-2 border-t bg-white/95 py-4 backdrop-blur">
        <button
          disabled={saving}
          onClick={cancel}
          className="rounded-lg border px-4 py-2.5 text-xs font-bold"
        >
          Cancel
        </button>
        <button
          disabled={saving}
          onClick={save}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-xs font-bold text-white disabled:opacity-50"
        >
          {saving ? (
            <Loader2 className="animate-spin" size={14} />
          ) : (
            <Save size={14} />
          )}{" "}
          Save Shared Record
        </button>
      </div>
    </section>
  );
}

function EditSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border bg-white p-4 shadow-sm">
      <h3 className="mb-4 font-black">{title}</h3>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">{children}</div>
    </section>
  );
}
function EditField({
  label,
  value: fieldValue,
  onChange,
  type = "text",
  required = false,
  wide = false,
}: {
  label: string;
  value: unknown;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
  wide?: boolean;
}) {
  return (
    <label
      className={`text-[10px] font-bold uppercase text-slate-500 ${wide ? "md:col-span-2" : ""}`}
    >
      {label}
      {required && <span className="text-red-500"> *</span>}
      <input
        required={required}
        type={type}
        value={String(fieldValue ?? "")}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 h-10 w-full rounded-lg border bg-white px-3 text-xs font-semibold normal-case text-slate-800"
      />
    </label>
  );
}
function EditTextArea({
  label,
  value: fieldValue,
  onChange,
  wide = false,
}: {
  label: string;
  value: unknown;
  onChange: (value: string) => void;
  wide?: boolean;
}) {
  return (
    <label
      className={`text-[10px] font-bold uppercase text-slate-500 ${wide ? "md:col-span-2 xl:col-span-4" : ""}`}
    >
      {label}
      <textarea
        value={String(fieldValue ?? "")}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 min-h-24 w-full rounded-lg border bg-white px-3 py-2 text-xs font-semibold normal-case text-slate-800"
      />
    </label>
  );
}
function EditCheckbox({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: unknown;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex min-h-10 items-center gap-3 rounded-lg border bg-slate-50 px-3 py-2 text-xs font-bold text-slate-700">
      <input
        type="checkbox"
        checked={Boolean(checked)}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 rounded border-slate-300 text-blue-600"
      />
      {label}
    </label>
  );
}
function EditSelect({
  label,
  value: fieldValue,
  onChange,
  options,
}: {
  label: string;
  value: unknown;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  const selected = String(fieldValue ?? "");
  const withCurrent =
    selected && !options.some((option) => option.value === selected)
      ? [{ value: selected, label: leadStatusLabel(selected) }, ...options]
      : options;
  return (
    <label className="text-[10px] font-bold uppercase text-slate-500">
      {label}
      <select
        value={selected}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 h-10 w-full rounded-lg border bg-white px-3 text-xs font-semibold normal-case text-slate-800"
      >
        {withCurrent.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
function statusOptions(
  values: string[],
): Array<{ value: string; label: string }> {
  return values.map((item) => ({ value: item, label: leadStatusLabel(item) }));
}
function buildEditDraft(detail: Obj): Obj {
  const lead = detail.lead || {};
  const appointment = detail.appointment || {};
  return {
    full_name: lead.full_name || "",
    phone_number: lead.phone_number || "",
    email: lead.email || "",
    address: lead.address || "",
    city: lead.city || "",
    state: lead.state || "",
    zip_code: lead.zip_code || "",
    service_needed: lead.service_needed || "",
    language: lead.language || "",
    notes: lead.notes || "",
    home_value: lead.home_value || "",
    sq_ft: lead.sq_ft || "",
    web_url: lead.web_url || "",
    source: lead.source || "",
    source_lead_id: lead.source_lead_id || "",
    source_disposition: lead.source_disposition || "",
    qualification_status: lead.qualification_status || "",
    qualification_reasons: lead.qualification_reasons || [],
    company_id: detail.company?.id || lead.company_id || "",
    location_id: detail.location?.id || lead.location_id || "",
    agent_id: detail.agent?.id || "",
    qc_status: lead.qc_status || "pending",
    qc_reason: lead.qc_reason || "",
    qc_notes: lead.qc_notes || "",
    recording_url: lead.recording_url || "",
    share_recording_with_company: Boolean(lead.share_recording_with_company),
    form_data: { ...(lead.form_data || {}) },
    appointment_date: appointment.appointment_date || "",
    start_time: String(appointment.start_time || "").slice(0, 5),
    appointment_status: appointment.status || "confirmed",
    client_status: appointment.client_status || "pending",
    attendance_status: appointment.attendance_status || "unknown",
    inspection_status: appointment.inspection_status || "not_started",
    sales_outcome: appointment.sales_outcome || "pending",
    inspector_notes: appointment.inspector_notes || "",
    company_action: appointment.company_action || "pending",
  };
}

function HistoryList({
  qc,
  reschedules,
  audits,
}: {
  qc: Obj[];
  reschedules: Obj[];
  audits: Obj[];
}) {
  const items = useMemo(
    () =>
      [
        ...qc.map((item) => ({
          at: item.completed_at || item.created_at,
          title: `QC Cycle ${item.cycle_number}: ${leadStatusLabel(item.status)}`,
          note: item.reason || item.notes,
        })),
        ...reschedules.map((item) => ({
          at: item.changed_at,
          title: `Rescheduled to ${item.new_date} ${timeValue(item.new_time)}`,
          note: item.reason,
        })),
        ...audits.map((item) => ({
          at: item.created_at,
          title: String(item.action || "").replace(/_/g, " "),
          note: [item.actor_name, item.actor_type].filter(Boolean).join(" · "),
        })),
      ]
        .sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")))
        .slice(0, 30),
    [audits, qc, reschedules],
  );
  if (!items.length)
    return <p className="text-sm text-slate-500">No history recorded yet.</p>;
  return (
    <div className="max-h-80 space-y-3 overflow-y-auto pr-2">
      {items.map((item, index) => (
        <div
          key={`${item.at}-${index}`}
          className="border-l-2 border-blue-200 pl-3"
        >
          <p className="text-xs font-black capitalize text-slate-800">
            {item.title}
          </p>
          <p className="text-[11px] text-slate-500">
            {item.at ? new Date(item.at).toLocaleString() : "—"}
            {item.note ? ` · ${item.note}` : ""}
          </p>
        </div>
      ))}
    </div>
  );
}

function RecordSection({
  title,
  icon,
  children,
}: {
  title: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border bg-white p-4 shadow-sm">
      <h3 className="mb-4 flex items-center gap-2 font-black text-slate-900">
        {icon}
        {title}
      </h3>
      {children}
    </section>
  );
}
function RecordGrid({ entries }: { entries: Array<[string, unknown]> }) {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
      {entries.map(([label, entry]) => (
        <div key={label}>
          <dt className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
            {label}
          </dt>
          <dd className="mt-0.5 text-sm font-semibold text-slate-700">
            {value(entry)}
          </dd>
        </div>
      ))}
    </dl>
  );
}
function HeroValue({
  label,
  value: content,
}: {
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="rounded-xl border bg-slate-50 p-3">
      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
        {label}
      </p>
      <div className="mt-1 flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-800">
        {content}
      </div>
    </div>
  );
}
function Cell({
  children,
  className = "",
  title,
}: {
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <td className={`px-3 py-3 ${className}`} title={title}>
      {children}
    </td>
  );
}
function Filter({
  value: selected,
  onChange,
  label,
  options,
  allValue = "all",
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  options: Array<{ value: string; label: string }>;
  allValue?: string;
}) {
  return (
    <select
      value={selected}
      onChange={(event) => onChange(event.target.value)}
      className="h-10 rounded-lg border bg-white px-3 text-xs font-semibold"
    >
      <option value={allValue}>{label}</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
function Metric({
  icon,
  tone,
  label,
  value: metric,
}: {
  icon: ReactNode;
  tone: string;
  label: string;
  value: ReactNode;
}) {
  return (
    <div className={`readyops-ref-metric tone-${tone}`}>
      <span className="readyops-ref-metric-icon">{icon}</span>
      <div>
        <p>{label}</p>
        <strong>{metric}</strong>
      </div>
    </div>
  );
}
function Status({ value: status }: { value: unknown }) {
  const normalized = String(status || "pending");
  return (
    <span
      className={`inline-flex whitespace-nowrap rounded-md border px-2 py-1 text-[10px] font-black ${leadStatusClasses(normalized)}`}
    >
      {leadStatusLabel(normalized)}
    </span>
  );
}
function primaryStatus(row: Obj): string {
  if (row.lead?.qc_status === "denied") return "qc_denied";
  return (
    row.appointment?.client_status ||
    row.appointment?.canonical_status ||
    row.lead?.qc_status ||
    row.appointment?.status ||
    "pending"
  );
}
function displayCompanyName(qcStatus: unknown, companyName: unknown): string {
  return String(qcStatus || "").toLowerCase() === "denied"
    ? "QC Denied"
    : value(companyName);
}
function shortId(id: unknown): string {
  return (
    String(id || "")
      .slice(0, 8)
      .toUpperCase() || "—"
  );
}
function value(input: unknown): string {
  if (input === null || input === undefined || input === "") return "—";
  if (Array.isArray(input)) return input.filter(Boolean).join(", ") || "—";
  if (typeof input === "object") return JSON.stringify(input);
  return String(input).replace(/_/g, " ");
}
function dateValue(input: unknown): string {
  return input ? String(input) : "—";
}
function timeValue(input: unknown): string {
  return input ? formatTime(String(input)) : "—";
}
function money(input: unknown): string {
  const amount = Number(String(input ?? "").replace(/[$,\s]/g, ""));
  return Number.isFinite(amount)
    ? new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
      }).format(amount)
    : "—";
}
function csvCell(input: unknown): string {
  return `"${String(input ?? "").replace(/"/g, '""')}"`;
}
