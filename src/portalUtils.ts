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

export function startOfWeek(date = new Date()): Date {
  const copy = new Date(date);
  const day = copy.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  copy.setDate(copy.getDate() + diff);
  copy.setHours(0, 0, 0, 0);
  return copy;
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

export async function copyText(value: string): Promise<void> {
  await navigator.clipboard.writeText(value);
}
