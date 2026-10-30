export const ROOF_PROS_ID = 'd12e8b8c-fd25-45c0-8d43-9b4aecdcda0c';
export const ROOF_PROS_FORM = 'https://docs.google.com/forms/d/e/1FAIpQLSeE-iKeKo_4zWEO3MOnKIBDSitr4eBMc-FC7f0eGSzXujCP1A/viewform?pli=1';
export const MANUAL_EXCLUSIONS = new Set([
  '44f9d82b-2247-4185-bae6-44ca6a2aa013', 'c1fc6f84-4c9f-469e-a036-8d08e7c4b53d',
  '52123081-6cc7-48d0-bad8-8fc96ebf0141', '9f158006-8bce-4928-aa13-8c686d00d91a',
]);

export function appointmentTimeFields(value: unknown) {
  const input = String(value ?? '').trim().toUpperCase().replace(/\./g, '').replace(/\s+/g, ' ');
  const match = input.match(/^(\d{1,2}):([0-5]\d)(?::[0-5]\d(?:\.\d+)?)?(?:\s*(AM|PM))?$/);
  if (!match) throw Error('Correct the appointment date and time first.');

  const sourceHour = Number(match[1]);
  const suffix = match[3];
  if (suffix && (sourceHour < 1 || sourceHour > 12)) throw Error('Correct the appointment date and time first.');
  if (!suffix && (sourceHour < 0 || sourceHour > 23)) throw Error('Correct the appointment date and time first.');

  const hour24 = suffix
    ? (sourceHour % 12) + (suffix === 'PM' ? 12 : 0)
    : sourceHour;
  return {
    hour: String(hour24 % 12 || 12),
    minute: match[2],
    ampm: hour24 >= 12 ? 'PM' : 'AM',
  };
}

export function manualFields(p: Record<string, unknown>) {
  const text = (key: string) => String(p[key] ?? '').trim();
  if (text('company_id') !== ROOF_PROS_ID || MANUAL_EXCLUSIONS.has(text('lead_id'))) throw Error('This lead cannot be prepared.');
  if (text('qc_status') !== 'approved' || !text('sent_at')) throw Error('Approve and Send this lead in ReadyOps first.');
  for (const key of ['name', 'address', 'city', 'state', 'zip', 'date', 'time', 'roof_type', 'roof_age']) {
    if (!text(key)) throw Error(`Complete ${key.replaceAll('_', ' ')} in ReadyOps first.`);
  }
  const age = text('roof_age');
  const match = age.match(/^(~|approximately\s+|about\s+)?(\d+(?:\.\d+)?)(?:\s*(?:-|–|to)\s*(\d+(?:\.\d+)?))?\s*(\+)?\s*(?:years?|yrs?)?$/i);
  if (!match || (match[3] && Number(match[3]) < Number(match[2])) || Number(match[2]) > 150) throw Error('Roof age needs a clear number, estimate, or numeric range.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text('date'))) throw Error('Correct the appointment date and time first.');
  const appointmentTime = appointmentTimeFields(text('time'));
  let notes = text('notes');
  if (match[1]) notes += `\n\nRoof age approximately ${match[2]} years, as stated in the recording.`;
  else if (match[3] || match[4]) notes += `\n\nRoof age reported: ${age}; numeric age field contains the stated minimum ${match[2]}.`;
  let address = text('address');
  for (const key of ['city', 'state', 'zip']) {
    if (!address.toLowerCase().includes(text(key).toLowerCase())) address += `${key === 'zip' ? ' ' : ', '}${text(key)}`;
  }
  return {
    telemarketer: 'Horacio', name: text('name'), address, phone: text('phone').replace(/\D/g, ''), email: text('email'),
    roof_type: text('roof_type'), date: text('date'), ...appointmentTime,
    roof_age: match[2], contract: ['Yes', 'No'].includes(text('contract')) ? text('contract') : '',
    insurance: text('insurance'), notes: notes.trim(),
  };
}
