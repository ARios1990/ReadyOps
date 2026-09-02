import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  Building2,
  CircleDollarSign,
  Download,
  FileCheck2,
  LockKeyhole,
  RefreshCw,
  Search,
} from "lucide-react";
import { AdminWorkspaceShell } from "./AdminWorkspaceShell";
import { HorizontalScrollFrame } from "./HorizontalScrollFrame";
import { LeadStatusBadge } from "./LeadStatusControls";
import { formatDateLong, formatTime, rpcError } from "./portalUtils";
import { supabase } from "./supabase";

type PaidLead = {
  lead_id: string;
  lead_code: string | null;
  company_id: string;
  company_name: string;
  full_name: string;
  phone_number: string;
  email: string | null;
  address: string;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  service_needed: string | null;
  form_data: Record<string, unknown>;
  qc_status: string | null;
  source: string | null;
  lead_received_at: string;
  appointment_id: string | null;
  appointment_date: string | null;
  start_time: string | null;
  lead_status: string;
  payment_source: "invoice" | "package";
  billing_type: string;
  client_pay: number;
  payment_status: "paid";
  payment_date: string | null;
  invoice_id: string | null;
  invoice_number: string | null;
  invoice_total: number | null;
  amount_paid: number | null;
  package_id: string | null;
  package_name: string | null;
  package_total: number | null;
};

type PaidLeadData = {
  rows: PaidLead[];
  total: number;
  limit: number;
  offset: number;
  summary: {
    paid_leads: number;
    paid_value: number;
    companies: number;
    invoice_paid: number;
    package_paid: number;
  };
  companies: Array<{ id: string; name: string }>;
};

const PAGE_SIZE = 50;
const EMPTY_DATA: PaidLeadData = {
  rows: [],
  total: 0,
  limit: PAGE_SIZE,
  offset: 0,
  summary: {
    paid_leads: 0,
    paid_value: 0,
    companies: 0,
    invoice_paid: 0,
    package_paid: 0,
  },
  companies: [],
};

