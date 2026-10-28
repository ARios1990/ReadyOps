import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Settings, X } from "lucide-react";
import { supabase } from "./supabase";
import { addDays, formatTime, localDate } from "./portalUtils";
import {
  invalidateAvailability,
  slotLabel,
  useScheduleAvailability,
  type AvailabilitySlot,
} from "./scheduleAvailability";
import type { CompanyLocation } from "./types";
type Props = {
  companyId: string;
  locations: CompanyLocation[];
  date: string;
  teams?: string;
  canManage?: boolean;
  accessToken?: string | null;
  onEdit?: (id: string | null) => void;
  onDateChange?: (date: string) => void;
};
export function AvailabilityGrid(props: Props) {
  const [ownDate, setOwnDate] = useState(props.date);
  useEffect(() => setOwnDate(props.date), [props.date]);
  const date = props.onDateChange ? props.date : ownDate;
  const change = (next: string) =>
    props.onDateChange ? props.onDateChange(next) : setOwnDate(next);
  const locations: Array<CompanyLocation | null> = props.locations.length
    ? props.locations
    : [null];
  return (
    <section
      className="overflow-hidden rounded-xl border border-slate-200 bg-white"
      aria-label="Appointment availability"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b p-3">
        <div>
          <h3 className="text-sm font-bold">Appointment Availability</h3>
          <p className="text-xs text-slate-500">
            Shared capacity across {props.teams || "All Teams"}. Times are local
            to each location.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            aria-label="Previous availability date"
            onClick={() =>
              change(localDate(addDays(new Date(`${date}T12:00:00`), -1)))
            }
            className="rounded border p-2"
          >
            <ChevronLeft size={14} />
          </button>
          <input
            aria-label="Availability date"
            type="date"
            value={date}
            onChange={(e) => change(e.target.value)}
            className="rounded border p-2 text-xs"
          />
          <button
            aria-label="Next availability date"
            onClick={() =>
              change(localDate(addDays(new Date(`${date}T12:00:00`), 1)))
            }
            className="rounded border p-2"
          >
            <ChevronRight size={14} />
          </button>
        </div>
      </div>
      {locations.map((location) => (
        <LocationAvailability
          key={location?.id || "company"}
          {...props}
          date={date}
          location={location}
        />
      ))}
    </section>
  );
}
function LocationAvailability({
  companyId,
  location,
  date,
  canManage = false,
  accessToken = null,
  onEdit,
}: Props & { location: CompanyLocation | null }) {
  const { day, error, loading, refresh } = useScheduleAvailability(
    companyId,
    location?.id || null,
    date,
    accessToken,
  );
  const [selected, setSelected] = useState<string[]>([]),
    [multi, setMulti] = useState(false),
    [active, setActive] = useState<AvailabilitySlot | null>(null);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [capacity, setCapacity] = useState("1");
  const [bookings, setBookings] = useState<Array<{
    id: string;
    name: string;
    status: string;
    time: string;
  }> | null>(null);
  const slots = day?.slots || [];
  useEffect(() => {
    setActive(null);
    setSelected([]);
    setBookings(null);
    setMessage("");
  }, [companyId, location?.id, date]);
  async function action(kind: string, whole = false) {
    const chosen = multi
      ? slots.filter((s) => selected.includes(s.start_time))
      : active
        ? [active]
        : [];
    if (!whole && !chosen.length) {
      setMessage("Select at least one slot.");
      return;
    }
    if (
      (whole || chosen.length > 1 || chosen.some((s) => s.booked > 0)) &&
      !window.confirm(
        `${kind === "block" ? "Block" : kind === "unblock" ? "Reopen" : "Change capacity for"} ${whole ? "this entire day" : `${chosen.length} slot(s)`}? Existing bookings stay scheduled. Company-wide closures and working hours still apply.`,
      )
    )
      return;
    setBusy(true);
    setMessage("");
    const { error: err } = await supabase.rpc("manage_schedule_slots", {
      p_company_id: companyId,
      p_location_id: location?.id || null,
      p_date: date,
      p_action: kind,
      p_slots: whole
        ? []
        : chosen.map((s) => ({
            start_time: s.start_time,
            end_time: s.end_time,
          })),
      p_capacity: kind === "capacity" ? Number(capacity) : null,
      p_note: "Availability grid",
      p_access_token: accessToken,
    });
    setBusy(false);
    if (err) {
      setMessage(err.message);
      return;
    }
    invalidateAvailability();
    await refresh();
    setSelected([]);
    setActive(null);
    setBookings(null);
    setMessage("Availability saved. Existing bookings retained.");
  }
  async function viewBookings(slot: AvailabilitySlot) {
    const { data, error: err } = await supabase.rpc(
      "get_schedule_slot_bookings",
      {
        p_company_id: companyId,
        p_location_id: location?.id || null,
        p_date: date,
        p_start: slot.start_time,
        p_access_token: accessToken,
      },
    );
    if (err) setMessage(err.message);
    else setBookings(data as typeof bookings);
  }
  return (
    <div className="border-b last:border-b-0" key={`${location?.id}-${date}`}>
      <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-50 px-3 py-2">
        <div className="text-xs">
          <strong>{location?.location_label || "Company-wide"}</strong>
          <span className="ml-2 text-slate-500">
            {day?.timezone || location?.timezone || "Loading timezone…"}
          </span>
          {day && (
            <p>
              {day.openings} remaining · {day.booked} booked · {day.reserved}{" "}
              held · {day.capacity} daily capacity
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          {canManage && (
            <>
              <button
                className="rounded border bg-white px-2 py-1"
                onClick={() => {
                  setMulti(!multi);
                  setSelected([]);
                  setActive(null);
                }}
              >
                {multi ? "Finish selecting" : "Select slots"}
              </button>
              <button
                disabled={busy || loading}
                className="rounded border bg-white px-2 py-1"
                onClick={() => void action("block", true)}
              >
                Block Day
              </button>
              <button
                disabled={busy || loading}
                className="rounded border bg-white px-2 py-1"
                onClick={() => void action("unblock", true)}
              >
                Reopen Day
              </button>
            </>
          )}
          {onEdit && (
            <button
              className="inline-flex items-center gap-1 rounded border bg-white px-2 py-1"
              onClick={() => onEdit(location?.id || null)}
            >
              <Settings size={12} />
              Edit Schedule
            </button>
          )}
        </div>
      </div>
      {loading ? (
        <p className="p-3 text-xs text-slate-500">Loading availability…</p>
      ) : error ? (
        <p role="alert" className="p-3 text-xs text-red-700">
          {error}
        </p>
      ) : slots.length === 0 ? (
        <p className="p-3 text-xs text-slate-500">
          Closed — no appointment intervals on this day.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr>
                {slots.map((s) => (
                  <th
                    key={s.start_time}
                    className="min-w-24 px-1 pt-2 font-medium"
                  >
                    {formatTime(s.start_time)}
                    <span className="block text-[10px] text-slate-400">
                      to {formatTime(s.end_time)}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                {slots.map((slot) => (
                  <td key={slot.start_time} className="p-1 pb-2">
                    <button
                      disabled={busy}
                      aria-pressed={
                        multi ? selected.includes(slot.start_time) : undefined
                      }
                      aria-label={`${location?.location_label || "Company-wide"}, ${formatTime(slot.start_time)}, ${slotLabel(slot)}`}
                      onClick={() => {
                        if (multi)
                          setSelected((ids) =>
                            ids.includes(slot.start_time)
                              ? ids.filter((id) => id !== slot.start_time)
                              : [...ids, slot.start_time],
                          );
                        else {
                          setActive(slot);
                          setBookings(null);
                          setCapacity(String(slot.capacity));
                        }
                      }}
                      className={`w-full rounded-md border px-2 py-2 text-xs font-bold focus-visible:ring-2 focus-visible:ring-blue-500 ${selected.includes(slot.start_time) ? "ring-2 ring-blue-500 " : ""}${slot.status === "available" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : slot.status === "full" || slot.status === "blocked" ? "border-red-200 bg-red-50 text-red-700" : "border-slate-200 bg-slate-100 text-slate-500"}`}
                    >
                      {slotLabel(slot)}
                      <span className="block text-[10px] font-normal">
                        {slot.booked} booked / held
                      </span>
                    </button>
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      )}
      {(active || (multi && selected.length > 0)) && (
        <div
          className="m-3 rounded-lg border border-blue-200 bg-blue-50 p-3"
          aria-label="Slot actions"
        >
          <div className="flex justify-between">
            <strong className="text-xs">
              {multi
                ? `${selected.length} slots selected`
                : `${formatTime(active!.start_time)}–${formatTime(active!.end_time)}`}
            </strong>
            <button
              aria-label="Close slot actions"
              onClick={() => {
                setActive(null);
                setSelected([]);
              }}
            >
              <X size={14} />
            </button>
          </div>
          {canManage && (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
              <button
                disabled={busy}
                onClick={() => void action("block")}
                className="rounded border bg-white px-2 py-1"
              >
                Block
              </button>
              <button
                disabled={busy}
                onClick={() => void action("unblock")}
                className="rounded border bg-white px-2 py-1"
              >
                Unblock
              </button>
              {active && (
                <button
                  onClick={() => void viewBookings(active)}
                  className="rounded border bg-white px-2 py-1"
                >
                  View Bookings
                </button>
              )}
              <label>
                Temporary slot capacity{" "}
                <input
                  aria-label="Temporary slot capacity"
                  type="number"
                  min="0"
                  max={active?.capacity || 50}
                  value={capacity}
                  onChange={(e) => setCapacity(e.target.value)}
                  className="w-14 rounded border p-1"
                />
              </label>
              <button
                disabled={busy}
                onClick={() => void action("capacity")}
                className="rounded border bg-white px-2 py-1"
              >
                Adjust Capacity
              </button>
              <button
                disabled={busy}
                onClick={() => void action("reset_capacity")}
                className="rounded border bg-white px-2 py-1"
              >
                Reset Capacity
              </button>
              <p className="w-full text-slate-600">
                Temporary capacity can reduce the regular slot limit. Hourly and
                daily limits remain in effect. Existing appointments are
                retained.
              </p>
            </div>
          )}
          {!canManage && (
            <p className="mt-2 text-xs">
              {active && slotLabel(active)}. Use the company booking form to
              reserve an available appointment.
            </p>
          )}
          {bookings && (
            <ul className="mt-2 text-xs">
              {bookings.length ? (
                bookings.map((b) => (
                  <li key={b.id}>
                    {b.name || "Appointment"} · {b.status}
                  </li>
                ))
              ) : (
                <li>
                  No active bookings. Active holds may still use capacity.
                </li>
              )}
            </ul>
          )}
        </div>
      )}
      {message && (
        <p role="status" className="px-3 pb-3 text-xs text-slate-700">
          {message}
        </p>
      )}
    </div>
  );
}
