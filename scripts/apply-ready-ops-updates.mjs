import fs from 'node:fs';

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

function write(path, content) {
  fs.writeFileSync(path, content);
}

function replaceRequired(path, from, to) {
  const current = read(path);
  if (!current.includes(from)) {
    throw new Error(`Expected text not found in ${path}: ${from.slice(0, 100)}`);
  }
  write(path, current.replace(from, to));
}

replaceRequired(
  'src/LoginPage.tsx',
  '<h1 className="text-3xl font-bold text-white">Time Slot Scheduler</h1>',
  '<h1 className="text-3xl font-bold text-white">Ready Ops</h1>',
);

replaceRequired(
  'src/Dashboard.tsx',
  '<h1 className="text-lg font-bold text-gray-900 leading-tight">Time Slot Scheduler</h1>',
  '<h1 className="text-lg font-bold text-gray-900 leading-tight">Ready Ops</h1>',
);

replaceRequired(
  'src/AgentBookingPortal.tsx',
  'Masters Ready Scheduler',
  'Ready Ops',
);

replaceRequired(
  'src/PortalAdmin.tsx',
  'Masters Ready Admin',
  'Ready Ops Admin',
);

replaceRequired(
  'src/CompanyPortal.tsx',
  'Internal Masters Ready Form',
  'Internal Ready Ops Form',
);

replaceRequired(
  'index.html',
  '<meta name="description" content="Masters Ready Time Slot Scheduler" />',
  '<meta name="description" content="Ready Ops scheduling, lead intake, company portals, and representative operations" />',
);

replaceRequired(
  'index.html',
  '<title>Masters Ready Time Slot Scheduler</title>',
  '<title>Ready Ops</title>',
);

replaceRequired(
  'src/AgentBookingPortal.tsx',
  "import { AlertTriangle, ArrowLeft, ArrowRight, CalendarDays, CheckCircle2, Clock3, ExternalLink, Loader2, Undo2 } from 'lucide-react';",
  "import { AlertTriangle, ArrowLeft, ArrowRight, CalendarDays, CheckCircle2, ClipboardCopy, Clock3, ExternalLink, Loader2, Undo2 } from 'lucide-react';",
);

replaceRequired(
  'src/AgentBookingPortal.tsx',
  "import { addDays, buildExternalFormUrl, formatDateLong, formatDateShort, formatTime, getPortalSessionId, localDate, rpcError, startOfWeek } from './portalUtils';",
  "import { addDays, buildExternalFormUrl, buildLeadTemplate, copyText, formatDateLong, formatDateShort, formatTime, getPortalSessionId, localDate, rpcError, startOfWeek } from './portalUtils';",
);

replaceRequired(
  'src/AgentBookingPortal.tsx',
  "    const payload = { ...formValues, appointment_date: reservation.appointment_date, appointment_time: reservation.start_time };",
  "    const basePayload = { ...formValues, appointment_date: reservation.appointment_date, appointment_time: reservation.start_time };\n    const payload = { ...basePayload, lead_template: buildLeadTemplate(basePayload) };",
);

const confirmationAnchor = `              {confirmation.form_mode !== 'internal' && confirmation.external_form_url && <button onClick={() => void openExternalForm()} className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white"><ExternalLink size={14} /> Continue to {confirmation.external_form_provider || 'Client Form'}</button>}\n            </div>\n          </section>`;
const confirmationReplacement = `              {confirmation.form_mode !== 'internal' && confirmation.external_form_url && <button onClick={() => void openExternalForm()} className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white"><ExternalLink size={14} /> Continue to {confirmation.external_form_provider || 'Client Form'}</button>}\n            </div>\n            {confirmation.form_data?.lead_template && (\n              <div className="mt-4 rounded-xl border border-emerald-200 bg-white p-4">\n                <div className="mb-3 flex items-center justify-between gap-3">\n                  <div><p className="text-xs font-bold uppercase tracking-wide text-emerald-700">Lead Template</p><p className="text-xs text-slate-500">Ready to copy into your CRM, notes, or client system.</p></div>\n                  <button type="button" onClick={() => void copyText(String(confirmation.form_data.lead_template))} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700"><ClipboardCopy size={14} /> Copy Template</button>\n                </div>\n                <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-xs leading-5 text-slate-700">{String(confirmation.form_data.lead_template)}</pre>\n              </div>\n            )}\n          </section>`;
replaceRequired('src/AgentBookingPortal.tsx', confirmationAnchor, confirmationReplacement);

