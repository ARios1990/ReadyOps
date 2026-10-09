import type { PortalFormSection } from './DynamicLeadForm';

export const LIGHTING_DECISION_MAKERS = ['Homeowner is the Sole Decision Maker', 'Both Will be Present', 'Only Husband', 'Only Wife', 'Other'];
export const permanentLightingSchema: PortalFormSection[] = [
  { id: 'customer', title: 'Customer Information', fields: [
    { key: 'full_name', label: 'Full Name', type: 'text', required: true },
    { key: 'phone_number', label: 'Phone', type: 'phone', required: true },
    { key: 'address', label: 'Address', type: 'address', required: true },
    { key: 'email', label: 'Email', type: 'email' },
    { key: 'language', label: 'Language', type: 'select', options: ['English', 'Spanish', 'Bilingual', 'Other'] },
  ] },
  { id: 'project', title: 'Project Information', fields: [
    { key: 'service_needed', label: 'Service Requested', type: 'select', options: ['Free Design & Estimate'], defaultValue: 'Free Design & Estimate', required: true },
    { key: 'home_type', label: 'Home Type', type: 'select', options: ['Single Family Home', 'Town Home', 'Multifamily Home', 'Commercial', 'Mobile Home', 'Other'], allowOther: true },
    { key: 'stories', label: 'Number of Stories', type: 'select', options: ['1', '1.5', '2', '2.5', '3'] },
    { key: 'decision_makers', label: 'Decision Maker Present', type: 'select', options: LIGHTING_DECISION_MAKERS, allowOther: true },
    { key: 'additional_properties', label: 'Additional Properties', type: 'select', options: ['Yes', 'No'] },
    { key: 'second_address', label: '2nd Address', type: 'address', showWhen: { field: 'additional_properties', equals: 'Yes' } },
    { key: 'home_value', label: 'Home Value', type: 'currency' },
    { key: 'sq_ft', label: 'Square Feet', type: 'number' },
    { key: 'web_url', label: 'Property Link', type: 'url' },
  ] },
  { id: 'additional', title: 'Customer Notes', fields: [
    { key: 'notes', label: 'Customer Notes', type: 'textarea' },
    { key: 'recording_url', label: 'Call Recording (QC only)', type: 'recording' },
  ] },
];

// Use the approved question order for defaults, saved company schemas and lead snapshots.
// Keep each company's required/optional/hidden settings for matching questions.
export function preparePermanentLightingSchema(schema: PortalFormSection[]): PortalFormSection[] {
  const existing = new Map(schema.flatMap(section => section.fields).map(field => [field.key, field]));
  return permanentLightingSchema.map(section => ({ ...section, fields: section.fields.map(field => ({
    ...field,
    ...(existing.get(field.key)?.mode ? { mode: existing.get(field.key)!.mode } : {}),
    ...(existing.has(field.key) && existing.get(field.key)!.required !== undefined ? { required: existing.get(field.key)!.required } : {}),
  })) }));
}
