import { useEffect, useMemo, useState } from "react";
import { Download, RefreshCw } from "lucide-react";
import { supabase } from "./supabase";
import { defaultReportDateRange, isLeadOutcome } from "./leadOutcome";

// Report joins intentionally accept flexible Supabase row shapes across legacy
// and current database responses.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Obj = Record<string, any>;
type Tab = "overview" | "companies" | "agents" | "appointments" | "financial";

function isGood(row: Obj): boolean {
  return isLeadOutcome(row, "good");
}
function isSigned(row: Obj): boolean {
  return isLeadOutcome(row, "signed_contract");
}
function isBad(row: Obj): boolean {
  return isLeadOutcome(row, "bad");
}
function isNoShow(row: Obj): boolean {
  return isLeadOutcome(row, "no_show");
}

export function AdminReports({
  initialStatusFilter = "all",
}: {
  initialStatusFilter?: string;
}) {
  const defaultRange = useMemo(() => defaultReportDateRange(), []);
  const [startDate, setStartDate] = useState(defaultRange.startDate);
  const [endDate, setEndDate] = useState(defaultRange.endDate);
  const [companyId, setCompanyId] = useState("all");
  const [agentId, setAgentId] = useState("all");
  const [statusFilter, setStatusFilter] = useState(initialStatusFilter);
  const [tab, setTab] = useState<Tab>("overview");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [companies, setCompanies] = useState<Obj[]>([]);
  const [agents, setAgents] = useState<Obj[]>([]);
  const [teams, setTeams] = useState<Obj[]>([]);
  const [leads, setLeads] = useState<Obj[]>([]);
  const [appointments, setAppointments] = useState<Obj[]>([]);
  const [invoices, setInvoices] = useState<Obj[]>([]);
  const [payrollEntries, setPayrollEntries] = useState<Obj[]>([]);

  async function load() {
    setLoading(true);
    setError("");
    const [c, a, t, l, ap, inv, pay] = await Promise.all([
      supabase.from("roster_companies").select("id,name,state").order("name"),
      supabase.from("agents").select("id,name,team_id,active").order("name"),
      supabase.from("teams").select("id,name,abbreviation"),
      supabase
        .from("portal_leads")
        .select(
          "id,lead_code,company_id,agent_id,agent_name,qc_status,qualification_status,created_at",
        ),
      supabase
        .from("portal_appointments")
        .select(
          "id,lead_id,company_id,appointment_date,status,canonical_status,client_status,sales_outcome,attendance_status,inspection_status",
        )
        .gte("appointment_date", startDate)
        .lte("appointment_date", endDate),
      supabase
        .from("invoices")
        .select("id,company_id,total,status,period_start,period_end")
        .gte("period_end", startDate)
        .lte("period_start", endDate),
      supabase
        .from("payroll_entries")
        .select(
          "id,total_pay,payroll_period_id,payroll_periods!inner(week_start,week_end)",
        )
        .lte("payroll_periods.week_start", endDate)
        .gte("payroll_periods.week_end", startDate),
    ]);
    const firstError =
      c.error ||
      a.error ||
      t.error ||
      l.error ||
      ap.error ||
      inv.error ||
      pay.error;
    if (firstError) setError(firstError.message);
    setCompanies((c.data || []) as Obj[]);
    setAgents((a.data || []) as Obj[]);
    setTeams((t.data || []) as Obj[]);
    setLeads((l.data || []) as Obj[]);
    setAppointments((ap.data || []) as Obj[]);
    setInvoices((inv.data || []) as Obj[]);
    setPayrollEntries((pay.data || []) as Obj[]);
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, [startDate, endDate]); // eslint-disable-line react-hooks/exhaustive-deps -- reload only when the selected reporting range changes
  useEffect(() => {
    setStatusFilter(initialStatusFilter);
  }, [initialStatusFilter]);

  const joined = useMemo<Obj[]>(() => {
    const leadMap = new Map(leads.map((l) => [l.id, l]));
    return appointments
      .map((ap) => ({ ...ap, lead: leadMap.get(ap.lead_id) || null }) as Obj)
      .filter((row) => Boolean(row.lead));
  }, [appointments, leads]);

  const filtered = useMemo(
    () =>
      joined.filter((row) => {
        if (companyId !== "all" && row.company_id !== companyId) return false;
        if (agentId !== "all" && row.lead?.agent_id !== agentId) return false;
        if (statusFilter === "approved" && row.lead?.qc_status !== "approved")
          return false;
        if (statusFilter === "denied" && row.lead?.qc_status !== "denied")
          return false;
        if (statusFilter === "good" && !isGood(row)) return false;
        if (statusFilter === "bad" && !isBad(row)) return false;
        if (statusFilter === "no_show" && !isNoShow(row)) return false;
        if (statusFilter === "signed_contract" && !isSigned(row)) return false;
        return true;
      }),
    [joined, companyId, agentId, statusFilter],
  );

  const metrics = useMemo(
    () => ({
      total: filtered.length,
      approved: filtered.filter((r) => r.lead?.qc_status === "approved").length,
      denied: filtered.filter((r) => r.lead?.qc_status === "denied").length,
      good: filtered.filter(isGood).length,
      noShow: filtered.filter(isNoShow).length,
      signed: filtered.filter(isSigned).length,
      completed: filtered.filter(
        (r) => r.status === "completed" || r.inspection_status === "completed",
      ).length,
      revenue: invoices
        .filter(
          (i) =>
            i.status !== "void" &&
            (companyId === "all" || i.company_id === companyId),
        )
        .reduce((sum, i) => sum + Number(i.total || 0), 0),
      payroll: payrollEntries.reduce(
        (sum, p) => sum + Number(p.total_pay || 0),
        0,
      ),
    }),
    [filtered, invoices, payrollEntries, companyId],
  );

  const companyRows = useMemo(
    () =>
      companies
        .map((company) => {
          const rows = filtered.filter((r) => r.company_id === company.id);
          return {
            name: company.name,
            total: rows.length,
            approved: rows.filter((r) => r.lead?.qc_status === "approved")
              .length,
            denied: rows.filter((r) => r.lead?.qc_status === "denied").length,
            good: rows.filter(isGood).length,
            noShow: rows.filter(isNoShow).length,
            signed: rows.filter(isSigned).length,
          };
        })
        .filter((r) => r.total > 0),
    [companies, filtered],
  );

  const agentRows = useMemo(
    () =>
      agents
        .map((agent) => {
          const rows = filtered.filter(
            (r) =>
              r.lead?.agent_id === agent.id ||
              (!r.lead?.agent_id && r.lead?.agent_name === agent.name),
          );
          const team = teams.find((t) => t.id === agent.team_id);
          const approved = rows.filter(
            (r) => r.lead?.qc_status === "approved",
          ).length;
          return {
            name: agent.name,
            team: team?.abbreviation || "—",
            total: rows.length,
            approved,
            denied: rows.filter((r) => r.lead?.qc_status === "denied").length,
            good: rows.filter(isGood).length,
            noShow: rows.filter(isNoShow).length,
            signed: rows.filter(isSigned).length,
            conversion: approved
              ? Math.round((rows.filter(isSigned).length / approved) * 100)
              : 0,
          };
        })
        .filter((r) => r.total > 0),
    [agents, teams, filtered],
  );

  function exportCsv() {
    const rows = filtered.map((r) => ({
      Date: r.appointment_date,
      Company: companies.find((c) => c.id === r.company_id)?.name || "",
      Agent: r.lead?.agent_name || "",
      Lead_ID: r.lead?.lead_code || "",
      QC: r.lead?.qc_status || "",
      Good: r.client_status === "good" ? "Yes" : "",
      Client_Status: r.client_status || "",
      Appointment_Status: r.status || "",
      Sales_Outcome: r.sales_outcome || "",
    }));
    const headers = Object.keys(
      rows[0] || {
        Date: "",
        Company: "",
        Agent: "",
        Lead_ID: "",
        QC: "",
        Good: "",
        Client_Status: "",
        Appointment_Status: "",
        Sales_Outcome: "",
      },
    );
    const csv = [
      headers.join(","),
      ...rows.map((row) =>
        headers
          .map((h) => `"${String((row as Obj)[h] ?? "").replace(/"/g, '""')}"`)
          .join(","),
      ),
    ].join("\n");
    const url = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `readyops-report-${startDate}-to-${endDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <div className="readyops-ref-page-header">
        <div className="readyops-ref-title-row">
          <h2>Reports</h2>
          <span>Operational + Financial Performance</span>
        </div>
        <div className="readyops-ref-page-actions">
          <button
            className="readyops-ref-secondary"
            onClick={() => void load()}
          >
            <RefreshCw size={14} /> Refresh
          </button>
          <button className="readyops-ref-primary" onClick={exportCsv}>
            <Download size={14} /> Export CSV
          </button>
        </div>
      </div>

      <section className="readyops-ref-card p-4">
        <div className="grid gap-3 md:grid-cols-5">
          <label className="text-xs font-bold">
            From
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="mt-1 w-full rounded-lg border p-2"
            />
          </label>
          <label className="text-xs font-bold">
            Through
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="mt-1 w-full rounded-lg border p-2"
            />
          </label>
          <label className="text-xs font-bold">
            Company
            <select
              value={companyId}
              onChange={(e) => setCompanyId(e.target.value)}
              className="mt-1 w-full rounded-lg border p-2"
            >
              <option value="all">All Companies</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-bold">
            Agent
            <select
              value={agentId}
              onChange={(e) => setAgentId(e.target.value)}
              className="mt-1 w-full rounded-lg border p-2"
            >
              <option value="all">All Agents</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-bold">
            Status
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="mt-1 w-full rounded-lg border p-2"
            >
              <option value="all">All Statuses</option>
              <option value="approved">Approved</option>
              <option value="denied">QC Denied</option>
              <option value="good">Good</option>
              <option value="bad">Bad</option>
              <option value="no_show">No Show</option>
              <option value="signed_contract">Signed Contract</option>
            </select>
          </label>
        </div>
      </section>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5 2xl:grid-cols-9">
        <Kpi label="Total Leads" value={metrics.total} />
        <Kpi label="Approved" value={metrics.approved} />
        <Kpi label="QC Denied" value={metrics.denied} />
        <Kpi label="Good" value={metrics.good} />
        <Kpi label="No Shows" value={metrics.noShow} />
        <Kpi label="Signed" value={metrics.signed} />
        <Kpi label="Completed" value={metrics.completed} />
        <Kpi label="Revenue" value={money(metrics.revenue)} />
        <Kpi label="Payroll Cost" value={money(metrics.payroll)} />
      </section>

      <section className="readyops-ref-card readyops-reports-results">
        <div className="readyops-ref-tabs readyops-reports-tabs">
          {(
            [
              "overview",
              "companies",
              "agents",
              "appointments",
              "financial",
            ] as Tab[]
          ).map((key) => (
            <button
              key={key}
              className={tab === key ? "active" : ""}
              onClick={() => setTab(key)}
            >
              {key[0].toUpperCase() + key.slice(1)}
            </button>
          ))}
        </div>
        <div className="readyops-reports-results-scroll">
          {loading ? (
            <div className="p-10 text-center text-sm opacity-60">
              Loading reports…
            </div>
          ) : tab === "companies" ? (
            <CompanyTable rows={companyRows} />
          ) : tab === "agents" ? (
            <AgentTable rows={agentRows} />
          ) : tab === "appointments" ? (
            <AppointmentTable rows={filtered} companies={companies} />
          ) : tab === "financial" ? (
            <Financial
              revenue={metrics.revenue}
              payroll={metrics.payroll}
              good={metrics.good}
            />
          ) : (
            <Overview companyRows={companyRows} agentRows={agentRows} />
          )}
        </div>
      </section>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="readyops-ref-card p-4">
      <p className="text-[10px] font-extrabold uppercase opacity-60">{label}</p>
      <p className="mt-1 text-2xl font-black">{value}</p>
    </div>
  );
}
function money(v: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(v);
}
function CompanyTable({ rows }: { rows: Obj[] }) {
  return (
    <Table
      headers={[
        "Company",
        "Delivered",
        "Approved",
        "QC Denied",
        "Good",
        "No Show",
        "Signed",
      ]}
      rows={rows.map((r) => [
        r.name,
        r.total,
        r.approved,
        r.denied,
        r.good,
        r.noShow,
        r.signed,
      ])}
    />
  );
}
function AgentTable({ rows }: { rows: Obj[] }) {
  return (
    <Table
      headers={[
        "Agent",
        "Team",
        "Leads",
        "Approved",
        "QC Denied",
        "Good",
        "No Show",
        "Signed",
        "Conversion",
      ]}
      rows={rows.map((r) => [
        r.name,
        r.team,
        r.total,
        r.approved,
        r.denied,
        r.good,
        r.noShow,
        r.signed,
        `${r.conversion}%`,
      ])}
    />
  );
}
function AppointmentTable({
  rows,
  companies,
}: {
  rows: Obj[];
  companies: Obj[];
}) {
  return (
    <Table
      headers={[
        "Date",
        "Company",
        "Agent",
        "Lead ID",
        "QC",
        "Good",
        "Client Status",
        "Appointment",
        "Sales",
      ]}
      rows={rows.map((r) => [
        r.appointment_date,
        companies.find((c) => c.id === r.company_id)?.name || "—",
        r.lead?.agent_name || "—",
        r.lead?.lead_code || "—",
        r.lead?.qc_status || "—",
        r.client_status === "good" ? "Yes" : "—",
        r.client_status || "—",
        r.status || "—",
        r.sales_outcome || "—",
      ])}
    />
  );
}
function Financial({
  revenue,
  payroll,
  good,
}: {
  revenue: number;
  payroll: number;
  good: number;
}) {
  return (
    <div className="grid gap-4 p-5 md:grid-cols-4">
      <Kpi label="Good Leads" value={good} />
      <Kpi label="Invoice Revenue" value={money(revenue)} />
      <Kpi label="Payroll Cost" value={money(payroll)} />
      <Kpi label="Gross Before Other Costs" value={money(revenue - payroll)} />
    </div>
  );
}
function Overview({
  companyRows,
  agentRows,
}: {
  companyRows: Obj[];
  agentRows: Obj[];
}) {
  return (
    <div className="grid gap-5 p-5 xl:grid-cols-2">
      <div>
        <h3 className="mb-3 font-bold">Company Performance</h3>
        <CompanyTable rows={companyRows.slice(0, 10)} />
      </div>
      <div>
        <h3 className="mb-3 font-bold">Agent Performance</h3>
        <AgentTable rows={agentRows.slice(0, 10)} />
      </div>
    </div>
  );
}
function Table({
  headers,
  rows,
}: {
  headers: string[];
  rows: (string | number)[][];
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-sm">
        <thead className="readyops-data-table-head sticky top-0 z-30">
          <tr className="text-left">
            {headers.map((h) => (
              <th key={h} className="px-4 py-3">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length ? (
            rows.map((r, i) => (
              <tr key={i} className="border-t">
                {r.map((v, j) => (
                  <td key={j} className="px-4 py-3">
                    {String(v).replace(/_/g, " ")}
                  </td>
                ))}
              </tr>
            ))
          ) : (
            <tr>
              <td
                colSpan={headers.length}
                className="p-8 text-center opacity-50"
              >
                No records for this filter.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
