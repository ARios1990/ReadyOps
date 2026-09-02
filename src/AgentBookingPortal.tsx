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
import { ColdCallScript } from "./ColdCallScript";
import { normalizeLeadType, type LeadType } from "./leadTypes";
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