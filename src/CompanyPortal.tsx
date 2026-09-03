import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BarChart3,
  CalendarDays,
  CalendarClock,
  CalendarX2,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clipboard,
  Download,
  ExternalLink,
  FileSpreadsheet,
  ImageUp,
  Loader2,
  MapPin,
  Pencil,
  PenLine,
  Plus,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  UserRoundCheck,
  Users,
  UserX,
  Clock3,
  X,
} from "lucide-react";
import { supabase } from "./supabase";
import { isLeadOutcome } from "./leadOutcome";
import { PortalFormField, PortalFormSection } from "./DynamicLeadForm";
import { HorizontalScrollFrame } from "./HorizontalScrollFrame";
import {
  addDays,
  calendarWeekStart,
  copyText,
  formatDateLong,
  formatTime,
  localDate,
  rpcError,
} from "./portalUtils";
import { READYOPS_LOGO_DATA_URI } from "./brand";
import { ClientLeadTemplate } from "./ClientLeadTemplate";
import { SharedRecordingPlayer } from "./SharedRecordingPlayer";
import { AppointmentWeatherBadge } from "./AgentWeatherPreview";
import { useCompanyPortalPresence } from "./useCompanyPortalPresence";
import {
  ClientStatusActions,
  LeadReceivedIndicator,
} from "./LeadStatusControls";
import {
  clientLeadStatusLabel,
  leadStatusClasses,
  leadStatusExportValue,
  normalizeLeadDisposition,
  type LeadDisposition,
} from "./leadStatusPresentation";

interface Location {
  id: string;
  location_label: string;
  state: string | null;
  office_name: string | null;
  address: string | null;
  city: string | null;
  zip_code: string | null;
  service_cities: string[];
  service_zips: string[];
  phone: string | null;
  email: string | null;
  manager_name: string | null;
  timezone: string;
  notes: string | null;
  active: boolean;
  sort_order: number;
}
interface ScheduleRule {
  id: string;
  location_id: string | null;
  day_of_week: number;
  is_open: boolean;
  start_time: string;
  end_time: string;
  slot_minutes: number;
  max_per_slot: number;
  max_per_day: number;
}
interface ScheduleException {
  id: string;
  location_id: string | null;
  exception_date: string;
  is_closed: boolean;
  start_time: string | null;
  end_time: string | null;
  note: string | null;
}
interface Representative {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  location_id: string | null;
  active: boolean;
  access_token: string;
}
interface LeadRecord {
  id: string;
  lead_code: string;
  full_name: string;
  phone_number: string;
  address: string;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  email: string | null;
  service_needed: string | null;
  language: string | null;
  notes: string | null;
  form_data: Record<string, unknown>;
  qualification_status: string;
  recording_url: string | null;
  recording_shared?: boolean;
}
interface Appointment {
  id: string;
  appointment_date: string;
  start_time: string;
  end_time: string;
  status: string;
  canonical_status?: string;
  rep_status: string;
  attendance_status: string;
  inspection_status: string;
  sales_outcome: string;
  client_status: string;
  company_action?: string;
  client_received?: boolean;
  received_at?: string | null;
  received_by?: string | null;
  inspector_notes: string | null;
  representative_id: string | null;
  representative_name: string | null;
  location_label: string | null;
  lead: LeadRecord;
}
interface AuditLog {
  id: string;
  action: string;
  actor_type: string;
  actor_name: string | null;
  entity_type: string;
  old_value: unknown;
  new_value: unknown;
  created_at: string;
}
interface SettingsRecord {
  company_id: string;
  public_slug: string;
  portal_enabled: boolean;
  allow_public_booking: boolean;
  company_access_enabled: boolean;
  company_access_token: string;
  timezone: string;
  requirements_short: string;
  requirements_detail: string;
  qualification_rules: Record<string, unknown>;
  form_mode: "internal" | "external" | "internal_external";
  form_schema: PortalFormSection[];
  external_form_provider: string | null;
  external_form_url: string | null;
  external_prefill_map: Record<string, string>;
  external_submission_map: Record<string, string>;
}
interface CompanyPortalData {
  company: {
    id: string;
    name: string;
    state: string | null;
    email: string | null;
    phone: string | null;
    logo_path?: string | null;
  };
  settings: SettingsRecord;
  locations: Location[];
  schedule_rules: ScheduleRule[];
  exceptions: ScheduleException[];
  representatives: Representative[];
  appointments: Appointment[];
  audit_logs: AuditLog[];
}

interface CompanyDashboardSummary {
  company: {
    id: string;
    name: string;
    state: string | null;
    logo_path: string | null;
  };
  performance: {
    total_leads: number;
    good_inspected: number;
    signed_contracts: number;
    no_shows: number;
    bad_leads: number;
    rescheduled: number;
    pending_updates: number;
    inspection_rate: number;
    close_rate: number;
  };
  active_package: null | {
    id: string;
    package_number: number | null;
    package_name: string | null;
    lead_target: number;
    amount_per_lead: number | null;
    package_total: number;
    amount_paid: number;
    payment_status: string;
    status: string;
    start_date: string | null;
    completed_at: string | null;
    completion_date: string | null;
    delivered_leads: number;
    remaining_leads: number;
    remaining_balance: number;
    completion_percentage: number;
    agreement_type?: string | null;
  };
  package_history: Array<Record<string, unknown>>;
  last_updated_at: string | null;
}

type Tab = "overview" | "leads" | "setup" | "reports";
type SetupTab = "locations" | "schedule" | "requirements" | "forms" | "reps";
const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
const COMPANY_LEAD_ACTIONS: Array<
  [Exclude<LeadDisposition, "pending">, string]
> = [
  ["good", "Inspected"],
  ["no_show", "No Show"],
  ["bad", "Bad / Canceled"],
  ["signed_contract", "Signed Contract"],
  ["rescheduled", "Rescheduled"],
];

function optimisticAppointmentStatus(
  value: string,
): Partial<Appointment> {
  const status = normalizeLeadDisposition(value) || "pending";
  const patch: Partial<Appointment> = {
    company_action: status,
    client_status: status,
    canonical_status: status === "good" ? "good_inspected" : status,
  };
  if (status === "good" || status === "signed_contract") {
    patch.inspection_status = "completed";
  } else if (status === "no_show") {
    patch.inspection_status = "not_completed";
  }
  if (status === "signed_contract") patch.sales_outcome = "signed_contract";
  if (status === "bad") patch.sales_outcome = "lost";
  return patch;
}

function optimisticDashboardStatus(
  current: CompanyDashboardSummary | null,
  appointment: Appointment,
  nextStatus: string,
): CompanyDashboardSummary | null {
  if (!current) return current;
  const previousDisposition =
    normalizeLeadDisposition(
      appointment.company_action ||
        appointment.canonical_status ||
        appointment.client_status,
    ) || "pending";
  const nextDisposition = normalizeLeadDisposition(nextStatus) || "pending";
  if (previousDisposition === nextDisposition) return current;

  const fields: Record<
    LeadDisposition,
    | "pending_updates"
    | "good_inspected"
    | "bad_leads"
    | "no_shows"
    | "signed_contracts"
    | "rescheduled"
  > = {
    pending: "pending_updates",
    good: "good_inspected",
    bad: "bad_leads",
    no_show: "no_shows",
    signed_contract: "signed_contracts",
    rescheduled: "rescheduled",
  };
  const performance = { ...current.performance };
  const previousField = fields[previousDisposition];
  const nextField = fields[nextDisposition];
  performance[previousField] = Math.max(0, performance[previousField] - 1);
  performance[nextField] += 1;
  performance.inspection_rate = performance.total_leads
    ? ((performance.good_inspected + performance.signed_contracts) /
        performance.total_leads) *
      100
    : 0;
  performance.close_rate =
    performance.good_inspected + performance.signed_contracts
      ? (performance.signed_contracts /
          (performance.good_inspected + performance.signed_contracts)) *
        100
      : 0;
  return { ...current, performance };
}