const utilsPath = 'src/portalUtils.ts';
const utils = read(utilsPath);
if (!utils.includes('export function buildLeadTemplate(')) {
  const helper = [
    'function leadTemplateValue(values: Record<string, unknown>, key: string): string {',
    '  const value = values[key];',
    "  if (Array.isArray(value)) return value.map(String).filter(Boolean).join(', ');",
    "  if (value === undefined || value === null) return '';",
    '  return String(value).trim();',
    '}',
    '',
    '/** Builds the standardized Ready Ops roofing lead template stored with each submitted appointment. */',
    'export function buildLeadTemplate(values: Record<string, unknown>): string {',
    "  const appointmentDate = leadTemplateValue(values, 'appointment_date');",
    "  const appointmentTime = leadTemplateValue(values, 'appointment_time');",
    '  const appointmentDateTime = [',
    "    appointmentDate ? formatDateLong(appointmentDate) : '',",
    "    appointmentTime ? formatTime(appointmentTime) : '',",
    "].filter(Boolean).join(' at ');",
    '',
    '  return [',
    "    '**Customer Information**',",
    "    'App Date & Time: ' + appointmentDateTime,",
    "    'Name: ' + leadTemplateValue(values, 'full_name'),",
    "    'Phone: ' + leadTemplateValue(values, 'phone_number'),",
    "    'Address: ' + leadTemplateValue(values, 'address'),",
    "    'Email: ' + leadTemplateValue(values, 'email').toLowerCase(),",
    "    'Language: ' + leadTemplateValue(values, 'language'),",
    "    'Services Need: ' + leadTemplateValue(values, 'service_needed'),",
    "    '',",
    "    '**Property Details**',",
    "    'Roof Age: ' + leadTemplateValue(values, 'roof_age'),",
    "    'Home Type: ' + leadTemplateValue(values, 'home_type'),",
    "    'Roof Type: ' + leadTemplateValue(values, 'roof_type'),",
    "    'Stories: ' + leadTemplateValue(values, 'stories'),",
    "    'Insurance: ' + leadTemplateValue(values, 'insurance'),",
    "    'Insurance Name: ' + leadTemplateValue(values, 'insurance_name'),",
    "    'Contract: ' + (leadTemplateValue(values, 'contract') || 'No'),",
    "    'Home Value: ' + leadTemplateValue(values, 'home_value'),",
    "    'SQ FT: ' + leadTemplateValue(values, 'sq_ft'),",
    "    'Web Link: ' + leadTemplateValue(values, 'web_url'),",
    "    '',",
    "    '**Additional Information**',",
    "    'Notes: ' + leadTemplateValue(values, 'notes'),",
    "    'Last Checked On: ' + leadTemplateValue(values, 'last_checked_on'),",
    "    'Size of Hail: ' + leadTemplateValue(values, 'hail_size'),",
    "    'Claim Filed: ' + leadTemplateValue(values, 'claim_filed'),",
    "    'Visible Damage: ' + leadTemplateValue(values, 'visible_damage'),",
    "    'Damage Type: ' + leadTemplateValue(values, 'damage_type'),",
    "    'Add. Properties: ' + leadTemplateValue(values, 'additional_properties'),",
    "    '2nd Address: ' + leadTemplateValue(values, 'second_address'),",
    "  ].join('\\n');",
    '}',
  ].join('\n');

  write(utilsPath, `${utils.trimEnd()}\n\n${helper}\n`);
}

console.log('Ready Ops form and branding updates applied.');
