import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Filter,
  Lock,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  WalletCards,
} from "lucide-react";
import { supabase } from "./supabase";
import { HorizontalScrollFrame } from "./HorizontalScrollFrame";

// Payroll RPC rows include configurable fields that vary by deployed migration.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Obj = Record<string, any>;
type PayStructure =
  | "commission_only"
  | "base_only"
  | "base_plus_commission"
  | "hourly";

const PAY_STRUCTURE_OPTIONS: Array<{ value: PayStructure; label: string }> = [
  { value: "commission_only", label: "Commission Only" },
  { value: "base_only", label: "Base Paid Only" },
  { value: "base_plus_commission", label: "Base Paid + Commission" },
  { value: "hourly", label: "Hourly" },
];

function isoDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function money(v: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Number.isFinite(v) ? v : 0);
}

function numberValue(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function currentSunday() {
  const d = new Date();
  d.setDate(d.getDate() - d.getDay());
  return isoDate(d);
}

function calculatedTotal(row: Obj) {
  const payStructure = (row.pay_structure || "commission_only") as PayStructure;
  const hours = numberValue(row.hours);
  const base = numberValue(row.base_pay);
  const hourly = numberValue(row.hourly_rate);
  const leadCommission =
    numberValue(row.qualified_leads) * numberValue(row.lead_rate);
  const signedCommission =
    numberValue(row.signed_contracts) *
    numberValue(row.signed_contract_rate);

  let gross = 0;
  if (payStructure === "commission_only") {
    gross = leadCommission + signedCommission;
  } else if (payStructure === "base_only") {
    gross = base;
  } else if (payStructure === "base_plus_commission") {
    gross = base + leadCommission + signedCommission;
  } else if (payStructure === "hourly") {
    gross = hours * hourly;
  }

  return Math.max(0, gross + numberValue(row.bonus) - numberValue(row.deductions));
}

export function AdminPayroll() {
  const [periods, setPeriods] = useState<Obj[]>([]);
  const [entries, setEntries] = useState<Obj[]>([]);
  const [agents, setAgents] = useState<Obj[]>([]);
  const [teams, setTeams] = useState<Obj[]>([]);
  const [periodId, setPeriodId] = useState("");
  const [week, setWeek] = useState(currentSunday);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [teamFilter, setTeamFilter] = useState("all");
  const [payStructureFilter, setPayStructureFilter] = useState("all");
  const [onlyAgentsWithLeads, setOnlyAgentsWithLeads] = useState(true);
  const [drafts, setDrafts] = useState<Record<string, Obj>>({});
  const [savingId, setSavingId] = useState("");
  const [savedId, setSavedId] = useState("");

  async function load(preferred?: string) {
    setLoading(true);
    setError("");
    const [p, a, t] = await Promise.all([
      supabase
        .from("payroll_periods")
        .select("*")
        .order("week_start", { ascending: false }),
      supabase
        .from("agents")
        .select(
          "id,name,team_id,active,pay_structure,weekly_base,hourly_rate,payroll_lead_rate,payroll_signed_contract_rate",
        )
        .order("name"),
      supabase.from("teams").select("id,name,abbreviation"),
    ]);

    if (p.error || a.error || t.error) {
      setError(
        (p.error || a.error || t.error)?.message || "Unable to load payroll",
      );
    }

    const nextPeriods = (p.data || []) as Obj[];
    setPeriods(nextPeriods);
    setAgents((a.data || []) as Obj[]);
    setTeams((t.data || []) as Obj[]);

    const chosen = preferred || periodId || nextPeriods[0]?.id || "";
    setPeriodId(chosen);
    if (chosen) {
      const e = await supabase
        .from("payroll_entries")
        .select("*")
        .eq("payroll_period_id", chosen)
        .order("created_at");
      if (e.error) setError(e.error.message);
      setEntries((e.data || []) as Obj[]);
    } else {
      setEntries([]);
    }

    setDrafts({});
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- initial finance load only

  useEffect(() => {
    if (periodId) void loadEntries(periodId);
  }, [periodId]); // eslint-disable-line react-hooks/exhaustive-deps -- period selection controls entry query

  async function loadEntries(id: string) {
    const e = await supabase
      .from("payroll_entries")
      .select("*")
      .eq("payroll_period_id", id);
    if (e.error) {
      setError(e.error.message);
    } else {
      setEntries((e.data || []) as Obj[]);
      setDrafts({});
    }
  }

  async function generate() {
    setError("");
    const { data, error: generateError } = await supabase.rpc(
      "generate_readyops_payroll_week",
      { p_date: week },
    );
    if (generateError) {
      setError(generateError.message);
      return;
    }
    await load(String(data || ""));
  }

  const period = periods.find((item) => item.id === periodId);
  const agentById = useMemo(
    () => new Map(agents.map((agent) => [agent.id, agent])),
    [agents],
  );
  const teamById = useMemo(
    () => new Map(teams.map((team) => [team.id, team])),
    [teams],
  );

  const visibleEntries = useMemo(
    () =>
      entries.filter((entry) => {
        const row = drafts[entry.id] || entry;
        if (teamFilter !== "all" && entry.team_id !== teamFilter) return false;
        if (
          payStructureFilter !== "all" &&
          (row.pay_structure || "commission_only") !== payStructureFilter
        ) {
          return false;
        }
        if (onlyAgentsWithLeads && numberValue(entry.qualified_leads) <= 0) {
          return false;
        }
        return true;
      }),
    [
      drafts,
      entries,
      onlyAgentsWithLeads,
      payStructureFilter,
      teamFilter,
    ],
  );

  const stats = useMemo(() => {
    const rows = visibleEntries.map((entry) => drafts[entry.id] || entry);
    return {
      agents: rows.length,
      qualified: rows.reduce(
        (sum, entry) => sum + numberValue(entry.qualified_leads),
        0,
      ),
      hours: rows.reduce((sum, entry) => sum + numberValue(entry.hours), 0),
      commission: rows.reduce(
        (sum, entry) =>
          sum +
          numberValue(entry.qualified_leads) * numberValue(entry.lead_rate) +
          numberValue(entry.signed_contracts) *
            numberValue(entry.signed_contract_rate),
        0,
      ),
      bonuses: rows.reduce((sum, entry) => sum + numberValue(entry.bonus), 0),
      deductions: rows.reduce(
        (sum, entry) => sum + numberValue(entry.deductions),
        0,
      ),
      total: rows.reduce(
        (sum, entry) => sum + calculatedTotal(entry),
        0,
      ),
    };
  }, [drafts, visibleEntries]);

  const activeFilterCount =
    Number(teamFilter !== "all") +
    Number(payStructureFilter !== "all") +
    Number(onlyAgentsWithLeads);

  function updateDraft(row: Obj, field: string, value: string | number) {
    setSavedId("");
    setDrafts((current) => ({
      ...current,
      [row.id]: {
        ...(current[row.id] || row),
        [field]: value,
      },
    }));
  }

  function clearDraft(rowId: string) {
    setDrafts((current) => {
      const next = { ...current };
      delete next[rowId];
      return next;
    });
  }

  async function saveEntry(row: Obj) {
    if (period?.status === "locked") {
      setError("This payroll period is locked.");
      return;
    }

    const draft = drafts[row.id] || row;
    setSavingId(row.id);
    setSavedId("");
    setError("");

    const { error: saveError } = await supabase.rpc(
      "save_readyops_payroll_entry",
      {
        p_entry_id: row.id,
        p_pay_structure:
          draft.pay_structure || ("commission_only" as PayStructure),
        p_hours: numberValue(draft.hours),
        p_base_pay: numberValue(draft.base_pay),
        p_hourly_rate: numberValue(draft.hourly_rate),
        p_lead_rate: numberValue(draft.lead_rate),
        p_signed_contract_rate: numberValue(draft.signed_contract_rate),
        p_bonus: numberValue(draft.bonus),
        p_deductions: numberValue(draft.deductions),
        p_notes: String(draft.notes || ""),
      },
    );

    setSavingId("");
    if (saveError) {
      setError(saveError.message);
      return;
    }

    await loadEntries(periodId);
    setSavedId(row.id);
    window.setTimeout(() => setSavedId(""), 3000);
  }

  function clearFilters() {
    setTeamFilter("all");
    setPayStructureFilter("all");
    setOnlyAgentsWithLeads(false);
  }

  async function setStatus(status: string) {
    if (!periodId) return;
    const patch: Obj = { status, updated_at: new Date().toISOString() };
    if (status === "approved") patch.approved_at = new Date().toISOString();
    if (status === "paid") patch.paid_at = new Date().toISOString();
    if (status === "locked") patch.locked_at = new Date().toISOString();

    const { error: statusError } = await supabase
      .from("payroll_periods")
      .update(patch)
      .eq("id", periodId);

    if (statusError) setError(statusError.message);
    else await load(periodId);
  }

  return (
    <div className="space-y-4">
      <div className="readyops-ref-page-header">
        <div className="readyops-ref-title-row">
          <h2>Payroll</h2>
          <span>Sunday → Saturday</span>
        </div>
        <div className="readyops-ref-page-actions">
          <input
            type="date"
            value={week}
            onChange={(event) => setWeek(event.target.value)}
            className="rounded-lg border p-2 text-xs"
          />
          <button className="readyops-ref-primary" onClick={() => void generate()}>
            <Plus size={14} /> Generate Week
          </button>
          <button
            className="readyops-ref-secondary"
            onClick={() => void load(periodId)}
          >
            <RefreshCw size={14} /> Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <section className="readyops-ref-card p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs font-bold">
            Payroll Period
            <select
              value={periodId}
              onChange={(event) => setPeriodId(event.target.value)}
              className="mt-1 min-w-64 rounded-lg border p-2"
            >
              <option value="">No period selected</option>
              {periods.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.week_start} – {item.week_end} • {item.status}
                </option>
              ))}
            </select>
          </label>

          {period && (
            <>
              <span className="rounded-full bg-blue-50 px-3 py-2 text-xs font-bold uppercase text-blue-700">
                {period.status}
              </span>
              <div className="ml-auto flex flex-wrap gap-2">
                <button
                  className="readyops-ref-secondary"
                  disabled={period.status === "locked"}
                  onClick={() => void setStatus("review")}
                >
                  Review
                </button>
                <button
                  className="readyops-ref-secondary"
                  disabled={period.status === "locked"}
                  onClick={() => void setStatus("approved")}
                >
                  <CheckCircle2 size={14} /> Approve
                </button>
                <button
                  className="readyops-ref-secondary"
                  disabled={period.status === "locked"}
                  onClick={() => void setStatus("paid")}
                >
                  <WalletCards size={14} /> Mark Paid
                </button>
                <button
                  className="readyops-ref-primary"
                  disabled={period.status === "locked"}
                  onClick={() => void setStatus("locked")}
                >
                  <Lock size={14} /> Lock Payroll
                </button>
              </div>
            </>
          )}
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-7">
        <Kpi label="Agents" value={stats.agents} />
        <Kpi label="Qualified Leads" value={stats.qualified} />
        <Kpi label="Hours" value={stats.hours.toFixed(1)} />
        <Kpi label="Commission" value={money(stats.commission)} />
        <Kpi label="Bonuses" value={money(stats.bonuses)} />
        <Kpi label="Deductions" value={money(stats.deductions)} />
        <Kpi label="Total Payroll" value={money(stats.total)} />
      </section>

      <section className="readyops-ref-card overflow-hidden">
        <div className="readyops-ref-card-heading space-y-3">
          <div>
            <h3>Agent Payroll</h3>
            <p className="mt-1 text-xs opacity-60">
              MSR and BRL default to a $450 weekly base. Dopey-MSR and
              Yeni-MSR use a $4,000 base; Leah-MSR earns $500 per qualified
              lead. OCTO pay plans remain configurable per agent.
            </p>
          </div>

          <div className="flex flex-wrap items-end gap-3 rounded-xl border bg-slate-50 p-3">
            <div className="flex items-center gap-2 text-xs font-extrabold uppercase text-slate-600">
              <Filter size={15} /> Filters
            </div>
            <label className="text-xs font-bold">
              Team
              <select
                value={teamFilter}
                onChange={(event) => setTeamFilter(event.target.value)}
                className="mt-1 block min-w-36 rounded-lg border bg-white p-2"
              >
                <option value="all">All Teams</option>
                {teams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.abbreviation || team.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs font-bold">
              Pay Structure
              <select
                value={payStructureFilter}
                onChange={(event) =>
                  setPayStructureFilter(event.target.value)
                }
                className="mt-1 block min-w-52 rounded-lg border bg-white p-2"
              >
                <option value="all">All Pay Structures</option>
                {PAY_STRUCTURE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 rounded-lg border bg-white px-3 py-2 text-xs font-bold">
              <input
                type="checkbox"
                checked={onlyAgentsWithLeads}
                onChange={(event) =>
                  setOnlyAgentsWithLeads(event.target.checked)
                }
              />
              Only agents who made qualified leads this week
            </label>
            <span className="text-xs text-slate-500">
              {visibleEntries.length} of {entries.length} agents
            </span>
            {activeFilterCount > 0 && (
              <button
                className="readyops-ref-secondary ml-auto"
                onClick={clearFilters}
              >
                <RotateCcw size={14} /> Clear {activeFilterCount} filter
                {activeFilterCount === 1 ? "" : "s"}
              </button>
            )}
          </div>
        </div>

        {loading ? (
          <div className="p-10 text-center opacity-60">Loading payroll…</div>
        ) : !periodId ? (
          <div className="p-10 text-center opacity-50">
            No payroll period yet. Pick a date and click Generate Week.
          </div>
        ) : visibleEntries.length === 0 ? (
          <div className="p-10 text-center">
            <p className="font-bold">No agents match these payroll filters.</p>
            <button className="mt-3 text-sm text-blue-700" onClick={clearFilters}>
              Clear filters
            </button>
          </div>
        ) : (
          <HorizontalScrollFrame ariaLabel="Editable payroll table horizontal scroll">
            <table className="w-full min-w-[2050px] text-sm">
              <thead>
                <tr className="bg-slate-50 text-left text-[10px] uppercase opacity-70">
                  <th className="p-3">Agent</th>
                  <th>Team</th>
                  <th>Pay Structure</th>
                  <th>Hours</th>
                  <th>Qualified</th>
                  <th>Signed</th>
                  <th>Base</th>
                  <th>Hourly Rate</th>
                  <th>Lead Rate</th>
                  <th>Signed Rate</th>
                  <th>Bonus</th>
                  <th>Deduction</th>
                  <th>Notes</th>
                  <th>Total</th>
                  <th>Save</th>
                </tr>
              </thead>
              <tbody>
                {visibleEntries.map((entry) => {
                  const row = drafts[entry.id] || entry;
                  const agent = agentById.get(entry.agent_id);
                  const team = teamById.get(entry.team_id);
                  const structure = (row.pay_structure ||
                    "commission_only") as PayStructure;
                  const isLocked = period?.status === "locked";
                  const isDirty = Boolean(drafts[entry.id]);
                  const inputClass =
                    "w-24 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs disabled:bg-slate-100 disabled:text-slate-400";

                  return (
                    <tr key={entry.id} className="border-t align-top">
                      <td className="p-3 font-bold">
                        {agent?.name || "Unknown Agent"}
                      </td>
                      <td>{team?.abbreviation || team?.name || "—"}</td>
                      <td>
                        <select
                          aria-label={`${agent?.name || "Agent"} pay structure`}
                          value={structure}
                          disabled={isLocked}
                          onChange={(event) =>
                            updateDraft(
                              entry,
                              "pay_structure",
                              event.target.value,
                            )
                          }
                          className="w-52 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs"
                        >
                          {PAY_STRUCTURE_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <PayrollNumberInput
                          label="Hours"
                          value={row.hours}
                          disabled={isLocked || structure !== "hourly"}
                          className={inputClass}
                          onChange={(value) =>
                            updateDraft(entry, "hours", value)
                          }
                        />
                      </td>
                      <td className="font-bold">
                        {numberValue(entry.qualified_leads)}
                      </td>
                      <td className="font-bold">
                        {numberValue(entry.signed_contracts)}
                      </td>
                      <td>
                        <PayrollNumberInput
                          label="Base pay"
                          value={row.base_pay}
                          disabled={
                            isLocked ||
                            !["base_only", "base_plus_commission"].includes(
                              structure,
                            )
                          }
                          className={inputClass}
                          onChange={(value) =>
                            updateDraft(entry, "base_pay", value)
                          }
                        />
                      </td>
                      <td>
                        <PayrollNumberInput
                          label="Hourly rate"
                          value={row.hourly_rate}
                          disabled={isLocked || structure !== "hourly"}
                          className={inputClass}
                          onChange={(value) =>
                            updateDraft(entry, "hourly_rate", value)
                          }
                        />
                      </td>
                      <td>
                        <PayrollNumberInput
                          label="Lead rate"
                          value={row.lead_rate}
                          disabled={
                            isLocked ||
                            ![
                              "commission_only",
                              "base_plus_commission",
                            ].includes(structure)
                          }
                          className={inputClass}
                          onChange={(value) =>
                            updateDraft(entry, "lead_rate", value)
                          }
                        />
                      </td>
                      <td>
                        <PayrollNumberInput
                          label="Signed rate"
                          value={row.signed_contract_rate}
                          disabled={
                            isLocked ||
                            ![
                              "commission_only",
                              "base_plus_commission",
                            ].includes(structure)
                          }
                          className={inputClass}
                          onChange={(value) =>
                            updateDraft(
                              entry,
                              "signed_contract_rate",
                              value,
                            )
                          }
                        />
                      </td>
                      <td>
                        <PayrollNumberInput
                          label="Bonus"
                          value={row.bonus}
                          disabled={isLocked}
                          className={inputClass}
                          onChange={(value) =>
                            updateDraft(entry, "bonus", value)
                          }
                        />
                      </td>
                      <td>
                        <PayrollNumberInput
                          label="Deduction"
                          value={row.deductions}
                          disabled={isLocked}
                          className={inputClass}
                          onChange={(value) =>
                            updateDraft(entry, "deductions", value)
                          }
                        />
                      </td>
                      <td>
                        <input
                          aria-label={`${agent?.name || "Agent"} payroll notes`}
                          value={String(row.notes || "")}
                          disabled={isLocked}
                          onChange={(event) =>
                            updateDraft(entry, "notes", event.target.value)
                          }
                          className="w-48 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs disabled:bg-slate-100"
                          placeholder="Optional notes"
                        />
                      </td>
                      <td className="font-black">
                        {money(calculatedTotal(row))}
                      </td>
                      <td>
                        <div className="flex min-w-32 items-center gap-2">
                          <button
                            className="readyops-ref-primary"
                            disabled={
                              isLocked ||
                              !isDirty ||
                              savingId === entry.id
                            }
                            onClick={() => void saveEntry(entry)}
                          >
                            <Save size={14} />
                            {savingId === entry.id ? "Saving…" : "Save"}
                          </button>
                          {isDirty && (
                            <button
                              className="readyops-ref-secondary"
                              disabled={savingId === entry.id}
                              onClick={() => clearDraft(entry.id)}
                            >
                              Cancel
                            </button>
                          )}
                          {savedId === entry.id && (
                            <span className="text-xs font-bold text-emerald-700">
                              Saved as this agent&apos;s default
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </HorizontalScrollFrame>
        )}
      </section>
    </div>
  );
}

function PayrollNumberInput({
  label,
  value,
  disabled,
  className,
  onChange,
}: {
  label: string;
  value: unknown;
  disabled?: boolean;
  className: string;
  onChange: (value: number) => void;
}) {
  return (
    <input
      aria-label={label}
      type="number"
      min={0}
      step="0.01"
      value={numberValue(value)}
      disabled={disabled}
      className={className}
      onChange={(event) => onChange(numberValue(event.target.value))}
    />
  );
}

function Kpi({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div className="readyops-ref-card p-4">
      <p className="text-[10px] font-extrabold uppercase opacity-60">{label}</p>
      <p className="mt-1 text-2xl font-black">{value}</p>
    </div>
  );
}
