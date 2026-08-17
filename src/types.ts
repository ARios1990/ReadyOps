export interface Team { id:string; name:string; abbreviation:string; }
export interface Company { id:string; name:string; state:string|null; contact_name:string|null; phone:string|null; email:string|null; account_status:string; team_id:string|null; metro_tag:string|null; website:string|null; client_id:string|null; requirements_note:string|null; notes:string|null; }
export interface CompanyLocation { id:string; company_id:string; location_label:string; state:string|null; metro_tag:string|null; sort_order:number; office_name?:string|null; address?:string|null; city?:string|null; zip_code?:string|null; service_cities?:string[]|null; service_zips?:string[]|null; phone?:string|null; email?:string|null; manager_name?:string|null; timezone?:string|null; available_days?:string[]|null; start_time?:string|null; end_time?:string|null; slot_interval_minutes?:number|null; max_per_hour?:number|null; max_per_day?:number|null; notes?:string|null; active?:boolean; created_at?:string|null; updated_at?:string|null; }
export interface CompanyTeam { id:string; company_id:string; team_id:string; }
export interface CompanyLocationAgent { id:string; location_id:string; agent_id:string; created_at?:string; }
export interface Agent { id:string; name:string; team_id:string; email?:string|null; portal_slug?:string|null; access_token?:string|null; active?:boolean; }
export interface Profile { id:string; role:'admin'|'agent'|'qc'|'manager'; agent_id:string|null; team_id?:string|null; display_name:string; email?:string|null; }
export interface CompanyBooking { id:string; company_id:string; location_id:string|null; day:string; time_slot:string; booked_by:string|null; created_at:string; }
export interface PortalAppointment { id:string; company_id:string; location_id:string|null; appointment_date:string; start_time:string; status:string; }
export interface CompanyScheduleException { id:string; company_id:string; location_id:string|null; exception_date:string; is_closed:boolean; start_time:string|null; end_time:string|null; note?:string|null; }
export interface ScheduleRow { id:string; companyId:string; companyName:string; locationId:string|null; locationLabel:string|null; state:string|null; teamId:string|null; assignedAgentIds:string[]; }
export const DAYS=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'] as const;
export type Day=(typeof DAYS)[number];
export const TIME_SLOTS=['8','9','10','11','12','1','2','3','4','5','6','7'] as const;
export function formatTimeAmPm(slot:string):string{const n=Number(slot);if(n>=8&&n<=11)return `${slot} AM`;if(n===12)return '12 PM';return `${slot} PM`;}
export function getRowDisplayLabel(row:ScheduleRow):string{if(row.locationLabel)return `${row.companyName} - ${row.locationLabel}`;if(row.state)return `${row.companyName} - ${row.state}`;return row.companyName;}
export const ACCOUNT_STATUSES=['Active','Pause','Prospect','Hidden','No Longer Working'] as const;
export type AccountStatus=(typeof ACCOUNT_STATUSES)[number];
