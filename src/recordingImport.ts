export type CallLogRow = Record<string, string>;
export type ImportDraft = {
  values: Record<string, unknown>;
  warnings: string[];
  sources: Record<string, string>;
  requestedDate: string;
  requestedTime: string;
  timeRange: string;
  transcript: string;
};

export function normalizePhone(value: string): string {
  const digits = value.replace(/\D/g, '');
  return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits.length === 10 ? digits : '';
}

const headerKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
export function fullAddress(street: string, city: string, state: string, zip: string): string {
  const clean = street.replace(/\s*,\s*/g, ', ').trim().replace(/,\s*$/, '');
  const folded = clean.toLowerCase();
  const parts = [clean].filter(Boolean);
  if (city && !folded.includes(city.toLowerCase())) parts.push(city);
  const statePresent = state && new RegExp(`\\b${state.replace(/[^a-z]/gi, '')}\\b`, 'i').test(clean);
  const zipPresent = zip && clean.includes(zip);
  const tail = [statePresent ? '' : state, zipPresent ? '' : zip].filter(Boolean).join(' ');
  if (tail) parts.push(tail);
  return parts.join(', ');
}
export function cell(row: CallLogRow, ...names: string[]): string {
  for (const name of names) {
    const key = Object.keys(row).find(k => headerKey(k) === headerKey(name));
    if (key && String(row[key] ?? '').trim()) return String(row[key]).trim();
  }
  return '';
}

export function matchCallLog(filename: string, rows: CallLogRow[]): CallLogRow[] {
  const phones = [...filename.matchAll(/(?:\+?1[ .-]?)?\(?\d{3}\)?[ .-]?\d{3}[ .-]?\d{4}/g)].map(m => normalizePhone(m[0]));
  if (phones.length) return rows.filter(row => phones.includes(normalizePhone(cell(row, 'Phone', 'Phone Number'))));
  const name = filename.toLowerCase().replace(/[^a-z0-9]/g, '');
  return rows.filter(row => {
    const full = (cell(row, 'First Name') + cell(row, 'Last Name')).toLowerCase().replace(/[^a-z0-9]/g, '');
    return full.length >= 5 && name.includes(full);
  });
}

