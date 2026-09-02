import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  ClipboardCopy,
  Clock3,
  Loader2,
  Undo2,
} from "lucide-react";
import { supabase } from "./supabase";
import { DynamicLeadForm, PortalFormSection } from "./DynamicLeadForm";
import {
  addDays,
  buildLeadTemplate,
  copyText,
  formatDateLong,
  formatDateShort,
  formatTime,
  getPortalSessionId,
  localDate,
  rpcError,
  startOfWeek,
} from "./portalUtils";
import { READYOPS_LOGO_DATA_URI } from "./brand";
import { AgentWeatherPreview, useWeeklyWeather } from "./AgentWeatherPreview";

interface Slot {
  start: string;
  end: string;
  status: string;
  capacity: number;
  bookedCount: number;
}
interface DayAvailability {
  day: string;
  date: string;
  slots: Slot[];
  booked: number;
  openings: number;
  closed: boolean;
}
interface Location {
  id: string;
  label: string;
  city: string | null;
  state: string | null;
  zip: string | null;
  timezone?: string | null;
  serviceCities: string[];
  serviceZips: string[];
}
interface PublicPortalData {
  company: {
    company: {
      id: string;
      name: string;
      slug: string;
      state: string | null;
      website: string | null;
    };
    settings: {
      timezone: string;
      requirementsShort: string;
      requirementsDetail: string;
      allowPublicBooking: boolean;
      formMode: "internal" | "external" | "internal_external";
      formSchema: PortalFormSection[];
      externalFormProvider: string | null;
      externalFormUrl: string | null;
      externalPrefillMap: Record<string, string>;
      qualificationRules: Record<string, unknown>;
    };
    locations: Location[];
  };
  week: DayAvailability[];
}

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function normalizePublicPortalData(value: unknown): PublicPortalData {
  const root = asObject(value);

  // Keep compatibility with the original nested response while accepting the
  // flat, snake_case contract returned by the production RPC.
  if (root.week && asObject(root.company).company) {
    return value as PublicPortalData;
  }

  const company = asObject(root.company);
  const settings = asObject(root.settings);
  const rawLocations = Array.isArray(root.locations) ? root.locations : [];
  const rawDays = Array.isArray(root.days) ? root.days : [];

  if (!asString(company.id) || !asString(company.name)) {
    throw new Error("The booking portal returned an invalid company record.");
  }

  return {
    company: {
      company: {
        id: asString(company.id),
        name: asString(company.name),
        slug: asString(company.public_slug),
        state: asNullableString(company.state),
        website: asNullableString(company.website),
      },
      settings: {
        timezone: asString(settings.timezone, "America/Chicago"),
        requirementsShort: asString(settings.requirements_short),
        requirementsDetail: asString(settings.requirements_detail),
        allowPublicBooking: settings.allow_public_booking !== false,
        formMode: (["internal", "external", "internal_external"].includes(
          asString(settings.form_mode),
        )
          ? settings.form_mode
          : "internal") as "internal" | "external" | "internal_external",
        formSchema: Array.isArray(settings.form_schema)
          ? (settings.form_schema as PortalFormSection[])
          : [],
        externalFormProvider: asNullableString(settings.external_form_provider),
        externalFormUrl: asNullableString(settings.external_form_url),
        externalPrefillMap: asObject(settings.external_prefill_map) as Record<
          string,
          string
        >,
        qualificationRules: asObject(settings.qualification_rules),
      },
      locations: rawLocations
        .map((item) => {
          const location = asObject(item);
          return {
            id: asString(location.id),
            label: asString(location.label),
            city: asNullableString(location.city),
            state: asNullableString(location.state),
            zip: asNullableString(location.zip_code),
            serviceCities: Array.isArray(location.service_cities)
              ? (location.service_cities as unknown[]).filter(
                  (v): v is string => typeof v === "string",
                )
              : [],
            serviceZips: Array.isArray(location.service_zips)
              ? (location.service_zips as unknown[]).filter(
                  (v): v is string => typeof v === "string",
                )
              : [],
          };
        })
        .filter((location) => location.id && location.label),
    },
    week: rawDays
      .map((item) => {
        const day = asObject(item);
        const rawSlots = Array.isArray(day.slots) ? day.slots : [];
        return {
          day: asString(day.day_name),
          date: asString(day.date),
          closed: day.closed === true,
          booked: asNumber(day.booked),
          openings: asNumber(day.openings),
          slots: rawSlots
            .map((slotValue) => {
              const slot = asObject(slotValue);
              const status = asString(slot.status, "blocked");
              const openings = asNumber(slot.openings);
              return {
                start: asString(slot.start_time),
                end: asString(slot.end_time),
                status,
                capacity: openings,
                bookedCount: status === "available" ? 0 : 1,
              };
            })
            .filter((slot) => slot.start && slot.end),
        };
      })
      .filter((day) => day.date),
  };
}

