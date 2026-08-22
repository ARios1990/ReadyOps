import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  Clipboard,
  Download,
  ExternalLink,
  FileSpreadsheet,
  ImageUp,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
  Trash2,
  UserRoundCheck,
  Users,
  UserX,
} from "lucide-react";
import { supabase } from "./supabase";
import { PortalFormField, PortalFormSection } from "./DynamicLeadForm";
import {
  addDays,
  copyText,
  formatDateLong,
  formatTime,
  localDate,
  rpcError,
  startOfWeek,
} from "./portalUtils";
import { READYOPS_LOGO_DATA_URI } from "./brand";
import { ClientLeadTemplate } from "./ClientLeadTemplate";
import { SharedRecordingPlayer } from "./SharedRecordingPlayer";
import { AppointmentWeatherBadge } from "./AgentWeatherPreview";
import { useCompanyPortalPresence } from "./useCompanyPortalPresence";
import { leadStatusClasses, leadStatusLabel } from "./leadStatusPresentation";

interface Location {
  id: string;
  location_label: string;
  state: string | null;
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
  inspector_notes: string | null;
  representative_id: string | null;
  representative_name: string | null;
  location_label: string | null;
  lead: LeadRecord;
  latest_checkin: {
    verified?: boolean;
    distance_m?: number;
    checked_in_at?: string;
  } | null;
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
  check_in_radius_m: number;
  check_in_before_minutes: number;
  check_in_after_minutes: number;
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
    inspection_rate: number;
    close_rate: number;
  };
  active_package: null | {
    id: string;
    package_number: number | null;
    package_name: string | null;
    lead_target: number;
    amount_per_lead: number | null;
    payment_status: string;
    start_date: string | null;
    delivered_leads: number;
    remaining_leads: number;
    completion_percentage: number;
    agreement_type?: string | null;
  };
  package_history: Array<Record<string, unknown>>;
  last_updated_at: string | null;
}

type Tab =
  | "appointments"
  | "leads"
  | "schedule"
  | "requirements"
  | "forms"
  | "reps"
  | "audit"
  | "reports";
const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

