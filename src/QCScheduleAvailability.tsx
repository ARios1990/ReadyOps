import { useScheduleAvailability, slotLabel } from "./scheduleAvailability";
import { formatTime } from "./portalUtils";
export function QCScheduleAvailability({
  companyId,
  locationId,
  date,
  onSelect,
}: {
  companyId: string;
  locationId: string;
  date: string;
  onSelect: (time: string) => void;
}) {
  const { day, error, loading } = useScheduleAvailability(
    companyId,
    locationId || null,
    date,
  );
  return (
    <div
      className="mt-2 rounded-lg border bg-slate-50 p-2 text-xs"
      aria-label="QC appointment availability"
    >
      {loading ? (
        "Loading current availability…"
      ) : error ? (
        <p role="alert">{error}</p>
      ) : (
        <>
          <p className="font-bold">
            {day?.timezone} · {day?.openings || 0} remaining
          </p>
          <div className="mt-2 flex flex-wrap gap-1">
            {day?.slots.map((slot) => (
              <button
                key={slot.start_time}
                type="button"
                disabled={slot.status !== "available"}
                onClick={() => onSelect(slot.start_time)}
                title={slotLabel(slot)}
                className="rounded border bg-white px-2 py-1 disabled:bg-slate-100 disabled:text-slate-400"
              >
                {formatTime(slot.start_time)} · {slotLabel(slot)}
              </button>
            ))}
            {!day?.slots.length && <p>Closed on this day.</p>}
          </div>
          <p className="mt-1 text-slate-500">
            Current holds and all teams share capacity. Saving rechecks
            availability atomically; the appointment’s own slot is excluded
            during a move.
          </p>
        </>
      )}
    </div>
  );
}