export function CompanyPortal({
  companyId,
  token,
}: {
  companyId: string;
  token: string;
}) {
  const [ownerAccess, setOwnerAccess] = useState(false);
  const [data, setData] = useState<CompanyPortalData | null>(null);
  const [dashboard, setDashboard] = useState<CompanyDashboardSummary | null>(
    null,
  );
  const [tab, setTab] = useState<Tab>("overview");
  const [setupTab, setSetupTab] = useState<SetupTab>("locations");
  const [companyLeadFilter, setCompanyLeadFilter] = useState("all");
  const [companyLeadLocationId, setCompanyLeadLocationId] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [editingCompanyName, setEditingCompanyName] = useState(false);
  const [companyNameDraft, setCompanyNameDraft] = useState("");
  const [selectedLead, setSelectedLead] = useState<Appointment | null>(null);
  const [companyLeadRefreshKey, setCompanyLeadRefreshKey] = useState(0);
  const [settingsDraft, setSettingsDraft] = useState<SettingsRecord | null>(
    null,
  );
  const [formSchema, setFormSchema] = useState<PortalFormSection[]>([]);
  const [prefillJson, setPrefillJson] = useState("{}");
  const [newRep, setNewRep] = useState({
    name: "",
    phone: "",
    email: "",
    location_id: "",
  });
  const [newException, setNewException] = useState({
    exception_date: "",
    is_closed: true,
    start_time: "09:00",
    end_time: "18:00",
    note: "",
    location_id: "",
  });
  const [scheduleLocation, setScheduleLocation] = useState<string>("");
  const [selectedDay, setSelectedDay] = useState(() => localDate(new Date()));

  useEffect(() => {
    let active = true;
    const checkOwnerAccess = async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session) {
        if (active) setOwnerAccess(false);
        return;
      }
      const { data: hasOwnerAccess } = await supabase.rpc(
        "readyops_owner_access",
      );
      if (active) setOwnerAccess(hasOwnerAccess === true);
    };
    void checkOwnerAccess();
    const { data: authListener } = supabase.auth.onAuthStateChange(() => {
      void checkOwnerAccess();
    });
    return () => {
      active = false;
      authListener.subscription.unsubscribe();
    };
  }, []);

  useCompanyPortalPresence(companyId, token, tab);

  const selectedWeekStart = calendarWeekStart(
    new Date(`${selectedDay}T12:00:00`),
  );
  const windowStart = localDate(addDays(selectedWeekStart, -7));
  const windowEnd = localDate(addDays(selectedWeekStart, 28));

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const [portalResult, dashboardResult] = await Promise.all([
      supabase.rpc("get_company_management_portal", {
        p_company_id: companyId,
        p_access_token: token,
        p_start_date: windowStart,
        p_end_date: windowEnd,
      }),
      supabase.rpc("get_company_management_dashboard_summary", {
        p_company_id: companyId,
        p_access_token: token,
      }),
    ]);
    const { data: result, error: rpcErr } = portalResult;
    if (rpcErr) {
      setError(rpcError(rpcErr));
      setData(null);
    } else {
      const portal = result as CompanyPortalData;
      setData(portal);
      setSettingsDraft(portal.settings);
      setFormSchema(portal.settings.form_schema || []);
      setPrefillJson(
        JSON.stringify(portal.settings.external_prefill_map || {}, null, 2),
      );
      setDashboard(
        dashboardResult.error
          ? null
          : (dashboardResult.data as CompanyDashboardSummary),
      );
    }
    setLoading(false);
  }, [companyId, token, windowEnd, windowStart]);

  useEffect(() => {
    void load();
  }, [load]);

  function notify(message: string) {
    setSuccess(message);
    window.setTimeout(() => setSuccess(""), 2500);
  }

  async function saveSettings(
    patch: Record<string, unknown>,
    message = "Settings saved.",
  ) {
    setBusy(true);
    setError("");
    const { error: rpcErr } = await supabase.rpc(
      "update_company_portal_settings",
      { p_company_id: companyId, p_access_token: token, p_patch: patch },
    );
    if (rpcErr) setError(rpcError(rpcErr));
    else {
      notify(message);
      await load();
    }
    setBusy(false);
  }

  async function saveCompanyName() {
    const companyName = companyNameDraft.trim();
    if (!companyName) {
      setError("Company name cannot be blank.");
      return;
    }
    if (companyName.length > 120) {
      setError("Company name must be 120 characters or fewer.");
      return;
    }

    setBusy(true);
    setError("");
    const { error: rpcErr } = await supabase.rpc(
      "update_company_portal_name",
      {
        p_company_id: companyId,
        p_access_token: token,
        p_company_name: companyName,
      },
    );
    if (rpcErr) setError(rpcError(rpcErr));
    else {
      setEditingCompanyName(false);
      notify("Company name updated.");
      await load();
    }
    setBusy(false);
  }

  async function saveRequirements() {
    if (!settingsDraft) return;
    await saveSettings({
      public_slug: settingsDraft.public_slug,
      portal_enabled: settingsDraft.portal_enabled,
      allow_public_booking: settingsDraft.allow_public_booking,
      company_access_enabled: settingsDraft.company_access_enabled,
      timezone: settingsDraft.timezone,
      requirements_short: settingsDraft.requirements_short,
      requirements_detail: settingsDraft.requirements_detail,
      qualification_rules: settingsDraft.qualification_rules,
    });
  }

  async function saveForms() {
    if (!settingsDraft) return;
    let map: Record<string, string> = {};
    try {
      map = JSON.parse(prefillJson) as Record<string, string>;
    } catch {
      setError("External prefill mapping must be valid JSON.");
      return;
    }
    await saveSettings(
      {
        form_mode: settingsDraft.form_mode,
        form_schema: formSchema,
        external_form_provider: settingsDraft.external_form_provider || "",
        external_form_url: settingsDraft.external_form_url || "",
        external_prefill_map: map,
      },
      "Form settings saved.",
    );
  }

  async function saveRule(day: number, draft: Partial<ScheduleRule>) {
    setBusy(true);
    setError("");
    const { error: rpcErr } = await supabase.rpc(
      "upsert_company_schedule_rule",
      {
        p_company_id: companyId,
        p_access_token: token,
        p_rule: {
          location_id: scheduleLocation || null,
          day_of_week: day,
          is_open: draft.is_open ?? true,
          start_time: (draft.start_time || "09:00").slice(0, 5),
          end_time: (draft.end_time || "18:00").slice(0, 5),
          slot_minutes: Number(draft.slot_minutes || 60),
          max_per_slot: Number(draft.max_per_slot || 1),
          max_per_day: Number(draft.max_per_day || 8),
        },
      },
    );
    if (rpcErr) setError(rpcError(rpcErr));
    else {
      notify(`${DAY_NAMES[day]} schedule saved.`);
      await load();
    }
    setBusy(false);
  }

  async function createException() {
    if (!newException.exception_date) {
      setError("Select an exception date.");
      return;
    }
    setBusy(true);
    setError("");
    const payload = {
      ...newException,
      location_id: newException.location_id || null,
      start_time: newException.is_closed ? null : newException.start_time,
      end_time: newException.is_closed ? null : newException.end_time,
    };
    const { error: rpcErr } = await supabase.rpc(
      "create_company_schedule_exception",
      { p_company_id: companyId, p_access_token: token, p_exception: payload },
    );
    if (rpcErr) setError(rpcError(rpcErr));
    else {
      setNewException({
        exception_date: "",
        is_closed: true,
        start_time: "09:00",
        end_time: "18:00",
        note: "",
        location_id: "",
      });
      notify("Schedule exception added.");
      await load();
    }
    setBusy(false);
  }

  async function deleteException(id: string) {
    setBusy(true);
    const { error: rpcErr } = await supabase.rpc(
      "delete_company_schedule_exception",
      { p_company_id: companyId, p_access_token: token, p_exception_id: id },
    );
    if (rpcErr) setError(rpcError(rpcErr));
    else {
      notify("Exception removed.");
      await load();
    }
    setBusy(false);
  }

  async function createRep() {
    if (!newRep.name.trim()) {
      setError("Representative name is required.");
      return;
    }
    setBusy(true);
    setError("");
    const { error: rpcErr } = await supabase.rpc(
      "create_company_representative",
      {
        p_company_id: companyId,
        p_access_token: token,
        p_representative: {
          ...newRep,
          location_id: newRep.location_id || null,
        },
      },
    );
    if (rpcErr) setError(rpcError(rpcErr));
    else {
      setNewRep({ name: "", phone: "", email: "", location_id: "" });
      notify("Representative created.");
      await load();
    }
    setBusy(false);
  }

  async function updateRep(
    rep: Representative,
    patch: Record<string, unknown>,
  ) {
    setBusy(true);
    setError("");
    const { error: rpcErr } = await supabase.rpc(
      "update_company_representative",
      {
        p_company_id: companyId,
        p_access_token: token,
        p_representative_id: rep.id,
        p_patch: patch,
      },
    );
    if (rpcErr) setError(rpcError(rpcErr));
    else {
      notify("Representative updated.");
      await load();
    }
    setBusy(false);
  }

  async function assignRep(appointmentId: string, repId: string) {
    setBusy(true);
    setError("");
    const { error: rpcErr } = await supabase.rpc(
      "assign_appointment_representative",
      {
        p_company_id: companyId,
        p_access_token: token,
        p_appointment_id: appointmentId,
        p_representative_id: repId || null,
      },
    );
    if (rpcErr) setError(rpcError(rpcErr));
    else {
      const assignedRepresentative = data?.representatives.find(
        (representative) => representative.id === repId,
      );
      setSelectedLead((current) =>
        current?.id === appointmentId
          ? {
              ...current,
              representative_id: repId || null,
              representative_name: assignedRepresentative?.name || null,
            }
          : current,
      );
      setCompanyLeadRefreshKey((value) => value + 1);
      notify("Representative assignment updated.");
      await load();
    }
    setBusy(false);
  }

  async function updateAppointmentStatus(
    appointmentId: string,
    status: string,
  ) {
    setBusy(true);
    setError("");
    const { data: updated, error: rpcErr } = await supabase.rpc(
      "company_update_appointment_status",
      {
        p_company_id: companyId,
        p_access_token: token,
        p_appointment_id: appointmentId,
        p_status: status,
      },
    );
    if (rpcErr) setError(rpcError(rpcErr));
    else {
      const updatedAppointment = updated as Partial<Appointment> | null;
      setSelectedLead((current) =>
        current?.id === appointmentId && updatedAppointment
          ? { ...current, ...updatedAppointment }
          : current,
      );
      setCompanyLeadRefreshKey((value) => value + 1);
      notify("Appointment status updated.");
      await load();
    }
    setBusy(false);
  }

  async function updateLeadOutcome(
    appointment: Appointment,
    clientStatus: string,
    suppliedNotes?: string,
  ) {
    const note =
      suppliedNotes === undefined
        ? window.prompt(
            "Inspector / company notes (optional)",
            appointment.inspector_notes || "",
          )
        : suppliedNotes;
    if (note === null) return;
    const previousData = data;
    const previousSelected = selectedLead;
    const previousDashboard = dashboard;
    const optimistic = optimisticAppointmentStatus(clientStatus);
    setBusy(true);
    setError("");
    setSelectedLead((current) =>
      current?.id === appointment.id ? { ...current, ...optimistic } : current,
    );
    setData((current) =>
      current
        ? {
            ...current,
            appointments: current.appointments.map((item) =>
              item.id === appointment.id ? { ...item, ...optimistic } : item,
            ),
          }
        : current,
    );
    setDashboard((current) =>
      optimisticDashboardStatus(current, appointment, clientStatus),
    );
    const { data: updated, error: rpcErr } = await supabase.rpc(
      "company_update_lead_outcome",
      {
        p_company_id: companyId,
        p_access_token: token,
        p_appointment_id: appointment.id,
        p_client_status: clientStatus,
        p_notes: note,
      },
    );
    if (rpcErr) {
      setData(previousData);
      setSelectedLead(previousSelected);
      setDashboard(previousDashboard);
      setError(rpcError(rpcErr));
    } else {
      const updatedAppointment = updated as Partial<Appointment> | null;
      if (updatedAppointment) {
        setSelectedLead((current) =>
          current?.id === appointment.id
            ? { ...current, ...updatedAppointment }
            : current,
        );
        setData((current) =>
          current
            ? {
                ...current,
                appointments: current.appointments.map((item) =>
                  item.id === appointment.id
                    ? { ...item, ...updatedAppointment }
                    : item,
                ),
              }
            : current,
        );
      }
      setCompanyLeadRefreshKey((value) => value + 1);
      notify("Lead outcome updated.");
      await load();
    }
    setBusy(false);
  }

  async function updateLeadPackage(
    packageId: string,
    leadTarget: number,
    amountPerLead: number,
    startDate: string,
  ): Promise<boolean> {
    if (!ownerAccess) {
      setError("Owner access is required to edit a lead package.");
      return false;
    }
    if (!Number.isInteger(leadTarget) || leadTarget <= 0) {
      setError("Package leads must be a whole number greater than zero.");
      return false;
    }
    if (!Number.isFinite(amountPerLead) || amountPerLead < 0) {
      setError("Price per lead cannot be negative.");
      return false;
    }
    if (!startDate) {
      setError("Start date is required.");
      return false;
    }

    setBusy(true);
    setError("");
    const { data: scopeRows, error: scopeError } = await supabase
      .from("company_package_locations")
      .select("location_id")
      .eq("package_id", packageId);
    if (scopeError) {
      setError(rpcError(scopeError));
      setBusy(false);
      return false;
    }

    const { data: updated, error: packageError } = await supabase.rpc(
      "save_company_package_admin",
      {
        p_company_id: companyId,
        p_package_id: packageId,
        p_lead_target: leadTarget,
        p_amount_per_lead: amountPerLead,
        p_start_date: startDate,
        p_location_ids: (scopeRows || []).map((row) => row.location_id),
        p_override_price: true,
      },
    );
    if (packageError) {
      setError(rpcError(packageError));
      setBusy(false);
      return false;
    }

    const updatedPackage = updated as
      | CompanyDashboardSummary["active_package"]
      | null;
    if (updatedPackage) {
      setDashboard((current) =>
        current ? { ...current, active_package: updatedPackage } : current,
      );
    }
    notify("Lead package updated.");
    await load();
    setBusy(false);
    return true;
  }

  async function createNextLeadPackage(
    currentPackageId: string,
    leadTarget: number,
    amountPerLead: number,
    startDate: string,
  ): Promise<boolean> {
    if (!ownerAccess) {
      setError("Owner access is required to add another lead package.");
      return false;
    }
    if (!Number.isInteger(leadTarget) || leadTarget <= 0) {
      setError("Package leads must be a whole number greater than zero.");
      return false;
    }
    if (!Number.isFinite(amountPerLead) || amountPerLead < 0) {
      setError("Price per lead cannot be negative.");
      return false;
    }
    if (!startDate) {
      setError("Start date is required.");
      return false;
    }
    if (
      !window.confirm(
        "Complete the current package and activate this new package? The completed package will remain in history.",
      )
    ) {
      return false;
    }

    setBusy(true);
    setError("");
    const { data: scopeRows, error: scopeError } = await supabase
      .from("company_package_locations")
      .select("location_id")
      .eq("package_id", currentPackageId);
    if (scopeError) {
      setError(rpcError(scopeError));
      setBusy(false);
      return false;
    }

    const { data: rolled, error: packageError } = await supabase.rpc(
      "start_next_company_package_admin",
      {
        p_company_id: companyId,
        p_current_package_id: currentPackageId,
        p_lead_target: leadTarget,
        p_amount_per_lead: amountPerLead,
        p_start_date: startDate,
        p_location_ids: (scopeRows || []).map((row) => row.location_id),
      },
    );
    if (packageError) {
      setError(rpcError(packageError));
      setBusy(false);
      return false;
    }

    const result = rolled as {
      active_package?: CompanyDashboardSummary["active_package"];
    } | null;
    if (result?.active_package) {
      setDashboard((current) =>
        current ? { ...current, active_package: result.active_package || null } : current,
      );
    }
    notify("New lead package created. The previous package is saved in history.");
    await load();
    setBusy(false);
    return true;
  }

  async function createLeadPackage(
    leadTarget: number,
    amountPerLead: number,
    startDate: string,
  ): Promise<boolean> {
    if (!ownerAccess) {
      setError("Owner access is required to create a lead package.");
      return false;
    }
    if (!Number.isInteger(leadTarget) || leadTarget <= 0) {
      setError("Package leads must be a whole number greater than zero.");
      return false;
    }
    if (!Number.isFinite(amountPerLead) || amountPerLead < 0) {
      setError("Price per lead cannot be negative.");
      return false;
    }
    if (!startDate) {
      setError("Start date is required.");
      return false;
    }

    setBusy(true);
    setError("");
    const { data: created, error: packageError } = await supabase.rpc(
      "save_company_package_admin",
      {
        p_company_id: companyId,
        p_package_id: null,
        p_lead_target: leadTarget,
        p_amount_per_lead: amountPerLead,
        p_start_date: startDate,
        p_location_ids: [],
        p_override_price: true,
      },
    );
    if (packageError) {
      setError(rpcError(packageError));
      setBusy(false);
      return false;
    }

    const activePackage = created as
      | CompanyDashboardSummary["active_package"]
      | null;
    if (activePackage) {
      setDashboard((current) =>
        current ? { ...current, active_package: activePackage } : current,
      );
    }
    notify("Lead package created.");
    await load();
    setBusy(false);
    return true;
  }

  async function confirmLeadReceipt(appointment: Appointment) {
    const previousData = data;
    const previousSelected = selectedLead;
    const optimistic = {
      client_received: true,
      received_at: new Date().toISOString(),
      received_by: "Company portal",
    };
    setBusy(true);
    setError("");
    setSelectedLead((current) =>
      current?.id === appointment.id ? { ...current, ...optimistic } : current,
    );
    setData((current) =>
      current
        ? {
            ...current,
            appointments: current.appointments.map((item) =>
              item.id === appointment.id ? { ...item, ...optimistic } : item,
            ),
          }
        : current,
    );
    const { data: updated, error: rpcErr } = await supabase.rpc(
      "company_confirm_lead_received",
      {
        p_company_id: companyId,
        p_access_token: token,
        p_appointment_id: appointment.id,
      },
    );
    if (rpcErr) {
      setData(previousData);
      setSelectedLead(previousSelected);
      setError(rpcError(rpcErr));
    } else {
      const updatedAppointment = updated as Partial<Appointment> | null;
      if (updatedAppointment) {
        setSelectedLead((current) =>
          current?.id === appointment.id
            ? { ...current, ...updatedAppointment }
            : current,
        );
        setData((current) =>
          current
            ? {
                ...current,
                appointments: current.appointments.map((item) =>
                  item.id === appointment.id
                    ? { ...item, ...updatedAppointment }
                    : item,
                ),
              }
            : current,
        );
      }
      setCompanyLeadRefreshKey((value) => value + 1);
      notify("Lead receipt confirmed.");
    }
    setBusy(false);
  }

  async function uploadCompanyLogo(file: File) {
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      setError("Upload a PNG, JPG, or WebP logo.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError("The company logo must be 5 MB or smaller.");
      return;
    }
    const body = new FormData();
    body.append("company_id", companyId);
    body.append("access_token", token);
    body.append("file", file);
    setBusy(true);
    setError("");
    const { data: result, error: uploadError } =
      await supabase.functions.invoke("upload-company-logo", { body });
    if (uploadError || result?.error)
      setError(result?.error || rpcError(uploadError));
    else {
      notify("Company logo uploaded.");
      await load();
    }
    setBusy(false);
  }

  async function rotateCompanyToken() {
    if (
      !window.confirm(
        "Regenerate the company management link? The current private link will stop working immediately.",
      )
    )
      return;
    setBusy(true);
    setError("");
    const { data: newToken, error: rpcErr } = await supabase.rpc(
      "regenerate_company_access_token",
      { p_company_id: companyId, p_access_token: token },
    );
    if (rpcErr) setError(rpcError(rpcErr));
    else if (newToken) {
      const url = `${window.location.origin}/company/${companyId}/manage/${String(newToken)}`;
      window.history.replaceState({}, "", url);
      window.location.reload();
    }
    setBusy(false);
  }

  function updateFormField(
    sectionIndex: number,
    fieldIndex: number,
    patch: Partial<PortalFormField>,
  ) {
    setFormSchema((prev) =>
      prev.map((section, si) =>
        si !== sectionIndex
          ? section
          : {
              ...section,
              fields: section.fields.map((field, fi) =>
                fi !== fieldIndex ? field : { ...field, ...patch },
              ),
            },
      ),
    );
  }

  function addFormField(sectionIndex: number) {
    const id = crypto.randomUUID().slice(0, 8);
    setFormSchema((prev) =>
      prev.map((section, index) =>
        index !== sectionIndex
          ? section
          : {
              ...section,
              fields: [
                ...section.fields,
                {
                  key: `custom_${id}`,
                  label: "New Question",
                  type: "text",
                  required: false,
                },
              ],
            },
      ),
    );
  }

  function removeFormField(sectionIndex: number, fieldIndex: number) {
    setFormSchema((prev) =>
      prev.map((section, si) =>
        si !== sectionIndex
          ? section
          : {
              ...section,
              fields: section.fields.filter((_, fi) => fi !== fieldIndex),
            },
      ),
    );
  }

  const scheduleRules = useMemo(() => {
    const map = new Map<number, ScheduleRule>();
    (data?.schedule_rules || [])
      .filter((rule) => (rule.location_id || "") === scheduleLocation)
      .forEach((rule) => map.set(rule.day_of_week, rule));
    return map;
  }, [data, scheduleLocation]);

  if (loading && !data)
    return (
      <PageState
        icon={<Loader2 className="animate-spin" />}
        title="Loading company portal..."
      />
    );
  if (!data || !settingsDraft)
    return (
      <PageState
        icon={<AlertTriangle />}
        title="Company portal unavailable"
        detail={error || "This secure link may be invalid or disabled."}
      />
    );

  const agentLink = `${window.location.origin}/book/${settingsDraft.public_slug}`;
  const companyLink = `${window.location.origin}/company/${settingsDraft.public_slug}/manage/${token}`;

  return (
    <div className="readyops-company-portal body-text min-h-screen w-full min-w-0 overflow-x-clip bg-slate-50 text-slate-900">
      <header className="readyops-company-header sticky top-0 z-30 border-b bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1500px] items-center justify-between gap-2 px-3 py-3 sm:gap-4 sm:px-6 sm:py-4">
          <div className="flex min-w-0 items-center gap-2 sm:gap-5">
            <img
              src={READYOPS_LOGO_DATA_URI}
              alt="ReadyOps"
              className="h-8 w-auto shrink-0 sm:h-10"
            />
            <div className="min-w-0">
              <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
                Company Management
              </p>
              {editingCompanyName ? (
                <form
                  className="flex min-w-0 items-center gap-1.5"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void saveCompanyName();
                  }}
                >
                  <input
                    autoFocus
                    aria-label="Company name"
                    value={companyNameDraft}
                    maxLength={120}
                    onChange={(event) =>
                      setCompanyNameDraft(event.target.value)
                    }
                    className="min-w-0 max-w-[320px] rounded-lg border border-blue-300 bg-white px-2.5 py-1 text-base font-black text-slate-950 outline-none ring-blue-100 focus:ring-4"
                  />
                  <button
                    type="submit"
                    disabled={busy || !companyNameDraft.trim()}
                    aria-label="Save company name"
                    className="rounded-lg bg-blue-600 p-1.5 text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {busy ? (
                      <Loader2 size={15} className="animate-spin" />
                    ) : (
                      <Save size={15} />
                    )}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    aria-label="Cancel company name edit"
                    onClick={() => {
                      setEditingCompanyName(false);
                      setCompanyNameDraft("");
                      setError("");
                    }}
                    className="rounded-lg border border-slate-200 bg-white p-1.5 text-slate-500 hover:bg-slate-50 disabled:opacity-50"
                  >
                    <X size={15} />
                  </button>
                </form>
              ) : (
                <div className="flex min-w-0 items-center gap-1.5">
                  <h1 className="truncate text-lg font-black text-slate-950">
                    {data.company.name}
                  </h1>
                  <button
                    type="button"
                    aria-label="Edit company name"
                    onClick={() => {
                      setCompanyNameDraft(data.company.name);
                      setEditingCompanyName(true);
                      setError("");
                    }}
                    className="shrink-0 rounded-md p-1 text-slate-400 transition hover:bg-blue-50 hover:text-blue-600"
                  >
                    <Pencil size={14} />
                  </button>
                </div>
              )}
            </div>
            <CompanyLogo
              company={dashboard?.company || data.company}
              busy={busy}
              onUpload={uploadCompanyLogo}
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700 sm:inline">
              Secure Link
            </span>
            <button
              onClick={() => void load()}
              className="rounded-lg border bg-white p-2 text-slate-700"
            >
              <RefreshCw size={16} />
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full min-w-0 max-w-[1500px] px-3 pb-24 pt-4 sm:px-6 sm:py-5">
        {error && (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}
        {success && (
          <div className="mb-4 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">
            <CheckCircle2 size={16} /> {success}
          </div>
        )}

        <section className="hidden">
          <LinkCard
            title="Agent Booking Link"
            value={agentLink}
            onCopy={() => void copyText(agentLink)}
            onOpen={() =>
              window.open(agentLink, "_blank", "noopener,noreferrer")
            }
          />
          <LinkCard
            title="Company Admin Link"
            value={companyLink}
            onCopy={() => void copyText(companyLink)}
            onOpen={() =>
              window.open(companyLink, "_blank", "noopener,noreferrer")
            }
            privateLink
          />
        </section>

        <nav className="readyops-company-primary-nav mb-5 hidden gap-4 overflow-x-auto rounded-xl border border-[#17314d] bg-[#06152b] p-2 shadow-sm sm:flex">
          {(
            [
              ["overview", "Dashboard", CalendarDays],
              ["leads", "Leads", FileSpreadsheet],
              ["setup", "Company Setup", ShieldCheck],
              ["reports", "Reports", BarChart3],
            ] as [Tab, string, typeof CalendarDays][]
          ).map(([key, label, Icon]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`inline-flex shrink-0 items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-bold ${tab === key ? "bg-blue-600 text-white shadow-sm" : "text-white hover:bg-white/10"}`}
            >
              <Icon size={14} />
              {label}
            </button>
          ))}
        </nav>

        {tab === "setup" && (
          <nav className="readyops-company-subnav mb-5 flex gap-1 overflow-x-auto rounded-xl border border-[#17314d] bg-[#06152b] p-2 shadow-sm">
            {(
              [
                ["locations", "Locations", MapPin],
                ["schedule", "Schedule", CalendarDays],
                ["requirements", "Requirements", ShieldCheck],
                ["forms", "Forms", Clipboard],
                ["reps", "Representatives", Users],
              ] as [SetupTab, string, typeof CalendarDays][]
            ).map(([key, label, Icon]) => (
              <button key={key} onClick={() => setSetupTab(key)} className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-bold transition ${setupTab === key ? "border-blue-500 bg-blue-600 text-white shadow-sm" : "border-transparent text-white hover:border-white/20 hover:bg-white/10"}`}>
                <Icon size={14} />{label}
              </button>
            ))}
          </nav>
        )}

        {tab === "overview" && (
          <CompanyAppointmentsDashboard
            data={data}
            dashboard={dashboard}
            selectedDay={selectedDay}
            setSelectedDay={setSelectedDay}
            busy={busy}
            openLead={setSelectedLead}
            assignRep={assignRep}
            updateAppointmentStatus={updateAppointmentStatus}
            updateLeadOutcome={updateLeadOutcome}
            confirmLeadReceipt={confirmLeadReceipt}
            ownerAccess={ownerAccess}
            updateLeadPackage={updateLeadPackage}
            createNextLeadPackage={createNextLeadPackage}
            createLeadPackage={createLeadPackage}
            openLeads={(filter) => {
              setCompanyLeadFilter(filter);
              setCompanyLeadLocationId("");
              setTab("leads");
            }}
          />
        )}

        {tab === "leads" && (
          <CompanyLeadsSpreadsheet
            companyId={companyId}
            token={token}
            filter={companyLeadFilter}
            setFilter={setCompanyLeadFilter}
            locations={data.locations}
            locationId={companyLeadLocationId}
            setLocationId={setCompanyLeadLocationId}
            openLead={setSelectedLead}
            busy={busy}
            representatives={data.representatives}
            assignRep={assignRep}
            updateLeadOutcome={updateLeadOutcome}
            activePackage={dashboard?.active_package || null}
            refreshKey={companyLeadRefreshKey}
          />
        )}

        {tab === "setup" && setupTab === "locations" && (
          <CompanyLocationsManager
            companyId={companyId}
            token={token}
            locations={data.locations}
            reload={load}
            onOpenSchedule={(locationId) => {
              setScheduleLocation(locationId);
              setSetupTab("schedule");
            }}
            onOpenLeads={(locationId) => {
              setCompanyLeadLocationId(locationId);
              setCompanyLeadFilter("all");
              setTab("leads");
            }}
          />
        )}

        {tab === "setup" && setupTab === "requirements" && (
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <h2 className="font-bold">Portal & Qualification Settings</h2>
                <p className="text-sm text-slate-500">
                  Changes are reflected on the agent link.
                </p>
              </div>
              <button
                disabled={busy}
                onClick={() => void saveRequirements()}
                className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white"
              >
                <Save size={15} /> Save
              </button>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                label="Public URL Slug"
                value={settingsDraft.public_slug}
                onChange={(value) =>
                  setSettingsDraft({ ...settingsDraft, public_slug: value })
                }
              />
              <TextField
                label="Timezone"
                value={settingsDraft.timezone}
                onChange={(value) =>
                  setSettingsDraft({ ...settingsDraft, timezone: value })
                }
              />
              <Toggle
                label="Agent Portal Enabled"
                checked={settingsDraft.portal_enabled}
                onChange={(value) =>
                  setSettingsDraft({ ...settingsDraft, portal_enabled: value })
                }
              />
              <Toggle
                label="Allow Agent Booking"
                checked={settingsDraft.allow_public_booking}
                onChange={(value) =>
                  setSettingsDraft({
                    ...settingsDraft,
                    allow_public_booking: value,
                  })
                }
              />
              <div className="sm:col-span-2">
                <TextArea
                  label="Quick Requirements"
                  value={settingsDraft.requirements_short}
                  onChange={(value) =>
                    setSettingsDraft({
                      ...settingsDraft,
                      requirements_short: value,
                    })
                  }
                />
              </div>
              <div className="sm:col-span-2">
                <TextArea
                  label="Detailed Requirements"
                  value={settingsDraft.requirements_detail}
                  onChange={(value) =>
                    setSettingsDraft({
                      ...settingsDraft,
                      requirements_detail: value,
                    })
                  }
                />
              </div>
              <NumberField
                label="Minimum Roof Age"
                value={numberOrBlank(
                  settingsDraft.qualification_rules.minimum_roof_age,
                )}
                onChange={(value) =>
                  setSettingsDraft({
                    ...settingsDraft,
                    qualification_rules: {
                      ...settingsDraft.qualification_rules,
                      minimum_roof_age: value === "" ? null : Number(value),
                    },
                  })
                }
              />
              <NumberField
                label="Minimum SQ FT"
                value={numberOrBlank(
                  settingsDraft.qualification_rules.minimum_sq_ft,
                )}
                onChange={(value) =>
                  setSettingsDraft({
                    ...settingsDraft,
                    qualification_rules: {
                      ...settingsDraft.qualification_rules,
                      minimum_sq_ft: value === "" ? null : Number(value),
                    },
                  })
                }
              />
              <Toggle
                label="Contract Must Be No"
                checked={Boolean(
                  settingsDraft.qualification_rules.contract_must_be_no,
                )}
                onChange={(value) =>
                  setSettingsDraft({
                    ...settingsDraft,
                    qualification_rules: {
                      ...settingsDraft.qualification_rules,
                      contract_must_be_no: value,
                    },
                  })
                }
              />
              <Toggle
                label="Block Disqualified Leads"
                checked={Boolean(
                  settingsDraft.qualification_rules.block_disqualified,
                )}
                onChange={(value) =>
                  setSettingsDraft({
                    ...settingsDraft,
                    qualification_rules: {
                      ...settingsDraft.qualification_rules,
                      block_disqualified: value,
                    },
                  })
                }
              />
              <div className="flex items-end">
                <button
                  disabled={busy}
                  onClick={() => void rotateCompanyToken()}
                  className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-bold text-red-700"
                >
                  Regenerate Private Company Link
                </button>
              </div>
            </div>
          </section>
        )}

        {tab === "setup" && setupTab === "schedule" && (
          <section className="space-y-5">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h2 className="font-bold">Weekly Schedule</h2>
                  <p className="text-sm text-slate-500">
                    Edit availability by company or service area.
                  </p>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-500">
                    Schedule Scope
                  </label>
                  <select
                    value={scheduleLocation}
                    onChange={(e) => setScheduleLocation(e.target.value)}
                    className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
                  >
                    <option value="">Company-wide</option>
                    {data.locations.map((loc) => (
                      <option key={loc.id} value={loc.id}>
                        {loc.location_label}
                        {loc.state ? `, ${loc.state}` : ""}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="mb-2 hidden rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] font-black uppercase tracking-wide text-slate-500 md:grid md:grid-cols-[110px_90px_repeat(5,1fr)_70px] md:items-center md:gap-2">
                <span>Day</span>
                <span>Open</span>
                <span>Start Time</span>
                <span>End Time</span>
                <span>Appointment Length (min)</span>
                <span>Appointments per Time Slot</span>
                <span>Max Appointments per Day</span>
                <span className="text-center">Save</span>
              </div>
              <div className="space-y-2">
                {DAY_NAMES.map((name, day) => (
                  <ScheduleRuleRow
                    key={name}
                    day={day}
                    name={name}
                    rule={scheduleRules.get(day)}
                    busy={busy}
                    onSave={(draft) => void saveRule(day, draft)}
                  />
                ))}
              </div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="font-bold">Closed Dates / Special Hours</h2>
              <div className="mt-4 grid gap-3 md:grid-cols-6">
                <input
                  type="date"
                  value={newException.exception_date}
                  onChange={(e) =>
                    setNewException({
                      ...newException,
                      exception_date: e.target.value,
                    })
                  }
                  className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
                />
                <select
                  value={newException.location_id}
                  onChange={(e) =>
                    setNewException({
                      ...newException,
                      location_id: e.target.value,
                    })
                  }
                  className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
                >
                  <option value="">Company-wide</option>
                  {data.locations.map((loc) => (
                    <option key={loc.id} value={loc.id}>
                      {loc.location_label}
                    </option>
                  ))}
                </select>
                <label className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm">
                  <input
                    type="checkbox"
                    checked={newException.is_closed}
                    onChange={(e) =>
                      setNewException({
                        ...newException,
                        is_closed: e.target.checked,
                      })
                    }
                  />{" "}
                  Closed
                </label>
                {!newException.is_closed && (
                  <>
                    <input
                      type="time"
                      value={newException.start_time}
                      onChange={(e) =>
                        setNewException({
                          ...newException,
                          start_time: e.target.value,
                        })
                      }
                      className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
                    />
                    <input
                      type="time"
                      value={newException.end_time}
                      onChange={(e) =>
                        setNewException({
                          ...newException,
                          end_time: e.target.value,
                        })
                      }
                      className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
                    />
                  </>
                )}
                <button
                  onClick={() => void createException()}
                  disabled={busy}
                  className="rounded-xl bg-blue-600 px-3 py-2 text-sm font-bold text-white"
                >
                  Add
                </button>
              </div>
              <div className="mt-4 space-y-2">
                {data.exceptions.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2 text-sm"
                  >
                    <span>
                      <strong>{formatDateLong(item.exception_date)}</strong> —{" "}
                      {item.is_closed
                        ? "Closed"
                        : `${formatTime(item.start_time || "")}–${formatTime(item.end_time || "")}`}{" "}
                      {item.note ? `• ${item.note}` : ""}
                    </span>
                    <button
                      onClick={() => void deleteException(item.id)}
                      className="text-red-600"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {tab === "setup" && setupTab === "forms" && (
          <section className="space-y-5">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-5 flex items-center justify-between">
                <div>
                  <h2 className="font-bold">Appointment Form</h2>
                  <p className="text-sm text-slate-500">
                    Ready Ops internal form is always completed for QC.
                    Optionally add the client external form for approved leads.
                  </p>
                </div>
                <button
                  onClick={() => void saveForms()}
                  disabled={busy}
                  className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white"
                >
                  <Save size={15} /> Save Form
                </button>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-600">
                    Form Mode
                  </label>
                  <select
                    value={settingsDraft.form_mode}
                    onChange={(e) =>
                      setSettingsDraft({
                        ...settingsDraft,
                        form_mode: e.target
                          .value as SettingsRecord["form_mode"],
                      })
                    }
                    className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm"
                  >
                    <option value="internal">Internal Ready Ops Form</option>
                    <option value="internal_external">
                      Internal + External Client Form
                    </option>
                  </select>
                </div>
                {settingsDraft.form_mode !== "internal" && (
                  <>
                    <TextField
                      label="External Provider"
                      value={settingsDraft.external_form_provider || ""}
                      onChange={(value) =>
                        setSettingsDraft({
                          ...settingsDraft,
                          external_form_provider: value,
                        })
                      }
                    />
                    <div className="sm:col-span-2">
                      <TextField
                        label="External Form URL"
                        value={settingsDraft.external_form_url || ""}
                        onChange={(value) =>
                          setSettingsDraft({
                            ...settingsDraft,
                            external_form_url: value,
                          })
                        }
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <TextArea
                        label="Prefill Mapping JSON (internal field → external query parameter)"
                        value={prefillJson}
                        onChange={setPrefillJson}
                      />
                    </div>
                  </>
                )}
              </div>
            </div>
            {settingsDraft.form_mode !== "external" && (
              <div className="space-y-4">
                {formSchema.map((section, sectionIndex) => (
                  <div
                    key={section.id}
                    className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
                  >
                    <div className="mb-3 flex items-center justify-between">
                      <input
                        value={section.title}
                        onChange={(e) =>
                          setFormSchema((prev) =>
                            prev.map((item, idx) =>
                              idx === sectionIndex
                                ? { ...item, title: e.target.value }
                                : item,
                            ),
                          )
                        }
                        className="text-base font-bold outline-none"
                      />
                      <button
                        onClick={() => addFormField(sectionIndex)}
                        className="inline-flex items-center gap-1 rounded-lg bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700"
                      >
                        <Plus size={13} /> Add Question
                      </button>
                    </div>
                    <div className="space-y-2">
                      {section.fields.map((field, fieldIndex) => (
                        <FormFieldEditor
                          key={`${section.id}-${field.key}`}
                          field={field}
                          onChange={(patch) =>
                            updateFormField(sectionIndex, fieldIndex, patch)
                          }
                          onRemove={() =>
                            removeFormField(sectionIndex, fieldIndex)
                          }
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {tab === "setup" && setupTab === "reps" && (
          <section className="space-y-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="font-bold">Add Representative</h2>
              <div className="mt-4 grid gap-3 md:grid-cols-5">
                <input
                  placeholder="Full name"
                  value={newRep.name}
                  onChange={(e) =>
                    setNewRep({ ...newRep, name: e.target.value })
                  }
                  className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
                />
                <input
                  placeholder="Phone"
                  value={newRep.phone}
                  onChange={(e) =>
                    setNewRep({ ...newRep, phone: e.target.value })
                  }
                  className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
                />
                <input
                  placeholder="Email"
                  value={newRep.email}
                  onChange={(e) =>
                    setNewRep({ ...newRep, email: e.target.value })
                  }
                  className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
                />
                <select
                  value={newRep.location_id}
                  onChange={(e) =>
                    setNewRep({ ...newRep, location_id: e.target.value })
                  }
                  className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
                >
                  <option value="">All areas</option>
                  {data.locations.map((loc) => (
                    <option key={loc.id} value={loc.id}>
                      {loc.location_label}
                    </option>
                  ))}
                </select>
                <button
                  disabled={busy}
                  onClick={() => void createRep()}
                  className="rounded-xl bg-blue-600 px-3 py-2 text-sm font-bold text-white"
                >
                  Create Rep
                </button>
              </div>
            </div>
            <div className="grid gap-3 lg:grid-cols-2">
              {data.representatives.map((rep) => {
                const repLink = `${window.location.origin}/rep/${rep.access_token}`;
                return (
                  <article
                    key={rep.id}
                    className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="font-bold">{rep.name}</h3>
                        <p className="text-xs text-slate-500">
                          {rep.phone || "No phone"} • {rep.email || "No email"}
                        </p>
                      </div>
                      <span
                        className={`rounded-full px-2 py-1 text-[10px] font-bold ${rep.active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}
                      >
                        {rep.active ? "ACTIVE" : "DISABLED"}
                      </span>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        onClick={() => void copyText(repLink)}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold"
                      >
                        <Clipboard size={13} /> Copy Rep Link
                      </button>
                      <button
                        onClick={() =>
                          window.open(repLink, "_blank", "noopener,noreferrer")
                        }
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold"
                      >
                        <ExternalLink size={13} /> Open
                      </button>
                      <button
                        onClick={() =>
                          void updateRep(rep, { active: !rep.active })
                        }
                        className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold"
                      >
                        {rep.active ? "Disable" : "Enable"}
                      </button>
                      <button
                        onClick={() =>
                          void updateRep(rep, { regenerate_token: true })
                        }
                        className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700"
                      >
                        New Link
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        )}

        {tab === "reports" && (
          <CompanyReports data={data} dashboard={dashboard} />
        )}

        {tab === "reports" && (
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="font-bold">Audit History</h2>
            <div className="mt-4 space-y-2">
              {data.audit_logs.length === 0 ? (
                <Empty text="No recorded changes yet." />
              ) : (
                data.audit_logs.map((item) => (
                  <div
                    key={item.id}
                    className="rounded-xl bg-slate-50 px-3 py-2"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-bold text-slate-800">
                        {item.action.replace(/_/g, " ")}
                      </p>
                      <span className="text-xs text-slate-400">
                        {new Date(item.created_at).toLocaleString()}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      {item.actor_name || item.actor_type} • {item.entity_type}
                    </p>
                  </div>
                ))
              )}
            </div>
          </section>
        )}
      </main>

      <nav
        aria-label="Mobile company navigation"
        className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t border-slate-200 bg-white/95 px-1 pb-[max(0.4rem,env(safe-area-inset-bottom))] pt-1 shadow-[0_-8px_28px_rgba(15,23,42,0.12)] backdrop-blur sm:hidden"
      >
        {(
          [
            ["overview", "Overview", CalendarDays],
            ["leads", "Leads", FileSpreadsheet],
            ["setup", "Setup", ShieldCheck],
            ["reports", "Reports", BarChart3],
          ] as [Tab, string, typeof CalendarDays][]
        ).map(([key, label, Icon]) => (
          <button
            key={key}
            type="button"
            aria-current={tab === key ? "page" : undefined}
            onClick={() => setTab(key)}
            className={`flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl px-1 text-[10px] font-black ${tab === key ? "bg-blue-50 text-blue-700" : "text-slate-500"}`}
          >
            <Icon size={19} />
            {label}
          </button>
        ))}
      </nav>

      {selectedLead && (
        <LeadModal
          appointment={selectedLead}
          companyId={companyId}
          token={token}
          busy={busy}
          representatives={data.representatives}
          assignRep={assignRep}
          updateAppointmentStatus={updateAppointmentStatus}
          updateLeadOutcome={updateLeadOutcome}
          confirmLeadReceipt={confirmLeadReceipt}
          onClose={() => setSelectedLead(null)}
        />
      )}
    </div>
  );
}

type LocationDraft = {
  location_label: string;
  office_name: string;
  address: string;
  city: string;
  state: string;
  zip_code: string;
  service_cities: string;
  service_zips: string;
  phone: string;
  email: string;
  manager_name: string;
  timezone: string;
  notes: string;
  active: boolean;
};

const EMPTY_LOCATION: LocationDraft = {
  location_label: "",
  office_name: "",
  address: "",
  city: "",
  state: "",
  zip_code: "",
  service_cities: "",
  service_zips: "",
  phone: "",
  email: "",
  manager_name: "",
  timezone: "America/Chicago",
  notes: "",
  active: true,
};

function CompanyLocationsManager({
  companyId,
  token,
  locations,
  reload,
  onOpenSchedule,
  onOpenLeads,
}: {
  companyId: string;
  token: string;
  locations: Location[];
  reload: () => Promise<void>;
  onOpenSchedule: (locationId: string) => void;
  onOpenLeads: (locationId: string) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<LocationDraft>(EMPTY_LOCATION);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const startCreate = () => {
    setEditingId("new");
    setDraft(EMPTY_LOCATION);
    setError("");
  };
  const startEdit = (location: Location) => {
    setEditingId(location.id);
    setDraft({
      location_label: location.location_label || "",
      office_name: location.office_name || "",
      address: location.address || "",
      city: location.city || "",
      state: location.state || "",
      zip_code: location.zip_code || "",
      service_cities: (location.service_cities || []).join(", "),
      service_zips: (location.service_zips || []).join(", "),
      phone: location.phone || "",
      email: location.email || "",
      manager_name: location.manager_name || "",
      timezone: location.timezone || "America/Chicago",
      notes: location.notes || "",
      active: location.active !== false,
    });
    setError("");
  };
  const payload = () => ({
    ...draft,
    service_cities: splitList(draft.service_cities),
    service_zips: splitList(draft.service_zips),
  });
  const save = async () => {
    if (!draft.location_label.trim()) {
      setError("Location or service-area name is required.");
      return;
    }
    setBusy(true);
    setError("");
    const rpcName =
      editingId === "new"
        ? "create_company_portal_location"
        : "update_company_portal_location";
    const rpcArgs =
      editingId === "new"
        ? {
            p_company_id: companyId,
            p_access_token: token,
            p_location: payload(),
          }
        : {
            p_company_id: companyId,
            p_access_token: token,
            p_location_id: editingId,
            p_patch: payload(),
          };
    const { error: saveError } = await supabase.rpc(rpcName, rpcArgs);
    if (saveError) setError(rpcError(saveError));
    else {
      setSuccess(
        editingId === "new" ? "Location created." : "Location updated.",
      );
      setEditingId(null);
      setDraft(EMPTY_LOCATION);
      await reload();
      window.setTimeout(() => setSuccess(""), 2500);
    }
    setBusy(false);
  };
  const set = <K extends keyof LocationDraft>(
    key: K,
    value: LocationDraft[K],
  ) => setDraft((current) => ({ ...current, [key]: value }));

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-black">Office & Service Locations</h2>
          <p className="text-xs text-slate-500">
            Add every office or market your company works in, then configure its
            schedule and view only that location&apos;s leads.
          </p>
        </div>
        <button
          onClick={startCreate}
          className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white"
        >
          <Plus size={15} /> Add Location
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-semibold text-red-700">
          {error}
        </div>
      )}
      {success && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs font-semibold text-emerald-700">
          {success}
        </div>
      )}

      {editingId && (
        <section className="rounded-2xl border border-blue-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h3 className="font-black">
                {editingId === "new" ? "Add Location" : "Edit Location"}
              </h3>
              <p className="text-xs text-slate-500">
                Requirements/notes are specific to this office or service area.
              </p>
            </div>
            <button
              onClick={() => setEditingId(null)}
              className="rounded-lg border px-3 py-2 text-xs font-bold"
            >
              Cancel
            </button>
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <TextField
              label="Location / Service Area Name *"
              value={draft.location_label}
              onChange={(value) => set("location_label", value)}
            />
            <TextField
              label="Office Name"
              value={draft.office_name}
              onChange={(value) => set("office_name", value)}
            />
            <TextField
              label="Office Phone"
              value={draft.phone}
              onChange={(value) => set("phone", value)}
            />
            <TextField
              label="Office Email"
              value={draft.email}
              onChange={(value) => set("email", value)}
            />
            <div className="md:col-span-2">
              <TextField
                label="Office Address"
                value={draft.address}
                onChange={(value) => set("address", value)}
              />
            </div>
            <TextField
              label="City"
              value={draft.city}
              onChange={(value) => set("city", value)}
            />
            <TextField
              label="State"
              value={draft.state}
              onChange={(value) => set("state", value)}
            />
            <TextField
              label="ZIP"
              value={draft.zip_code}
              onChange={(value) => set("zip_code", value)}
            />
            <TextField
              label="Location Manager"
              value={draft.manager_name}
              onChange={(value) => set("manager_name", value)}
            />
            <TextField
              label="Timezone"
              value={draft.timezone}
              onChange={(value) => set("timezone", value)}
            />
            <TextField
              label="Service Cities (comma separated)"
              value={draft.service_cities}
              onChange={(value) => set("service_cities", value)}
            />
            <TextField
              label="Service ZIP Codes (comma separated)"
              value={draft.service_zips}
              onChange={(value) => set("service_zips", value)}
            />
            <div className="md:col-span-2 xl:col-span-3">
              <TextArea
                label="Location Requirements / Notes"
                value={draft.notes}
                onChange={(value) => set("notes", value)}
              />
            </div>
            <Toggle
              label="Location Active"
              checked={draft.active}
              onChange={(value) => set("active", value)}
            />
          </div>
          <div className="mt-4 flex justify-end">
            <button
              disabled={busy}
              onClick={() => void save()}
              className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50"
            >
              {busy ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <Save size={15} />
              )}
              Save Location
            </button>
          </div>
        </section>
      )}

      {!locations.length ? (
        <Empty text="No locations yet. Add the first office or service area." />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
          {locations.map((location) => (
            <article
              key={location.id}
              className={`rounded-2xl border bg-white p-4 shadow-sm ${location.active === false ? "opacity-60" : ""}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-blue-50 text-blue-700">
                    <MapPin size={18} />
                  </span>
                  <div>
                    <h3 className="font-black">{location.location_label}</h3>
                    <p className="text-xs text-slate-500">
                      {location.office_name || "Service area"}
                    </p>
                  </div>
                </div>
                <span
                  className={`rounded-full px-2 py-1 text-[10px] font-bold ${location.active === false ? "bg-slate-100 text-slate-500" : "bg-emerald-50 text-emerald-700"}`}
                >
                  {location.active === false ? "Inactive" : "Active"}
                </span>
              </div>
              <div className="mt-3 space-y-1 text-xs text-slate-600">
                <p>
                  {[
                    location.address,
                    location.city,
                    location.state,
                    location.zip_code,
                  ]
                    .filter(Boolean)
                    .join(", ") || "No office address entered"}
                </p>
                <p>
                  <strong>Service:</strong>{" "}
                  {(location.service_cities || []).join(", ") ||
                    (location.service_zips || []).join(", ") ||
                    "Not specified"}
                </p>
                <p>
                  <strong>Manager:</strong> {location.manager_name || "—"}
                </p>
                {location.notes && (
                  <p className="line-clamp-2" title={location.notes}>
                    <strong>Requirements:</strong> {location.notes}
                  </p>
                )}
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  onClick={() => startEdit(location)}
                  className="rounded-lg border px-3 py-2 text-xs font-bold"
                >
                  Edit
                </button>
                <button
                  onClick={() => onOpenSchedule(location.id)}
                  className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700"
                >
                  Schedule
                </button>
                <button
                  onClick={() => onOpenLeads(location.id)}
                  className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-xs font-bold text-violet-700"
                >
                  View Leads
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function CompanyLeadsSpreadsheet({
  companyId,
  token,
  filter,
  setFilter,
  locations,
  locationId,
  setLocationId,
  openLead,
  busy,
  representatives,
  assignRep,
  updateLeadOutcome,
  activePackage,
  refreshKey,
}: {
  companyId: string;
  token: string;
  filter: string;
  setFilter: (value: string) => void;
  locations: Location[];
  locationId: string;
  setLocationId: (value: string) => void;
  openLead: (appointment: Appointment) => void;
  busy: boolean;
  representatives: Representative[];
  assignRep: (appointmentId: string, repId: string) => Promise<void>;
  updateLeadOutcome: (
    appointment: Appointment,
    clientStatus: string,
  ) => Promise<void>;
  activePackage: CompanyDashboardSummary["active_package"];
  refreshKey: number;
}) {
  const [data, setData] = useState<CompanyLeadSheetData>({
    rows: [],
    total: 0,
    limit: 100,
    offset: 0,
    summary: {
      delivered: 0,
      good: 0,
      bad: 0,
      no_show: 0,
      rescheduled: 0,
      signed_contract: 0,
      pending: 0,
    },
  });
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [representativeId, setRepresentativeId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    void refreshKey;
    setLoading(true);
    setError("");
    const { data: result, error: loadError } = await supabase.rpc(
      "get_company_location_lead_spreadsheet",
      {
        p_company_id: companyId,
        p_access_token: token,
        p_filter: filter,
        p_location_id: locationId || null,
        p_representative_id: representativeId || null,
        p_start_date: startDate || null,
        p_end_date: endDate || null,
        p_search: search || null,
        p_limit: 100,
        p_offset: offset,
      },
    );
    if (loadError) setError(rpcError(loadError));
    else setData(result as CompanyLeadSheetData);
    setLoading(false);
  }, [
    companyId,
    endDate,
    filter,
    locationId,
    offset,
    refreshKey,
    representativeId,
    search,
    startDate,
    token,
  ]);
  useEffect(() => {
    void load();
  }, [load]);
  const chooseFilter = (next: string) => {
    setOffset(0);
    setFilter(next);
  };
  const filterCards = [
    {
      key: "all",
      label: "Delivered",
      count: data.summary.delivered,
      tone: "readyops-stat-delivered border-[#7DD3FC] bg-[#BAE6FD] text-[#075985]",
      Icon: Clipboard,
    },
    {
      key: "good",
      label: "Inspected",
      count: data.summary.good,
      tone: "readyops-stat-good border-[#6EE7B7] bg-[#A7F3D0] text-[#047857]",
      Icon: ThumbsUp,
    },
    {
      key: "bad",
      label: "Bad",
      count: data.summary.bad,
      tone: "readyops-stat-bad border-[#FCA5A5] bg-[#FECACA] text-[#B91C1C]",
      Icon: ThumbsDown,
    },
    {
      key: "no_show",
      label: "No Show",
      count: data.summary.no_show,
      tone: "readyops-stat-no-show border-[#FBBF24] bg-[#FDE68A] text-[#92400E]",
      Icon: CalendarX2,
    },
    {
      key: "rescheduled",
      label: "Rescheduled",
      count: data.summary.rescheduled,
      tone: "readyops-stat-rescheduled border-[#FDBA74] bg-[#FED7AA] text-[#C2410C]",
      Icon: CalendarClock,
    },
    {
      key: "signed_contract",
      label: "Signed Contract",
      count: data.summary.signed_contract,
      tone: "readyops-stat-signed border-[#00512E] bg-[#006B3C] text-white",
      Icon: PenLine,
    },
    {
      key: "pending",
      label: "Pending Updates",
      count: data.summary.pending,
      tone: "readyops-stat-pending border-[#67E8F9] bg-[#A5F3FC] text-[#0E7490]",
      Icon: Clock3,
    },
  ] as const;
  const page = Math.floor(offset / 100) + 1;
  const pages = Math.max(1, Math.ceil(data.total / 100));
  return (
    <section className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3 sm:items-end">
        <div>
          <h2 className="section-title">Company Leads</h2>
          <p className="text-xs text-slate-500">
            Every QC-approved lead delivered to this company, across all dates.
          </p>
        </div>
        <div className="w-full rounded-xl border bg-white px-4 py-2 text-xs sm:w-auto">
          <strong>{activePackage?.remaining_leads ?? "—"}</strong> package leads
          remaining{" "}
          <span className="text-slate-400">(not yet delivered records)</span>
        </div>
      </div>
      <div className="grid gap-3 rounded-xl border bg-white p-3 md:grid-cols-2 xl:grid-cols-[1fr_1fr_180px_180px_auto]">
        <label className="space-y-1 text-[10px] font-black uppercase tracking-wide text-slate-500">
          <span className="flex items-center gap-1">
            <MapPin size={13} className="text-blue-600" /> Location
          </span>
          <select
            value={locationId}
            onChange={(event) => {
              setOffset(0);
              setLocationId(event.target.value);
            }}
            className="min-h-11 w-full rounded-lg border px-3 py-2 text-sm font-semibold normal-case tracking-normal text-slate-800 sm:min-h-0 sm:text-xs"
          >
            <option value="">All locations</option>
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.location_label}
                {location.active === false ? " (Inactive)" : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-[10px] font-black uppercase tracking-wide text-slate-500">
          <span className="flex items-center gap-1">
            <UserRoundCheck size={13} className="text-blue-600" /> Inspector
          </span>
          <select
            value={representativeId}
            onChange={(event) => {
              setOffset(0);
              setRepresentativeId(event.target.value);
            }}
            className="min-h-11 w-full rounded-lg border px-3 py-2 text-sm font-semibold normal-case tracking-normal text-slate-800 sm:min-h-0 sm:text-xs"
          >
            <option value="">All inspectors</option>
            {representatives.map((representative) => (
              <option key={representative.id} value={representative.id}>
                {representative.name}
                {representative.active === false ? " (Inactive)" : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-[10px] font-black uppercase tracking-wide text-slate-500">
          Start Date
          <input
            type="date"
            value={startDate}
            onChange={(event) => {
              const value = event.target.value;
              setOffset(0);
              setStartDate(value);
              if (value && endDate && endDate < value) setEndDate(value);
            }}
            className="min-h-11 w-full rounded-lg border px-3 py-2 text-sm font-semibold normal-case tracking-normal text-slate-800 sm:min-h-0 sm:text-xs"
          />
        </label>
        <label className="space-y-1 text-[10px] font-black uppercase tracking-wide text-slate-500">
          End Date
          <input
            type="date"
            min={startDate || undefined}
            value={endDate}
            onChange={(event) => {
              setOffset(0);
              setEndDate(event.target.value);
            }}
            className="min-h-11 w-full rounded-lg border px-3 py-2 text-sm font-semibold normal-case tracking-normal text-slate-800 sm:min-h-0 sm:text-xs"
          />
        </label>
        <button
          type="button"
          disabled={!locationId && !representativeId && !startDate && !endDate}
          onClick={() => {
            setOffset(0);
            setLocationId("");
            setRepresentativeId("");
            setStartDate("");
            setEndDate("");
          }}
          className="min-h-11 self-end rounded-lg border px-3 py-2 text-xs font-bold hover:border-blue-300 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-40 sm:min-h-0"
        >
          Clear Filters
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-7">
        {filterCards.map(({ key, label, count, tone, Icon }) => (
          <button
            key={key}
            onClick={() => chooseFilter(key)}
            className={`relative min-h-[112px] overflow-hidden rounded-xl border p-3 text-left transition hover:-translate-y-0.5 hover:shadow-md ${tone} ${filter === key ? "ring-2 ring-blue-500 ring-offset-1" : ""}`}
          >
            <Icon
              size={29}
              strokeWidth={1.8}
              className="absolute right-3 top-1/2 -translate-y-1/2 opacity-90"
            />
            <span className="kpi-title block max-w-[72%] uppercase tracking-wide">
              {label}
            </span>
            <strong className={`kpi-number mt-1 block ${key === "signed_contract" ? "text-white" : "text-slate-950"}`}>
              {count}
            </strong>
            <span className="mt-2 block text-[9px] font-bold">Show matching leads →</span>
          </button>
        ))}
      </div>
      <section className="rounded-2xl border bg-white shadow-sm">
        <div className="flex flex-wrap items-stretch justify-between gap-3 border-b p-3 sm:items-center">
          <form
            className="relative w-full min-w-0 sm:flex-1"
            onSubmit={(event) => {
              event.preventDefault();
              setOffset(0);
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
              placeholder="Search homeowner, phone, address, service…"
              className="h-11 w-full rounded-lg border pl-9 pr-3 text-sm sm:h-10 sm:text-xs"
            />
          </form>
          <button
            onClick={() => void load()}
            className="inline-flex min-h-11 items-center justify-center gap-1 rounded-lg border px-3 py-2.5 text-xs font-bold sm:min-h-0"
          >
            <RefreshCw size={13} /> Refresh
          </button>
          <span className="flex flex-1 items-center justify-end text-right text-xs font-bold text-slate-500 sm:flex-none">
            {data.total} matching leads • Page {page} of {pages}
          </span>
        </div>
        {error && (
          <div className="m-3 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">
            {error}
          </div>
        )}
        {loading ? (
          <div className="grid min-h-64 place-items-center">
            <Loader2 className="animate-spin text-blue-600" />
          </div>
        ) : !data.rows.length ? (
          <Empty text="No company leads match this filter." />
        ) : (
          <>
            <div className="divide-y md:hidden">
              {data.rows.map((appointment) => {
                const form = appointment.lead.form_data || {};
                const status =
                  appointment.company_action ||
                  appointment.canonical_status ||
                  appointment.client_status ||
                  appointment.status;
                const address = [
                  appointment.lead.address,
                  appointment.lead.city,
                  appointment.lead.state,
                  appointment.lead.zip_code,
                ]
                  .filter(Boolean)
                  .join(", ");
                const propertyDetails = [
                  form.roof_age && `Roof age: ${String(form.roof_age)}`,
                  form.roof_type && `Roof: ${String(form.roof_type)}`,
                  (form.insurance_name || form.insurance) &&
                    `Insurance: ${String(form.insurance_name || form.insurance)}`,
                ].filter(Boolean) as string[];
                return (
                  <article
                    key={appointment.id}
                    className="space-y-4 p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="truncate text-base font-black text-slate-950">
                          {appointment.lead.full_name}
                        </h3>
                        <p className="mt-1 text-xs font-bold text-blue-700">
                          {formatDateLong(appointment.appointment_date)} at{" "}
                          {formatTime(appointment.start_time)}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          {appointment.lead.service_needed || "Service not listed"}
                          {" • "}
                          {appointment.location_label || "Company-wide"}
                        </p>
                      </div>
                      <StatusChip status={status} />
                    </div>

                    <div className="rounded-xl bg-slate-50 p-3 text-xs text-slate-600">
                      <p className="font-semibold text-slate-800">
                        {address || "No property address entered"}
                      </p>
                      {propertyDetails.length > 0 && (
                        <p className="mt-1 text-[11px]">
                          {propertyDetails.join(" • ")}
                        </p>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <a
                        href={`tel:${appointment.lead.phone_number}`}
                        className="inline-flex min-h-11 items-center justify-center rounded-lg border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700"
                      >
                        Call homeowner
                      </a>
                      <button
                        type="button"
                        onClick={() => openLead(appointment)}
                        className="min-h-11 rounded-lg bg-blue-600 px-3 text-xs font-bold text-white"
                      >
                        Assign & update
                      </button>
                    </div>

                    <div className="hidden gap-3 sm:grid">
                      <label className="space-y-1 text-[10px] font-black uppercase tracking-wide text-slate-500">
                        Inspector
                        <select
                          aria-label={`Assign inspector for ${appointment.lead.full_name}`}
                          value={appointment.representative_id || ""}
                          disabled={busy}
                          onChange={(event) =>
                            void assignRep(appointment.id, event.target.value)
                          }
className="min-h-11 w-full rounded-lg border border-blue-300 bg-blue-100 px-3 text-sm font-bold normal-case tracking-normal text-blue-900 disabled:cursor-wait disabled:opacity-50"
                        >
                          <option value="">Unassigned</option>
                          {representatives
                            .filter(
                              (rep) =>
                                rep.active ||
                                rep.id === appointment.representative_id,
                            )
                            .map((rep) => (
                              <option key={rep.id} value={rep.id}>
                                {rep.name}
                                {rep.active ? "" : " (Inactive)"}
                              </option>
                            ))}
                        </select>
                      </label>
                      <label className="space-y-1 text-[10px] font-black uppercase tracking-wide text-slate-500">
                        Lead status
                        <select
                          aria-label={`Update ${appointment.lead.full_name} lead status`}
                          value={
                            normalizeLeadDisposition(
                              appointment.company_action ||
                                appointment.client_status ||
                                appointment.canonical_status,
                            ) || "pending"
                          }
                          disabled={busy}
                          onChange={(event) =>
                            void updateLeadOutcome(
                              appointment,
                              event.target.value,
                            )
                          }
                          className={`min-h-11 w-full rounded-lg border px-3 text-sm font-black normal-case tracking-normal disabled:cursor-wait disabled:opacity-50 ${leadStatusClasses(status)}`}
                        >
                          <option value="pending">Pending</option>
                          {COMPANY_LEAD_ACTIONS.map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>

                    {(appointment.inspector_notes || appointment.lead.notes) && (
                      <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                        {appointment.inspector_notes || appointment.lead.notes}
                      </p>
                    )}
                  </article>
                );
              })}
            </div>

            <HorizontalScrollFrame
              className="readyops-sticky-table hidden md:block"
              ariaLabel="Company leads horizontal scroll"
            >
              <table className="readyops-company-leads-table w-full min-w-[1380px] border-separate border-spacing-0 text-xs">
                <thead className="table-header sticky top-0 z-10 bg-[#071525] text-left uppercase tracking-wide text-white">
                  <tr>
                    {[
                      "Inspector Assignment",
                      "Homeowner",
                      "Appointment Date & Time",
                      "Full Address",
                      "Service",
                      "Roof Age",
                      "Roof Type",
                      "Home Type",
                      "Stories",
                      "Insurance",
                      "Carrier",
                      "Damage / Hail",
                      "Action",
                      "Lead Status",
                    ].map((label, index, labels) => (
                      <th
                        key={label}
                        className={`border-b border-[#17314d] px-2 py-3 ${index === 0 ? "sticky left-0 z-20 min-w-[126px] bg-[#071525] shadow-[4px_0_8px_-6px_rgba(15,23,42,0.9)]" : ""} ${index === labels.length - 1 ? "sticky right-0 z-20 bg-[#071525] shadow-[-4px_0_8px_-6px_rgba(15,23,42,0.9)]" : ""}`}
                      >
                        <span className="flex items-center justify-between gap-1">
                          {label}
                          <span className="text-[9px] text-blue-100/80">↕</span>
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((appointment) => {
                    const form = appointment.lead.form_data || {};
                    const status =
                      appointment.company_action ||
                      appointment.canonical_status ||
                      appointment.client_status ||
                      appointment.status;
                    const fullAddress = [
                      appointment.lead.address,
                      appointment.lead.city,
                      appointment.lead.state,
                      appointment.lead.zip_code,
                    ]
                      .filter(Boolean)
                      .join(", ");
                    return (
                      <tr
                        key={appointment.id}
                        onClick={() => openLead(appointment)}
                        className="group cursor-pointer bg-slate-50 even:bg-slate-100/80 hover:bg-blue-50"
                      >
                        <td
                          className="sticky left-0 z-[1] min-w-[126px] border-b border-r bg-inherit px-2 py-3 shadow-[4px_0_8px_-6px_rgba(15,23,42,0.28)]"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <select
                            aria-label={`Assign inspector for ${appointment.lead.full_name}`}
                            value={appointment.representative_id || ""}
                            disabled={busy}
                            onClick={(event) => event.stopPropagation()}
                            onChange={(event) =>
                              void assignRep(appointment.id, event.target.value)
                            }
                            className="w-full min-w-[112px] cursor-pointer rounded-md border border-blue-300 bg-blue-100 px-2 py-2 text-[11px] font-bold text-blue-900 disabled:cursor-wait disabled:opacity-50"
                          >
                            <option value="">Unassigned</option>
                            {representatives
                              .filter(
                                (rep) =>
                                  rep.active ||
                                  rep.id === appointment.representative_id,
                              )
                              .map((rep) => (
                                <option key={rep.id} value={rep.id}>
                                  {rep.name}
                                  {rep.active ? "" : " (Inactive)"}
                                </option>
                              ))}
                          </select>
                        </td>
                        <td className="min-w-[150px] border-b border-r border-slate-200 px-2.5 py-3">
                          <span className="flex items-center gap-1 font-black text-slate-950">
                            {appointment.lead.full_name}
                            <Pencil size={12} className="text-slate-500" />
                          </span>
                          <span className="mt-1 block text-[11px] text-slate-700">
                            {appointment.lead.phone_number}
                          </span>
                        </td>
                        <td className="min-w-[125px] border-b border-r border-slate-200 px-2.5 py-3 font-black text-blue-700">
                          <span className="block">
                            {new Date(`${appointment.appointment_date}T12:00:00`).toLocaleDateString("en-US")}
                          </span>
                          <span className="mt-1 block text-slate-900">
                            {formatTime(appointment.start_time)}
                          </span>
                        </td>
                        <td className="min-w-[175px] border-b border-r border-slate-200 px-2.5 py-3 leading-5">
                          {fullAddress || "—"}
                        </td>
                        <td className="min-w-[95px] border-b border-r border-slate-200 px-2.5 py-3">
                          {appointment.lead.service_needed || "—"}
                        </td>
                        <td className="min-w-[68px] border-b border-r border-slate-200 px-2.5 py-3">
                          {String(form.roof_age || "—")}
                        </td>
                        <td className="min-w-[72px] border-b border-r border-slate-200 px-2.5 py-3">
                          {String(form.roof_type || "—")}
                        </td>
                        <td className="min-w-[82px] border-b border-r border-slate-200 px-2.5 py-3">
                          {String(form.home_type || "—")}
                        </td>
                        <td className="min-w-[58px] border-b border-r border-slate-200 px-2.5 py-3">
                          {String(form.stories || "—")}
                        </td>
                        <td className="min-w-[64px] border-b border-r border-slate-200 px-2.5 py-3">
                          {String(form.insurance || "—")}
                        </td>
                        <td className="min-w-[75px] border-b border-r border-slate-200 px-2.5 py-3">
                          {String(form.insurance_name || "—")}
                        </td>
                        <td className="min-w-[75px] border-b border-r border-slate-200 px-2.5 py-3">
                          {String(form.visible_damage || form.hail_size || "—")}
                        </td>
                        <td className="min-w-[75px] border-b border-r border-slate-200 px-2.5 py-3">
                          <button
                            onClick={(event) => {
                              event.stopPropagation();
                              openLead(appointment);
                            }}
                            className="whitespace-nowrap rounded-lg border border-blue-300 bg-white px-2.5 py-1.5 font-bold text-blue-700 shadow-sm"
                          >
                            View Lead
                          </button>
                        </td>
                        <td className="sticky right-0 z-[1] min-w-[108px] border-b border-l bg-inherit px-2.5 py-3 shadow-[-4px_0_8px_-6px_rgba(15,23,42,0.28)]">
                          <StatusChip
                            status={status}
                            label={String(status).toLowerCase() === "pending" ? "Pending Updates" : undefined}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </HorizontalScrollFrame>
          </>
        )}
        <div className="flex justify-between gap-2 border-t p-3 sm:justify-end">
          <button
            disabled={offset === 0 || loading}
            onClick={() => setOffset((value) => Math.max(0, value - 100))}
            className="min-h-11 flex-1 rounded-lg border px-3 py-2 text-xs font-bold disabled:opacity-40 sm:min-h-0 sm:flex-none"
          >
            Previous
          </button>
          <button
            disabled={page >= pages || loading}
            onClick={() => setOffset((value) => value + 100)}
            className="min-h-11 flex-1 rounded-lg border px-3 py-2 text-xs font-bold disabled:opacity-40 sm:min-h-0 sm:flex-none"
          >
            Next
          </button>
        </div>
      </section>
    </section>
  );
}

function CompanyAppointmentsDashboard({
  data,
  dashboard,
  selectedDay,
  setSelectedDay,
  busy,
  openLead,
  assignRep,
  updateAppointmentStatus,
  updateLeadOutcome,
  confirmLeadReceipt,
  ownerAccess,
  updateLeadPackage,
  createNextLeadPackage,
  createLeadPackage,
  openLeads,
}: {
  data: CompanyPortalData;
  dashboard: CompanyDashboardSummary | null;
  selectedDay: string;
  setSelectedDay: (value: string) => void;
  busy: boolean;
  openLead: (appointment: Appointment) => void;
  assignRep: (appointmentId: string, repId: string) => Promise<void>;
  updateAppointmentStatus: (
    appointmentId: string,
    status: string,
  ) => Promise<void>;
  updateLeadOutcome: (
    appointment: Appointment,
    clientStatus: string,
    notes?: string,
  ) => Promise<void>;
  confirmLeadReceipt: (appointment: Appointment) => Promise<void>;
  ownerAccess: boolean;
  updateLeadPackage: (
    packageId: string,
    leadTarget: number,
    amountPerLead: number,
    startDate: string,
  ) => Promise<boolean>;
  createNextLeadPackage: (
    currentPackageId: string,
    leadTarget: number,
    amountPerLead: number,
    startDate: string,
  ) => Promise<boolean>;
  createLeadPackage: (
    leadTarget: number,
    amountPerLead: number,
    startDate: string,
  ) => Promise<boolean>;
  openLeads: (filter: string) => void;
}) {
  const delivered = data.appointments;
  const fallbackPerformance = performanceFromAppointments(delivered);
  const performance = dashboard?.performance || fallbackPerformance;
  const pkg = dashboard?.active_package;
  const [editingPackage, setEditingPackage] = useState(false);
  const [addingPackage, setAddingPackage] = useState(false);
  const [creatingPackage, setCreatingPackage] = useState(false);
  const [packageDraft, setPackageDraft] = useState({
    leadTarget: "",
    amountPerLead: "",
    startDate: "",
  });
  useEffect(() => {
    setEditingPackage(false);
    setAddingPackage(false);
    setCreatingPackage(false);
    setPackageDraft({
      leadTarget: pkg ? String(pkg.lead_target) : "",
      amountPerLead: pkg ? String(pkg.amount_per_lead ?? 0) : "",
      startDate: pkg?.start_date || "",
    });
  }, [pkg]);

  async function savePackageDraft() {
    const leadTarget = Number(packageDraft.leadTarget);
    const amountPerLead = Number(packageDraft.amountPerLead);
    let saved = false;
    if (creatingPackage) {
      saved = await createLeadPackage(
        leadTarget,
        amountPerLead,
        packageDraft.startDate,
      );
    } else if (pkg) {
      const saveAction = addingPackage
        ? createNextLeadPackage
        : updateLeadPackage;
      saved = await saveAction(
        pkg.id,
        leadTarget,
        amountPerLead,
        packageDraft.startDate,
      );
    }
    if (saved) {
      setEditingPackage(false);
      setAddingPackage(false);
      setCreatingPackage(false);
    }
  }
  function beginFirstPackage() {
    setEditingPackage(false);
    setAddingPackage(false);
    setCreatingPackage(true);
    setPackageDraft({
      leadTarget: "",
      amountPerLead: "0",
      startDate: localDate(new Date()),
    });
  }
  function beginNextPackage() {
    if (!pkg) return;
    setEditingPackage(false);
    setAddingPackage(true);
    setCreatingPackage(false);
    setPackageDraft({
      leadTarget: "",
      amountPerLead: String(pkg.amount_per_lead ?? 0),
      startDate: localDate(new Date()),
    });
  }
  function cancelPackageDraft() {
    setEditingPackage(false);
    setAddingPackage(false);
    setCreatingPackage(false);
    setPackageDraft({
      leadTarget: pkg ? String(pkg.lead_target) : "",
      amountPerLead: pkg ? String(pkg.amount_per_lead ?? 0) : "",
      startDate: pkg?.start_date || "",
    });
  }
  const visibleWeekStart = calendarWeekStart(
    new Date(`${selectedDay}T12:00:00`),
  );
  const visibleWeekEnd = addDays(visibleWeekStart, 6);
  const days = Array.from({ length: 7 }, (_, index) =>
    localDate(addDays(visibleWeekStart, index)),
  );
  const moveWeek = (weeks: number) =>
    setSelectedDay(localDate(addDays(visibleWeekStart, weeks * 7)));
  const selectedAppointments = delivered
    .filter((appointment) => appointment.appointment_date === selectedDay)
    .sort((a, b) => a.start_time.localeCompare(b.start_time));
  const rescheduled = performance.rescheduled;
  const pendingUpdates = performance.pending_updates;
  return (
    <section className="space-y-4">
      <div className="grid gap-3 xl:grid-cols-[1.55fr_1.35fr_250px]">
        <section className="rounded-2xl border bg-white p-3 shadow-sm">
          <h2 className="mb-3 font-black">Company Performance</h2>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            <PerformanceCard
              tone="blue"
              label="Delivered"
              value={pkg?.delivered_leads ?? performance.total_leads}
              icon={<Users size={18} />}
              onClick={() => openLeads("all")}
            />
            <PerformanceCard
              tone="purple"
              label="Remaining"
              value={pkg?.remaining_leads ?? "—"}
              icon={<CalendarDays size={18} />}
              onClick={() => openLeads("all")}
            />
            <PerformanceCard
              tone="green"
              label="Inspected"
              value={performance.good_inspected}
              icon={<UserRoundCheck size={18} />}
              onClick={() => openLeads("good")}
            />
            <PerformanceCard
              tone="yellow"
              label="No Show"
              value={performance.no_shows}
              icon={<UserX size={18} />}
              onClick={() => openLeads("no_show")}
            />
            <PerformanceCard
              tone="orange"
              label="Rescheduled"
              value={rescheduled}
              icon={<RefreshCw size={18} />}
              onClick={() => openLeads("rescheduled")}
            />
            <PerformanceCard
              tone="signed"
              label="Signed Contract"
              value={performance.signed_contracts}
              icon={<Clipboard size={18} />}
              onClick={() => openLeads("signed_contract")}
            />
            <PerformanceCard
              tone="cyan"
              label="Pending Updates"
              value={pendingUpdates}
              icon={<AlertTriangle size={18} />}
              onClick={() => openLeads("pending")}
            />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <div className="rounded-xl border bg-slate-50 p-3">
              <p className="text-xs font-bold text-slate-500">
                Inspection Rate
              </p>
              <strong className="mt-1 block text-xl text-blue-700">
                {Number(performance.inspection_rate || 0).toFixed(1)}%
              </strong>
            </div>
            <div className="rounded-xl border bg-slate-50 p-3">
              <p className="text-xs font-bold text-slate-500">Close Rate</p>
              <strong className="mt-1 block text-xl text-blue-700">
                {Number(performance.close_rate || 0).toFixed(1)}%
              </strong>
            </div>
          </div>
        </section>
        <section className="rounded-2xl border border-blue-100 bg-white p-4 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-blue-600">
                Package Management
              </p>
              <h2 className="mt-1 font-black">Lead Package</h2>
            </div>
            {pkg && (
              <span className={`rounded-full px-3 py-1 text-[10px] font-black uppercase ${
                pkg.payment_status === "paid"
                  ? "bg-emerald-100 text-emerald-700"
                  : pkg.payment_status === "partial"
                    ? "bg-amber-100 text-amber-700"
                    : "bg-red-100 text-red-700"
              }`}>
                {pkg.payment_status}
              </span>
            )}
          </div>
          {pkg ? (
            <>
              <p className="mt-2 text-xs font-bold text-slate-700">
                {pkg.package_name || `Package #${pkg.package_number || ""}`}
              </p>
              {ownerAccess && (editingPackage || addingPackage) ? (
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {addingPackage && (
                    <div className="col-span-2 rounded-lg border border-blue-200 bg-blue-50 p-2 text-[10px] font-bold text-blue-800">
                      Create the next package using the current location scope. The current package will be completed only after the new package saves successfully.
                    </div>
                  )}
                  <PackageEditField
                    label="Package Leads"
                    value={packageDraft.leadTarget}
                    onChange={(leadTarget) =>
                      setPackageDraft((current) => ({ ...current, leadTarget }))
                    }
                  />
                  <PackageEditField
                    label="Price Per Lead"
                    value={packageDraft.amountPerLead}
                    onChange={(amountPerLead) =>
                      setPackageDraft((current) => ({ ...current, amountPerLead }))
                    }
                  />
                  <PackageEditField
                    label="Start Date"
                    type="date"
                    value={packageDraft.startDate}
                    onChange={(startDate) =>
                      setPackageDraft((current) => ({ ...current, startDate }))
                    }
                  />
                  <div className="flex items-end gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void savePackageDraft()}
                      className="inline-flex min-h-9 flex-1 items-center justify-center gap-1 rounded-lg bg-blue-600 px-2.5 py-1.5 text-[11px] font-black text-white disabled:opacity-50"
                    >
                      {busy ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                      {addingPackage ? "Create Next" : "Save"}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={cancelPackageDraft}
                      className="min-h-9 flex-1 rounded-lg border bg-white px-2.5 py-1.5 text-[11px] font-black text-slate-700 disabled:opacity-50"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <PackageField label="Package Leads" value={String(pkg.lead_target)} />
                  <PackageField label="Price Per Lead" value={formatPackageMoney(pkg.amount_per_lead)} />
                  <PackageField label="Total Amount" value={formatPackageMoney(pkg.package_total)} />
                  <PackageField label="Amount Paid" value={formatPackageMoney(pkg.amount_paid)} />
                  <PackageField label="Payment Status" value={packageStatusLabel(pkg.payment_status)} />
                  <PackageField label="Remaining Balance" value={formatPackageMoney(pkg.remaining_balance)} />
                  <PackageField
                    label="Start Date"
                    value={pkg.start_date ? formatDateLong(pkg.start_date) : "—"}
                  />
                  <PackageField
                    label="Completion Date"
                    value={pkg.completion_date ? formatDateLong(pkg.completion_date) : "In Progress"}
                  />
                </div>
              )}
              <div className="mt-4 flex items-center justify-between gap-3 text-xs">
                <strong>{pkg.delivered_leads} of {pkg.lead_target} Leads Delivered</strong>
                <strong className="text-blue-700">
                  {Number(pkg.completion_percentage || 0).toFixed(0)}%
                </strong>
              </div>
              <div className="mt-2 h-3 overflow-hidden rounded-full bg-slate-200">
                <span
                  className="block h-full rounded-full bg-gradient-to-r from-blue-600 to-emerald-500 transition-all"
                  style={{
                    width: `${Math.min(100, Number(pkg.completion_percentage || 0))}%`,
                  }}
                />
              </div>
              <div className="mt-3 flex items-center justify-between gap-2 rounded-lg bg-blue-50 p-2 text-[10px] font-bold text-blue-700">
                <p>
                  Package pricing and payments are managed by ReadyOps. {dashboard?.package_history.length || 0} package{dashboard?.package_history.length === 1 ? "" : "s"} in history.
                </p>
                {ownerAccess && !editingPackage && !addingPackage && (
                  <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={beginNextPackage}
                      className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-2 py-1 text-[10px] font-black text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                      <Plus size={11} /> Add Another Package
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setAddingPackage(false);
                        setCreatingPackage(false);
                        setEditingPackage(true);
                      }}
                      className="inline-flex items-center gap-1 rounded-md border border-blue-200 bg-white px-2 py-1 text-[10px] font-black text-blue-700 hover:bg-blue-100 disabled:opacity-50"
                    >
                      <Pencil size={11} /> Edit Package
                    </button>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="mt-4 rounded-xl border border-dashed p-4">
              {ownerAccess && creatingPackage ? (
                <div className="grid grid-cols-2 gap-2 text-left">
                  <div className="col-span-2 rounded-lg border border-blue-200 bg-blue-50 p-2 text-[10px] font-bold text-blue-800">
                    Create a new active package for all current company locations. Completed packages remain in history.
                  </div>
                  <PackageEditField
                    label="Package Leads"
                    value={packageDraft.leadTarget}
                    onChange={(leadTarget) =>
                      setPackageDraft((current) => ({ ...current, leadTarget }))
                    }
                  />
                  <PackageEditField
                    label="Price Per Lead"
                    value={packageDraft.amountPerLead}
                    onChange={(amountPerLead) =>
                      setPackageDraft((current) => ({ ...current, amountPerLead }))
                    }
                  />
                  <PackageEditField
                    label="Start Date"
                    type="date"
                    value={packageDraft.startDate}
                    onChange={(startDate) =>
                      setPackageDraft((current) => ({ ...current, startDate }))
                    }
                  />
                  <div className="flex items-end gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void savePackageDraft()}
                      className="inline-flex min-h-9 flex-1 items-center justify-center gap-1 rounded-lg bg-blue-600 px-2.5 py-1.5 text-[11px] font-black text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                      {busy ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
                      Create Package
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={cancelPackageDraft}
                      className="min-h-9 flex-1 rounded-lg border bg-white px-2.5 py-1.5 text-[11px] font-black text-slate-700 disabled:opacity-50"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="text-center text-sm text-slate-400">
                  <p>No active package.</p>
                  {ownerAccess && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={beginFirstPackage}
                      className="mt-3 inline-flex min-h-9 items-center justify-center gap-1 rounded-lg bg-blue-600 px-3 py-2 text-xs font-black text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                      <Plus size={13} /> Create Package
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </section>
        <section className="rounded-2xl border bg-white p-4 shadow-sm">
          <h2 className="font-black">Client Agreement</h2>
          <p className="mt-8 text-xs font-bold text-slate-600">
            {pkg?.agreement_type?.replace(/_/g, " ") || "Paid Per Lead"}
          </p>
          <strong className="mt-2 block text-lg">
            {pkg?.amount_per_lead != null
              ? `$${Number(pkg.amount_per_lead).toLocaleString()} / lead`
              : "Not configured"}
          </strong>
          <button
            disabled
            className="mt-8 w-full rounded-lg border px-3 py-2 text-xs font-bold opacity-60"
          >
            Agreement managed by ReadyOps
          </button>
        </section>
      </div>

      <section className="rounded-2xl border bg-white p-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <div className="mr-auto">
            <h2 className="font-black">Lead Data Tools</h2>
            <p className="text-[10px] text-slate-500">
              Company-approved and delivered appointments only
            </p>
          </div>
          <button
            disabled
            title="Configure a Google Sheets connection in ReadyOps Admin"
            className="rounded-lg border px-3 py-2 text-xs font-bold opacity-60"
          >
            <FileSpreadsheet
              size={14}
              className="mr-1 inline text-emerald-600"
            />{" "}
            Sync Google Sheets
          </button>
          <button
            disabled
            title="Configure an Excel connection in ReadyOps Admin"
            className="rounded-lg border px-3 py-2 text-xs font-bold opacity-60"
          >
            <FileSpreadsheet
              size={14}
              className="mr-1 inline text-emerald-600"
            />{" "}
            Sync Excel
          </button>
          <button
            onClick={() => downloadAppointments(delivered, "csv")}
            className="rounded-lg border px-3 py-2 text-xs font-bold"
          >
            <Download size={14} className="mr-1 inline" /> Download CSV
          </button>
          <button
            onClick={() => downloadAppointments(delivered, "excel")}
            className="rounded-lg border px-3 py-2 text-xs font-bold"
          >
            <FileSpreadsheet
              size={14}
              className="mr-1 inline text-emerald-600"
            />{" "}
            Download Excel
          </button>
          <span className="ml-2 text-[10px] font-semibold text-slate-500">
            Last updated:{" "}
            {dashboard?.last_updated_at
              ? new Date(dashboard.last_updated_at).toLocaleString()
              : "Live"}
          </span>
        </div>
      </section>

      <section className="rounded-2xl border bg-white p-3 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-xs font-bold text-slate-600">
              Select a day to view its leads
            </p>
            <p className="mt-0.5 text-[10px] font-semibold text-slate-400">
              {visibleWeekStart.toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}{" "}
              –{" "}
              {visibleWeekEnd.toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => moveWeek(-1)}
              className="inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-xs font-bold hover:border-blue-300 hover:bg-blue-50"
            >
              <ChevronLeft size={14} /> Previous Week
            </button>
            <button
              type="button"
              onClick={() => setSelectedDay(localDate(new Date()))}
              className="rounded-lg border px-3 py-2 text-xs font-bold hover:border-blue-300 hover:bg-blue-50"
            >
              Today
            </button>
            <button
              type="button"
              onClick={() => moveWeek(1)}
              className="inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-xs font-bold hover:border-blue-300 hover:bg-blue-50"
            >
              Next Week <ChevronRight size={14} />
            </button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-7">
          {days.map((day) => {
            const date = new Date(`${day}T12:00:00`);
            const count = delivered.filter(
              (appointment) => appointment.appointment_date === day,
            ).length;
            const active = day === selectedDay;
            return (
              <button
                key={day}
                onClick={() => setSelectedDay(day)}
                className={`rounded-xl border p-3 text-left transition ${active ? "border-blue-600 bg-blue-600 text-white shadow-md" : "bg-white hover:border-blue-300"}`}
              >
                <span className="text-xs font-bold">
                  {date.toLocaleDateString(undefined, { weekday: "long" })}
                </span>
                <span className="float-right text-[10px]">
                  {date.toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                  })}
                </span>
                <div className="mt-3 flex items-center justify-between text-xs">
                  <span>
                    {count} Lead{count === 1 ? "" : "s"}
                  </span>
                  <CalendarDays size={14} />
                </div>
              </button>
            );
          })}
        </div>
      </section>

      <div className="flex items-center justify-between">
        <h2 className="text-lg font-black">
          {new Date(`${selectedDay}T12:00:00`).toLocaleDateString(undefined, {
            weekday: "long",
          })}{" "}
          Leads
        </h2>
        <span className="text-xs font-bold">
          {selectedAppointments.length} total leads
        </span>
      </div>
      {selectedAppointments.length === 0 ? (
        <Empty text="No approved appointments were sent for this date." />
      ) : (
        selectedAppointments.map((appointment) => (
          <CompanyAppointmentRow
            key={appointment.id}
            appointment={appointment}
            representatives={data.representatives}
            busy={busy}
            openLead={openLead}
            assignRep={assignRep}
            updateAppointmentStatus={updateAppointmentStatus}
            updateLeadOutcome={updateLeadOutcome}
            confirmLeadReceipt={confirmLeadReceipt}
          />
        ))
      )}
    </section>
  );
}

function CompanyAppointmentRow({
  appointment,
  representatives,
  busy,
  openLead,
  assignRep,
  updateAppointmentStatus,
  updateLeadOutcome,
  confirmLeadReceipt,
}: {
  appointment: Appointment;
  representatives: Representative[];
  busy: boolean;
  openLead: (appointment: Appointment) => void;
  assignRep: (appointmentId: string, repId: string) => Promise<void>;
  updateAppointmentStatus: (
    appointmentId: string,
    status: string,
  ) => Promise<void>;
  updateLeadOutcome: (
    appointment: Appointment,
    clientStatus: string,
    notes?: string,
  ) => Promise<void>;
  confirmLeadReceipt: (appointment: Appointment) => Promise<void>;
}) {
  const canonical =
    appointment.canonical_status ||
    appointment.client_status ||
    appointment.status;
  const form = appointment.lead.form_data || {};
  const qualification = [
    form.roof_age && `Roof ${form.roof_age}`,
    form.roof_type,
    form.insurance_name || form.insurance,
    form.visible_damage && `Damage: ${form.visible_damage}`,
  ]
    .filter(Boolean)
    .join(" • ");
  return (
    <article className="rounded-2xl border bg-white p-4 shadow-sm">
      <div className="grid gap-4 xl:grid-cols-[1.25fr_1fr_1fr_1fr]">
        <button onClick={() => openLead(appointment)} className="text-left">
          <p className="text-xs font-bold text-blue-600">
            {formatDateLong(appointment.appointment_date)} •{" "}
            {formatTime(appointment.start_time)}
          </p>
          <h3 className="mt-1 font-black">{appointment.lead.full_name}</h3>
          <p className="text-xs text-slate-600">
            {appointment.lead.phone_number} • {appointment.lead.address}
            {appointment.lead.city ? `, ${appointment.lead.city}` : ""}
            {appointment.lead.state ? `, ${appointment.lead.state}` : ""}{" "}
            {appointment.lead.zip_code || ""}
          </p>
          <p className="mt-1 text-[10px] text-slate-500">
            {qualification ||
              "Open the lead for full property and qualification details."}
          </p>
        </button>
        <div className="border-l pl-4">
          <p className="text-[10px] font-bold text-slate-500">
            Inspector / Lead Status
          </p>
          <button onClick={() => openLead(appointment)} className="mt-2">
            <StatusChip status={appointment.company_action || canonical} />
          </button>
          <p className="mt-2 text-[10px] text-slate-400">
            {appointment.location_label || "Company-wide"} •{" "}
            {appointment.lead.qualification_status.replace(/_/g, " ")}
          </p>
        </div>
        <div className="hidden space-y-2 border-l pl-4 sm:block">
          <p className="text-[10px] font-bold text-slate-500">
            Inspector Assignment
          </p>
          <select
            aria-label={`Assign inspector for ${appointment.lead.full_name}`}
            value={appointment.representative_id || ""}
            onChange={(event) =>
              void assignRep(appointment.id, event.target.value)
            }
            disabled={busy}
            className="w-full rounded-lg border border-blue-300 bg-blue-100 px-3 py-2 text-xs font-bold text-blue-900"
          >
            <option value="">Unassigned</option>
            {representatives
              .filter(
                (rep) =>
                  rep.active || rep.id === appointment.representative_id,
              )
              .map((rep) => (
                <option key={rep.id} value={rep.id}>
                  {rep.name}
                  {rep.active ? "" : " (Inactive)"}
                </option>
              ))}
          </select>
          <p className="text-[10px] font-bold text-slate-500">
            Latest company action
          </p>
          <StatusChip status={appointment.company_action || "pending"} />
        </div>
        <div className="hidden border-l pl-4 sm:block">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-bold text-slate-500">Appointment</p>
            <AppointmentWeatherBadge
              date={appointment.appointment_date}
              city={appointment.lead.city}
              state={appointment.lead.state}
              zip={appointment.lead.zip_code}
            />
          </div>
          <select
            value={appointment.status}
            onChange={(event) =>
              void updateAppointmentStatus(appointment.id, event.target.value)
            }
            disabled={busy}
            className="mt-2 w-full rounded-lg border px-3 py-2 text-xs"
          >
            <option value="confirmed">Confirmed</option>
            <option value="assigned">Assigned</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
      </div>
      <button
        type="button"
        onClick={() => openLead(appointment)}
        className="mt-4 min-h-12 w-full rounded-xl bg-blue-600 px-4 text-sm font-black text-white sm:hidden"
      >
        Assign representative or update status
      </button>
      <div className="mt-4 hidden border-t pt-3 sm:block">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-[10px] font-black uppercase tracking-wide text-slate-400">
            Quick update
          </span>
          <LeadReceivedIndicator
            received={Boolean(appointment.client_received)}
          />
        </div>
        <ClientStatusActions
          currentStatus={appointment.company_action || canonical}
          received={Boolean(appointment.client_received)}
          disabled={busy}
          pendingInsteadOfInspected
          compact
          onConfirm={() => void confirmLeadReceipt(appointment)}
          onDisposition={(status) =>
            void updateLeadOutcome(appointment, status, "")
          }
        />
      </div>
    </article>
  );
}

function CompanyReports({
  data,
  dashboard,
}: {
  data: CompanyPortalData;
  dashboard: CompanyDashboardSummary | null;
}) {
  const performance =
    dashboard?.performance || performanceFromAppointments(data.appointments);
  const rows = [
    ["Pending Updates", performance.pending_updates, "bg-[#0EA5E9]"],
    ["Inspected", performance.good_inspected, "bg-[#059669]"],
    ["Bad / Canceled", performance.bad_leads, "bg-[#E52420]"],
    ["No Show", performance.no_shows, "bg-[#FBBF24]"],
    ["Signed Contract", performance.signed_contracts, "bg-[#006B3C]"],
    ["Rescheduled", performance.rescheduled, "bg-[#FF7A1A]"],
  ] as const;
  return (
    <section className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-2xl border bg-white p-5 shadow-sm">
        <h2 className="font-black">Lead Outcomes</h2>
        <p className="text-xs text-slate-500">
          Based only on approved appointments delivered to this company.
        </p>
        <div className="mt-5 space-y-4">
          {rows.map(([label, value, color]) => (
            <div key={label}>
              <div className="mb-1 flex justify-between text-xs font-bold">
                <span>{label}</span>
                <span>{value}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                <span
                  className={`block h-full ${color}`}
                  style={{
                    width: `${Math.min(100, (Number(value) / Math.max(1, performance.total_leads)) * 100)}%`,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="rounded-2xl border bg-white p-5 shadow-sm">
        <h2 className="font-black">Performance Summary</h2>
        <div className="mt-5 grid grid-cols-2 gap-3">
          <ReportValue
            label="Delivered Leads"
            value={performance.total_leads}
          />
          <ReportValue
            label="Inspection Rate"
            value={`${Number(performance.inspection_rate).toFixed(1)}%`}
          />
          <ReportValue
            label="Close Rate"
            value={`${Number(performance.close_rate).toFixed(1)}%`}
          />
          <ReportValue
            label="Package Remaining"
            value={dashboard?.active_package?.remaining_leads ?? "—"}
          />
        </div>
      </div>
    </section>
  );
}

function CompanyLogo({
  company,
  busy,
  onUpload,
}: {
  company: { name: string; logo_path?: string | null };
  busy: boolean;
  onUpload: (file: File) => Promise<void>;
}) {
  const directLogo =
    company.logo_path && /^https?:/.test(company.logo_path)
      ? company.logo_path
      : null;
  return (
    <div className="flex shrink-0 items-center gap-2">
      <div className="hidden">
        {directLogo ? (
          <img
            src={directLogo}
            alt={`${company.name} logo`}
            className="h-full w-full object-contain p-1"
          />
        ) : (
          <ImageUp className="text-slate-300" size={24} />
        )}
      </div>
      <label
        className={`inline-flex cursor-pointer items-center gap-1 rounded-lg border bg-white px-2.5 py-2 text-[10px] font-bold text-slate-700 shadow-sm ${busy ? "pointer-events-none opacity-50" : ""}`}
      >
        <ImageUp size={13} /> {directLogo ? "Change Logo" : "Upload Logo"}
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="sr-only"
          disabled={busy}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void onUpload(file);
            event.currentTarget.value = "";
          }}
        />
      </label>
    </div>
  );
}
function PerformanceCard({
  tone,
  label,
  value,
  suffix,
  icon,
  onClick,
}: {
  tone:
    | "blue"
    | "cyan"
    | "green"
    | "signed"
    | "purple"
    | "yellow"
    | "orange"
    | "red";
  label: string;
  value: React.ReactNode;
  suffix?: string;
  icon: React.ReactNode;
  onClick?: () => void;
}) {
  const colors = {
    blue: "border-[#7DD3FC] bg-[#BAE6FD] text-[#075985]",
    cyan: "border-[#67E8F9] bg-[#A5F3FC] text-[#0E7490]",
    green: "border-[#6EE7B7] bg-[#A7F3D0] text-[#047857]",
    signed: "border-[#34D399] bg-[#6EE7B7] text-[#00512E]",
    purple: "border-[#C4B5FD] bg-[#DDD6FE] text-[#6D28D9]",
    yellow: "border-[#FBBF24] bg-[#FDE68A] text-[#92400E]",
    orange: "border-[#FDBA74] bg-[#FED7AA] text-[#C2410C]",
    red: "border-[#FCA5A5] bg-[#FECACA] text-[#B91C1C]",
  };
  const content = (
    <>
      <div className="flex items-center justify-between">
        <span className="kpi-title text-slate-600">{label}</span>
        {icon}
      </div>
      <strong className="kpi-number mt-2 block text-slate-950">{value}</strong>
      {suffix && <span className="text-[10px] font-bold">{suffix}</span>}
    </>
  );
  return onClick ? (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl border p-3 text-left transition hover:-translate-y-0.5 hover:shadow-md ${colors[tone]}`}
      title={`Open ${label} leads`}
    >
      {content}
      <span className="mt-2 block text-[9px] font-black uppercase tracking-wide opacity-70">
        View leads →
      </span>
    </button>
  ) : (
    <div className={`rounded-xl border p-3 ${colors[tone]}`}>{content}</div>
  );
}
interface CompanyLeadSheetData {
  rows: Appointment[];
  total: number;
  limit: number;
  offset: number;
  summary: {
    delivered: number;
    good: number;
    bad: number;
    no_show: number;
    rescheduled: number;
    signed_contract: number;
    pending: number;
  };
}
function PackageField({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-xl border bg-slate-50 p-2.5">
      <span className="block text-[9px] font-black uppercase tracking-wide text-slate-500">
        {label}
      </span>
      <strong className="mt-1 block text-sm text-slate-900">{value}</strong>
    </div>
  );
}

function PackageEditField({
  label,
  value,
  onChange,
  type = "number",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: "number" | "date";
}) {
  return (
    <label className="text-[9px] font-black uppercase tracking-wide text-slate-500">
      {label}
      <input
        type={type}
        min={type === "number" ? "0" : undefined}
        step={label === "Package Leads" ? "1" : undefined}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 min-h-9 w-full rounded-lg border border-blue-200 bg-white px-2.5 py-1.5 text-xs font-bold normal-case tracking-normal text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
      />
    </label>
  );
}

function formatPackageMoney(value: number | null | undefined): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Number(value || 0));
}

function packageStatusLabel(value: string): string {
  const status = String(value || "unpaid").toLowerCase();
  if (status === "paid") return "Paid";
  if (status === "partial") return "Partial";
  return "Unpaid";
}
function ReportValue({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="rounded-xl bg-slate-50 p-4">
      <p className="text-xs font-bold text-slate-500">{label}</p>
      <strong className="mt-1 block text-2xl text-blue-700">{value}</strong>
    </div>
  );
}
function StatusChip({ status, label }: { status: string; label?: string }) {
  const classes = label === "Pending Updates"
    ? "border-blue-100 bg-blue-50 text-blue-700"
    : leadStatusClasses(status);
  return (
    <span
      className={`inline-flex whitespace-nowrap rounded-md border px-2.5 py-2 text-[11px] font-black ${classes}`}
    >
      {label || clientLeadStatusLabel(status)}
    </span>
  );
}
function performanceFromAppointments(
  appointments: Appointment[],
): CompanyDashboardSummary["performance"] {
  const total = appointments.length;
  const good = appointments.filter((item) => isLeadOutcome(item, "good")).length;
  const signed = appointments.filter((item) => isLeadOutcome(item, "signed_contract")).length;
  const noShows = appointments.filter((item) => isLeadOutcome(item, "no_show")).length;
  const bad = appointments.filter((item) => isLeadOutcome(item, "bad")).length;
  const rescheduled = appointments.filter((item) =>
    isLeadOutcome(item, "rescheduled"),
  ).length;
  const pendingUpdates = appointments.filter(
    (item) =>
      (!item.company_action || item.company_action === "pending") &&
      !(
        ["good", "signed_contract", "no_show", "bad", "rescheduled"] as const
      ).some((status) => isLeadOutcome(item, status)),
  ).length;
  return {
    total_leads: total,
    good_inspected: good,
    signed_contracts: signed,
    no_shows: noShows,
    bad_leads: bad,
    rescheduled,
    pending_updates: pendingUpdates,
    inspection_rate: total ? ((good + signed) / total) * 100 : 0,
    close_rate: good + signed ? (signed / (good + signed)) * 100 : 0,
  };
}
function downloadAppointments(
  appointments: Appointment[],
  format: "csv" | "excel",
) {
  const rows = [
    [
      "Date",
      "Time",
      "Homeowner",
      "Phone",
      "Address",
      "Location",
      "Status",
      "Representative",
    ],
    ...appointments.map((item) => [
      item.appointment_date,
      item.start_time,
      item.lead.full_name,
      item.lead.phone_number,
      item.lead.address,
      item.location_label || "Company-wide",
      leadStatusExportValue(
        item.company_action ||
          item.client_status ||
          item.canonical_status ||
          item.status,
      ),
      item.representative_name || "Unassigned",
    ]),
  ];
  const separator = format === "excel" ? "\t" : ",";
  const quote = (value: string) =>
    format === "excel"
      ? value.replace(/\t|\r?\n/g, " ")
      : `"${value.replace(/"/g, '""')}"`;
  const blob = new Blob(
    [
      rows
        .map((row) => row.map((value) => quote(String(value))).join(separator))
        .join("\n"),
    ],
    {
      type:
        format === "excel"
          ? "application/vnd.ms-excel;charset=utf-8"
          : "text/csv;charset=utf-8",
    },
  );
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `readyops-company-leads.${format === "excel" ? "xls" : "csv"}`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function ScheduleRuleRow({
  day,
  name,
  rule,
  busy,
  onSave,
}: {
  day: number;
  name: string;
  rule?: ScheduleRule;
  busy: boolean;
  onSave: (draft: Partial<ScheduleRule>) => void;
}) {
  const [draft, setDraft] = useState<Partial<ScheduleRule>>(
    () =>
      rule || {
        day_of_week: day,
        is_open: day !== 0,
        start_time: "09:00",
        end_time: "18:00",
        slot_minutes: 60,
        max_per_slot: 1,
        max_per_day: 8,
      },
  );
  useEffect(
    () =>
      setDraft(
        rule || {
          day_of_week: day,
          is_open: day !== 0,
          start_time: "09:00",
          end_time: "18:00",
          slot_minutes: 60,
          max_per_slot: 1,
          max_per_day: 8,
        },
      ),
    [rule, day],
  );
  return (
    <div className="grid gap-2 rounded-xl border border-slate-100 bg-slate-50 p-3 md:grid-cols-[110px_90px_repeat(5,1fr)_70px] md:items-center">
      <strong className="text-sm">{name}</strong>
      <label className="flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={Boolean(draft.is_open)}
          onChange={(e) => setDraft({ ...draft, is_open: e.target.checked })}
        />{" "}
        Open
      </label>
      <input
        type="time"
        value={String(draft.start_time || "").slice(0, 5)}
        onChange={(e) => setDraft({ ...draft, start_time: e.target.value })}
        className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
      />
      <input
        type="time"
        value={String(draft.end_time || "").slice(0, 5)}
        onChange={(e) => setDraft({ ...draft, end_time: e.target.value })}
        className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
      />
      <input
        title="Minutes between slots"
        type="number"
        min="15"
        value={draft.slot_minutes || 60}
        onChange={(e) =>
          setDraft({ ...draft, slot_minutes: Number(e.target.value) })
        }
        className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
      />
      <input
        title="Max per time slot"
        type="number"
        min="1"
        value={draft.max_per_slot || 1}
        onChange={(e) =>
          setDraft({ ...draft, max_per_slot: Number(e.target.value) })
        }
        className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
      />
      <input
        title="Max per day"
        type="number"
        min="1"
        value={draft.max_per_day || 8}
        onChange={(e) =>
          setDraft({ ...draft, max_per_day: Number(e.target.value) })
        }
        className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
      />
      <button
        disabled={busy}
        onClick={() => onSave(draft)}
        className="rounded-lg bg-blue-600 px-2 py-2 text-xs font-bold text-white"
      >
        Save
      </button>
    </div>
  );
}

function FormFieldEditor({
  field,
  onChange,
  onRemove,
}: {
  field: PortalFormField;
  onChange: (patch: Partial<PortalFormField>) => void;
  onRemove: () => void;
}) {
  const optionText = (field.options || []).join(", ");
  return (
    <div className="grid gap-2 rounded-xl bg-slate-50 p-3 md:grid-cols-[1.5fr_1fr_1fr_auto_auto]">
      <input
        value={field.label}
        onChange={(e) => onChange({ label: e.target.value })}
        className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
      />
      <select
        value={field.type}
        onChange={(e) => onChange({ type: e.target.value })}
        className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
      >
        <option value="text">Text</option>
        <option value="textarea">Long Text</option>
        <option value="phone">Phone</option>
        <option value="email">Email</option>
        <option value="address">Address</option>
        <option value="number">Number</option>
        <option value="currency">Currency</option>
        <option value="url">URL</option>
        <option value="select">Dropdown</option>
        <option value="multiselect">Multi Select</option>
        <option value="date">Date</option>
        <option value="time">Time</option>
      </select>
      {field.type === "select" || field.type === "multiselect" ? (
        <input
          value={optionText}
          onChange={(e) =>
            onChange({
              options: e.target.value
                .split(",")
                .map((v) => v.trim())
                .filter(Boolean),
            })
          }
          placeholder="Option 1, Option 2"
          className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
        />
      ) : (
        <input
          value={field.key}
          onChange={(e) =>
            onChange({ key: e.target.value.replace(/\s+/g, "_").toLowerCase() })
          }
          className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs text-slate-500"
        />
      )}
      <label className="flex items-center gap-1 text-xs">
        <input
          type="checkbox"
          checked={Boolean(field.required)}
          onChange={(e) => onChange({ required: e.target.checked })}
        />{" "}
        Required
      </label>
      <button onClick={onRemove} className="text-red-600">
        <Trash2 size={15} />
      </button>
    </div>
  );
}

function LeadModal({
  appointment,
  companyId,
  token,
  busy,
  representatives,
  assignRep,
  updateAppointmentStatus,
  updateLeadOutcome,
  confirmLeadReceipt,
  onClose,
}: {
  appointment: Appointment;
  companyId: string;
  token: string;
  busy: boolean;
  representatives: Representative[];
  assignRep: (appointmentId: string, repId: string) => Promise<void>;
  updateAppointmentStatus: (
    appointmentId: string,
    status: string,
  ) => Promise<void>;
  updateLeadOutcome: (
    appointment: Appointment,
    clientStatus: string,
    notes?: string,
  ) => Promise<void>;
  confirmLeadReceipt: (appointment: Appointment) => Promise<void>;
  onClose: () => void;
}) {
  const lead = appointment.lead;
  const [notes, setNotes] = useState(appointment.inspector_notes || "");
  const currentStatus =
    appointment.company_action ||
    appointment.canonical_status ||
    appointment.client_status ||
    appointment.status;
  return (
    <div
      className="fixed inset-0 z-[100] flex items-end bg-black/50 sm:items-center sm:justify-center sm:p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Update ${lead.full_name}`}
        className="readyops-company-lead-modal max-h-[94dvh] w-full overflow-y-auto rounded-t-[28px] bg-white text-slate-900 shadow-2xl sm:max-w-3xl sm:rounded-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b bg-white/95 px-4 py-4 backdrop-blur sm:px-5">
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-widest text-blue-600">
              Assign & Update
            </p>
            <h2 className="truncate text-xl font-black">{lead.full_name}</h2>
            <p className="mt-0.5 text-xs font-semibold text-slate-500">
              {formatDateLong(appointment.appointment_date)} · {formatTime(appointment.start_time)}
            </p>
          </div>
          <button
            type="button"
            aria-label="Close lead"
            onClick={onClose}
            className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-700"
          >
            <X size={19} />
          </button>
        </div>

        <div className="p-4 sm:p-5">
          <section className="rounded-2xl border border-blue-100 bg-blue-50/60 p-4">
            <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
              <label className="space-y-1 text-[10px] font-black uppercase tracking-wide text-slate-500">
                Assigned representative
                <select
                  aria-label={`Assign representative for ${lead.full_name}`}
                  value={appointment.representative_id || ""}
                  disabled={busy}
                  onChange={(event) =>
                    void assignRep(appointment.id, event.target.value)
                  }
                  className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-base font-bold normal-case tracking-normal text-slate-900 disabled:cursor-wait disabled:opacity-50 sm:min-w-64 sm:text-sm"
                >
                  <option value="">Unassigned</option>
                  {representatives
                    .filter(
                      (rep) =>
                        rep.active || rep.id === appointment.representative_id,
                    )
                    .map((rep) => (
                      <option key={rep.id} value={rep.id}>
                        {rep.name}
                        {rep.active ? "" : " (Inactive)"}
                      </option>
                    ))}
                </select>
              </label>
              <div className="rounded-xl border border-blue-100 bg-white px-3 py-2">
                <p className="text-[9px] font-black uppercase tracking-wide text-slate-400">
                  Current status
                </p>
                <div className="mt-1">
                  <StatusChip status={currentStatus} />
                </div>
              </div>
            </div>

            <div className="mt-4 border-t border-blue-100 pt-4">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-black text-slate-900">
                    Choose an update
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    One tap saves the outcome and keeps it in ReadyOps history.
                  </p>
                </div>
                <LeadReceivedIndicator
                  received={Boolean(appointment.client_received)}
                />
              </div>
              <ClientStatusActions
                className="mt-3"
                currentStatus={currentStatus}
                received={Boolean(appointment.client_received)}
                disabled={busy}
                pendingInsteadOfInspected
                compact
                onConfirm={() => void confirmLeadReceipt(appointment)}
                onDisposition={(status) =>
                  void updateLeadOutcome(appointment, status, notes)
                }
              />
            </div>

            <label className="mt-4 block text-[10px] font-black uppercase tracking-wide text-slate-500">
              Notes (optional)
              <textarea
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Add inspector or company notes before choosing an update"
                className="mt-1 min-h-20 w-full resize-y rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium normal-case tracking-normal text-slate-900 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
              />
            </label>

            <details className="mt-3 rounded-xl border border-blue-100 bg-white">
              <summary className="cursor-pointer px-3 py-3 text-xs font-black text-slate-700">
                Appointment options
              </summary>
              <label className="block border-t border-blue-100 p-3 text-[10px] font-black uppercase tracking-wide text-slate-500">
                Appointment status
                <select
                  value={appointment.status}
                  onChange={(event) =>
                    void updateAppointmentStatus(
                      appointment.id,
                      event.target.value,
                    )
                  }
                  disabled={busy}
                  className="mt-1 min-h-11 w-full rounded-lg border bg-white px-3 text-sm font-bold normal-case tracking-normal text-slate-800"
                >
                  <option value="confirmed">Confirmed</option>
                  <option value="assigned">Assigned</option>
                  <option value="completed">Completed</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </label>
            </details>
          </section>

          <div className="mt-5">
            <ClientLeadTemplate lead={lead} appointment={appointment} />
          </div>
          <div className="mt-3">
            <AppointmentWeatherBadge
              date={appointment.appointment_date}
              city={lead.city}
              state={lead.state}
              zip={lead.zip_code}
              size="lg"
            />
          </div>
          <div className="mt-4">
            <SharedRecordingPlayer
              companyId={companyId}
              token={token}
              leadId={lead.id}
              recordingUrl={lead.recording_url}
              shared={lead.recording_shared}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
function LinkCard({
  title,
  value,
  onCopy,
  onOpen,
  privateLink = false,
}: {
  title: string;
  value: string;
  onCopy: () => void;
  onOpen: () => void;
  privateLink?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border p-4 ${privateLink ? "border-amber-200 bg-amber-50" : "border-blue-200 bg-blue-50"}`}
    >
      <p className="text-xs font-bold text-slate-700">{title}</p>
      <p className="mt-1 truncate text-xs text-slate-500">{value}</p>
      <div className="mt-3 flex gap-2">
        <button
          onClick={onCopy}
          className="inline-flex items-center gap-1 rounded-lg bg-white px-3 py-2 text-xs font-bold shadow-sm"
        >
          <Clipboard size={13} /> Copy
        </button>
        <button
          onClick={onOpen}
          className="inline-flex items-center gap-1 rounded-lg bg-white px-3 py-2 text-xs font-bold shadow-sm"
        >
          <ExternalLink size={13} /> Open
        </button>
      </div>
    </div>
  );
}
function TextField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-semibold text-slate-600">
        {label}
      </label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm"
      />
    </div>
  );
}
function TextArea({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-semibold text-slate-600">
        {label}
      </label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="min-h-24 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm"
      />
    </div>
  );
}
function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-semibold text-slate-600">
        {label}
      </label>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm"
      />
    </div>
  );
}
function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-3 text-sm font-medium">
      <span>{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}
function Empty({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-400">
      {text}
    </div>
  );
}
function PageState({
  icon,
  title,
  detail,
}: {
  icon: React.ReactNode;
  title: string;
  detail?: string;
}) {
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <div className="max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-500">
          {icon}
        </div>
        <h1 className="font-bold">{title}</h1>
        {detail && <p className="mt-2 text-sm text-slate-500">{detail}</p>}
      </div>
    </div>
  );
}
function numberOrBlank(value: unknown): string {
  return value === null || value === undefined || value === ""
    ? ""
    : String(value);
}

function splitList(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(/[\n,]/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
}