// --- Nearest-location matching -------------------------------------------
// When a company has more than one active location, pick the one closest to
// the lead being booked so the widget doesn't default to a "Company-wide"
// view with no schedule. Matching uses only data already stored on each
// location (service_cities / service_zips / its own city, state, zip) —
// no geocoding involved.
function normalizeZip(zip: string | null | undefined): string {
  return (zip || "").replace(/\D/g, "").slice(0, 5);
}

function normalizeText(value: string | null | undefined): string {
  return (value || "").trim().toLowerCase();
}

function scoreLocationMatch(
  location: Location,
  lead: { city: string; state: string; zip: string },
): number {
  const leadZip = normalizeZip(lead.zip);
  const leadCity = normalizeText(lead.city);
  const leadState = normalizeText(lead.state);
  const locationState = normalizeText(location.state);
  const sameState = Boolean(leadState) && leadState === locationState;

  const zipCandidates = [
    normalizeZip(location.zip),
    ...location.serviceZips.map(normalizeZip),
  ].filter(Boolean);
  const cityCandidates = [
    normalizeText(location.city),
    ...location.serviceCities.map(normalizeText),
  ].filter(Boolean);

  // Exact ZIP match on this location's own zip or its service area — the
  // strongest signal available.
  if (leadZip && zipCandidates.includes(leadZip)) return 100;

  // Same state and the lead's city is one this location explicitly serves.
  if (sameState && leadCity && cityCandidates.includes(leadCity)) return 80;

  // Same state, no exact city/zip match: fall back to ZIP-prefix proximity
  // as a rough stand-in for "nearest" since locations don't store lat/long.
  if (sameState && leadZip && zipCandidates.length) {
    const leadZipNum = parseInt(leadZip, 10);
    const distances = zipCandidates
      .map((z) => Math.abs(parseInt(z, 10) - leadZipNum))
      .filter((d) => Number.isFinite(d));
    if (distances.length) {
      const minDistance = Math.min(...distances);
      return Math.max(30, 60 - Math.min(minDistance / 50, 30));
    }
  }

  // Same state with nothing else to compare on.
  if (sameState) return 20;

  return 0;
}

function pickNearestLocation(
  locations: Location[],
  lead: { city?: string; state?: string; zip?: string },
): string | null {
  const city = lead.city || "";
  const state = lead.state || "";
  const zip = lead.zip || "";
  if (!city && !state && !zip) return null;
  if (!locations.length) return null;

  let bestId: string | null = null;
  let bestScore = 0;
  for (const location of locations) {
    const score = scoreLocationMatch(location, { city, state, zip });
    if (score > bestScore) {
      bestScore = score;
      bestId = location.id;
    }
  }
  return bestId;
}

interface Reservation {
  id: string;
  reservation_token: string;
  appointment_date: string;
  start_time: string;
  end_time: string;
  location_id: string | null;
  last_action: string;
  undo_deadline: string;
  expires_at: string;
}
interface Confirmation {
  appointment_id: string;
  manage_token: string;
  lead_id: string;
  lead_code: string;
  appointment_date: string;
  start_time: string;
  end_time: string;
  qualification_status: string;
  qualification_reasons: string[];
  qc_status?: string;
  form_mode: "internal" | "external" | "internal_external";
  external_form_provider: string | null;
  external_form_url: string | null;
  external_prefill_map: Record<string, string>;
  form_data: Record<string, unknown>;
}

