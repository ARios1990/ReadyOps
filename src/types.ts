export interface Team {
  id: string;
  name: string;
  abbreviation: string;
}

export interface Company {
  id: string;
  name: string;
  state: string | null;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  account_status: string;
  team_id: string | null;
  metro_tag: string | null;
  website: string | null;
  client_id: string | null;
  requirements_note: string | null;
  notes: string | null;
}

export interface CompanyLocation {
  id: string;
  company_id: string;
  location_label: string;
  state: string | null;
  metro_tag: string | null;
  sort_order: number;
}

export interface CompanyTeam {
  id: string;
  company_id: string;
  team_id: string;
}

export interface Agent {
  id: string;
  name: string;
  team_id: string;
}

export interface Profile {
  id: string;
  role: 'admin' | 'agent';
  agent_id: string | null;
  display_name: string;
}

export interface CompanyBooking {
  id: string;
  company_id: string;
  location_id: string | null;
  day: string;
  time_slot: string;
  booked_by: string | null;
  created_at: string;
}

export interface ScheduleRow {
  id: string;
  companyId: string;
  companyName: string;
  locationId: string | null;
  locationLabel: string | null;
  state: string | null;
  teamId: string | null;
}

export const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;
export type Day = (typeof DAYS)[number];

export const TIME_SLOTS = ['8', '9', '10', '11', '12', '1', '2', '3', '4', '5', '6', '7'] as const;

export function formatTimeAmPm(slot: string): string {
  const n = Number(slot);
  if (n >= 8 && n <= 11) return `${slot} AM`;
  if (n === 12) return '12 PM';
  return `${slot} PM`;
}

export function getRowDisplayLabel(row: ScheduleRow): string {
  if (row.locationLabel) {
    return `${row.companyName} - ${row.locationLabel}`;
  }
  if (row.state) {
    return `${row.companyName} - ${row.state}`;
  }
  return row.companyName;
}

export const ACCOUNT_STATUSES = ['Active', 'Pause', 'Prospect', 'Hidden', 'No Longer Working'] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];