export function CompanyPortal({
  companyId,
  token,
}: {
  companyId: string;
  token: string;
}) {
  const [data, setData] = useState<CompanyPortalData | null>(null);
  const [dashboard, setDashboard] = useState<CompanyDashboardSummary | null>(
    null,
  );
  const [tab, setTab] = useState<Tab>("appointments");
  const [companyLeadFilter, setCompanyLeadFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [selectedLead, setSelectedLead] = useState<Appointment | null>(null);
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

  useCompanyPortalPresence(companyId, token, tab);

  const windowStart = localDate(addDays(startOfWeek(), -7));
  const windowEnd = localDate(addDays(startOfWeek(), 28));

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
      check_in_radius_m: settingsDraft.check_in_radius_m,
      check_in_before_minutes: settingsDraft.check_in_before_minutes,
      check_in_after_minutes: settingsDraft.check_in_after_minutes,
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
    const { error: rpcErr } = await supabase.rpc(
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
      notify("Appointment status updated.");
      await load();
    }
    setBusy(false);
  }

  async function updateLeadOutcome(
    appointment: Appointment,
    clientStatus: string,
  ) {
    const note =
      window.prompt(
        "Inspector / company notes (optional)",
        appointment.inspector_notes || "",
      ) ??
      (appointment.inspector_notes || "");
    setBusy(true);
    setError("");
    const { error: rpcErr } = await supabase.rpc(
      "company_update_lead_outcome",
      {
        p_company_id: companyId,
        p_access_token: token,
        p_appointment_id: appointment.id,
        p_client_status: clientStatus,
        p_notes: note,
      },
    );
    if (rpcErr) setError(rpcError(rpcErr));
    else {
      notify("Lead outcome updated.");
      await load();
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
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-30 border-b bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1500px] items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-5">
            <img
              src={READYOPS_LOGO_DATA_URI}
              alt="ReadyOps"
              className="h-10 w-auto"
            />
            <div className="min-w-0">
              <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
                Company Management
              </p>
              <h1 className="truncate text-lg font-black text-slate-950">
                {data.company.name}
              </h1>
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

      <main className="mx-auto max-w-[1500px] px-4 py-5 sm:px-6">
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

        <section className="mb-5 grid gap-3 md:grid-cols-2">
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

        <nav className="mb-5 flex gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1">
          {(
            [
              ["appointments", "Appointments", CalendarDays],
              ["leads", "Leads", FileSpreadsheet],
              ["schedule", "Schedule", CalendarDays],
              ["requirements", "Requirements", ShieldCheck],
              ["forms", "Forms", Clipboard],
              ["reps", "Reps", Users],
              ["audit", "Audit", ShieldCheck],
              ["reports", "Reports", BarChart3],
            ] as [Tab, string, typeof CalendarDays][]
          ).map(([key, label, Icon]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold ${tab === key ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-50"}`}
            >
              <Icon size={14} />
              {label}
            </button>
          ))}
        </nav>

        {tab === "appointments" && (
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
            openLeads={(filter) => {
              setCompanyLeadFilter(filter);
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
            openLead={setSelectedLead}
            activePackage={dashboard?.active_package || null}
          />
        )}

        {tab === "requirements" && (
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
              <NumberField
                label="GPS Check-In Radius (meters)"
                value={String(settingsDraft.check_in_radius_m)}
                onChange={(value) =>
                  setSettingsDraft({
                    ...settingsDraft,
                    check_in_radius_m: Number(value || 152),
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

        {tab === "schedule" && (
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

        {tab === "forms" && (
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

        {tab === "reps" && (
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

        {tab === "audit" && (
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

      {selectedLead && (
        <LeadModal
          appointment={selectedLead}
          companyId={companyId}
          token={token}
          onClose={() => setSelectedLead(null)}
        />
      )}
    </div>
  );
}

function CompanyLeadsSpreadsheet({
  companyId,
  token,
  filter,
  setFilter,
  openLead,
  activePackage,
}: {
  companyId: string;
  token: string;
  filter: string;
  setFilter: (value: string) => void;
  openLead: (appointment: Appointment) => void;
  activePackage: CompanyDashboardSummary["active_package"];
}) {
  const [data, setData] = useState<CompanyLeadSheetData>({
    rows: [],
    total: 0,
    limit: 100,
    offset: 0,
    summary: {
      delivered: 0,
      good: 0,
      no_show: 0,
      rescheduled: 0,
      signed_contract: 0,
      pending: 0,
    },
  });
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const { data: result, error: loadError } = await supabase.rpc(
      "get_company_lead_spreadsheet",
      {
        p_company_id: companyId,
        p_access_token: token,
        p_filter: filter,
        p_search: search || null,
        p_limit: 100,
        p_offset: offset,
      },
    );
    if (loadError) setError(rpcError(loadError));
    else setData(result as CompanyLeadSheetData);
    setLoading(false);
  }, [companyId, filter, offset, search, token]);
  useEffect(() => {
    void load();
  }, [load]);
  const chooseFilter = (next: string) => {
    setOffset(0);
    setFilter(next);
  };
  const filterCards = [
    [
      "all",
      "Delivered",
      data.summary.delivered,
      "border-blue-200 bg-blue-50 text-blue-700",
    ],
    [
      "good",
      "Good",
      data.summary.good,
      "border-emerald-200 bg-emerald-50 text-emerald-700",
    ],
    [
      "no_show",
      "No Show",
      data.summary.no_show,
      "border-orange-200 bg-orange-50 text-orange-700",
    ],
    [
      "rescheduled",
      "Rescheduled",
      data.summary.rescheduled,
      "border-amber-200 bg-amber-50 text-amber-700",
    ],
    [
      "signed_contract",
      "Signed Contracts",
      data.summary.signed_contract,
      "border-violet-200 bg-violet-50 text-violet-700",
    ],
    [
      "pending",
      "Pending Updates",
      data.summary.pending,
      "border-red-200 bg-red-50 text-red-700",
    ],
  ] as const;
  const page = Math.floor(offset / 100) + 1;
  const pages = Math.max(1, Math.ceil(data.total / 100));
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-black">Company Leads</h2>
          <p className="text-xs text-slate-500">
            Every QC-approved lead delivered to this company, across all dates.
          </p>
        </div>
        <div className="rounded-xl border bg-white px-4 py-2 text-xs">
          <strong>{activePackage?.remaining_leads ?? "—"}</strong> package leads
          remaining{" "}
          <span className="text-slate-400">(not yet delivered records)</span>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
        {filterCards.map(([key, label, count, tone]) => (
          <button
            key={key}
            onClick={() => chooseFilter(key)}
            className={`rounded-xl border p-3 text-left ${tone} ${filter === key ? "ring-2 ring-blue-500 ring-offset-1" : ""}`}
          >
            <span className="text-[10px] font-black uppercase tracking-wide">
              {label}
            </span>
            <strong className="mt-1 block text-2xl text-slate-950">
              {count}
            </strong>
            <span className="text-[9px] font-bold">Show matching leads →</span>
          </button>
        ))}
      </div>
      <section className="rounded-2xl border bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b p-3">
          <form
            className="relative min-w-[260px] flex-1"
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
              className="h-10 w-full rounded-lg border pl-9 pr-3 text-xs"
            />
          </form>
          <button
            onClick={() => void load()}
            className="inline-flex items-center gap-1 rounded-lg border px-3 py-2.5 text-xs font-bold"
          >
            <RefreshCw size={13} /> Refresh
          </button>
          <span className="text-xs font-bold text-slate-500">
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
          <div className="overflow-x-auto">
            <table className="w-full min-w-[2300px] border-separate border-spacing-0 text-xs">
              <thead className="sticky top-0 z-10 bg-slate-50 text-left text-[10px] uppercase tracking-wide text-slate-500">
                <tr>
                  {[
                    "Appointment Date",
                    "Time",
                    "Homeowner",
                    "Phone",
                    "Property Address",
                    "City / State / ZIP",
                    "Service",
                    "Roof Age",
                    "Roof Type",
                    "Insurance",
                    "Carrier",
                    "Damage / Hail",
                    "Inspector",
                    "Lead Status",
                    "Client Notes",
                    "Action",
                  ].map((label, index, labels) => (
                    <th
                      key={label}
                      className={`border-b px-3 py-3 ${index === 0 ? "sticky left-0 z-20 bg-slate-50" : ""} ${index === labels.length - 1 ? "sticky right-0 z-20 bg-slate-50" : ""}`}
                    >
                      {label}
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
                  return (
                    <tr
                      key={appointment.id}
                      onClick={() => openLead(appointment)}
                      className="cursor-pointer hover:bg-blue-50/40"
                    >
                      <td className="sticky left-0 z-[1] border-b border-r bg-white px-3 py-3 font-black text-blue-700">
                        {appointment.appointment_date}
                      </td>
                      <td className="border-b px-3 py-3 font-bold">
                        {formatTime(appointment.start_time)}
                      </td>
                      <td className="border-b px-3 py-3 font-black">
                        {appointment.lead.full_name}
                      </td>
                      <td className="border-b px-3 py-3">
                        {appointment.lead.phone_number}
                      </td>
                      <td className="border-b px-3 py-3">
                        {appointment.lead.address}
                      </td>
                      <td className="border-b px-3 py-3">
                        {[
                          appointment.lead.city,
                          appointment.lead.state,
                          appointment.lead.zip_code,
                        ]
                          .filter(Boolean)
                          .join(", ")}
                      </td>
                      <td className="border-b px-3 py-3">
                        {appointment.lead.service_needed || "—"}
                      </td>
                      <td className="border-b px-3 py-3">
                        {String(form.roof_age || "—")}
                      </td>
                      <td className="border-b px-3 py-3">
                        {String(form.roof_type || "—")}
                      </td>
                      <td className="border-b px-3 py-3">
                        {String(form.insurance || "—")}
                      </td>
                      <td className="border-b px-3 py-3">
                        {String(form.insurance_name || "—")}
                      </td>
                      <td className="border-b px-3 py-3">
                        {String(form.visible_damage || form.hail_size || "—")}
                      </td>
                      <td className="border-b px-3 py-3">
                        {appointment.representative_name || "Unassigned"}
                      </td>
                      <td className="border-b px-3 py-3">
                        <StatusChip status={status} />
                      </td>
                      <td
                        className="max-w-[280px] truncate border-b px-3 py-3"
                        title={
                          appointment.inspector_notes ||
                          appointment.lead.notes ||
                          ""
                        }
                      >
                        {appointment.inspector_notes ||
                          appointment.lead.notes ||
                          "—"}
                      </td>
                      <td className="sticky right-0 z-[1] border-b border-l bg-white px-3 py-3">
                        <button
                          onClick={(event) => {
                            event.stopPropagation();
                            openLead(appointment);
                          }}
                          className="rounded-lg border border-blue-300 bg-blue-50 px-3 py-1.5 font-bold text-blue-700"
                        >
                          View Lead
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex justify-end gap-2 border-t p-3">
          <button
            disabled={offset === 0 || loading}
            onClick={() => setOffset((value) => Math.max(0, value - 100))}
            className="rounded-lg border px-3 py-2 text-xs font-bold disabled:opacity-40"
          >
            Previous
          </button>
          <button
            disabled={page >= pages || loading}
            onClick={() => setOffset((value) => value + 100)}
            className="rounded-lg border px-3 py-2 text-xs font-bold disabled:opacity-40"
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
  ) => Promise<void>;
  openLeads: (filter: string) => void;
}) {
  const delivered = data.appointments;
  const fallbackPerformance = performanceFromAppointments(delivered);
  const performance = dashboard?.performance || fallbackPerformance;
  const pkg = dashboard?.active_package;
  const days = Array.from({ length: 7 }, (_, index) =>
    localDate(addDays(startOfWeek(new Date(`${selectedDay}T12:00:00`)), index)),
  );
  const selectedAppointments = delivered
    .filter((appointment) => appointment.appointment_date === selectedDay)
    .sort((a, b) => a.start_time.localeCompare(b.start_time));
  const rescheduled = delivered.filter((item) =>
    ["rescheduled", "reschedule"].includes(
      item.company_action || item.canonical_status || item.client_status,
    ),
  ).length;
  const pendingUpdates = delivered.filter(
    (item) => !item.company_action || item.company_action === "pending",
  ).length;
  return (
    <section className="space-y-4">
      <div className="grid gap-3 xl:grid-cols-[1.65fr_1.1fr_250px]">
        <section className="rounded-2xl border bg-white p-3 shadow-sm">
          <h2 className="mb-3 font-black">Company Performance</h2>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            <PerformanceCard
              tone="blue"
              label="Package"
              value={pkg?.lead_target ?? "—"}
              icon={<Clipboard size={18} />}
              onClick={() => openLeads("all")}
            />
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
              label="Good"
              value={performance.good_inspected}
              icon={<UserRoundCheck size={18} />}
              onClick={() => openLeads("good")}
            />
            <PerformanceCard
              tone="orange"
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
              tone="purple"
              label="Signed Contracts"
              value={performance.signed_contracts}
              icon={<Clipboard size={18} />}
              onClick={() => openLeads("signed_contract")}
            />
            <PerformanceCard
              tone="red"
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
        <section className="rounded-2xl border bg-white p-4 shadow-sm">
          <h2 className="font-black">Lead Packages</h2>
          {pkg ? (
            <>
              <div className="mt-3 flex items-start justify-between gap-3">
                <div>
                  <p className="font-bold">
                    {pkg.package_name || `Package #${pkg.package_number || ""}`}
                  </p>
                  <span className="mt-1 inline-flex rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-bold text-emerald-700">
                    Active
                  </span>
                  <p className="mt-2 text-[10px] text-slate-500">
                    Started{" "}
                    {pkg.start_date ? formatDateLong(pkg.start_date) : "—"}
                  </p>
                </div>
                <div className="grid grid-cols-3 gap-4 text-center">
                  <PackageNumber value={pkg.lead_target} label="Purchased" />
                  <PackageNumber
                    value={pkg.delivered_leads}
                    label="Delivered"
                  />
                  <PackageNumber
                    value={pkg.remaining_leads}
                    label="Remaining"
                  />
                </div>
              </div>
              <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-200">
                <span
                  className="block h-full rounded-full bg-emerald-500"
                  style={{
                    width: `${Math.min(100, Number(pkg.completion_percentage || 0))}%`,
                  }}
                />
              </div>
              <p className="mt-1 text-right text-[10px] font-bold text-slate-500">
                {Number(pkg.completion_percentage || 0).toFixed(0)}% Complete
              </p>
              <div className="mt-4 flex gap-2">
                <button
                  disabled
                  className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white opacity-60"
                >
                  <Plus size={13} className="mr-1 inline" /> Start New Package
                </button>
                <span className="rounded-lg border px-3 py-2 text-xs font-bold">
                  {dashboard?.package_history.length || 0} in History
                </span>
              </div>
            </>
          ) : (
            <div className="mt-4 rounded-xl border border-dashed p-6 text-center text-sm text-slate-400">
              No active package.
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
        <p className="mb-2 text-xs font-bold text-slate-500">
          Select a day to view its leads
        </p>
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
  ) => Promise<void>;
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
  const actions = [
    ["contacted", "Contacted"],
    ["confirmed", "Confirmed"],
    ["inspected", "Inspected"],
    ["no_show", "No Show"],
    ["rescheduled", "Rescheduled"],
    ["estimate_given", "Estimate Given"],
    ["claim_filed", "Claim Filed"],
    ["signed_contract", "Signed Contract"],
    ["lost", "Lost"],
  ] as const;
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
        <div className="space-y-2 border-l pl-4">
          <p className="text-[10px] font-bold text-slate-500">Rep Assignment</p>
          <select
            value={appointment.representative_id || ""}
            onChange={(event) =>
              void assignRep(appointment.id, event.target.value)
            }
            disabled={busy}
            className="w-full rounded-lg border px-3 py-2 text-xs"
          >
            <option value="">Unassigned</option>
            {representatives
              .filter((rep) => rep.active)
              .map((rep) => (
                <option key={rep.id} value={rep.id}>
                  {rep.name}
                </option>
              ))}
          </select>
          <p className="text-[10px] font-bold text-slate-500">
            Latest company action
          </p>
          <StatusChip status={appointment.company_action || "pending"} />
        </div>
        <div className="border-l pl-4">
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
      <div className="mt-4 flex flex-wrap gap-2 border-t pt-3">
        <span className="mr-1 self-center text-[10px] font-black uppercase tracking-wide text-slate-400">
          Quick update
        </span>
        {actions.map(([value, label]) => (
          <button
            key={value}
            disabled={busy}
            onClick={() => void updateLeadOutcome(appointment, value)}
            className={`rounded-lg border px-2.5 py-1.5 text-[10px] font-bold ${appointment.company_action === value ? "border-blue-600 bg-blue-600 text-white" : "bg-slate-50 text-slate-700 hover:border-blue-300"}`}
          >
            {label}
          </button>
        ))}
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
    ["Good / Inspected", performance.good_inspected, "bg-emerald-500"],
    ["Signed Contracts", performance.signed_contracts, "bg-violet-500"],
    ["No Shows", performance.no_shows, "bg-orange-500"],
    ["Bad Leads", performance.bad_leads, "bg-red-500"],
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
      <div className="hidden h-16 w-20 items-center justify-center overflow-hidden rounded-xl border bg-white shadow-sm md:flex">
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
  tone: "blue" | "green" | "purple" | "orange" | "red";
  label: string;
  value: React.ReactNode;
  suffix?: string;
  icon: React.ReactNode;
  onClick?: () => void;
}) {
  const colors = {
    blue: "border-blue-100 bg-blue-50 text-blue-700",
    green: "border-emerald-100 bg-emerald-50 text-emerald-700",
    purple: "border-violet-100 bg-violet-50 text-violet-700",
    orange: "border-orange-100 bg-orange-50 text-orange-700",
    red: "border-red-100 bg-red-50 text-red-700",
  };
  const content = (
    <>
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold text-slate-600">{label}</span>
        {icon}
      </div>
      <strong className="mt-2 block text-2xl text-slate-950">{value}</strong>
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
    no_show: number;
    rescheduled: number;
    signed_contract: number;
    pending: number;
  };
}
function PackageNumber({ value, label }: { value: number; label: string }) {
  return (
    <div>
      <strong className="block text-lg">{value}</strong>
      <span className="text-[9px] text-slate-500">{label}</span>
    </div>
  );
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
function StatusChip({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex rounded-md border px-3 py-2 text-xs font-black ${leadStatusClasses(status)}`}
    >
      {leadStatusLabel(status)}
    </span>
  );
}
function performanceFromAppointments(
  appointments: Appointment[],
): CompanyDashboardSummary["performance"] {
  const total = appointments.length;
  const good = appointments.filter((item) =>
    ["good_inspected", "good"].includes(
      item.canonical_status || item.client_status,
    ),
  ).length;
  const signed = appointments.filter((item) =>
    ["signed_contract"].includes(item.canonical_status || item.client_status),
  ).length;
  const noShows = appointments.filter((item) =>
    ["no_show"].includes(item.canonical_status || item.client_status),
  ).length;
  const bad = appointments.filter((item) =>
    ["bad"].includes(item.canonical_status || item.client_status),
  ).length;
  return {
    total_leads: total,
    good_inspected: good,
    signed_contracts: signed,
    no_shows: noShows,
    bad_leads: bad,
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
      item.canonical_status || item.client_status || item.status,
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
  onClose,
}: {
  appointment: Appointment;
  companyId: string;
  token: string;
  onClose: () => void;
}) {
  const lead = appointment.lead;
  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="mx-auto my-8 max-w-3xl rounded-2xl bg-white p-5 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex justify-end">
          <button
            onClick={onClose}
            className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-bold"
          >
            Close
          </button>
        </div>
        <ClientLeadTemplate lead={lead} appointment={appointment} />
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
