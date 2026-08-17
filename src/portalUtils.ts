export type JsonMap = Record<string, unknown>;

export function rpcError(error: unknown): string {
  if (!error) return 'Something went wrong.';
  if (typeof error === 'string') return error;
  if (typeof error === 'object' && error && 'message' in error) {
    return String((error as { message?: unknown }).message || 'Something went wrong.');
  }
  return 'Something went wrong.';
}

export function localDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function addDays(date: Date, days: number): Date {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

/** Returns the Monday of the normal calendar week without weekend rollover. */
export function calendarWeekStart(date = new Date()): Date {
  const copy = new Date(date);
  const day = copy.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  copy.setDate(copy.getDate() + diff);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

/**
 * Returns the Monday used for live scheduling.
 * Monday-Friday stay on the current week. Saturday and Sunday roll forward
 * to the following Monday so agents are never opened on an expired weekend week.
 */
export function startOfWeek(date = new Date()): Date {
  const copy = new Date(date);
  const day = copy.getDay();
  const diff = day === 6 ? 2 : day === 0 ? 1 : 1 - day;
  copy.setDate(copy.getDate() + diff);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

/** Uses the same weekend-forward week as the admin Time Slots board. */
export function scheduleWeekStart(date = new Date()): Date {
  return startOfWeek(date);
}

export function formatDateLong(value: string): string {
  const date = new Date(`${value}T12:00:00`);
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'long', month: 'short', day: 'numeric', year: 'numeric',
  }).format(date);
}

export function formatDateShort(value: string): string {
  const date = new Date(`${value}T12:00:00`);
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date);
}

export function formatTime(value: string): string {
  const [hourText, minuteText = '00'] = value.split(':');
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const suffix = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${String(minute).padStart(2, '0')} ${suffix}`;
}

export function getPortalSessionId(): string {
  const key = 'masters-ready-portal-session';
  const existing = window.localStorage.getItem(key);
  if (existing) return existing;
  const created = crypto.randomUUID();
  window.localStorage.setItem(key, created);
  return created;
}

export function shouldShowField(
  showWhen: { field?: string; equals?: unknown } | undefined,
  values: Record<string, unknown>,
): boolean {
  if (!showWhen?.field) return true;
  return values[showWhen.field] === showWhen.equals;
}

export function buildExternalFormUrl(
  baseUrl: string,
  mapping: Record<string, string>,
  values: Record<string, unknown>,
  extras: Record<string, unknown>,
): string {
  const url = new URL(baseUrl);
  const source = { ...values, ...extras };
  Object.entries(mapping || {}).forEach(([internalKey, externalKey]) => {
    const value = source[internalKey];
    if (!externalKey || value === undefined || value === null || value === '') return;
    url.searchParams.set(externalKey, Array.isArray(value) ? value.join(', ') : String(value));
  });
  return url.toString();
}

const READYMODE_PREFILL_QUERY = [
  'agent=(User.Name)',
  'first_name=(Profile.First Name)',
  'last_name=(Profile.Last Name)',
  'phone=(Profile.Phone Number)',
  'address=(Profile.Address)',
  'city=(Profile.City)',
  'state=(Profile.State)',
  'zip=(Profile.Zip Code)',
  'email=(Profile.Email)',
  'language=(Profile.Language)',
  'services_needed=(Profile.Services Needed)',
  'last_checked=(Profile.Last Checked On)',
  'home_type=(Profile.Home Type)',
  'roof_type=(Profile.Roof Type)',
  'roof_age=(Profile.Roof Age)',
  'stories=(Profile.Stories)',
  'insurance=(Profile.Insurance)',
  'insurance_name=(Profile.Insurance Name)',
  'contract=(Profile.Contract)',
  'home_value=(Profile.Home Value)',
  'sq_ft=(Profile.SQ FT)',
  'web_url=(Profile.Web Url)',
  'notes=(Profile.Notes)',
  'hail_size=(Profile.Size of Hail)',
  'claim_filed=(Profile.File Claim)',
  'visible_damage=(Profile.Visible Damage)',
  'damage_type=(Profile.Damage Type)',
  'additional_properties=(Profile.Add. Properties)',
  'second_address=(Profile.2nd Address)',
].join('&');

/** Builds the exact ReadyMode popup URL for a Ready Ops company booking page. */
export function buildReadyModeBookingLink(baseUrl: string): string {
  const cleanBase = baseUrl.replace(/\?+$/, '');
  return `${cleanBase}?${READYMODE_PREFILL_QUERY}`;
}

export async function copyText(value: string): Promise<void> {
  await navigator.clipboard.writeText(value);
}

function leadTemplateValue(values: Record<string, unknown>, key: string): string {
  const value = values[key];
  if (Array.isArray(value)) return value.map(String).filter(Boolean).join(', ');
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

/** Builds the standardized Ready Ops roofing lead template stored with each submitted appointment. */
export function buildLeadTemplate(values: Record<string, unknown>): string {
  const appointmentDate = leadTemplateValue(values, 'appointment_date');
  const appointmentTime = leadTemplateValue(values, 'appointment_time');
  const appointmentDateTime = [
    appointmentDate ? formatDateLong(appointmentDate) : '',
    appointmentTime ? formatTime(appointmentTime) : '',
  ].filter(Boolean).join(' at ');

  return [
    '**Customer Information**',
    'App Date & Time: ' + appointmentDateTime,
    'Name: ' + leadTemplateValue(values, 'full_name'),
    'Phone: ' + leadTemplateValue(values, 'phone_number'),
    'Address: ' + leadTemplateValue(values, 'address'),
    'Email: ' + leadTemplateValue(values, 'email').toLowerCase(),
    'Language: ' + leadTemplateValue(values, 'language'),
    'Services Need: ' + leadTemplateValue(values, 'service_needed'),
    '',
    '**Property Details**',
    'Roof Age: ' + leadTemplateValue(values, 'roof_age'),
    'Home Type: ' + leadTemplateValue(values, 'home_type'),
    'Roof Type: ' + leadTemplateValue(values, 'roof_type'),
    'Stories: ' + leadTemplateValue(values, 'stories'),
    'Insurance: ' + leadTemplateValue(values, 'insurance'),
    'Insurance Name: ' + leadTemplateValue(values, 'insurance_name'),
    'Contract: ' + (leadTemplateValue(values, 'contract') || 'No'),
    'Home Value: ' + leadTemplateValue(values, 'home_value'),
    'SQ FT: ' + leadTemplateValue(values, 'sq_ft'),
    'Web Link: ' + leadTemplateValue(values, 'web_url'),
    '',
    '**Additional Information**',
    'Notes: ' + leadTemplateValue(values, 'notes'),
    'Last Checked On: ' + leadTemplateValue(values, 'last_checked_on'),
    'Size of Hail: ' + leadTemplateValue(values, 'hail_size'),
    'Claim Filed: ' + leadTemplateValue(values, 'claim_filed'),
    'Visible Damage: ' + leadTemplateValue(values, 'visible_damage'),
    'Damage Type: ' + leadTemplateValue(values, 'damage_type'),
    'Add. Properties: ' + leadTemplateValue(values, 'additional_properties'),
    '2nd Address: ' + leadTemplateValue(values, 'second_address'),
  ].join('\n');
}
