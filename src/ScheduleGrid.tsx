import { AvailabilityGrid } from "./AvailabilityGrid";
import {
  ScheduleRow,
  Team,
  Company,
  CompanyLocation,
  ACCOUNT_STATUSES,
} from "./types";
interface ScheduleGridProps {
  rows: ScheduleRow[];
  companies: Company[];
  locations: CompanyLocation[];
  isBooked: (
    companyId: string,
    locationId: string | null,
    day: string,
    timeSlot: string,
  ) => boolean;
  isCompanyWideBooked: (
    companyId: string,
    day: string,
    timeSlot: string,
  ) => boolean;
  isScheduleExceptionBlocked: (
    companyId: string,
    locationId: string | null,
    day: string,
    timeSlot: string,
  ) => boolean;
  isPortalBooked: (
    companyId: string,
    locationId: string | null,
    day: string,
    timeSlot: string,
  ) => boolean;
  getCompanyTeams: (companyId: string) => Team[];
  onToggle: (
    companyId: string,
    locationId: string | null,
    day: string,
    timeSlot: string,
  ) => void;
  onStatusChange: (companyId: string, status: string) => void;
  canEdit: (companyId: string) => boolean;
  isAdmin: boolean;
  activeDay: string;
  appointmentDate: string;
}

export function ScheduleGrid({
  rows,
  companies,
  locations,
  getCompanyTeams,
  onStatusChange,
  isAdmin,
  appointmentDate,
}: ScheduleGridProps) {
  const ids = [...new Set(rows.map((row) => row.companyId))];
  if (!ids.length)
    return (
      <p className="p-6 text-center text-sm text-slate-500">
        No companies found for this selection.
      </p>
    );
  return (
    <div className="space-y-3">
      {ids.map((id) => {
        const company = companies.find((c) => c.id === id);
        const scoped = locations.filter(
          (l) => l.company_id === id && rows.some((r) => r.locationId === l.id),
        );
        return (
          <section key={id}>
            <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-50 px-3 py-2 text-sm">
              <strong>{company?.name}</strong>
              {isAdmin && (
                <select
                  aria-label={`${company?.name} account status`}
                  value={company?.account_status || "Active"}
                  onChange={(e) => onStatusChange(id, e.target.value)}
                  className="rounded border p-1 text-xs"
                >
                  {ACCOUNT_STATUSES.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              )}
            </div>
            <AvailabilityGrid
              companyId={id}
              locations={scoped}
              date={appointmentDate}
              teams={
                getCompanyTeams(id)
                  .map((t) => t.name)
                  .join(", ") || "All Teams"
              }
              canManage={isAdmin}
            />
          </section>
        );
      })}
    </div>
  );
}
