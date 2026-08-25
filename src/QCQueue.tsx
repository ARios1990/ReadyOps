import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  AlertTriangle,
  Building2,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Circle,
  Clock3,
  Download,
  ExternalLink,
  Headphones,
  Loader2,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Send,
  ShieldCheck,
  Shuffle,
  Trash2,
  UploadCloud,
  UserRound,
  X,
  XCircle,
} from "lucide-react";
import { supabase } from "./supabase";
import { AdminWorkspaceShell } from "./AdminWorkspaceShell";
import { HorizontalScrollFrame } from "./HorizontalScrollFrame";
import { QCRecordingUpload } from "./QCRecordingUpload";
import { ClientLeadTemplate } from "./ClientLeadTemplate";
import {
  buildExternalFormUrl,
  formatDateLong,
  formatTime,
  localDate,
  rpcError,
} from "./portalUtils";
import { leadStatusClasses, leadStatusLabel } from "./leadStatusPresentation";
import { useAuth } from "./AuthContext";

// RPC records stay flexible while the migration preserves legacy portal fields.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Obj = Record<string, any>;
type RefData = {
  companies: Obj[];
  locations: Obj[];
  teams: Obj[];
  agents: Obj[];
};
type QueueData = {
  days: Obj[];
  summary: Obj;
  rows: Obj[];
  total?: number;
  truncated?: boolean;
  scope?: string;
};
const EMPTY_REFS: RefData = {
  companies: [],
  locations: [],
  teams: [],
  agents: [],
};
const EMPTY_QUEUE: QueueData = { days: [], summary: {}, rows: [] };
const DAY_MS = 86_400_000;
// City, state, and ZIP stay on each lead for search/filtering, but the QC form
// shows the complete canonical address once instead of repeating its parts.
const QC_FIELDS = [
  ["service_needed", "Services Needed"],
  ["full_name", "Full Name"],
  ["phone_number", "Phone"],
  ["address", "Address"],
  ["email", "Email"],
  ["language", "Language"],
  ["last_checked_on", "Last Checked On"],
  ["home_type", "Home Type"],
  ["roof_type", "Roof Type"],
  ["roof_age", "Roof Age"],
  ["stories", "Stories"],
  ["insurance", "Insurance"],
  ["insurance_name", "Insurance Name"],
  ["claim_filed", "Claim Filed"],
  ["contract", "Contract"],
  ["hail_size", "Size of Hail"],
  ["visible_damage", "Visible Damage"],
  ["damage_type", "Damage Type"],
  ["home_value", "Home Value"],
  ["sq_ft", "SQ FT"],
  ["web_url", "Web Link"],
  ["additional_properties", "Add. Properties"],
  ["second_address", "2nd Address"],
  ["notes", "Notes"],
] as const;