export function AgentBookingPortal({ slug }: { slug: string }) {
  const sessionId = useMemo(() => getPortalSessionId(), []);
  const [weekStart, setWeekStart] = useState(() => startOfWeek());
  const [locationId, setLocationId] = useState<string | null>(null);
  const [autoSelectedLocation, setAutoSelectedLocation] = useState(false);
  const autoSelectAttempted = useRef(false);
  const [portal, setPortal] = useState<PublicPortalData | null>(null);
  const [expandedDate, setExpandedDate] = useState<string | null>(null);
  const queryPrefill = useMemo(() => readReadyModePrefill(), []);
  const [agentName, setAgentName] = useState(
    () =>
      queryPrefill.agent_name ||
      window.localStorage.getItem("masters-ready-agent-name") ||
      "",
  );
  const [reservation, setReservation] = useState<Reservation | null>(null);
  const [formValues, setFormValues] = useState<Record<string, unknown>>(() => ({
    contract: "No",
    additional_properties: "No",
    ...queryPrefill.values,
  }));
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [rescheduleMode, setRescheduleMode] = useState(false);
  const [undoSeconds, setUndoSeconds] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const startDate = localDate(weekStart);
  const endDate = localDate(addDays(weekStart, 6));
  const selectedServiceArea = useMemo(() => {
    if (!portal?.company.locations.length) return null;
    if (locationId)
      return (
        portal.company.locations.find(
          (location) => location.id === locationId,
        ) || null
      );
    return portal.company.locations.length === 1
      ? portal.company.locations[0]
      : null;
  }, [portal, locationId]);
  const weeklyWeather = useWeeklyWeather({
    city: asString(formValues.city),
    state: asString(formValues.state),
    zip: asString(formValues.zip_code),
    serviceArea: selectedServiceArea?.city || selectedServiceArea?.label,
    serviceAreaState: selectedServiceArea?.state,
    serviceAreaZip: selectedServiceArea?.zip,
  });

  async function loadPortal(nextLocationId = locationId) {
    setLoading(true);
    setError("");
    const [{ data, error: rpcErr }, { data: locationTimezone }] =
      await Promise.all([
        supabase.rpc("get_public_booking_portal_active_locations", {
          p_slug: slug,
          p_location_id: nextLocationId,
          p_start_date: startDate,
          p_end_date: endDate,
        }),
        supabase.rpc("get_public_location_timezone", {
          p_slug: slug,
          p_location_id: nextLocationId,
        }),
      ]);
    if (rpcErr) {
      setError(rpcError(rpcErr));
      setPortal(null);
    } else {
      try {
        const result = normalizePublicPortalData(data);
        if (typeof locationTimezone === "string" && locationTimezone)
          result.company.settings.timezone = locationTimezone;
        setPortal(result);
        if (!nextLocationId && result.company.locations.length === 1) {
          setLocationId(result.company.locations[0].id);
        } else if (
          !nextLocationId &&
          !autoSelectAttempted.current &&
          result.company.locations.length > 1
        ) {
          // More than one service area and nothing picked yet: try to match
          // the lead's address (from the ReadyMode dialer prefill, if any)
          // to the nearest location instead of defaulting to Company-wide.
          autoSelectAttempted.current = true;
          const nearestId = pickNearestLocation(result.company.locations, {
            city: asString(queryPrefill.values.city),
            state: asString(queryPrefill.values.state),
            zip: asString(queryPrefill.values.zip_code),
          });
          if (nearestId) {
            setAutoSelectedLocation(true);
            setLocationId(nearestId);
          }
        }
      } catch (loadError) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : "The booking portal returned invalid data.",
        );
        setPortal(null);
      }
    }
    setLoading(false);
  }

  useEffect(() => {
    void loadPortal();
  }, [slug, startDate, endDate, locationId]); // eslint-disable-line react-hooks/exhaustive-deps -- loadPortal intentionally reloads only for portal scope changes

  useEffect(() => {
    if (!reservation) {
      setUndoSeconds(0);
      return;
    }
    const update = () =>
      setUndoSeconds(
        Math.max(
          0,
          Math.ceil(
            (new Date(reservation.undo_deadline).getTime() - Date.now()) / 1000,
          ),
        ),
      );
    update();
    const timer = window.setInterval(update, 250);
    return () => window.clearInterval(timer);
  }, [reservation]);

  useEffect(() => {
    if (!reservation) return;
    const timer = window.setInterval(
      async () => {
        await supabase.rpc("refresh_public_reservation", {
          p_reservation_token: reservation.reservation_token,
          p_session_id: sessionId,
        });
      },
      4 * 60 * 1000,
    );
    return () => window.clearInterval(timer);
  }, [reservation, sessionId]);

  async function selectSlot(day: DayAvailability, slot: Slot) {
    if (slot.status !== "available" || busy) return;
    if (!agentName.trim()) {
      setError("Enter your agent name before selecting an appointment time.");
      return;
    }
    window.localStorage.setItem("masters-ready-agent-name", agentName.trim());
    setBusy(true);
    setError("");

    if (rescheduleMode && confirmation) {
      const { data, error: rpcErr } = await supabase.rpc(
        "reschedule_public_appointment",
        {
          p_manage_token: confirmation.manage_token,
          p_location_id: locationId,
          p_date: day.date,
          p_start_time: slot.start,
          p_actor_name: agentName.trim(),
        },
      );
      if (rpcErr) setError(rpcError(rpcErr));
      else {
        const moved = data as {
          appointment_date: string;
          start_time: string;
          end_time: string;
          location_id: string | null;
        };
        setConfirmation((prev) =>
          prev
            ? {
                ...prev,
                appointment_date: moved.appointment_date,
                start_time: moved.start_time,
                end_time: moved.end_time,
              }
            : prev,
        );
        setRescheduleMode(false);
        await loadPortal();
      }
      setBusy(false);
      return;
    }

    if (reservation) {
      const { data, error: rpcErr } = await supabase.rpc(
        "move_public_reservation_slot",
        {
          p_reservation_token: reservation.reservation_token,
          p_session_id: sessionId,
          p_location_id: locationId,
          p_date: day.date,
          p_start_time: slot.start,
        },
      );
      if (rpcErr) setError(rpcError(rpcErr));
      else {
        setReservation(data as Reservation);
        setExpandedDate(day.date);
        await loadPortal();
      }
      setBusy(false);
      return;
    }

    const { data, error: rpcErr } = await supabase.rpc(
      "reserve_public_appointment_slot",
      {
        p_slug: slug,
        p_location_id: locationId,
        p_date: day.date,
        p_start_time: slot.start,
        p_session_id: sessionId,
        p_agent_name: agentName.trim(),
      },
    );
    if (rpcErr) setError(rpcError(rpcErr));
    else {
      setReservation(data as Reservation);
      setExpandedDate(day.date);
      await loadPortal();
    }
    setBusy(false);
  }

  async function undoReservation() {
    if (!reservation || undoSeconds <= 0) return;
    setBusy(true);
    setError("");
    const { data, error: rpcErr } = await supabase.rpc(
      "undo_public_reservation_action",
      {
        p_reservation_token: reservation.reservation_token,
        p_session_id: sessionId,
      },
    );
    if (rpcErr) setError(rpcError(rpcErr));
    else {
      const result = data as { status: string } & Partial<Reservation>;
      if (result.status === "released") setReservation(null);
      else setReservation(result as Reservation);
      await loadPortal();
    }
    setBusy(false);
  }

  async function submitAppointment() {
    if (!reservation) return;
    setBusy(true);
    setError("");
    const basePayload = {
      ...formValues,
      appointment_date: reservation.appointment_date,
      appointment_time: reservation.start_time,
    };
    const payload = {
      ...basePayload,
      lead_template: buildLeadTemplate(basePayload),
    };
    const { data, error: rpcErr } = await supabase.rpc(
      "submit_public_appointment",
      {
        p_reservation_token: reservation.reservation_token,
        p_session_id: sessionId,
        p_form_data: payload,
        p_agent_name: agentName.trim(),
      },
    );
    if (rpcErr) setError(rpcError(rpcErr));
    else {
      setConfirmation(data as Confirmation);
      setReservation(null);
      await loadPortal();
    }
    setBusy(false);
  }

  if (loading && !portal)
    return (
      <FullPageMessage
        icon={<Loader2 className="animate-spin" />}
        title="Loading availability..."
      />
    );
  if (!portal)
    return (
      <FullPageMessage
        icon={<AlertTriangle />}
        title="Booking portal unavailable"
        detail={error || "This link may be disabled."}
      />
    );

  const company = portal.company.company;
  const settings = portal.company.settings;
  const weekLabel = `${formatDateShort(startDate)} – ${formatDateShort(endDate)}`;
  const leadTemplate =
    typeof confirmation?.form_data?.lead_template === "string"
      ? confirmation.form_data.lead_template
      : "";

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="readyops-brand-header border-b">
        <div className="mx-auto max-w-5xl px-4 py-4 sm:px-6">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <img
                src={READYOPS_LOGO_DATA_URI}
                alt="ReadyOps"
                className="readyops-brand-logo"
              />
              <div className="border-l border-white/15 pl-4">
                <h1 className="text-xl font-bold text-white">{company.name}</h1>
                {company.state && (
                  <p className="readyops-brand-subtitle text-sm">
                    {company.state}
                  </p>
                )}
              </div>
            </div>
            <div className="rounded-xl border border-blue-400/20 bg-blue-500/10 px-3 py-2 text-right text-xs text-blue-100">
              <span className="font-bold text-white">Live availability</span>
              <br />
              {settings.timezone}
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-5 px-4 py-5 sm:px-6">
        {(settings.requirementsShort || settings.requirementsDetail) && (
          <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
            <h2 className="text-sm font-bold text-amber-900">
              Company Requirements
            </h2>
            {settings.requirementsShort && (
              <p className="mt-2 whitespace-pre-line text-sm font-medium text-amber-900">
                {settings.requirementsShort}
              </p>
            )}
            {settings.requirementsDetail && (
              <p className="mt-2 whitespace-pre-line text-xs text-amber-800">
                {settings.requirementsDetail}
              </p>
            )}
          </section>
        )}

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}
        {Boolean(formValues.recording_url) && (
          <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-xs font-semibold text-blue-800">
            ReadyMode recording attached for QC. The company will not receive
            the audio unless QC explicitly shares it.
          </div>
        )}

        {confirmation && !rescheduleMode && (
          <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
            <div className="flex gap-3">
              <CheckCircle2 className="text-emerald-600" />
              <div className="flex-1">
                <h2 className="font-bold text-emerald-900">
                  Appointment Submitted to QC
                </h2>
                <p className="mt-1 text-sm text-emerald-800">
                  {confirmation.lead_code} •{" "}
                  {formatDateLong(confirmation.appointment_date)} at{" "}
                  {formatTime(confirmation.start_time)}
                </p>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                onClick={() => setRescheduleMode(true)}
                className="rounded-lg bg-white px-3 py-2 text-xs font-bold text-emerald-800 shadow-sm ring-1 ring-emerald-200"
              >
                Reschedule
              </button>
              <span className="rounded-lg bg-amber-100 px-3 py-2 text-xs font-bold text-amber-800">
                Pending QC — company will receive it after approval
              </span>
            </div>
            {leadTemplate && (
              <div className="mt-4 rounded-xl border border-emerald-200 bg-white p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-emerald-700">
                      Lead Template
                    </p>
                    <p className="text-xs text-slate-500">
                      Ready to copy into your CRM, notes, or client system.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void copyText(leadTemplate)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700"
                  >
                    <ClipboardCopy size={14} /> Copy Template
                  </button>
                </div>
                <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-xs leading-5 text-slate-700">
                  {leadTemplate}
                </pre>
              </div>
            )}
          </section>
        )}

        {reservation && (
          <section className="rounded-2xl border border-blue-200 bg-blue-50 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-blue-600">
                  Time Reserved
                </p>
                <p className="mt-1 font-bold text-blue-950">
                  {formatDateLong(reservation.appointment_date)} •{" "}
                  {formatTime(reservation.start_time)}
                </p>
                <p className="mt-1 text-xs text-blue-700">
                  Held while you finish the form. You can change time without
                  creating a duplicate.
                </p>
              </div>
              {undoSeconds > 0 ? (
                <button
                  disabled={busy}
                  onClick={() => void undoReservation()}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-bold text-blue-700 shadow-sm ring-1 ring-blue-200"
                >
                  <Undo2 size={16} /> Undo — {undoSeconds}s
                </button>
              ) : (
                <span className="rounded-lg bg-white px-3 py-2 text-xs font-bold text-blue-700 ring-1 ring-blue-200">
                  Select another open time to Change Time
                </span>
              )}
            </div>
          </section>
        )}

        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600">
                Agent Name
              </label>
              <input
                value={agentName}
                onChange={(e) => setAgentName(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-400"
                placeholder="Your name"
              />
            </div>
            {portal.company.locations.length > 0 && (
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">
                  Service Area
                  {autoSelectedLocation && (
                    <span className="ml-1 font-normal text-emerald-600">
                      • Matched to lead&apos;s address
                    </span>
                  )}
                </label>
                <select
                  value={locationId || ""}
                  onChange={(e) => {
                    setAutoSelectedLocation(false);
                    setLocationId(e.target.value || null);
                  }}
                  className="min-w-52 rounded-xl border border-slate-200 px-3 py-2.5 text-sm"
                >
                  <option value="">Company-wide</option>
                  {portal.company.locations.map((loc) => (
                    <option key={loc.id} value={loc.id}>
                      {loc.label}
                      {loc.state ? `, ${loc.state}` : ""}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </section>

        <section>
          <div className="mb-3 flex items-center justify-between gap-3">
            <button
              onClick={() => setWeekStart(addDays(weekStart, -7))}
              className="rounded-lg border border-slate-200 bg-white p-2 text-slate-600"
            >
              <ArrowLeft size={18} />
            </button>
            <div className="text-center">
              <p className="text-xs font-semibold text-slate-500">
                {rescheduleMode
                  ? "Choose a new appointment time"
                  : reservation
                    ? "Change Time / Weekly Availability"
                    : "Weekly Availability"}
              </p>
              <h2 className="font-bold">{weekLabel}</h2>
              {weeklyWeather.locationLabel && (
                <p className="mt-0.5 text-[10px] font-semibold text-sky-600">
                  Forecast: {weeklyWeather.locationLabel}
                </p>
              )}
            </div>
            <button
              onClick={() => setWeekStart(addDays(weekStart, 7))}
              className="rounded-lg border border-slate-200 bg-white p-2 text-slate-600"
            >
              <ArrowRight size={18} />
            </button>
          </div>

          <div className="space-y-2">
            {portal.week.map((day) => {
              const expanded = expandedDate === day.date;
              const isFull = !day.closed && day.openings <= 0;
              return (
                <div
                  key={day.date}
                  className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
                >
                  <button
                    onClick={() => setExpandedDate(expanded ? null : day.date)}
                    className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-4 text-left sm:grid-cols-[1fr_minmax(190px,250px)_auto]"
                  >
                    <div className="flex items-center gap-3">
                      <div className="rounded-xl bg-slate-100 p-2">
                        <CalendarDays size={18} className="text-slate-600" />
                      </div>
                      <div>
                        <p className="font-bold">{day.day}</p>
                        <p className="text-xs text-slate-500">
                          {formatDateShort(day.date)}
                        </p>
                      </div>
                    </div>
                    <div className="col-span-2 row-start-2 rounded-xl bg-sky-50/70 px-3 py-2 sm:col-span-1 sm:col-start-2 sm:row-start-1 sm:bg-transparent sm:p-0">
                      <AgentWeatherPreview
                        weather={weeklyWeather.daily[day.date]}
                        loading={weeklyWeather.loading}
                        hasLocation={weeklyWeather.hasLocation}
                      />
                    </div>
                    <div className="text-right">
                      {day.closed ? (
                        <span className="text-xs font-bold text-slate-400">
                          CLOSED
                        </span>
                      ) : isFull ? (
                        <span className="text-xs font-bold text-red-600">
                          FULL
                        </span>
                      ) : (
                        <>
                          <p className="text-sm font-bold text-emerald-600">
                            {day.openings} Opening
                            {day.openings === 1 ? "" : "s"}
                          </p>
                          <p className="text-[11px] text-slate-400">
                            {day.booked} booked
                          </p>
                        </>
                      )}
                    </div>
                  </button>
                  {expanded && !day.closed && (
                    <div className="border-t border-slate-100 bg-slate-50 p-3">
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
                        {day.slots.map((slot) => (
                          <button
                            key={`${day.date}-${slot.start}`}
                            disabled={
                              slot.status !== "available" ||
                              busy ||
                              (!settings.allowPublicBooking && !rescheduleMode)
                            }
                            onClick={() => void selectSlot(day, slot)}
                            className={`rounded-xl border px-3 py-3 text-sm font-bold transition ${slot.status === "available" ? "border-emerald-200 bg-white text-emerald-700 hover:bg-emerald-50" : "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400"}`}
                          >
                            <Clock3 size={14} className="mx-auto mb-1" />
                            {formatTime(slot.start)}
                            <span className="mt-1 block text-[10px] uppercase">
                              {slot.status === "available"
                                ? "Available"
                                : slot.status}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {weeklyWeather.error && (
            <p className="mt-2 text-center text-[10px] font-semibold text-slate-400">
              {weeklyWeather.error}
            </p>
          )}
        </section>

        {reservation && !confirmation && (
          <section>
            <div className="mb-3">
              <h2 className="text-lg font-bold">Appointment Information</h2>
              <p className="text-sm text-slate-500">
                Complete the lead details. Your selected time is being held.
              </p>
            </div>
            <DynamicLeadForm
              schema={settings.formSchema || []}
              values={formValues}
              disabled={busy}
              onChange={(key, value) =>
                setFormValues((prev) => ({ ...prev, [key]: value }))
              }
              onSubmit={() => void submitAppointment()}
              submitLabel={busy ? "Saving..." : "Confirm Appointment"}
            />
          </section>
        )}
      </main>
    </div>
  );
}

function FullPageMessage({
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
        <h1 className="font-bold text-slate-900">{title}</h1>
        {detail && <p className="mt-2 text-sm text-slate-500">{detail}</p>}
      </div>
    </div>
  );
}

function readReadyModePrefill(): {
  agent_name: string;
  values: Record<string, unknown>;
} {
  const q = new URLSearchParams(window.location.search);
  const get = (...keys: string[]) => {
    for (const key of keys) {
      const value = q.get(key);
      if (value) return value;
    }
    return "";
  };
  const first = get("first_name", "firstName");
  const last = get("last_name", "lastName");
  const fullName =
    get("full_name", "name") || [first, last].filter(Boolean).join(" ");
  const street = get("address", "street");
  const city = get("city");
  const state = get("state");
  const zip = get("zip", "zip_code");
  const fullAddress =
    get("full_address") ||
    [street, city, state, zip].filter(Boolean).join(", ");
  const values: Record<string, unknown> = {
    full_name: fullName,
    phone_number: get("phone", "phone_number"),
    address: fullAddress,
    city,
    state,
    zip_code: zip,
    email: get("email"),
    language: get("language"),
    service_needed: get("service_needed", "services_needed"),
    last_checked_on: get("last_checked_on"),
    home_type: get("home_type"),
    roof_type: get("roof_type"),
    roof_age: get("roof_age"),
    stories: get("stories"),
    insurance: get("insurance"),
    insurance_name: get("insurance_name"),
    contract: get("contract") || "No",
    home_value: get("home_value"),
    sq_ft: get("sq_ft"),
    web_url: get("web_url", "web_link"),
    notes: get("notes"),
    hail_size: get("hail_size", "size_of_hail"),
    claim_filed: get("claim_filed", "file_claim"),
    visible_damage: get("visible_damage"),
    damage_type: get("damage_type"),
    additional_properties:
      get("additional_properties", "add_properties") || "No",
    second_address: get("second_address", "2nd_address"),
    recording_url: get(
      "recording_url",
      "recording",
      "recording_link",
      "audio_url",
      "call_recording",
    ),
    readymode_call_log_id: get(
      "rm_call_log_id",
      "readymode_call_log_id",
      "call_log_id",
    ),
    agent_token: get("agent_token"),
    _source:
      get("source") ||
      (get("rm_lead_id", "readymode_lead_id") ? "readymode" : "ready_ops"),
    _source_lead_id: get("rm_lead_id", "readymode_lead_id", "lead_id"),
    _source_disposition: get("disposition"),
  };
  Object.keys(values).forEach((key) => {
    if (values[key] === "") delete values[key];
  });
  return { agent_name: get("agent", "agent_name", "user_name"), values };
}
