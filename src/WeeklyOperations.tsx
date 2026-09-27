import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  BarChart3,
  Calendar,
  CheckCircle2,
  Clock,
  Download,
  Info,
  Loader2,
  Phone,
  RefreshCw,
  Settings,
  Trash2,
  TrendingUp,
  Upload,
  Users,
  X,
} from "lucide-react";
import { parseWorkforceReport, type ParsedRow, type ParseResult } from "./weeklyOpsParser";

type ScheduleConfig = {
  paid_hours_per_week: number;
  scheduled_hours_per_day: number;
  work_days: string[];
  hourly_rate: number;
  lunch_minutes_unpaid: number;
  break_count: number;
  break_minutes_paid_each: number;
  planned_start_time: string | null;
  planned_end_time: string | null;
  low_productivity_threshold: number;
  low_calls_threshold: number;
  high_idle_hours_threshold: number;
  attendance_shortfall_hours: number;
};

const DEFAULT_CONFIG: ScheduleConfig = {
  paid_hours_per_week: 40,
  scheduled_hours_per_day: 8,
  work_days: ["Mon", "Tue", "Wed", "Thu", "Fri"],
  hourly_rate: 6.25,
  lunch_minutes_unpaid: 60,
  break_count: 2,
  break_minutes_paid_each: 20,
  planned_start_time: null,
  planned_end_time: null,
  low_productivity_threshold: 0.6,
  low_calls_threshold: 40,
  high_idle_hours_threshold: 1.5,
  attendance_shortfall_hours: 1,
};

const CONFIG_STORAGE_KEY = "readyops-weekly-ops-config";

type UploadRecord = {
  id: string;
  filename: string;
  file_type: string;
  detected_columns: string[];
  unmapped_columns: string[];
  warnings: string[];
  row_count: number;
  created_at: string;
};

type Row = ParsedRow & { id: string; upload_id: string; week_start: string };