function weekStart(value = new Date()): Date {
  const date = new Date(value.getFullYear(), value.getMonth(), value.getDate());
  const day = date.getDay();
  date.setDate(date.getDate() - (day === 0 ? 6 : day - 1));
  return date;
}
function countBy(rows: Obj[], status: string): number {
  return rows.filter(
    (row) => (row.qc_review?.status || row.lead?.qc_status) === status,
  ).length;
}
function quoteCsv(value: unknown): string {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

export function QCQueue() {
  const { profile } = useAuth();
  const isManager = profile?.role === "manager";
  const isAdmin = profile?.role === "admin";
  const initialParams =
    typeof window === "undefined"
      ? new URLSearchParams()
      : new URLSearchParams(window.location.search);
  const [week, setWeek] = useState(() => weekStart());
  const [selectedDate, setSelectedDate] = useState(() => localDate(new Date()));
  const [queue, setQueue] = useState<QueueData>(EMPTY_QUEUE);
  const [refs, setRefs] = useState<RefData>(EMPTY_REFS);
  const [companyId, setCompanyId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [teamId, setTeamId] = useState("");
  const [agentId, setAgentId] = useState("");
  const [dateBasis, setDateBasis] = useState<"appointment" | "call">(
    initialParams.get("date") === "call" ? "call" : "appointment",
  );
  const [qcStatus, setQcStatus] = useState(() =>
    [
      "pending",
      "in_review",
      "manager_approved",
      "approved",
      "needs_correction",
      "denied",
      "needs_review",
    ].includes(initialParams.get("status") || "")
      ? initialParams.get("status")!
      : "all",
  );
  const [appointmentStatus, setAppointmentStatus] = useState("all");
  const [stateFilter, setStateFilter] = useState("all");
  const [areaFilter, setAreaFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [searchScope, setSearchScope] = useState<
    "all_history" | "selected_day"
  >("all_history");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Obj | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [values, setValues] = useState<Obj>({});
  const [targetCompany, setTargetCompany] = useState("");
  const [targetLocation, setTargetLocation] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [targetTime, setTargetTime] = useState("");
  const [decisionReason, setDecisionReason] = useState("");
  const [decisionNotes, setDecisionNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const startDate = localDate(week);
  const endDate = localDate(new Date(week.getTime() + 6 * DAY_MS));

  const load = useCallback(
    async (quiet = false) => {
      if (!quiet) setLoading(true);
      setError("");
      const allHistorySearch = Boolean(search) && searchScope === "all_history";
      const [calendarResult, refsResult, globalResult] = await Promise.all([
        supabase.rpc("get_qc_calendar_queue", {
          p_start_date: startDate,
          p_end_date: endDate,
          p_company_id: companyId || null,
          p_location_id: locationId || null,
          p_agent_id: agentId || null,
          p_qc_status: qcStatus === "all" ? null : qcStatus,
          p_appointment_status:
            appointmentStatus === "all" ? null : appointmentStatus,
          p_search: allHistorySearch ? null : search || null,
          p_state: stateFilter === "all" ? null : stateFilter,
          p_service_area: areaFilter === "all" ? null : areaFilter,
          p_date_basis: dateBasis,
        }),
        supabase.rpc("get_qc_reference_data"),
        allHistorySearch
          ? supabase.rpc("search_qc_leads_global", {
              p_search: search,
              p_company_id: companyId || null,
              p_location_id: locationId || null,
              p_team_id: teamId || null,
              p_agent_id: agentId || null,
              p_qc_status: qcStatus === "all" ? null : qcStatus,
              p_appointment_status:
                appointmentStatus === "all" ? null : appointmentStatus,
              p_state: stateFilter === "all" ? null : stateFilter,
              p_service_area: areaFilter === "all" ? null : areaFilter,
              p_limit: 100,
            })
          : Promise.resolve({ data: null, error: null }),
      ]);
      if (calendarResult.error || refsResult.error || globalResult.error)
        setError(
          rpcError(
            calendarResult.error || refsResult.error || globalResult.error,
          ),
        );
      else {
        const calendar = (calendarResult.data || EMPTY_QUEUE) as QueueData;
        const global = globalResult.data as QueueData | null;
        setQueue(global ? { ...global, days: calendar.days } : calendar);
        setRefs((refsResult.data || EMPTY_REFS) as RefData);
      }
      setLoading(false);
    },
    [
      agentId,
      appointmentStatus,
      areaFilter,
      companyId,
      dateBasis,
      endDate,
      locationId,
      qcStatus,
      search,
      searchScope,
      startDate,
      stateFilter,
      teamId,
    ],
  );

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    // When the Overview dashboard sends the operator here with `?status=needs_review`,
    // jump to the week that actually contains an actionable lead. The queue's default
    // is the current week, which is often empty even when the all-time card shows a
    // count. `get_qc_needs_review_focus` returns the soonest future appointment (or
    // the most recent past one) that matches the umbrella predicate the dashboard uses.
    if (initialParams.get("status") !== "needs_review") return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.rpc("get_qc_needs_review_focus");
      if (cancelled || error) return;
      const focus = (data as { focus_date?: string | null } | null)?.focus_date;
      if (!focus) return;
      const [y, m, d] = focus.split("-").map(Number);
      if (!y || !m || !d) return;
      setWeek(weekStart(new Date(y, m - 1, d)));
      setSelectedDate(focus);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const channel = supabase
      .channel("readyops-qc-calendar-live")
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
    const onFocus = () => void load(true);
    window.addEventListener("focus", onFocus);
    const timer = window.setInterval(() => void load(true), 60_000);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.clearInterval(timer);
      void supabase.removeChannel(channel);
    };
  }, [load]);

  const filteredAgents = useMemo(
    () => refs.agents.filter((agent) => !teamId || agent.team_id === teamId),
    [refs.agents, teamId],
  );
  const states = useMemo(
    () =>
      [
        ...new Set(
          [...refs.companies, ...refs.locations]
            .map((item) => item.state)
            .filter(Boolean),
        ),
      ].sort(),
    [refs],
  );
  const areas = useMemo(
    () =>
      [
        ...new Set(
          [...refs.companies, ...refs.locations]
            .map((item) => item.metro_tag)
            .filter(Boolean),
        ),
      ].sort(),
    [refs],
  );
  const selectedRows = useMemo(
    () =>
      queue.rows.filter(
        (row) =>
          (search && searchScope === "all_history"
            ? true
            : row.filter_date === selectedDate) &&
          (!teamId || row.agent?.team_id === teamId),
      ),
    [queue.rows, search, searchScope, selectedDate, teamId],
  );
  const isAllHistorySearch = Boolean(search) && searchScope === "all_history";
  const selectedSummary = useMemo(
    () => ({
      companies: new Set(selectedRows.map((row) => row.company?.id)).size,
      scheduled: selectedRows.length,
      pending: countBy(selectedRows, "pending"),
      inReview: countBy(selectedRows, "in_review"),
      managerApproved: countBy(selectedRows, "manager_approved"),
      approved: countBy(selectedRows, "approved"),
      awaitingSend: selectedRows.filter(
        (row) =>
          (row.qc_review?.status || row.lead?.qc_status) === "approved" &&
          !row.appointment?.company_visible_at,
      ).length,
      sent: selectedRows.filter(
        (row) =>
          (row.qc_review?.status || row.lead?.qc_status) === "approved" &&
          Boolean(row.appointment?.company_visible_at),
      ).length,
      denied: countBy(selectedRows, "denied"),
      correction: countBy(selectedRows, "needs_correction"),
    }),
    [selectedRows],
  );
  const completion = selectedSummary.scheduled
    ? Math.round(
        ((selectedSummary.approved + selectedSummary.denied) /
          selectedSummary.scheduled) *
          1000,
      ) / 10
    : 0;
  const grouped = useMemo(() => {
    const map = new Map<string, Obj[]>();
    selectedRows.forEach((row) =>
      map.set(row.company.id, [...(map.get(row.company.id) || []), row]),
    );
    return [...map.values()].sort(
      (a, b) =>
        countBy(b, "pending") - countBy(a, "pending") ||
        String(a[0].appointment.start_time).localeCompare(
          String(b[0].appointment.start_time),
        ) ||
        String(a[0].company.name).localeCompare(String(b[0].company.name)),
    );
  }, [selectedRows]);

  function moveWeek(offset: number) {
    const next = new Date(week.getTime() + offset * 7 * DAY_MS);
    setWeek(next);
    setSelectedDate(localDate(next));
  }
  function goToday() {
    const today = new Date();
    setWeek(weekStart(today));
    setSelectedDate(localDate(today));
  }
  function toggleGroup(id: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function change(key: string, value: unknown) {
    setValues((previous) => ({ ...previous, [key]: value }));
  }

  async function openReview(row: Obj, startReview = false) {
    setBusy(true);
    setError("");
    setMessage("");
    if (
      startReview &&
      !["approved", "denied"].includes(
        row.qc_review?.status || row.lead.qc_status,
      )
    ) {
      const { error: startError } = await supabase.rpc("qc_start_review", {
        p_lead_id: row.lead.id,
      });
      if (startError) {
        setError(rpcError(startError));
        setBusy(false);
        return;
      }
      await load(true);
    }
    setSelected(row);
    setSelectedAgentId(row.agent?.id || row.lead.agent_id || "");
    setValues({ ...row.lead.form_data, ...row.lead });
    setTargetCompany(row.lead.company_id);
    setTargetLocation(row.lead.location_id || "");
    setTargetDate(row.appointment.appointment_date);
    setTargetTime(String(row.appointment.start_time).slice(0, 5));
    setDecisionReason(row.qc_review?.reason || row.lead.qc_reason || "");
    setDecisionNotes(row.qc_review?.notes || row.lead.qc_notes || "");
    setBusy(false);
  }
  async function saveEdits() {
    if (!selected) return;
    setBusy(true);
    setError("");
    const patch: Obj = {};
    [
      "full_name",
      "phone_number",
      "address",
      "city",
      "state",
      "zip_code",
      "email",
      "language",
      "service_needed",
      "notes",
      "home_value",
      "sq_ft",
      "web_url",
    ].forEach((key) => {
      patch[key] = values[key] ?? "";
    });
    patch.recording_url = values.recording_url ?? "";
    patch.share_recording_with_company = Boolean(
      values.share_recording_with_company,
    );
    patch.form_data = { ...selected.lead.form_data, ...values };
    [
      "recording_url",
      "recording",
      "recording_link",
      "audio_url",
      "call_recording",
      "share_recording_with_company",
    ].forEach((key) => delete patch.form_data[key]);
        const { data: updatedLead, error: updateError } = await supabase.rpc("qc_update_lead", {
      p_lead_id: selected.lead.id,
      p_patch: patch,
    });
    if (updateError) setError(rpcError(updateError));
    else {
            const persistedLead = (updatedLead || {}) as Obj;
      setSelected((current) =>
        current
          ? { ...current, lead: { ...current.lead, ...persistedLead } }
          : current,
      );
      setValues((current) => ({
        ...current,
        ...(persistedLead.form_data || {}),
        ...persistedLead,
      }));
      setMessage("QC edits saved successfully.");
      await load(true);
    }
    setBusy(false);
  }
  async function reassignAgent() {
    if (!selected || isManager || !selectedAgentId) return;
    if (selectedAgentId === (selected.agent?.id || selected.lead.agent_id)) {
      setError("Select a different agent before updating the assignment.");
      return;
    }
    setBusy(true);
    setError("");
    const { error: assignmentError } = await supabase.rpc(
      "qc_reassign_lead_agent",
      {
        p_lead_id: selected.lead.id,
        p_agent_id: selectedAgentId,
      },
    );
    if (assignmentError) setError(rpcError(assignmentError));
    else {
      setMessage("Agent assignment updated and team access refreshed.");
      setSelected(null);
      await load(true);
    }
    setBusy(false);
  }
  async function deleteLead() {
    if (!selected || isManager) return;
    const reason = window.prompt(
      "Enter the reason for deleting this lead:",
      "Duplicate lead",
    );
    if (reason === null) return;
    if (!reason.trim()) {
      setError("A deletion reason is required.");
      return;
    }
    if (
      !window.confirm(
        `Permanently delete ${selected.lead.full_name || "this lead"}? This cannot be undone.`,
      )
    )
      return;
    setBusy(true);
    setError("");
    const { error: deleteError } = await supabase.rpc("qc_delete_lead", {
      p_lead_id: selected.lead.id,
      p_reason: reason.trim(),
    });
    if (deleteError) setError(rpcError(deleteError));
    else {
      setMessage(
        "Duplicate lead deleted. The action was recorded in the audit log.",
      );
      setSelected(null);
      await load(true);
    }
    setBusy(false);
  }
  async function moveLead(closeAfter = false) {
    if (!selected || !targetCompany || !targetDate || !targetTime) return false;
    const { error: moveError } = await supabase.rpc("qc_move_lead", {
      p_lead_id: selected.lead.id,
      p_company_id: targetCompany,
      p_location_id: targetLocation || null,
      p_date: targetDate,
      p_start_time: targetTime,
      p_reason: "QC calendar reassignment or reschedule",
    });
    if (moveError) {
      setError(rpcError(moveError));
      return false;
    }
    setMessage("Appointment moved and returned to Pending QC.");
    await load(true);
    if (closeAfter) setSelected(null);
    return true;
  }
  async function review(decision: "approved" | "denied" | "needs_correction") {
    if (!selected) return;
    if (decision !== "approved" && !decisionReason.trim()) {
      setError("Choose or enter a reason for this decision.");
      return;
    }
    setBusy(true);
    setError("");
    const originalTime = String(selected.appointment.start_time).slice(0, 5);
    const changed =
      targetCompany !== selected.lead.company_id ||
      (targetLocation || "") !== (selected.lead.location_id || "") ||
      targetDate !== selected.appointment.appointment_date ||
      targetTime !== originalTime;
    if (changed && !(await moveLead(false))) {
      setBusy(false);
      return;
    }
    const { error: shareError } = await supabase.rpc("qc_update_lead", {
      p_lead_id: selected.lead.id,
      p_patch: {
        recording_url: values.recording_url ?? "",
        share_recording_with_company: Boolean(
          values.share_recording_with_company,
        ),
      },
    });
    if (shareError) {
      setError(rpcError(shareError));
      setBusy(false);
      return;
    }
    const { error: reviewError } = await supabase.rpc("qc_review_lead", {
      p_lead_id: selected.lead.id,
      p_decision: decision,
      p_reason: decision === "approved" ? null : decisionReason,
      p_notes: decisionNotes || null,
    });
    if (reviewError) setError(rpcError(reviewError));
    else {
      setMessage(
        decision === "approved"
          ? isManager
            ? "Manager review submitted to Main QC. The lead remains hidden from the client."
            : "QC Approved. The lead is still internal until an Admin presses Send Lead."
          : decision === "needs_correction"
            ? "Returned to the assigned agent for correction."
            : "Denied; it remains hidden from the Company Link.",
      );
      setSelected(null);
      await load(true);
    }
    setBusy(false);
  }
  async function sendLead(row: Obj) {
    if (!isAdmin || !row?.lead?.id) return;
    if (
      !window.confirm(
        `Send ${row.lead.full_name || "this lead"} to ${row.company?.name || "the company"}? The company will be able to see it and it will count as delivered.`,
      )
    )
      return;
    setBusy(true);
    setError("");
    const { error: sendError } = await supabase.rpc(
      "qc_send_lead_to_client",
      { p_lead_id: row.lead.id },
    );
    if (sendError) setError(rpcError(sendError));
    else {
      setMessage(
        `${row.lead.lead_code || "Lead"} was sent to ${row.company?.name || "the company"}.`,
      );
      setSelected(null);
      await load(true);
    }
    setBusy(false);
  }
  async function reopen() {
    if (!selected || !decisionReason.trim()) {
      setError("Enter a reason before reopening this review.");
      return;
    }
    setBusy(true);
    const { error: reopenError } = await supabase.rpc("qc_reopen_review", {
      p_lead_id: selected.lead.id,
      p_reason: decisionReason,
    });
    if (reopenError) setError(rpcError(reopenError));
    else {
      setMessage("Review reopened as a new Pending QC cycle.");
      setSelected(null);
      await load(true);
    }
    setBusy(false);
  }
  function openExternal(row: Obj) {
    if (!row.portal?.external_form_url) return;
    const url = buildExternalFormUrl(
      row.portal.external_form_url,
      row.portal.external_prefill_map || {},
      row.lead.form_data || {},
      {
        lead_id: row.lead.id,
        lead_code: row.lead.lead_code,
        appointment_id: row.appointment.id,
        appointment_date: row.appointment.appointment_date,
        appointment_time: String(row.appointment.start_time).slice(0, 5),
      },
    );
    window.open(url, "_blank", "noopener,noreferrer");
  }
  async function exportCsv() {
    const { error: auditError } = await supabase.rpc("qc_log_export", {
      p_filters: {
        start_date: startDate,
        end_date: endDate,
        company_id: companyId || null,
        qc_status: qcStatus,
        selected_date: selectedDate,
        date_basis: dateBasis,
      },
      p_row_count: selectedRows.length,
    });
    if (auditError) {
      setError(rpcError(auditError));
      return;
    }
    const header = [
      "Filtered By",
      "Call / Lead Date",
      "Appointment Date",
      "Appointment Time",
      "Company",
      "Location",
      "Homeowner",
      "Phone",
      "Address",
      "Agent",
      "Appointment Status",
      "QC Status",
      "Recording",
    ];
    const lines = selectedRows.map((row) =>
      [
        dateBasis === "call" ? "Call / Lead Date" : "Appointment Date",
        row.lead.received_date,
        row.appointment.appointment_date,
        row.appointment.start_time,
        row.company.name,
        row.location?.label,
        row.lead.full_name,
        row.lead.phone_number,
        row.lead.address,
        row.agent?.name || row.lead.agent_name,
        row.appointment.canonical_status,
        row.qc_review?.status || row.lead.qc_status,
        row.lead.recording_url,
      ]
        .map(quoteCsv)
        .join(","),
    );
    const blob = new Blob(
      [[header.map(quoteCsv).join(","), ...lines].join("\n")],
      { type: "text/csv;charset=utf-8" },
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `readyops-qc-${dateBasis}-${selectedDate}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
    setMessage(`Exported ${selectedRows.length} visible QC rows.`);
  }

  const actions = (
    <>
      <button className="readyops-ref-secondary" onClick={goToday}>
        Today
      </button>
      <button className="readyops-ref-secondary" onClick={() => moveWeek(-1)}>
        <ChevronLeft size={14} /> Previous Week
      </button>
      <button className="readyops-ref-secondary" onClick={() => moveWeek(1)}>
        Next Week <ChevronRight size={14} />
      </button>
      <button
        className="readyops-ref-secondary"
        onClick={() => void exportCsv()}
      >
        <Download size={14} /> Export
      </button>
      <button
        className="readyops-ref-secondary"
        onClick={() => void load()}
        aria-label="Refresh"
      >
        <RefreshCw size={14} />
      </button>
    </>
  );
  return (
    <AdminWorkspaceShell
      active="qc"
      title="QC Calendar"
      subtitle={
        isManager
          ? "Review your team’s leads and submit approvals to Main QC."
          : isAdmin
            ? "Complete QC, then explicitly send approved leads to clients."
            : "Complete final QC; an Admin sends approved leads to clients."
      }
      actions={actions}
    >
      <div className="readyops-qc-page">
      {error && <Notice tone="red" text={error} />}
      {message && <Notice tone="blue" text={message} />}
      <div
        className={`mb-4 rounded-xl border p-3 text-sm font-semibold ${isManager ? "border-violet-200 bg-violet-50 text-violet-800" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}
      >
        {isManager
          ? "Manager QC mode: Approve submits the lead to Main QC. It does not send or expose the lead to the client."
          : isAdmin
            ? "Admin QC mode: Approve keeps the lead internal. Use Send Lead only after QC is complete."
            : "Final QC mode: Approve keeps the lead internal. An Admin must press Send Lead before the client can see it."}
      </div>
      <section className="readyops-ref-metrics">
        <Metric
          icon={<Building2 />}
          tone="blue"
          label="Companies"
          value={selectedSummary.companies}
        />
        <Metric
          icon={<CalendarDays />}
          tone="blue"
          label={dateBasis === "call" ? "Leads Received" : "Scheduled Leads"}
          value={selectedSummary.scheduled}
        />
        <Metric
          icon={<ShieldCheck />}
          tone="orange"
          label="Pending QC"
          value={selectedSummary.pending + selectedSummary.inReview}
        />
        <Metric
          icon={<Circle />}
          tone="purple"
          label="Awaiting Final QC"
          value={selectedSummary.managerApproved}
        />
        <Metric
          icon={<CheckCircle2 />}
          tone="green"
          label="Awaiting Send"
          value={selectedSummary.awaitingSend}
        />
        <Metric
          icon={<Send />}
          tone="green"
          label="Sent to Client"
          value={selectedSummary.sent}
        />
        <Metric
          icon={<AlertTriangle />}
          tone="orange"
          label="Needs Correction"
          value={selectedSummary.correction}
        />
        <Metric
          icon={<Circle />}
          tone="purple"
          label="QC Completion"
          value={`${completion}%`}
        />
      </section>
      <section className="mb-4 rounded-2xl border bg-white/95 p-3 shadow-sm">
        <div className="grid gap-2 md:grid-cols-3 xl:grid-cols-6">
          <Select
            value={dateBasis}
            onChange={(value) =>
              setDateBasis(value === "call" ? "call" : "appointment")
            }
            emptyValue="appointment"
            label="Appointment Date"
            options={[{ value: "call", label: "Call / Lead Date" }]}
          />
          <Select
            value={areaFilter}
            onChange={setAreaFilter}
            emptyValue="all"
            label="All Areas"
            options={areas.map((value) => ({ value, label: value }))}
          />
          <Select
            value={stateFilter}
            onChange={setStateFilter}
            emptyValue="all"
            label="All States"
            options={states.map((value) => ({ value, label: value }))}
          />
          <Select
            value={companyId}
            onChange={(value) => {
              setCompanyId(value);
              setLocationId("");
            }}
            emptyValue=""
            label="All Companies"
            options={refs.companies.map((item) => ({
              value: item.id,
              label: item.name,
            }))}
          />
          <Select
            value={locationId}
            onChange={setLocationId}
            emptyValue=""
            label="All Locations"
            options={refs.locations
              .filter((item) => !companyId || item.company_id === companyId)
              .map((item) => ({ value: item.id, label: item.label }))}
          />
          <Select
            value={teamId}
            onChange={(value) => {
              setTeamId(value);
              setAgentId("");
            }}
            emptyValue=""
            label="All Teams"
            options={refs.teams.map((item) => ({
              value: item.id,
              label: item.name,
            }))}
          />
          <Select
            value={agentId}
            onChange={setAgentId}
            emptyValue=""
            label="All Agents"
            options={filteredAgents.map((item) => ({
              value: item.id,
              label: item.name,
            }))}
          />
          <Select
            value={qcStatus}
            onChange={setQcStatus}
            emptyValue="all"
            label="All QC Statuses"
            options={[
              ["needs_review", "Needs Review (all pending)"],
              ["pending", "Pending QC"],
              ["in_review", "In Review"],
              ["manager_approved", "Awaiting Final QC"],
              ["approved", "QC Approved / Sent"],
              ["needs_correction", "Needs Correction"],
              ["denied", "Denied"],
            ].map(([value, label]) => ({ value, label }))}
          />
          <Select
            value={appointmentStatus}
            onChange={setAppointmentStatus}
            emptyValue="all"
            label="All Appointment Statuses"
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
          <form
            className="relative md:col-span-2"
            onSubmit={(event) => {
              event.preventDefault();
              setSearch(searchInput.trim());
            }}
          >
            <Search
              size={14}
              className="absolute left-3 top-3 text-slate-400"
            />
            <input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Search homeowner, phone, address, company…"
              className="h-10 w-full rounded-lg border bg-white pl-9 pr-3 text-xs"
            />
          </form>
          <Select
            value={searchScope}
            onChange={(value) =>
              setSearchScope(
                value === "selected_day" ? "selected_day" : "all_history",
              )
            }
            emptyValue="all_history"
            label="Search All History"
            options={[{ value: "selected_day", label: "Search Selected Day" }]}
          />
          <div className="flex items-center justify-center gap-2 rounded-lg border bg-slate-50 text-xs font-bold text-slate-600">
            <Clock3 size={14} />{" "}
            {isAllHistorySearch
              ? `All dates • up to 100 results`
              : "Location Time Zones"}
          </div>
        </div>
      </section>
      <section className="mb-5 grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-7">
        {queue.days.map((day) => {
          const date = new Date(`${day.date}T12:00:00`);
          const active = day.date === selectedDate;
          return (
            <button
              key={day.date}
              onClick={() => {
                setSelectedDate(day.date);
                if (search) setSearchScope("selected_day");
              }}
              className={`readyops-qc-day-card rounded-xl border p-3 text-center shadow-sm transition ${active ? "is-active border-[#071a33] bg-[#071a33] text-white" : "bg-white hover:border-blue-300"}`}
            >
              <p className="text-xs">
                {date.toLocaleDateString(undefined, { weekday: "long" })}
              </p>
              <strong className="block text-base">
                {date.toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                })}
              </strong>
              <span className="mt-2 block text-xs">
                {day.scheduled}{" "}
                {dateBasis === "call" ? "Received" : "Scheduled"}
              </span>
              <span className="mt-2 inline-flex rounded-md bg-amber-50 px-2 py-1 text-[10px] font-bold text-amber-700">
                {day.pending_qc} Pending QC
              </span>
            </button>
          );
        })}
      </section>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-xl font-black">
            {isAllHistorySearch ? (
              `All-History Search — “${search}”`
            ) : (
              <>
                {formatDateLong(selectedDate)} —{" "}
                {dateBasis === "call" ? "Leads Received" : "QC Queue"}
              </>
            )}
          </h3>
          <p className="text-xs text-slate-500">
            {isAllHistorySearch
              ? `Phone formatting is ignored, and every lead date is checked.${queue.truncated ? ` Showing the first 100 of ${queue.total} matches.` : ""}`
              : isManager
                ? "Only leads assigned to agents on your team are visible."
                : "Admins and Main QC can review leads across every team."}
          </p>
        </div>
        <p className="text-sm font-semibold">
          {selectedSummary.scheduled}{" "}
          {isAllHistorySearch
            ? "matches"
            : dateBasis === "call"
              ? "received"
              : "scheduled"}{" "}
          • {selectedSummary.pending + selectedSummary.inReview} pending •{" "}
          {selectedSummary.managerApproved} awaiting final QC
        </p>
      </div>
      {loading ? (
        <div className="grid min-h-64 place-items-center rounded-2xl border bg-white">
          <Loader2 className="animate-spin text-blue-600" />
        </div>
      ) : grouped.length === 0 ? (
        <div className="grid min-h-64 place-items-center rounded-2xl border border-dashed bg-white text-center">
          <div>
            <CalendarDays className="mx-auto mb-3 text-slate-300" size={36} />
            <p className="font-bold">
              {isAllHistorySearch
                ? "No lead in the full history matches this search."
                : "No leads match this day and filter set."}
            </p>
            <p className="text-xs text-slate-500">
              {isAllHistorySearch
                ? "Check the phone number or clear one of the company, area, team, or status filters."
                : "Choose another date or clear one of the filters."}
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {grouped.map((items) => (
            <CompanyGroup
              key={items[0].company.id}
              items={items}
              open={expanded.has(items[0].company.id)}
              onToggle={() => toggleGroup(items[0].company.id)}
              onReview={openReview}
              onSend={sendLead}
              isManager={isManager}
              canSend={isAdmin}
              dateBasis={dateBasis}
              allHistory={isAllHistorySearch}
            />
          ))}
        </div>
      )}
      {selected && (
        <ReviewDialog
          row={selected}
          values={values}
          change={change}
          refs={refs}
          targetCompany={targetCompany}
          setTargetCompany={(value) => {
            setTargetCompany(value);
            setTargetLocation("");
          }}
          targetLocation={targetLocation}
          setTargetLocation={setTargetLocation}
          targetDate={targetDate}
          setTargetDate={setTargetDate}
          targetTime={targetTime}
          setTargetTime={setTargetTime}
          decisionReason={decisionReason}
          setDecisionReason={setDecisionReason}
          decisionNotes={decisionNotes}
          setDecisionNotes={setDecisionNotes}
          busy={busy}
          close={() => setSelected(null)}
          save={saveEdits}
          move={() => void moveLead(true)}
          review={review}
          reopen={reopen}
          openExternal={openExternal}
          isManager={isManager}
          canSend={isAdmin}
          send={() => sendLead(selected)}
          selectedAgentId={selectedAgentId}
          setSelectedAgentId={setSelectedAgentId}
          reassignAgent={reassignAgent}
          deleteLead={deleteLead}
        />
      )}
      </div>
    </AdminWorkspaceShell>
  );
}

function CompanyGroup({
  items,
  open,
  onToggle,
  onReview,
  onSend,
  isManager,
  canSend,
  dateBasis,
  allHistory,
}: {
  items: Obj[];
  open: boolean;
  onToggle: () => void;
  onReview: (row: Obj, start?: boolean) => Promise<void>;
  onSend: (row: Obj) => Promise<void>;
  isManager: boolean;
  canSend: boolean;
  dateBasis: "appointment" | "call";
  allHistory: boolean;
}) {
  const first = items[0];
  const pending = countBy(items, "pending");
  const inReview = countBy(items, "in_review");
  const managerApproved = countBy(items, "manager_approved");
  const approved = countBy(items, "approved");
  const awaitingSend = items.filter(
    (row) =>
      (row.qc_review?.status || row.lead.qc_status) === "approved" &&
      !row.appointment?.company_visible_at,
  ).length;
  const sent = approved - awaitingSend;
  const denied = countBy(items, "denied");
  const correction = countBy(items, "needs_correction");
  const actionable = isManager
    ? ["pending", "in_review"]
    : ["pending", "in_review", "manager_approved"];
  const next = items.find((row) =>
    actionable.includes(row.qc_review?.status || row.lead.qc_status),
  );
  const completion = items.length
    ? Math.round(((approved + denied) / items.length) * 1000) / 10
    : 0;
  return (
    <section className="overflow-hidden rounded-2xl border bg-white shadow-sm">
      <header className="flex flex-wrap items-center gap-3 p-3">
        <button
          onClick={onToggle}
          className="rounded-lg p-1 hover:bg-slate-100"
        >
          {open ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
        </button>
        <div className="min-w-[210px] flex-1">
          <h4 className="font-black">{first.company.name}</h4>
          <p className="text-xs text-slate-500">
            {first.location?.state || first.company.state || "Company-wide"} •{" "}
            {items.length} {dateBasis === "call" ? "Received" : "Scheduled"}
          </p>
        </div>
        <Pill tone="amber">{pending + inReview} Pending QC</Pill>
        {managerApproved > 0 && (
          <Pill tone="purple">{managerApproved} Awaiting Final</Pill>
        )}
        {awaitingSend > 0 && (
          <Pill tone="orange">{awaitingSend} Awaiting Send</Pill>
        )}
        <Pill tone="green">{sent} Sent</Pill>
        {correction > 0 && (
          <Pill tone="orange">{correction} Needs Correction</Pill>
        )}
        <Pill tone="purple">{completion}% Complete</Pill>
        <button
          disabled={!next}
          onClick={() => next && void onReview(next, true)}
          className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-40"
        >
          Review Next Pending
        </button>
        {!isManager && (
          <button
            onClick={() => {
              window.location.href = `/admin/operations?company=${first.company.id}`;
            }}
            className="rounded-lg border px-4 py-2 text-xs font-bold"
          >
            View Company
          </button>
        )}
      </header>
      {open && (
        <HorizontalScrollFrame className="border-t" ariaLabel="QC queue horizontal scroll">
          <table className="w-full min-w-[1120px] text-xs">
            <thead className="bg-slate-50 text-left text-slate-500">
              <tr>
                <th className="p-3">
                  {dateBasis === "call" || allHistory ? "Appointment" : "Time"}
                </th>
                <th>Homeowner</th>
                <th>Address</th>
                <th>Agent</th>
                <th>Inspector / Lead Status</th>
                <th>QC Status</th>
                <th>Recording</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => {
                const status = row.qc_review?.status || row.lead.qc_status;
                const start =
                  ["pending", "in_review"].includes(status) ||
                  (!isManager && status === "manager_approved");
                return (
                  <tr
                    key={row.lead.id}
                    className="border-t hover:bg-blue-50/30"
                  >
                    <td className="p-3 font-bold text-blue-700">
                      {(dateBasis === "call" || allHistory) && (
                        <span className="block text-[10px] font-semibold text-slate-500">
                          {row.appointment.appointment_date}
                        </span>
                      )}
                      {formatTime(String(row.appointment.start_time))}
                    </td>
                    <td className="font-bold">{row.lead.full_name}</td>
                    <td className="min-w-[320px] max-w-[460px] whitespace-normal break-words leading-5">
                      {row.lead.address || "—"}
                    </td>
                    <td>
                      {row.agent?.name || row.lead.agent_name || "Unassigned"}
                    </td>
                    <td>
                      <StatusPill
                        status={
                          row.appointment.canonical_status ||
                          row.appointment.status
                        }
                      />
                    </td>
                    <td>
                      <StatusPill status={status} />
                    </td>
                    <td>
                      {row.lead.recording_url ? (
                        <Pill tone="green">
                          <Headphones size={11} /> Recording Ready
                        </Pill>
                      ) : (
                        <Pill tone="gray">
                          <UploadCloud size={11} /> Missing
                        </Pill>
                      )}
                    </td>
                    <td>
                      {status === "approved" &&
                      !row.appointment?.company_visible_at &&
                      canSend ? (
                        <button
                          onClick={() => void onSend(row)}
                          className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-4 py-1.5 font-bold text-white"
                        >
                          <Send size={12} /> Send Lead
                        </button>
                      ) : (
                        <button
                          onClick={() => void onReview(row, start)}
                          className="rounded-lg border border-blue-500 px-4 py-1.5 font-bold text-blue-700"
                        >
                          {status === "pending"
                            ? "Start QC"
                            : status === "manager_approved" && isManager
                              ? "Submitted"
                              : status === "approved" &&
                                  row.appointment?.company_visible_at
                                ? "Sent"
                                : "Review"}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </HorizontalScrollFrame>
      )}
    </section>
  );
}

type DialogProps = {
  row: Obj;
  values: Obj;
  change: (key: string, value: unknown) => void;
  refs: RefData;
  targetCompany: string;
  setTargetCompany: (value: string) => void;
  targetLocation: string;
  setTargetLocation: (value: string) => void;
  targetDate: string;
  setTargetDate: (value: string) => void;
  targetTime: string;
  setTargetTime: (value: string) => void;
  decisionReason: string;
  setDecisionReason: (value: string) => void;
  decisionNotes: string;
  setDecisionNotes: (value: string) => void;
  busy: boolean;
  close: () => void;
  save: () => Promise<void>;
  move: () => void;
  review: (
    decision: "approved" | "denied" | "needs_correction",
  ) => Promise<void>;
  reopen: () => Promise<void>;
  openExternal: (row: Obj) => void;
  isManager: boolean;
  canSend: boolean;
  send: () => Promise<void>;
  selectedAgentId: string;
  setSelectedAgentId: (value: string) => void;
  reassignAgent: () => Promise<void>;
  deleteLead: () => Promise<void>;
};
function ReviewDialog(props: DialogProps) {
  const status = props.row.qc_review?.status || props.row.lead.qc_status;
  const finalCompleted = ["approved", "denied"].includes(status);
  const managerSubmitted = status === "manager_approved";
  const awaitingSend =
    status === "approved" && !props.row.appointment?.company_visible_at;
  const completed = finalCompleted || (props.isManager && managerSubmitted);
  if (props.isManager && managerSubmitted)
  
    return (
      <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/55 p-6">
        <section className="w-full max-w-lg rounded-2xl bg-white p-6 text-center shadow-2xl">
          <ShieldCheck className="mx-auto text-violet-600" size={36} />
          <h2 className="mt-3 text-lg font-black">
            {managerSubmitted
              ? "Waiting for Final QC"
              : "Manager Review Completed"}
          </h2>
          <p className="mt-2 text-sm text-slate-600">
            {managerSubmitted
              ? "Your team review was submitted successfully. This lead is still hidden from the client. Final QC must approve it, and an Admin must press Send Lead."
              : "This review is complete. Only an Admin can send an approved lead to the client or reopen a completed QC decision."}
          </p>
          <button
            onClick={props.close}
            className="mt-5 rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-bold text-white"
          >
            Close
          </button>
        </section>
      </div>
    );
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/55 p-3 sm:p-6">
      <section className="mx-auto max-w-6xl overflow-hidden rounded-2xl bg-white shadow-2xl">
        <header className="sticky top-0 z-10 flex items-center justify-between border-b bg-white px-5 py-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-blue-600">
              {props.row.lead.lead_code} • QC Cycle{" "}
              {props.row.qc_review?.cycle_number || 1}
            </p>
            <h2 className="text-lg font-black">
              {props.row.company.name} — {props.row.lead.full_name}
            </h2>
          </div>
          <button onClick={props.close} className="rounded-lg border p-2">
            <X size={18} />
          </button>
        </header>
        <div className="grid gap-5 p-5 lg:grid-cols-[1fr_340px]">
          <div>
            <div className="grid gap-3 sm:grid-cols-2">
              {QC_FIELDS.map(([key, label]) => (
                <label
                  key={key}
                  className={`text-xs font-semibold text-slate-600 ${key === "notes" || key === "address" ? "sm:col-span-2" : ""}`}
                >
                  {label}
                  {key === "notes" ? (
                    <textarea
                      value={
                        Array.isArray(props.values[key])
                          ? props.values[key].join(", ")
                          : (props.values[key] ?? "")
                      }
                      onChange={(event) =>
                        props.change(key, event.target.value)
                      }
                      className="mt-1 min-h-20 w-full rounded-lg border p-2 text-sm"
                    />
                  ) : (
                    <input
                      value={
                        Array.isArray(props.values[key])
                          ? props.values[key].join(", ")
                          : (props.values[key] ?? "")
                      }
                      onChange={(event) =>
                        props.change(key, event.target.value)
                      }
                      className="mt-1 w-full rounded-lg border p-2 text-sm"
                    />
                  )}
                </label>
              ))}
            </div>
            <button
              disabled={props.busy || managerSubmitted}
              onClick={() => void props.save()}
              className="mt-4 inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-40"
            >
              <Save size={15} /> Save QC Edits
            </button>
          </div>
          <aside className="space-y-4">
            <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
              <div className="flex items-center gap-2 text-blue-950">
                <UserRound size={17} />
                <h3 className="font-bold">Agent Assignment</h3>
              </div>
              <p className="mt-2 text-xs text-blue-800">
                Current:{" "}
                {props.row.agent?.name ||
                  props.row.lead.agent_name ||
                  "Unassigned"}
              </p>
              {props.isManager ? (
                <p className="mt-3 rounded-lg border border-blue-200 bg-white p-2 text-xs text-slate-600">
                  Managers can view the assigned agent. Only Admin or Main QC
                  can change it.
                </p>
              ) : (
                <>
                  <select
                    value={props.selectedAgentId}
                    onChange={(event) =>
                      props.setSelectedAgentId(event.target.value)
                    }
                    className="mt-3 w-full rounded-lg border bg-white p-2 text-sm"
                  >
                    <option value="">Select the correct agent</option>
                    {props.refs.agents.map((agent) => (
                      <option key={agent.id} value={agent.id}>
                        {agent.name}
                      </option>
                    ))}
                  </select>
                  <button
                    disabled={
                      props.busy ||
                      !props.selectedAgentId ||
                      props.selectedAgentId ===
                        (props.row.agent?.id || props.row.lead.agent_id)
                    }
                    onClick={() => void props.reassignAgent()}
                    className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 p-2.5 text-xs font-bold text-white disabled:opacity-40"
                  >
                    <Save size={14} /> Update Agent Assignment
                  </button>
                  <p className="mt-2 text-[11px] text-blue-700">
                    This updates the agent name, linked user, and team access
                    together.
                  </p>
                </>
              )}
            </div>
            <QCRecordingUpload
              leadId={props.row.lead.id}
              value={String(props.values.recording_url || "")}
              shared={Boolean(props.values.share_recording_with_company)}
              onChange={(value) => props.change("recording_url", value)}
              onShareChange={(value) =>
                props.change("share_recording_with_company", value)
              }
            />
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <ClientLeadTemplate
                lead={{ ...props.row.lead, ...props.values }}
                appointment={props.row.appointment}
              />
            </div>
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
            />
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
              <h3 className="font-bold text-amber-950">Company Requirements</h3>
              <p className="mt-2 whitespace-pre-line text-sm text-amber-900">
                {props.row.portal?.requirements_short ||
                  props.row.company.requirements_note ||
                  "No quick requirements entered."}
              </p>
            </div>
            <div className="rounded-xl border p-4">
              <h3 className="font-bold">Transfer / Reschedule</h3>
              <select
                value={props.targetCompany}
                onChange={(event) => props.setTargetCompany(event.target.value)}
                className="mt-3 w-full rounded-lg border p-2 text-sm"
              >
                {props.refs.companies.map((company) => (
                  <option key={company.id} value={company.id}>
                    {company.name}
                  </option>
                ))}
              </select>
              <select
                value={props.targetLocation}
                onChange={(event) =>
                  props.setTargetLocation(event.target.value)
                }
                className="mt-2 w-full rounded-lg border p-2 text-sm"
              >
                <option value="">Company-wide</option>
                {props.refs.locations
                  .filter(
                    (location) => location.company_id === props.targetCompany,
                  )
                  .map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.label}
                    </option>
                  ))}
              </select>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <input
                  type="date"
                  value={props.targetDate}
                  onChange={(event) => props.setTargetDate(event.target.value)}
                  className="rounded-lg border p-2 text-sm"
                />
                <input
                  type="time"
                  value={props.targetTime}
                  onChange={(event) => props.setTargetTime(event.target.value)}
                  className="rounded-lg border p-2 text-sm"
                />
              </div>
              <button
                disabled={props.busy || managerSubmitted}
                onClick={props.move}
                className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-blue-200 bg-blue-50 p-2 text-xs font-bold text-blue-700 disabled:opacity-40"
              >
                <Shuffle size={14} /> Move / Keep Pending
              </button>
            </div>
            {awaitingSend && (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                <div className="flex items-center gap-2 text-emerald-950">
                  <CheckCircle2 size={17} />
                  <h3 className="font-black">QC Approved — Awaiting Send</h3>
                </div>
                <p className="mt-2 text-xs text-emerald-800">
                  Approval is complete, but the company still cannot see this
                  lead and it does not count as delivered.
                </p>
                {props.canSend ? (
                  <button
                    disabled={props.busy}
                    onClick={() => void props.send()}
                    className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 p-3 text-sm font-black text-white disabled:opacity-40"
                  >
                    <Send size={15} /> Send Lead to Company
                  </button>
                ) : (
                  <p className="mt-3 rounded-lg bg-white p-2 text-xs font-bold text-slate-600">
                    Waiting for an Admin to press Send Lead.
                  </p>
                )}
              </div>
            )}
            <div className="rounded-xl border p-4">
              <label className="text-xs font-bold text-slate-600">
                Decision Reason
                <select
                  value={props.decisionReason}
                  onChange={(event) =>
                    props.setDecisionReason(event.target.value)
                  }
                  className="mt-1 w-full rounded-lg border p-2 text-sm"
                >
                  <option value="">Select or enter a reason</option>
                  <option>Missing or invalid recording</option>
                  <option>Incorrect homeowner information</option>
                  <option>Outside company requirements</option>
                  <option>Duplicate appointment</option>
                  <option>Agent follow-up required</option>
                </select>
              </label>
              <textarea
                value={props.decisionReason}
                onChange={(event) =>
                  props.setDecisionReason(event.target.value)
                }
                placeholder="Reason details"
                className="mt-2 min-h-16 w-full rounded-lg border p-2 text-sm"
              />
              <textarea
                value={props.decisionNotes}
                onChange={(event) => props.setDecisionNotes(event.target.value)}
                placeholder="Internal QC notes"
                className="mt-2 min-h-16 w-full rounded-lg border p-2 text-sm"
              />
              {completed ? (
                <button
                  disabled={props.busy}
                  onClick={() => void props.reopen()}
                  className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 p-2.5 text-xs font-bold text-white"
                >
                  <RotateCcw size={14} /> Reopen as New QC Cycle
                </button>
              ) : (
                <div className="mt-3 grid grid-cols-3 gap-2">
                  <button
                    disabled={props.busy}
                    onClick={() => void props.review("denied")}
                    className="rounded-lg bg-red-600 p-2 text-xs font-bold text-white"
                  >
                    <XCircle size={14} className="mx-auto mb-1" /> Deny
                  </button>
                  <button
                    disabled={props.busy}
                    onClick={() => void props.review("needs_correction")}
                    className="rounded-lg bg-amber-500 p-2 text-xs font-bold text-white"
                  >
                    <AlertTriangle size={14} className="mx-auto mb-1" /> Correct
                  </button>
                  <button
                    disabled={props.busy}
                    onClick={() => void props.review("approved")}
                    className="rounded-lg bg-emerald-600 p-2 text-xs font-bold text-white"
                  >
                    <CheckCircle2 size={14} className="mx-auto mb-1" /> Approve
                  </button>
                </div>
              )}
            </div>
            {status === "approved" &&
              Boolean(props.row.appointment?.company_visible_at) &&
              props.row.portal?.form_mode !== "internal" &&
              props.row.portal?.external_form_url && (
                <button
                  onClick={() => props.openExternal(props.row)}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-sm font-bold text-white"
                >
                  <ExternalLink size={15} /> Open Prefilled Client Form
                </button>
              )}
            <div className="rounded-xl bg-slate-900 p-4 text-xs text-slate-200">
              <ShieldCheck size={15} className="mb-2" />
              <strong>Delivery rule:</strong> only approved, company-visible
              appointments count as sent leads. Pending, denied, corrected,
              draft, deleted, and unsent records are excluded.
            </div>
            {!props.isManager && (
              <div className="rounded-xl border border-red-200 bg-red-50 p-4">
                <h3 className="font-bold text-red-900">Duplicate Lead</h3>
                <p className="mt-1 text-xs text-red-700">
                  Delete only when this lead was entered twice. Delivered or
                  invoiced leads are protected.
                </p>
                <button
                  disabled={props.busy || status === "approved"}
                  onClick={() => void props.deleteLead()}
                  className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-red-300 bg-white p-2.5 text-xs font-bold text-red-700 disabled:opacity-40"
                >
                  <Trash2 size={14} /> Delete Lead
                </button>
              </div>
            )}
          </aside>
        </div>
      </section>
    </div>
  );
}

function Select({
  value,
  onChange,
  emptyValue,
  label,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  emptyValue: string;
  label: string;
  options: { value: string; label: string }[];
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="h-10 rounded-lg border bg-white px-3 text-xs font-semibold"
    >
      <option value={emptyValue}>{label}</option>
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
  value,
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
        <strong>{value}</strong>
      </div>
    </div>
  );
}
function Pill({
  tone,
  children,
}: {
  tone: "amber" | "green" | "orange" | "purple" | "gray";
  children: ReactNode;
}) {
  const classes = {
    amber: "bg-amber-50 text-amber-700",
    green: "bg-emerald-50 text-emerald-700",
    orange: "bg-orange-50 text-orange-700",
    purple: "bg-violet-50 text-violet-700",
    gray: "bg-slate-100 text-slate-500",
  };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-bold ${classes[tone]}`}
    >
      {children}
    </span>
  );
}
function StatusPill({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-1 text-[10px] font-black ${leadStatusClasses(status)}`}
    >
      {leadStatusLabel(status)}
    </span>
  );
}
function Notice({ tone, text }: { tone: "red" | "blue"; text: string }) {
  return (
    <div
      className={`mb-4 rounded-xl border p-3 text-sm ${tone === "red" ? "border-red-200 bg-red-50 text-red-700" : "border-blue-200 bg-blue-50 text-blue-700"}`}
    >
      {text}
    </div>
  );
}
