import { formatDateLong, formatTime } from './portalUtils';
import { getLane } from './leadTypes';

/** Subset of the QC assessment the inspector note reads. */
export type NoteAssessment = {
  qualifiers?: Partial<Record<string, 'yes' | 'no' | 'unknown'>>;
  optional_details?: {
    insurance_company?: string;
    roof_type?: string;
    stories?: string;
    damage_type?: string;
    last_inspection_date?: string;
  };
  payment_path?: 'cash' | 'financing' | 'insurance' | 'unknown';
  lead_type?: string;
  roof_age_damage_override?: boolean;
} | null;

export function formatAppointmentDateTime(date?: string | null, time?: string | null): string {
  const parts: string[] = [];
  if (date) {
    try { parts.push(formatDateLong(date)); } catch { parts.push(date); }
  }
  if (time) {
    try { parts.push(formatTime(String(time).slice(0, 5))); } catch { parts.push(String(time)); }
  }
  return parts.join(' • ');
}

/**
 * Joins address parts without repeating any that the street field already
 * carries. ReadyMode hands over a full one-line address in `address` for some
 * campaigns and a bare street for others, which is what produced notes reading
 * "Wichita Falls, TX, 76306, Wichita Falls, TX, 76306".
 */
export function composeAddress(parts: {
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zipCode?: string | null;
}): string {
  const street = String(parts.address ?? '').trim();
  const normalized = street.toLowerCase().replace(/[^a-z0-9]+/g, ' ');
  const alreadyPresent = (value?: string | null) => {
    const token = String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ');
    if (!token) return true;
    return new RegExp(`(^| )${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( |$)`).test(normalized);
  };

  const cityState = [
    alreadyPresent(parts.city) ? '' : String(parts.city ?? '').trim(),
    alreadyPresent(parts.state) ? '' : String(parts.state ?? '').trim(),
  ].filter(Boolean).join(', ');
  const zip = alreadyPresent(parts.zipCode) ? '' : String(parts.zipCode ?? '').trim();

  return [street, cityState, zip].filter(Boolean).join(', ');
}

export function formValue(form: Record<string, unknown> | undefined, ...keys: string[]): string {
  if (!form) return '';
  for (const key of keys) {
    const raw = form[key];
    if (raw === undefined || raw === null) continue;
    const value = String(raw).trim();
    if (value && value !== '—') return value;
  }
  return '';
}

function formatSqFt(value: string): string {
  if (!value) return '';
  const numeric = Number(String(value).replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(numeric) || numeric <= 0) return `${value} sq ft`;
  return `${numeric.toLocaleString('en-US')} sq ft`;
}

/**
 * Builds the note the inspector actually reads before knocking.
 *
 * Two rules drive this: state only what the call established, and frame it for
 * the lane. A retail cold call where no damage came up is a normal, healthy
 * lead — the note says so plainly instead of hinting at damage nobody reported.
 */
export function buildInspectorNote(
  assessment: NoteAssessment,
  appointment: { date?: string | null; time?: string | null; address?: string | null; city?: string | null; state?: string | null; zipCode?: string | null },
  context?: { homeownerName?: string | null; leadType?: unknown; form?: Record<string, unknown> },
): string {
  const lane = getLane(context?.leadType ?? assessment?.lead_type);
  const form = context?.form;
  const lines: string[] = [];
  const qualifiers = assessment?.qualifiers;
  const details = assessment?.optional_details;

  lines.push(`Lead type: ${lane.label} (cold call)`);

  const when = formatAppointmentDateTime(appointment.date, appointment.time);
  if (when) lines.push(`Appointment: ${when}`);

  const homeowner = String(context?.homeownerName ?? '').trim() || formValue(form, 'full_name', 'name');
  if (homeowner) {
    const authority = qualifiers?.homeowner_authority === 'yes'
      ? ' — confirmed owner/decision-maker'
      : qualifiers?.homeowner_authority === 'no'
        ? ' — NOT confirmed as decision-maker'
        : ' — authority not confirmed on call';
    lines.push(`Homeowner: ${homeowner}${authority}`);
  }

  const addressLine = composeAddress(appointment);
  if (addressLine) lines.push(`Address: ${addressLine}`);

  const propertyBits = [
    formValue(form, 'home_type'),
    details?.stories || formValue(form, 'stories'),
    formatSqFt(formValue(form, 'sq_ft')),
  ].filter(Boolean);
  if (propertyBits.length) lines.push(`Property: ${propertyBits.join(', ')}`);

  const roofBits = [
    details?.roof_type || formValue(form, 'roof_type'),
    formValue(form, 'roof_age'),
  ].filter(Boolean);
  const lastChecked = details?.last_inspection_date || formValue(form, 'last_checked_on');
  if (lastChecked) roofBits.push(`last checked: ${lastChecked}`);
  if (roofBits.length) lines.push(`Roof: ${roofBits.join(', ')}`);

  // Damage is reported ONLY when the homeowner actually described it.
  const damage = details?.damage_type || formValue(form, 'damage_type');
  const visibleDamage = formValue(form, 'visible_damage');
  if (damage) {
    lines.push(`Damage reported: ${damage}${visibleDamage ? ` (${visibleDamage})` : ''}`);
  } else if (lane.id !== 'storm') {
    lines.push('Damage reported: none — homeowner did not report damage or leaks');
  }

  const carrier = details?.insurance_company || formValue(form, 'insurance_name');
  if (carrier) lines.push(`Insurance: ${carrier}`);

  const paymentPath = assessment?.payment_path;
  if (paymentPath && paymentPath !== 'unknown') {
    lines.push(`Payment path: ${paymentPath}`);
  }

  if (qualifiers?.no_existing_contract === 'yes') {
    lines.push('Competition: none — no signed contract, we are the first estimate');
  } else if (qualifiers?.no_existing_contract === 'no') {
    lines.push('Competition: HOMEOWNER IS ALREADY SIGNED with another contractor — confirm before proceeding');
  }

  // Only surface the override when it genuinely fired, and say what it means.
  if (assessment?.roof_age_damage_override && damage) {
    lines.push('Note: roof age was not stated — the appointment qualified on reported damage. Verify age on site.');
  }

  lines.push(`On site: ${lane.inspectorFraming}`);

  return lines.filter(Boolean).join('\n');
}