const ALL_DAY_ABBREV = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function isoMonday(date: Date): string {
  const d = new Date(date);
  const dow = d.getDay();
  const diff = (dow + 6) % 7;
  d.setDate(d.getDate() - diff);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatWeekLabel(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const start = new Date(y, m - 1, d);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const fmt = (dt: Date) => dt.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `${fmt(start)} – ${fmt(end)}, ${end.getFullYear()}`;
}

function dayAbbrev(iso: string | null): string | null {
  if (!iso) return null;
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return null;
  return ALL_DAY_ABBREV[new Date(y, m - 1, d).getDay()];
}

function num(n: number | null | undefined, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toFixed(digits);
}

function pct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${Math.round(n * 100)}%`;
}

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function loadConfigFromStorage(): ScheduleConfig {
  try {
    const raw = window.localStorage.getItem(CONFIG_STORAGE_KEY);
    if (!raw) return DEFAULT_CONFIG;
    const parsed = JSON.parse(raw) as Partial<ScheduleConfig>;
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch {
    return DEFAULT_CONFIG;
  }
}

function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function WeeklyOperations() {
  const [weekStart, setWeekStart] = useState<string>(() => isoMonday(new Date()));
  const [config, setConfig] = useState<ScheduleConfig>(loadConfigFromStorage);
  const [configOpen, setConfigOpen] = useState(false);
  const [uploads, setUploads] = useState<UploadRecord[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [lastResult, setLastResult] = useState<ParseResult | null>(null);
  const [agentFilter, setAgentFilter] = useState("");
  const [teamFilter, setTeamFilter] = useState("all");
  const [dayFilter, setDayFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [performanceFilter, setPerformanceFilter] = useState("all");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      window.localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(config));
    } catch {
      /* ignore quota errors */
    }
  }, [config]);

  const weekRows = useMemo(() => rows.filter((r) => r.week_start === weekStart), [rows, weekStart]);
  const weekUploads = useMemo(() => {
    const uploadIds = new Set(rows.filter((r) => r.week_start === weekStart).map((r) => r.upload_id));
    return uploads.filter((u) => uploadIds.has(u.id));
  }, [rows, uploads, weekStart]);
  const availableWeeks = useMemo(() => {
    const set = new Set<string>([weekStart]);
    rows.forEach((r) => set.add(r.week_start));
    return [...set].sort().reverse();
  }, [rows, weekStart]);

  const handleFileChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file) return;
      setUploading(true);
      setError("");
      try {
        const result = await parseWorkforceReport(file);
        setLastResult(result);
        if (!result.formatSupported || result.errors.length > 0) return;
        const uploadId = newId();
        const record: UploadRecord = {
          id: uploadId,
          filename: file.name,
          file_type: file.type || file.name.split(".").pop() || "unknown",
          detected_columns: result.detectedColumns,
          unmapped_columns: result.unmappedColumns,
          warnings: result.warnings,
          row_count: result.rows.length,
          created_at: new Date().toISOString(),
        };
        const insertedRows: Row[] = result.rows.map((r) => ({
          ...r,
          id: newId(),
          upload_id: uploadId,
          week_start: weekStart,
          day_of_week: r.day_of_week || dayAbbrev(r.entry_date),
        }));
        setUploads((prev) => [record, ...prev]);
        setRows((prev) => [...prev, ...insertedRows]);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Upload failed.");
      } finally {
        setUploading(false);
      }
    },
    [weekStart],
  );

  const deleteUpload = useCallback((id: string) => {
    if (!window.confirm("Remove this upload and its rows from this session?")) return;
    setUploads((prev) => prev.filter((u) => u.id !== id));
    setRows((prev) => prev.filter((r) => r.upload_id !== id));
  }, []);

  const clearWeek = useCallback(() => {
    if (!window.confirm("Clear all uploads and rows for the selected week?")) return;
    const affectedUploadIds = new Set(rows.filter((r) => r.week_start === weekStart).map((r) => r.upload_id));
    setRows((prev) => prev.filter((r) => r.week_start !== weekStart));
    setUploads((prev) => prev.filter((u) => !affectedUploadIds.has(u.id)));
  }, [rows, weekStart]);

  const saveConfig = useCallback((next: ScheduleConfig) => {
    setConfig(next);
    setConfigOpen(false);
  }, []);

  const rowsFiltered = useMemo(() => {
    return weekRows.filter((r) => {
      if (agentFilter && !(r.agent_name || "").toLowerCase().includes(agentFilter.toLowerCase())) return false;
      if (teamFilter !== "all" && (r.team_name || "—") !== teamFilter) return false;
      const dow = r.day_of_week || dayAbbrev(r.entry_date);
      if (dayFilter !== "all" && dow !== dayFilter) return false;
      if (statusFilter !== "all" && (r.status || "").toLowerCase() !== statusFilter.toLowerCase()) return false;
      return true;
    });
  }, [weekRows, agentFilter, teamFilter, dayFilter, statusFilter]);

  const teams = useMemo(() => {
    const set = new Set<string>();
    weekRows.forEach((r) => set.add(r.team_name || "—"));
    return [...set].sort();
  }, [weekRows]);

  const statusOptions = useMemo(() => {
    const set = new Set<string>();
    weekRows.forEach((r) => r.status && set.add(r.status));
    return [...set].sort();
  }, [weekRows]);

  type AgentAgg = {
    name: string;
    team: string | null;
    days: Set<string>;
    scheduled: number;
    actual: number;
    productive: number;
    idle: number;
    calls: number;
    appointments: number;
    results: number;
    entriesToday: Row[];
    latestLogin: string | null;
    latestLogout: string | null;
    hasStatus: string | null;
  };

  const perAgent = useMemo(() => {
    const map = new Map<string, AgentAgg>();
    for (const r of rowsFiltered) {
      const name = r.agent_name || "(unassigned)";
      let agg = map.get(name);
      if (!agg) {
        agg = {
          name,
          team: r.team_name,
          days: new Set(),
          scheduled: 0,
          actual: 0,
          productive: 0,
          idle: 0,
          calls: 0,
          appointments: 0,
          results: 0,
          entriesToday: [],
          latestLogin: null,
          latestLogout: null,
          hasStatus: r.status,
        };
        map.set(name, agg);
      }
      const dow = r.day_of_week || dayAbbrev(r.entry_date);
      if (dow) agg.days.add(dow);
      if (r.entry_date) agg.days.add(r.entry_date);
      agg.scheduled += r.scheduled_hours || 0;
      agg.actual += r.actual_hours || 0;
      agg.productive += r.productive_hours || 0;
      agg.idle += r.idle_hours || 0;
      agg.calls += r.calls || 0;
      agg.appointments += r.appointments || 0;
      agg.results += r.results || 0;
      if (r.entry_date === todayIso()) agg.entriesToday.push(r);
      if (r.login_at && (!agg.latestLogin || r.login_at > agg.latestLogin)) agg.latestLogin = r.login_at;
      if (r.logout_at && (!agg.latestLogout || r.logout_at > agg.latestLogout)) agg.latestLogout = r.logout_at;
      if (r.status) agg.hasStatus = r.status;
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [rowsFiltered]);

  const perDay = useMemo(() => {
    const order = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const map = new Map<string, { scheduled: number; actual: number; productive: number; idle: number; calls: number }>();
    order.forEach((d) => map.set(d, { scheduled: 0, actual: 0, productive: 0, idle: 0, calls: 0 }));
    for (const r of rowsFiltered) {
      const dow = r.day_of_week || dayAbbrev(r.entry_date);
      if (!dow || !map.has(dow)) continue;
      const b = map.get(dow)!;
      b.scheduled += r.scheduled_hours || 0;
      b.actual += r.actual_hours || 0;
      b.productive += r.productive_hours || 0;
      b.idle += r.idle_hours || 0;
      b.calls += r.calls || 0;
    }
    return order.map((day) => ({ day, ...map.get(day)! }));
  }, [rowsFiltered]);

  const scheduledPerAgentPerDay = config.scheduled_hours_per_day;
  const paidBreakHours = (config.break_count * config.break_minutes_paid_each) / 60;

  function agentPerformance(a: AgentAgg): "on_target" | "attendance" | "calls" | "productive" | "idle" {
    const scheduledExpected = a.days.size ? a.days.size * scheduledPerAgentPerDay : config.paid_hours_per_week;
    const shortfall = scheduledExpected - a.actual;
    if (shortfall > config.attendance_shortfall_hours) return "attendance";
    if (a.actual > 0 && a.calls > 0 && a.calls < config.low_calls_threshold) return "calls";
    const ratio = a.actual > 0 ? a.productive / a.actual : null;
    if (ratio != null && ratio < config.low_productivity_threshold) return "productive";
    if (a.idle > config.high_idle_hours_threshold) return "idle";
    return "on_target";
  }

  function recommendation(perf: ReturnType<typeof agentPerformance>): string {
    switch (perf) {
      case "attendance": return "Attendance follow-up";
      case "calls": return "Improve call volume";
      case "productive": return "Increase productive time";
      case "idle": return "Reduce idle time";
      default: return "On target";
    }
  }

  const perAgentPerformance = useMemo(
    () => perAgent.filter((a) => performanceFilter === "all" || agentPerformance(a) === performanceFilter),
    [perAgent, performanceFilter, config],
  );

  const kpis = useMemo(() => {
    const scheduledAgents = perAgent.length;
    const workingToday = perAgent.filter((a) =>
      a.entriesToday.some((r) => (r.actual_hours || 0) > 0 || r.login_at),
    ).length;
    const notWorking = Math.max(0, scheduledAgents - workingToday);
    const totalScheduled = perAgent.reduce((s, a) => s + a.scheduled, 0);
    const totalActual = perAgent.reduce((s, a) => s + a.actual, 0);
    const totalProductive = perAgent.reduce((s, a) => s + a.productive, 0);
    const totalCalls = perAgent.reduce((s, a) => s + a.calls, 0);
    const attendance = totalScheduled > 0 ? totalActual / totalScheduled : null;
    return { scheduledAgents, workingToday, notWorking, totalScheduled, totalActual, totalProductive, totalCalls, attendance };
  }, [perAgent]);

  const alerts = useMemo(() => {
    const items: { severity: "high" | "medium" | "low"; label: string; agent?: string }[] = [];
    for (const a of perAgent) {
      const scheduledExpected = a.days.size ? a.days.size * scheduledPerAgentPerDay : config.paid_hours_per_week;
      if (a.scheduled > 0 && a.actual === 0)
        items.push({ severity: "high", label: `Scheduled but did not log in`, agent: a.name });
      const shortfall = scheduledExpected - a.actual;
      if (shortfall > config.attendance_shortfall_hours && a.actual > 0)
        items.push({ severity: "medium", label: `Under scheduled hours by ${num(shortfall)} h`, agent: a.name });
      if (config.planned_start_time && a.latestLogin) {
        const login = new Date(a.latestLogin);
        const [h, m] = config.planned_start_time.split(":").map(Number);
        const planned = new Date(login);
        planned.setHours(h || 0, m || 0, 0, 0);
        if (login.getTime() > planned.getTime() + 5 * 60_000)
          items.push({ severity: "medium", label: `Late login vs planned start`, agent: a.name });
      }
      if (a.idle > config.high_idle_hours_threshold)
        items.push({ severity: "low", label: `Excessive idle time (${num(a.idle)} h)`, agent: a.name });
      if (a.actual > 0 && a.calls > 0 && a.calls < config.low_calls_threshold)
        items.push({ severity: "low", label: `Low call volume (${a.calls})`, agent: a.name });
      const ratio = a.actual > 0 ? a.productive / a.actual : null;
      if (ratio != null && ratio < config.low_productivity_threshold)
        items.push({ severity: "low", label: `Low productivity (${pct(ratio)})`, agent: a.name });
    }
    if (weekRows.length === 0 && weekUploads.length === 0)
      items.push({ severity: "low", label: `No report data uploaded for this week yet.` });
    return items;
  }, [perAgent, config, weekRows.length, weekUploads.length]);

  const maxDayValue = Math.max(1, ...perDay.map((d) => Math.max(d.scheduled, d.actual, d.productive)));
  const maxCallsValue = Math.max(1, ...perDay.map((d) => d.calls));

  function exportCsv() {
    const header = [
      "Agent", "Team", "Days worked", "Scheduled hrs", "Actual hrs", "Productive hrs", "Calls",
      "Appointments", "Results", "Productivity %", "Recommendation",
    ];
    const lines = [header.join(",")];
    for (const a of perAgentPerformance) {
      const perf = agentPerformance(a);
      const ratio = a.actual > 0 ? a.productive / a.actual : null;
      lines.push([
        `"${a.name}"`, `"${a.team || ""}"`, a.days.size, num(a.scheduled), num(a.actual),
        num(a.productive), a.calls, a.appointments, a.results,
        ratio == null ? "" : pct(ratio), recommendation(perf),
      ].join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `weekly-operations-${weekStart}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <div className="readyops-ref-page-header">
        <div className="readyops-ref-title-row">
          <div>
            <h2>Weekly Operations</h2>
            <p className="mt-1 text-xs text-slate-500">
              Workforce attendance and productivity for the week of {formatWeekLabel(weekStart)}
            </p>
          </div>
        </div>
        <div className="readyops-ref-page-actions">
          <button className="readyops-ref-secondary" onClick={clearWeek} title="Clear this week's uploads">
            <RefreshCw size={14} /> Clear week
          </button>
          <button className="readyops-ref-secondary" onClick={() => setConfigOpen(true)}>
            <Settings size={14} /> Schedule & Pay
          </button>
          <button className="readyops-ref-secondary" onClick={exportCsv}>
            <Download size={14} /> Export CSV
          </button>
          <button
            className="readyops-ref-primary"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
            Upload report
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.tsv,.txt,.xlsx,.xls,.pdf,text/csv,text/plain,text/tab-separated-values,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
            className="hidden"
            onChange={handleFileChange}
          />
        </div>
      </div>

      <div className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-xs text-sky-800 flex items-start gap-2">
        <Info size={14} className="mt-0.5" />
        <span>
          Uploaded reports live only in this browser session — refresh the page and you will need to re-upload. Schedule & pay defaults are saved locally in this browser. Nothing is sent to the server.
        </span>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <section className="readyops-ref-card p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs font-bold">
            Week starting
            <select
              value={weekStart}
              onChange={(e) => setWeekStart(e.target.value)}
              className="mt-1 block rounded-lg border p-2"
            >
              {availableWeeks.map((w) => (
                <option key={w} value={w}>{formatWeekLabel(w)}</option>
              ))}
            </select>
          </label>
          <label className="text-xs font-bold">
            Agent
            <input
              value={agentFilter}
              onChange={(e) => setAgentFilter(e.target.value)}
              placeholder="Search agent…"
              className="mt-1 block rounded-lg border p-2"
            />
          </label>
          <label className="text-xs font-bold">
            Team
            <select value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)} className="mt-1 block rounded-lg border p-2">
              <option value="all">All teams</option>
              {teams.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label className="text-xs font-bold">
            Day
            <select value={dayFilter} onChange={(e) => setDayFilter(e.target.value)} className="mt-1 block rounded-lg border p-2">
              <option value="all">All days</option>
              {["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </label>
          <label className="text-xs font-bold">
            Status
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="mt-1 block rounded-lg border p-2">
              <option value="all">All statuses</option>
              {statusOptions.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label className="text-xs font-bold">
            Performance
            <select value={performanceFilter} onChange={(e) => setPerformanceFilter(e.target.value)} className="mt-1 block rounded-lg border p-2">
              <option value="all">All</option>
              <option value="on_target">On target</option>
              <option value="attendance">Attendance follow-up</option>
              <option value="calls">Improve call volume</option>
              <option value="productive">Increase productive time</option>
              <option value="idle">Reduce idle time</option>
            </select>
          </label>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
        <Kpi icon={Users} label="Scheduled Agents" value={String(kpis.scheduledAgents)} accent="blue" />
        <Kpi icon={CheckCircle2} label="Working Today" value={String(kpis.workingToday)} accent="emerald" />
        <Kpi icon={X} label="Not Working" value={String(kpis.notWorking)} accent="rose" />
        <Kpi icon={Calendar} label="Scheduled Hours" value={num(kpis.totalScheduled)} accent="slate" />
        <Kpi icon={Clock} label="Actual Hours" value={num(kpis.totalActual)} accent="sky" />
        <Kpi icon={TrendingUp} label="Attendance %" value={pct(kpis.attendance)} accent="emerald" />
        <Kpi icon={BarChart3} label="Productive Hours" value={num(kpis.totalProductive)} accent="amber" />
        <Kpi icon={Phone} label="Total Calls" value={kpis.totalCalls.toLocaleString()} accent="indigo" />
      </section>

      {weekUploads.length === 0 && weekRows.length === 0 && (
        <EmptyUploadState onPick={() => fileRef.current?.click()} />
      )}

      {lastResult && (
        <UploadDetail result={lastResult} onDismiss={() => setLastResult(null)} />
      )}

      <section className="readyops-ref-card p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-black uppercase tracking-wide">Today — Who is Working</h3>
          <span className="text-[11px] opacity-60">{todayIso()}</span>
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] font-black uppercase tracking-wide text-slate-500">
                <th className="px-2 py-2">Agent</th>
                <th className="px-2 py-2">Team</th>
                <th className="px-2 py-2">Scheduled shift</th>
                <th className="px-2 py-2">Login</th>
                <th className="px-2 py-2">Status</th>
                <th className="px-2 py-2 text-right">Actual hrs</th>
                <th className="px-2 py-2 text-right">Productivity</th>
              </tr>
            </thead>
            <tbody>
              {perAgent.length === 0 && (
                <tr><td colSpan={7} className="px-2 py-6 text-center text-xs opacity-60">No agent rows for the current filters.</td></tr>
              )}
              {perAgent.map((a) => {
                const todayEntry = a.entriesToday[0];
                const actualToday = a.entriesToday.reduce((s, r) => s + (r.actual_hours || 0), 0);
                const productiveToday = a.entriesToday.reduce((s, r) => s + (r.productive_hours || 0), 0);
                const ratio = actualToday > 0 ? productiveToday / actualToday : null;
                const scheduledShift = config.planned_start_time && config.planned_end_time
                  ? `${config.planned_start_time}–${config.planned_end_time}`
                  : `${scheduledPerAgentPerDay} h`;
                const status = derivedStatus(a, actualToday, todayEntry, config);
                return (
                  <tr key={a.name} className="border-t border-slate-100">
                    <td className="px-2 py-2 font-bold">{a.name}</td>
                    <td className="px-2 py-2 opacity-80">{a.team || "—"}</td>
                    <td className="px-2 py-2 opacity-80">{scheduledShift}</td>
                    <td className="px-2 py-2 opacity-80">{todayEntry?.login_at ? new Date(todayEntry.login_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"}</td>
                    <td className="px-2 py-2"><StatusPill status={status} /></td>
                    <td className="px-2 py-2 text-right">{actualToday > 0 ? num(actualToday) : "—"}</td>
                    <td className="px-2 py-2 text-right">{pct(ratio)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="readyops-ref-card p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-black uppercase tracking-wide">Weekly agent results</h3>
          <span className="text-[11px] opacity-60">{perAgentPerformance.length} agents</span>
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] font-black uppercase tracking-wide text-slate-500">
                <th className="px-2 py-2">Agent</th>
                <th className="px-2 py-2">Team</th>
                <th className="px-2 py-2 text-right">Days</th>
                <th className="px-2 py-2 text-right">Sched hrs</th>
                <th className="px-2 py-2 text-right">Actual hrs</th>
                <th className="px-2 py-2 text-right">Productive hrs</th>
                <th className="px-2 py-2 text-right">Calls</th>
                <th className="px-2 py-2 text-right">Appts</th>
                <th className="px-2 py-2 text-right">Results</th>
                <th className="px-2 py-2 text-right">Productivity</th>
                <th className="px-2 py-2">Recommendation</th>
              </tr>
            </thead>
            <tbody>
              {perAgentPerformance.length === 0 && (
                <tr><td colSpan={11} className="px-2 py-6 text-center text-xs opacity-60">No matching agents.</td></tr>
              )}
              {perAgentPerformance.map((a) => {
                const ratio = a.actual > 0 ? a.productive / a.actual : null;
                const perf = agentPerformance(a);
                return (
                  <tr key={a.name} className="border-t border-slate-100">
                    <td className="px-2 py-2 font-bold">{a.name}</td>
                    <td className="px-2 py-2 opacity-80">{a.team || "—"}</td>
                    <td className="px-2 py-2 text-right">{a.days.size || "—"}</td>
                    <td className="px-2 py-2 text-right">{a.scheduled > 0 ? num(a.scheduled) : "—"}</td>
                    <td className="px-2 py-2 text-right">{a.actual > 0 ? num(a.actual) : "—"}</td>
                    <td className="px-2 py-2 text-right">{a.productive > 0 ? num(a.productive) : "—"}</td>
                    <td className="px-2 py-2 text-right">{a.calls > 0 ? a.calls.toLocaleString() : "—"}</td>
                    <td className="px-2 py-2 text-right">{a.appointments > 0 ? a.appointments : "—"}</td>
                    <td className="px-2 py-2 text-right">{a.results > 0 ? a.results : "—"}</td>
                    <td className="px-2 py-2 text-right">{pct(ratio)}</td>
                    <td className="px-2 py-2">
                      <RecommendationPill kind={perf} label={recommendation(perf)} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid gap-3 lg:grid-cols-2">
        <ChartCard title="Scheduled vs Actual hours by day">
          <div className="flex items-end gap-2 h-40 pt-4">
            {perDay.map((d) => (
              <div key={d.day} className="flex-1 flex flex-col items-center gap-1">
                <div className="w-full flex items-end gap-0.5 h-32">
                  <div className="flex-1 bg-slate-300 rounded-t" style={{ height: `${(d.scheduled / maxDayValue) * 100}%` }} title={`Scheduled ${num(d.scheduled)}`} />
                  <div className="flex-1 bg-sky-500 rounded-t" style={{ height: `${(d.actual / maxDayValue) * 100}%` }} title={`Actual ${num(d.actual)}`} />
                </div>
                <span className="text-[10px] font-bold opacity-70">{d.day}</span>
              </div>
            ))}
          </div>
          <div className="mt-2 flex items-center gap-3 text-[10px] opacity-70">
            <span className="flex items-center gap-1"><span className="w-2 h-2 bg-slate-300 rounded-sm" /> Scheduled</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 bg-sky-500 rounded-sm" /> Actual</span>
          </div>
        </ChartCard>

        <ChartCard title="Productive hours & calls by day">
          <div className="flex items-end gap-2 h-40 pt-4">
            {perDay.map((d) => (
              <div key={d.day} className="flex-1 flex flex-col items-center gap-1">
                <div className="w-full flex items-end gap-0.5 h-32">
                  <div className="flex-1 bg-amber-500 rounded-t" style={{ height: `${(d.productive / maxDayValue) * 100}%` }} title={`Productive ${num(d.productive)}`} />
                  <div className="flex-1 bg-indigo-500 rounded-t" style={{ height: `${(d.calls / maxCallsValue) * 100}%` }} title={`Calls ${d.calls}`} />
                </div>
                <span className="text-[10px] font-bold opacity-70">{d.day}</span>
              </div>
            ))}
          </div>
          <div className="mt-2 flex items-center gap-3 text-[10px] opacity-70">
            <span className="flex items-center gap-1"><span className="w-2 h-2 bg-amber-500 rounded-sm" /> Productive hrs</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 bg-indigo-500 rounded-sm" /> Calls</span>
          </div>
        </ChartCard>
      </section>

      <section className="readyops-ref-card p-4">
        <div className="flex items-center gap-2">
          <AlertTriangle size={16} className="text-amber-500" />
          <h3 className="text-sm font-black uppercase tracking-wide">Exception alerts</h3>
          <span className="text-[11px] opacity-60">{alerts.length}</span>
        </div>
        <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {alerts.length === 0 && (
            <p className="text-xs opacity-60 col-span-full">No exceptions detected with current thresholds.</p>
          )}
          {alerts.map((a, i) => (
            <div
              key={i}
              className={`rounded-lg border px-3 py-2 text-xs ${
                a.severity === "high" ? "border-red-200 bg-red-50 text-red-700"
                  : a.severity === "medium" ? "border-amber-200 bg-amber-50 text-amber-800"
                  : "border-slate-200 bg-slate-50 text-slate-700"
              }`}
            >
              <p className="font-bold">{a.label}</p>
              {a.agent && <p className="opacity-80">{a.agent}</p>}
            </div>
          ))}
        </div>
      </section>

      <section className="readyops-ref-card p-4">
        <h3 className="text-sm font-black uppercase tracking-wide">Uploads for this week</h3>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] font-black uppercase tracking-wide text-slate-500">
                <th className="px-2 py-2">File</th>
                <th className="px-2 py-2">Format</th>
                <th className="px-2 py-2 text-right">Rows</th>
                <th className="px-2 py-2">Detected columns</th>
                <th className="px-2 py-2">Unmapped</th>
                <th className="px-2 py-2">Uploaded</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {weekUploads.length === 0 && (
                <tr><td colSpan={7} className="px-2 py-6 text-center text-xs opacity-60">No uploads for this week (session-only).</td></tr>
              )}
              {weekUploads.map((u) => (
                <tr key={u.id} className="border-t border-slate-100 align-top">
                  <td className="px-2 py-2 font-bold">{u.filename}</td>
                  <td className="px-2 py-2 opacity-80">{u.file_type}</td>
                  <td className="px-2 py-2 text-right">{u.row_count}</td>
                  <td className="px-2 py-2 text-xs opacity-80">{(u.detected_columns || []).join(", ") || "—"}</td>
                  <td className="px-2 py-2 text-xs opacity-80">{(u.unmapped_columns || []).join(", ") || "—"}</td>
                  <td className="px-2 py-2 opacity-80">{new Date(u.created_at).toLocaleString()}</td>
                  <td className="px-2 py-2">
                    <button
                      className="rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-xs font-bold text-red-700 hover:bg-red-100"
                      onClick={() => deleteUpload(u.id)}
                    >
                      <Trash2 size={12} className="inline mr-1" /> Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {configOpen && (
        <ScheduleConfigModal
          config={config}
          paidBreakHours={paidBreakHours}
          onSave={saveConfig}
          onClose={() => setConfigOpen(false)}
        />
      )}
    </div>
  );
}

function Kpi({ icon: Icon, label, value, accent }: { icon: typeof Users; label: string; value: string; accent: string }) {
  const tones: Record<string, string> = {
    blue: "bg-blue-50 text-blue-600",
    emerald: "bg-emerald-50 text-emerald-600",
    rose: "bg-rose-50 text-rose-600",
    slate: "bg-slate-100 text-slate-600",
    sky: "bg-sky-50 text-sky-600",
    amber: "bg-amber-50 text-amber-600",
    indigo: "bg-indigo-50 text-indigo-600",
  };
  return (
    <div className="readyops-ref-card p-4">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-extrabold uppercase opacity-60">{label}</p>
        <span className={`p-1.5 rounded-lg ${tones[accent] || tones.slate}`}><Icon size={14} /></span>
      </div>
      <p className="mt-1 text-2xl font-black">{value}</p>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    Working: "bg-emerald-100 text-emerald-800",
    "Not Working": "bg-slate-200 text-slate-700",
    "Scheduled but not logged in": "bg-amber-100 text-amber-800",
    "Completed shift": "bg-blue-100 text-blue-800",
    Late: "bg-rose-100 text-rose-800",
  };
  return <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-bold ${map[status] || "bg-slate-100 text-slate-700"}`}>{status}</span>;
}

function RecommendationPill({ kind, label }: { kind: string; label: string }) {
  const map: Record<string, string> = {
    on_target: "bg-emerald-50 text-emerald-700 border-emerald-200",
    attendance: "bg-rose-50 text-rose-700 border-rose-200",
    calls: "bg-indigo-50 text-indigo-700 border-indigo-200",
    productive: "bg-amber-50 text-amber-800 border-amber-200",
    idle: "bg-slate-100 text-slate-700 border-slate-200",
  };
  return <span className={`inline-block rounded-full border px-2 py-0.5 text-[10px] font-bold ${map[kind] || map.on_target}`}>{label}</span>;
}

function derivedStatus(
  agent: { entriesToday: Row[] },
  actualToday: number,
  todayEntry: Row | undefined,
  config: ScheduleConfig,
): string {
  if (agent.entriesToday.length === 0) return "Not Working";
  if (todayEntry?.status) return todayEntry.status;
  if (config.planned_start_time && !todayEntry?.login_at) return "Scheduled but not logged in";
  if (config.planned_end_time && todayEntry?.logout_at) return "Completed shift";
  if (actualToday > 0) return "Working";
  return "Scheduled but not logged in";
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="readyops-ref-card p-4">
      <h3 className="text-sm font-black uppercase tracking-wide">{title}</h3>
      {children}
    </div>
  );
}

function EmptyUploadState({ onPick }: { onPick: () => void }) {
  return (
    <section className="readyops-ref-card p-8 text-center">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-blue-50 text-blue-600">
        <Upload size={22} />
      </div>
      <h3 className="mt-3 text-base font-black">Upload a workforce report to begin</h3>
      <p className="mx-auto mt-1 max-w-lg text-sm opacity-70">
        Drop a weekly export from your dialer or workforce system. All metrics on this page are computed from the file you upload — nothing is fabricated. CSV, TSV, plain text, XLSX/XLS, and text-based PDFs are all parsed in this browser and never leave your device. Data lives in this browser session only.
      </p>
      <button className="readyops-ref-primary mt-4 inline-flex" onClick={onPick}>
        <Upload size={14} /> Choose file
      </button>
    </section>
  );
}

function UploadDetail({ result, onDismiss }: { result: ParseResult; onDismiss: () => void }) {
  const isError = !result.formatSupported || result.errors.length > 0;
  return (
    <section className={`readyops-ref-card p-4 ${isError ? "border border-red-200" : "border border-emerald-200"}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          {isError ? <AlertTriangle size={16} className="mt-0.5 text-red-600" /> : <Info size={16} className="mt-0.5 text-emerald-600" />}
          <div>
            <h3 className="text-sm font-black">
              {isError ? "Upload could not be processed" : `Imported ${result.rows.length} rows`}
            </h3>
            {result.detectedColumns.length > 0 && (
              <p className="mt-1 text-xs opacity-80"><b>Detected columns:</b> {result.detectedColumns.join(", ")}</p>
            )}
            {result.unmappedColumns.length > 0 && (
              <p className="mt-1 text-xs opacity-80"><b>Unmapped:</b> {result.unmappedColumns.join(", ")}</p>
            )}
            {result.warnings.slice(0, 5).map((w, i) => (
              <p key={i} className="mt-1 text-xs text-amber-700">• {w}</p>
            ))}
            {result.errors.map((e, i) => (
              <p key={i} className="mt-1 text-xs text-red-700">• {e}</p>
            ))}
            {result.guidance && <p className="mt-2 text-xs opacity-70">{result.guidance}</p>}
          </div>
        </div>
        <button onClick={onDismiss} className="opacity-60 hover:opacity-100"><X size={16} /></button>
      </div>
    </section>
  );
}

function ScheduleConfigModal({
  config, paidBreakHours, onSave, onClose,
}: {
  config: ScheduleConfig;
  paidBreakHours: number;
  onSave: (c: ScheduleConfig) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<ScheduleConfig>(config);
  function set<K extends keyof ScheduleConfig>(key: K, value: ScheduleConfig[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-2xl rounded-2xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b p-4">
          <h3 className="text-base font-black">Schedule & Pay Defaults</h3>
          <button onClick={onClose}><X size={18} /></button>
        </div>
        <div className="p-4 grid gap-3 sm:grid-cols-2 text-sm">
          <Field label="Paid hours per week"><input type="number" min={0} step="0.5" value={draft.paid_hours_per_week} onChange={(e) => set("paid_hours_per_week", Number(e.target.value))} className="w-full rounded-lg border p-2" /></Field>
          <Field label="Scheduled paid hours per day"><input type="number" min={0} step="0.5" value={draft.scheduled_hours_per_day} onChange={(e) => set("scheduled_hours_per_day", Number(e.target.value))} className="w-full rounded-lg border p-2" /></Field>
          <Field label="Hourly rate ($)"><input type="number" min={0} step="0.01" value={draft.hourly_rate} onChange={(e) => set("hourly_rate", Number(e.target.value))} className="w-full rounded-lg border p-2" /></Field>
          <Field label="Unpaid lunch (min/day)"><input type="number" min={0} step="1" value={draft.lunch_minutes_unpaid} onChange={(e) => set("lunch_minutes_unpaid", Number(e.target.value))} className="w-full rounded-lg border p-2" /></Field>
          <Field label="Paid breaks per day (count)"><input type="number" min={0} step="1" value={draft.break_count} onChange={(e) => set("break_count", Number(e.target.value))} className="w-full rounded-lg border p-2" /></Field>
          <Field label="Paid break length (min each)"><input type="number" min={0} step="1" value={draft.break_minutes_paid_each} onChange={(e) => set("break_minutes_paid_each", Number(e.target.value))} className="w-full rounded-lg border p-2" /></Field>
          <Field label="Planned start time (optional)"><input type="time" value={draft.planned_start_time || ""} onChange={(e) => set("planned_start_time", e.target.value || null)} className="w-full rounded-lg border p-2" /></Field>
          <Field label="Planned end time (optional)"><input type="time" value={draft.planned_end_time || ""} onChange={(e) => set("planned_end_time", e.target.value || null)} className="w-full rounded-lg border p-2" /></Field>
          <Field label="Low productivity threshold (0–1)"><input type="number" min={0} max={1} step="0.05" value={draft.low_productivity_threshold} onChange={(e) => set("low_productivity_threshold", Number(e.target.value))} className="w-full rounded-lg border p-2" /></Field>
          <Field label="Low calls threshold (per week)"><input type="number" min={0} step="1" value={draft.low_calls_threshold} onChange={(e) => set("low_calls_threshold", Number(e.target.value))} className="w-full rounded-lg border p-2" /></Field>
          <Field label="High idle hours threshold"><input type="number" min={0} step="0.1" value={draft.high_idle_hours_threshold} onChange={(e) => set("high_idle_hours_threshold", Number(e.target.value))} className="w-full rounded-lg border p-2" /></Field>
          <Field label="Attendance shortfall threshold (hrs)"><input type="number" min={0} step="0.1" value={draft.attendance_shortfall_hours} onChange={(e) => set("attendance_shortfall_hours", Number(e.target.value))} className="w-full rounded-lg border p-2" /></Field>
          <Field label="Work days">
            <div className="flex flex-wrap gap-1">
              {["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map((d) => {
                const on = draft.work_days.includes(d);
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => set("work_days", on ? draft.work_days.filter((x) => x !== d) : [...draft.work_days, d])}
                    className={`rounded-full px-3 py-1 text-xs font-bold border ${on ? "bg-blue-600 text-white border-blue-600" : "bg-slate-50 text-slate-700 border-slate-200"}`}
                  >
                    {d}
                  </button>
                );
              })}
            </div>
          </Field>
        </div>
        <div className="border-t p-3 text-xs opacity-70">
          Paid hours per week ({draft.paid_hours_per_week}) exclude the {draft.lunch_minutes_unpaid}-minute unpaid lunch. The {draft.break_count} paid breaks of {draft.break_minutes_paid_each} minutes ({paidBreakHours.toFixed(2)} h/day) are counted inside the {draft.scheduled_hours_per_day}-hour paid day. Lunch is scheduled outside the paid day. Late arrivals are only flagged when a planned start time is set. Settings are saved locally in this browser.
        </div>
        <div className="flex justify-end gap-2 border-t p-3">
          <button onClick={onClose} className="rounded-lg border px-3 py-2 text-sm font-bold">Cancel</button>
          <button onClick={() => onSave(draft)} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white">Save defaults</button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="text-xs font-bold block">
      {label}
      <div className="mt-1">{children}</div>
    </label>
  );
}