export function OwnerPaidClientLeads() {
  const [data, setData] = useState<PaidLeadData>(EMPTY_DATA);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [paymentSource, setPaymentSource] = useState("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(
    async (quiet = false) => {
      if (!quiet) setLoading(true);
      setError("");
      const { data: result, error: loadError } = await supabase.rpc(
        "get_owner_paid_client_leads",
        {
          p_search: search || null,
          p_company_id: companyId || null,
          p_payment_source: paymentSource,
          p_start_date: startDate || null,
          p_end_date: endDate || null,
          p_limit: PAGE_SIZE,
          p_offset: offset,
        },
      );
      if (loadError) setError(rpcError(loadError));
      else setData((result || EMPTY_DATA) as PaidLeadData);
      setLoading(false);
    },
    [companyId, endDate, offset, paymentSource, search, startDate],
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const channel = supabase
      .channel("readyops-owner-paid-client-leads")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "invoices" },
        () => void load(true),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "invoice_items" },
        () => void load(true),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "company_packages" },
        () => void load(true),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [load]);

  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const pages = Math.max(1, Math.ceil(data.total / PAGE_SIZE));
  const visibleRange = data.total
    ? `${offset + 1}–${Math.min(offset + data.rows.length, data.total)} of ${data.total}`
    : "0 paid leads";

  const exportRows = useMemo(
    () =>
      data.rows.map((row) => [
        row.lead_code,
        row.company_name,
        row.lead_status,
        row.full_name,
        row.phone_number,
        row.email,
        fullAddress(row),
        row.appointment_date,
        row.start_time,
        row.service_needed,
        row.billing_type,
        row.client_pay,
        row.payment_source,
        row.payment_date,
        row.invoice_number || row.package_name,
      ]),
    [data.rows],
  );

  function resetFilters() {
    setSearchInput("");
    setSearch("");
    setCompanyId("");
    setPaymentSource("all");
    setStartDate("");
    setEndDate("");
    setOffset(0);
  }

  function exportCsv() {
    const headers = [
      "Lead ID",
      "Company",
      "Lead Status",
      "Homeowner",
      "Phone",
      "Email",
      "Address",
      "Appointment Date",
      "Appointment Time",
      "Service",
      "Billing Type",
      "Client Pay USD",
      "Payment Source",
      "Payment Date",
      "Payment Reference",
    ];
    const csv = [headers, ...exportRows]
      .map((row) => row.map(csvCell).join(","))
      .join("\n");
    const url = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "readyops-paid-client-leads.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  const actions = (
    <>
      <span className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-black text-emerald-700">
        <LockKeyhole size={14} /> Owner Only
      </span>
      <button
        type="button"
        className="readyops-ref-secondary"
        onClick={exportCsv}
        disabled={!data.rows.length}
      >
        <Download size={14} /> Export Page
      </button>
      <button
        type="button"
        className="readyops-ref-secondary"
        onClick={() => void load()}
        disabled={loading}
      >
        <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
        Refresh
      </button>
    </>
  );

  return (
    <AdminWorkspaceShell
      active="paid-client-leads"
      title="Paid Client Leads"
      subtitle="Private owner ledger of client leads already covered by a completed package or fully paid invoice."
      actions={actions}
    >
      {error && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">
          {error}
        </div>
      )}

      <section className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Metric
          icon={<FileCheck2 />}
          tone="blue"
          label="Paid Leads"
          value={data.summary.paid_leads}
        />
        <Metric
          icon={<CircleDollarSign />}
          tone="green"
          label="Paid Lead Value"
          value={money(data.summary.paid_value)}
        />
        <Metric
          icon={<Building2 />}
          tone="purple"
          label="Clients"
          value={data.summary.companies}
        />
        <Metric
          icon={<FileCheck2 />}
          tone="green"
          label="Package Paid"
          value={data.summary.package_paid}
        />
        <Metric
          icon={<CircleDollarSign />}
          tone="orange"
          label="Invoice Paid"
          value={data.summary.invoice_paid}
        />
      </section>

      <section className="mb-4 rounded-2xl border bg-white/95 p-3 shadow-sm">
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-[2fr_1fr_1fr_1fr_1fr_auto]">
          <form
            className="relative"
            onSubmit={(event) => {
              event.preventDefault();
              setOffset(0);
              setSearch(searchInput.trim());
            }}
          >
            <Search
              size={16}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Search paid leads…"
              className="min-h-11 w-full rounded-xl border bg-white pl-9 pr-3 text-sm outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
            />
          </form>
          <select
            aria-label="Company"
            value={companyId}
            onChange={(event) => {
              setOffset(0);
              setCompanyId(event.target.value);
            }}
            className="min-h-11 rounded-xl border bg-white px-3 text-sm font-bold"
          >
            <option value="">All Companies</option>
            {data.companies.map((company) => (
              <option key={company.id} value={company.id}>
                {company.name}
              </option>
            ))}
          </select>
          <select
            aria-label="Payment source"
            value={paymentSource}
            onChange={(event) => {
              setOffset(0);
              setPaymentSource(event.target.value);
            }}
            className="min-h-11 rounded-xl border bg-white px-3 text-sm font-bold"
          >
            <option value="all">All Paid Sources</option>
            <option value="package">Paid Package</option>
            <option value="invoice">Paid Invoice</option>
          </select>
          <input
            type="date"
            aria-label="Appointment start date"
            value={startDate}
            onChange={(event) => {
              setOffset(0);
              setStartDate(event.target.value);
            }}
            className="min-h-11 rounded-xl border bg-white px-3 text-sm"
          />
          <input
            type="date"
            aria-label="Appointment end date"
            value={endDate}
            onChange={(event) => {
              setOffset(0);
              setEndDate(event.target.value);
            }}
            className="min-h-11 rounded-xl border bg-white px-3 text-sm"
          />
          <button
            type="button"
            onClick={resetFilters}
            className="min-h-11 rounded-xl border bg-slate-50 px-4 text-xs font-black text-slate-600 hover:bg-slate-100"
          >
            Clear
          </button>
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border bg-white/95 shadow-sm">
        {loading && !data.rows.length ? (
          <div className="p-12 text-center text-sm font-bold text-slate-400">
            Loading private paid-lead ledger…
          </div>
        ) : data.rows.length ? (
          <HorizontalScrollFrame ariaLabel="Paid client leads horizontal scroll">
            <table className="w-full min-w-[1480px] text-left text-xs [&_td]:px-4 [&_td]:py-3 [&_th]:px-4">
              <thead className="readyops-data-table-head sticky top-0 z-20">
                <tr>
                  <th>Company</th>
                  <th>Status</th>
                  <th>Lead</th>
                  <th>Address</th>
                  <th>Appointment</th>
                  <th>Property</th>
                  <th>Client Pay</th>
                  <th>Payment</th>
                  <th>Reference</th>
                  <th className="text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row) => {
                  const form = row.form_data || {};
                  return (
                    <tr key={row.lead_id} className="border-t align-top hover:bg-blue-50/50">
                      <td>
                        <strong className="block text-sm text-slate-900">
                          {row.company_name}
                        </strong>
                        <span className="mt-1 block text-blue-700">
                          {row.service_needed || "Lead"}
                        </span>
                      </td>
                      <td>
                        <LeadStatusBadge value={row.lead_status} />
                      </td>
                      <td>
                        <strong className="block text-sm text-slate-900">
                          {row.full_name}
                        </strong>
                        <a href={`tel:${row.phone_number}`} className="mt-1 block text-blue-700">
                          {row.phone_number}
                        </a>
                        <span className="mt-1 block text-[10px] text-slate-400">
                          {row.lead_code || "—"}
                        </span>
                      </td>
                      <td className="max-w-[250px]">
                        <span className="font-semibold text-slate-800">
                          {fullAddress(row)}
                        </span>
                      </td>
                      <td>
                        <strong className="block">
                          {row.appointment_date
                            ? formatDateLong(row.appointment_date)
                            : "—"}
                        </strong>
                        <span className="mt-1 block text-blue-600">
                          {row.start_time ? formatTime(row.start_time) : "—"}
                        </span>
                      </td>
                      <td>
                        <span className="block">
                          Home: {display(form.home_type)}
                        </span>
                        <span className="block">Roof: {display(form.roof_type)}</span>
                        <span className="block">Age: {display(form.roof_age)}</span>
                      </td>
                      <td>
                        <span className="block capitalize text-slate-500">
                          {row.billing_type.replace(/_/g, " ")}
                        </span>
                        <strong className="mt-1 block text-sm text-slate-950">
                          {money(row.client_pay)}
                        </strong>
                      </td>
                      <td>
                        <span className="inline-flex rounded-lg border border-emerald-700 bg-emerald-600 px-3 py-2 font-black text-white">
                          PAID
                        </span>
                        <span className="mt-1 block capitalize text-slate-500">
                          {row.payment_source} • {row.payment_date || "Date not entered"}
                        </span>
                      </td>
                      <td>
                        <strong>
                          {row.invoice_number || row.package_name || "Paid record"}
                        </strong>
                      </td>
                      <td className="text-right">
                        <button
                          type="button"
                          onClick={() => {
                            window.location.href = `/admin/crm?lead=${encodeURIComponent(row.lead_id)}`;
                          }}
                          className="rounded-lg border border-blue-200 bg-white px-3 py-2 font-black text-blue-700 hover:bg-blue-50"
                        >
                          Open Lead
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </HorizontalScrollFrame>
        ) : (
          <div className="p-12 text-center">
            <LockKeyhole className="mx-auto text-slate-300" size={30} />
            <p className="mt-3 text-sm font-black text-slate-700">
              No paid client leads match these filters.
            </p>
          </div>
        )}
        <footer className="flex items-center justify-between gap-3 border-t bg-slate-50 px-4 py-3 text-xs text-slate-500">
          <span>{visibleRange}</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={page <= 1 || loading}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              className="rounded-lg border bg-white px-3 py-2 font-bold disabled:opacity-40"
            >
              Previous
            </button>
            <strong className="text-slate-700">
              Page {page} of {pages}
            </strong>
            <button
              type="button"
              disabled={page >= pages || loading}
              onClick={() => setOffset(offset + PAGE_SIZE)}
              className="rounded-lg border bg-white px-3 py-2 font-bold disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </footer>
      </section>
    </AdminWorkspaceShell>
  );
}

function Metric({
  icon,
  tone,
  label,
  value,
}: {
  icon: ReactNode;
  tone: "blue" | "green" | "purple" | "orange";
  label: string;
  value: ReactNode;
}) {
  return (
    <article className={`readyops-ref-metric ${tone}`}>
      <div className="readyops-ref-metric-icon">{icon}</div>
      <div>
        <p>{label}</p>
        <strong>{value}</strong>
      </div>
    </article>
  );
}

function fullAddress(row: PaidLead): string {
  return [row.address, row.city, row.state, row.zip_code].filter(Boolean).join(", ");
}

function display(value: unknown): string {
  const normalized = String(value || "").trim();
  return normalized || "—";
}

function money(value: unknown): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Number(value || 0));
}

function csvCell(value: unknown): string {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}
