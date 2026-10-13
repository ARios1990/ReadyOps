export const ROOFING_SERVICE_OPTIONS = ['Roof Inspection', 'Roof Repair', 'Roof Replacement', 'Roof Estimate', 'Storm Damage Inspection', 'Hail Damage Inspection', 'Wind Damage Inspection', 'Insurance Claim Assistance', 'Siding', 'Gutters', 'Windows', 'Other'];

export function cleanProfileValue(value: unknown): string {
  const text = String(value ?? '').trim();
  return /\(\s*Profile\.[^)]+\)/i.test(text) ? '' : text;
}

export function contractValue(value: unknown): string {
  return cleanProfileValue(value).toLowerCase() === 'yes' ? 'Yes' : 'No';
}

export function savedServiceValue(value: unknown): string {
  const text = cleanProfileValue(value);
  return ROOFING_SERVICE_OPTIONS.find(option => option.toLowerCase() === text.toLowerCase()) || text;
}
