import { useEffect, useRef, useState } from "react";
import { supabase } from "./supabase";
export type AvailabilitySlot = {
  start_time: string;
  end_time: string;
  status: "available" | "full" | "blocked" | "closed" | "past";
  openings: number;
  capacity: number;
  booked: number;
  starts_at: string;
};
export type AvailabilityDay = {
  date: string;
  timezone: string;
  closed: boolean;
  openings: number;
  booked: number;
  reserved: number;
  capacity: number;
  slots: AvailabilitySlot[];
};
const eventName = "readyops:availability-changed";
let consumers = 0;
let realtime: ReturnType<typeof supabase.channel> | null = null;
export function invalidateAvailability() {
  window.dispatchEvent(new Event(eventName));
}
// Polling also covers anonymous client links, reconnects, expired holds, and
// installations where a scheduling table is not in the Realtime publication.
export function useAvailabilityRefresh(refresh: () => void, enabled = true) {
  const latest = useRef(refresh);
  latest.current = refresh;
  useEffect(() => {
    if (!enabled) return;
    if (consumers++ === 0) {
      realtime = supabase.channel("availability-invalidation");
      for (const table of [
        "company_schedule_rules",
        "company_schedule_exceptions",
        "company_locations",
        "company_bookings",
        "portal_appointments",
        "appointment_reservations",
        "qc_review_cycles",
      ]) {
        realtime.on(
          "postgres_changes",
          { event: "*", schema: "public", table },
          invalidateAvailability,
        );
      }
      realtime.subscribe();
    }
    let running = false;
    const run = () => {
      if (document.visibilityState === "hidden" || running) return;
      running = true;
      Promise.resolve(latest.current()).finally(() => {
        running = false;
      });
    };
    const timer = window.setInterval(run, 15000);
    window.addEventListener(eventName, run);
    window.addEventListener("focus", run);
    document.addEventListener("visibilitychange", run);
    return () => {
      clearInterval(timer);
      window.removeEventListener(eventName, run);
      window.removeEventListener("focus", run);
      document.removeEventListener("visibilitychange", run);
      if (--consumers === 0 && realtime) {
        void supabase.removeChannel(realtime);
        realtime = null;
      }
    };
  }, [enabled]);
}
export function useScheduleAvailability(
  companyId: string,
  locationId: string | null,
  date: string,
  accessToken: string | null = null,
) {
  const [day, setDay] = useState<AvailabilityDay | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  const generation = useRef(0);
  async function refresh() {
    if (!companyId || !date) return;
    const request = ++generation.current;
    const { data, error: err } = await supabase.rpc(
      "get_schedule_availability",
      {
        p_company_id: companyId,
        p_location_id: locationId,
        p_date: date,
        p_access_token: accessToken,
      },
    );
    if (request !== generation.current) return;
    setError(err?.message || "");
    setDay(err ? null : (data as AvailabilityDay));
    setLoading(false);
  }
  useEffect(() => {
    setDay(null);
    setLoading(true);
    void refresh();
    return () => {
      generation.current++;
    };
  }, [companyId, locationId, date, accessToken]); // eslint-disable-line react-hooks/exhaustive-deps
  useAvailabilityRefresh(refresh, Boolean(companyId && date));
  return { day, error, loading, refresh };
}
export function slotLabel(slot: AvailabilitySlot) {
  return slot.status === "available"
    ? `Available · ${slot.openings} left`
    : slot.status === "full"
      ? "Full"
      : slot.status === "blocked"
        ? "Blocked"
        : "Closed";
}