function dateParts(year: number, month: number, day: number): string {
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return '';
  return d.toISOString().slice(0, 10);
}
export function readDate(text: string, reference = ''): string {
  const iso = text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) return dateParts(+iso[1], +iso[2], +iso[3]);
  const us = text.match(/\b(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/);
  if (us) return dateParts(+us[3], +us[1], +us[2]);
  const month = text.match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s*,?\s*(20\d{2}))?\b/i);
  if (month) {
    const year = month[3] || reference.slice(0, 4);
    return year ? dateParts(+year, ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(month[1].slice(0, 3).toLowerCase()) + 1, +month[2]) : '';
  }
  return '';
}
function offsetDate(reference: string, days: number): string {
  const date = new Date(reference + 'T12:00:00Z');
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
export function requestedAppointment(text: string, reference: string): { date: string; time: string; range: string } {
  let date = readDate(text, reference);
  if (!date && reference && /\b(tomorrow|mañana)\b/i.test(text)) date = offsetDate(reference, 1);
  if (!date && reference) {
    const weekdays = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
    const match = text.toLowerCase().match(/\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
    if (match) date = offsetDate(reference, (weekdays.indexOf(match[1]) - new Date(reference + 'T12:00:00Z').getUTCDay() + 7) % 7);
  }
  const normalize = (hours: string, mins: string, period: string) => {
    const h = +hours, m = +(mins || '0');
    if (h < 1 || h > 12 || m > 59) return '';
    return String(h % 12 + (/p/i.test(period) ? 12 : 0)).padStart(2, '0') + ':' + String(m).padStart(2, '0');
  };
  const range = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(?:am|pm)?\s*[/–-]\s*(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b/i);
  if (range) return { date, time: '', range: `${normalize(range[1], range[2], range[5])}–${normalize(range[3], range[4], range[5])}` };
  const time = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b/i);
  return { date, time: time ? normalize(time[1], time[2], time[3]) : '', range: '' };
}

/** Quoted speech, never a generated claim that a question was answered. */
export function recordingNotes(transcript: string): string {
  const sentences = transcript.replace(/\s+/g, ' ').trim().match(/[^.!?]+[.!?]?/g) || [];
  const relevant = sentences.filter(s => /\b(roof|techo|shingle|years|años|hail|graniz|insurance|seguro|claim|contract|contrat|tomorrow|mañana|monday|tuesday|available|call me|llama|work|trabajo|gate|dog|perro|inspection|inspecci)/i.test(s));
  return (relevant.length ? relevant : sentences).slice(0, 18).map(s => s.trim()).filter(Boolean).join('\n');
}

export function prepareDraft(row: CallLogRow, transcript = ''): ImportDraft {
  const values: Record<string, unknown> = { _source: 'readymode', _universal_template: true, contract: '', additional_properties: '' };
  const sources: Record<string, string> = {}, warnings: string[] = [];
  const set = (key: string, value: string, source: string) => { if (value) { values[key] = value; sources[key] = source; } };
  const mapping: Record<string, string[]> = {
    phone_number: ['Phone', 'Phone Number'], address: ['Address'], city: ['City'], state: ['State'], zip_code: ['Zip Code', 'ZIP'], email: ['Email'],
    roof_age: ['Roof Age'], roof_type: ['Roof Type'], home_type: ['Home Type'], stories: ['Stories'], language: ['Language'], insurance: ['Insurance'],
    insurance_name: ['Insurance Name'], claim_filed: ['Claim File'], hail_size: ['Size Hail'], visible_damage: ['Visible Damage'],
    homeowner_authority: ['Are you the'], last_checked_on: ['Last Inspection Date'], home_value: ['Home Value'], sq_ft: ['Square Feet'], web_url: ['Web Url'],
    second_address: ['2nd Address'], additional_properties: ['Add. Property'], readymode_call_log_id: ['Call Log ID'],
  };
  Object.entries(mapping).forEach(([key, names]) => set(key, cell(row, ...names), 'Call log column'));
  set('address', fullAddress(cell(row, 'Full_address', 'Full Address') || cell(row, 'Address'), cell(row, 'City'), cell(row, 'State'), cell(row, 'Zip Code', 'ZIP')), 'Call log full address');
  set('full_name', [cell(row, 'First Name'), cell(row, 'Last Name')].filter(Boolean).join(' '), 'Call log column');
  if (values.home_type === 'Single Family Dwelling') values.home_type = 'Single Family Home';
  const note = cell(row, 'Call Notes'), existingNotes = cell(row, 'Notes');
  const roof = note.match(/\b(\d{1,2}(?:\s*[-–]\s*\d{1,2}|\+)?)\s*(?:yrs?|years?)\b/i);
  if (!values.roof_age && roof) set('roof_age', roof[1].replace(/\s/g, ''), 'Call log notes');
  if (!values.insurance) {
    if (/\b(?:uninsured|not insured|no insurance|cash)\b/i.test(note)) set('insurance', 'No', 'Call log notes');
    else if (/\binsured\b/i.test(note)) set('insurance', 'Yes', 'Call log notes');
  }
  if (/\bno\s+contract\s+sign(?:ed)?\b/i.test(note)) set('contract', 'No', 'Call log notes');
  if (!values.language && /\benglish\b/i.test(note)) set('language', 'English', 'Call log notes');
  if (!values.language && /\bspanish\b/i.test(note)) set('language', 'Spanish', 'Call log notes');
  const reference = readDate(cell(row, 'Recording Start', 'Log Time'));
  const appointment = requestedAppointment(cell(row, 'App. Date & Time') || note, reference);
  const scheduled = readDate(cell(row, 'Scheduled time'));
  if (scheduled && appointment.date && scheduled !== appointment.date) warnings.push('Scheduled time differs from the appointment in Call Notes. Verify the appointment date.');
  if (appointment.range) warnings.push(`Call notes give a time window (${appointment.range}); choose the agreed time from live availability.`);
  if (!appointment.date) warnings.push('Appointment date was not found. Choose a date before booking.');
  if (!appointment.time && !appointment.range) warnings.push('Appointment time was not found. Choose a time before booking.');
  if (transcript) {
    // Explicit statements only; unanswered questions never become qualifiers.
    const transcriptRoof = transcript.match(/(?:my (?:shingle )?roof is|roof (?:age|is about)|mi techo tiene)\s*(\d{1,2}(?:\s*[-–]\s*\d{1,2}|\+)?)\s*(?:years?|años)/i);
    if (transcriptRoof) {
      if (values.roof_age && String(values.roof_age) !== transcriptRoof[1]) warnings.push(`Roof age differs: log ${values.roof_age}, recording ${transcriptRoof[1]}.`);
      else set('roof_age', transcriptRoof[1], 'Recording statement');
    }
    if (/\b(i (?:do not|don't|don’t) have (?:home(?:owner)? )?insurance|no tengo seguro)\b/i.test(transcript)) {
      if (values.insurance === 'Yes') warnings.push('Recording says no insurance; call log says insured. Verify insurance.');
      else set('insurance', 'No', 'Recording statement');
    }
    if (/\bmi techo|cuántos años|mañana|caballero\b/i.test(transcript) && values.language === 'English') warnings.push('Recording contains Spanish; call log lists English. Confirm the customer’s preferred language.');
    set('recording_notes', recordingNotes(transcript), 'Quoted recording passages');
  }
  set('notes', [note && `Agent call notes: ${note}`, existingNotes].filter(Boolean).join('\n'), 'Call log notes');
  if (values.recording_notes) values.notes = `Recording notes (quoted passages):\n${values.recording_notes}` + (values.notes ? `\n\n${values.notes}` : '');
  if (!values.full_name) warnings.push('Customer name is missing from the call log.');
  if (!cell(row, 'Full_address', 'Full Address', 'Address')) warnings.push('Street address is missing from the call log.');
  for (const key of ['city', 'state', 'zip_code']) if (!values[key]) warnings.push(`${key === 'zip_code' ? 'ZIP code' : key === 'city' ? 'City' : 'State'} is missing. Verify the full address before booking.`);
  if (!normalizePhone(String(values.phone_number || ''))) warnings.push('A valid 10-digit phone number is required.');
  return { values, warnings, sources, requestedDate: appointment.date, requestedTime: appointment.time, timeRange: appointment.range, transcript };
}
