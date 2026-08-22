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
  RefreshCw,
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
  const [detail, setDetail] = useState<Obj | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(
    async (quiet = false) => {
      if (!quiet) setLoading(true);
      setError("");
      const { data: result, error: loadError } = await supabase.rpc(
        "get_admin_lead_crm",
        {
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
        },
      );
      if (loadError) setError(rpcError(loadError));
      else setData((result || EMPTY_DATA) as CrmData);
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

  async function openDetail(leadId: string) {
    setSelectedId(leadId);
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
        row.company.name,
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
      title="Admin Lead CRM"
      subtitle="Homeowner and property records with appointment, company, agent, QC, client, and financial outcomes."
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
            <h3 className="font-black">Homeowner & Property Records</h3>
            <p className="text-xs text-slate-500">
              {visibleRange} • click any row for the complete record
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
            <table className="w-full min-w-[3150px] text-xs">
              <thead className="sticky top-0 bg-slate-50 text-left text-[10px] uppercase tracking-wide text-slate-500">
                <tr>
                  {[
                    "Lead ID",
                    "Status",
                    "Homeowner Name",
                    "Phone",
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
                  ].map((label) => (
                    <th key={label} className="whitespace-nowrap px-3 py-3">
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
                    onOpen={() => void openDetail(row.lead.id)}
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
        />
      )}
    </AdminWorkspaceShell>
  );
}

function LeadRow({ row, onOpen }: { row: Obj; onOpen: () => void }) {
  const form = row.lead.form_data || {};
  const stormDate = form.storm_date || form.hail_date || form.last_checked_on;
  return (
    <tr
      onClick={onOpen}
      className="cursor-pointer border-t align-top hover:bg-blue-50/50"
    >
      <Cell className="font-black text-blue-700">
        {row.lead.lead_code || shortId(row.lead.id)}
      </Cell>
      <Cell>
        <Status value={primaryStatus(row)} />
      </Cell>
      <Cell className="font-bold">{value(row.lead.full_name)}</Cell>
      <Cell>{value(row.lead.phone_number)}</Cell>
      <Cell className="max-w-[260px]">{value(row.lead.address)}</Cell>
      <Cell>{value(row.lead.city)}</Cell>
      <Cell>{value(row.lead.state)}</Cell>
      <Cell>{value(row.lead.zip_code)}</Cell>
      <Cell>{dateValue(row.appointment.appointment_date)}</Cell>
      <Cell>{timeValue(row.appointment.start_time)}</Cell>
      <Cell className="font-semibold">{value(row.company.name)}</Cell>
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
    </tr>
  );
}

function LeadDetailModal({
  detail,
  loading,
  close,
}: {
  detail: Obj | null;
  loading: boolean;
  close: () => void;
}) {
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
        <header className="sticky top-0 z-10 flex items-center justify-between border-b bg-white px-5 py-4">
          <div>
            <p className="text-xs font-black uppercase tracking-wider text-blue-600">
              {lead.lead_code || shortId(lead.id)}
            </p>
            <h2 className="text-xl font-black">
              {value(lead.full_name)} — {value(detail.company?.name)}
            </h2>
          </div>
          <button onClick={close} className="rounded-lg border p-2">
            <X size={18} />
          </button>
        </header>
        <div className="space-y-5 p-5">
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
                  <p className="text-xs text-slate-500">{value(lead.email)}</p>
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
                  {value(detail.company?.name)}
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
            <RecordSection title="Operations" icon={<ShieldCheck size={17} />}>
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
            <RecordSection title="Record History" icon={<History size={17} />}>
              <HistoryList
                qc={detail.qc_history || []}
                reschedules={detail.reschedule_history || []}
                audits={detail.audit_history || []}
              />
            </RecordSection>
          </div>
        </div>
      </section>
    </div>
  );
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
  return (
    row.appointment?.client_status ||
    row.appointment?.canonical_status ||
    row.lead?.qc_status ||
    row.appointment?.status ||
    "pending"
  );
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
