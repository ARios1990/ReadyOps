from pathlib import Path
import re


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f"Missing expected {label} marker")
    return text.replace(old, new, 1)

# Company portal: clients see only the standardized lead template plus recording when QC shares it.
company_path = Path('src/CompanyPortal.tsx')
company = company_path.read_text(encoding='utf-8')
company = replace_once(
    company,
    "import { READYOPS_LOGO_DATA_URI } from './brand';",
    "import { READYOPS_LOGO_DATA_URI } from './brand';\nimport { ClientLeadTemplate } from './ClientLeadTemplate';\nimport { SharedRecordingPlayer } from './SharedRecordingPlayer';",
    'CompanyPortal imports',
)
company = replace_once(
    company,
    "{selectedLead && <LeadModal appointment={selectedLead} onClose={() => setSelectedLead(null)} />}",
    "{selectedLead && <LeadModal appointment={selectedLead} companyId={companyId} token={token} onClose={() => setSelectedLead(null)} />}",
    'LeadModal call',
)

# Add desktop column headings above the weekly schedule rows.
schedule_marker = '<div className="space-y-2">{DAY_NAMES.map((name, day) => <ScheduleRuleRow'
schedule_header = '''<div className="mb-2 hidden rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] font-black uppercase tracking-wide text-slate-500 md:grid md:grid-cols-[110px_90px_repeat(5,1fr)_70px] md:items-center md:gap-2">
  <span>Day</span>
  <span>Open</span>
  <span>Start Time</span>
  <span>End Time</span>
  <span>Appointment Length (min)</span>
  <span>Appointments per Time Slot</span>
  <span>Max Appointments per Day</span>
  <span className="text-center">Save</span>
</div><div className="space-y-2">{DAY_NAMES.map((name, day) => <ScheduleRuleRow'''
company = replace_once(company, schedule_marker, schedule_header, 'weekly schedule header')

lead_modal = '''function LeadModal({ appointment, companyId, token, onClose }: { appointment: Appointment; companyId: string; token: string; onClose: () => void }) {
  const lead = appointment.lead;
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/40 p-4" onClick={onClose}>
      <div className="mx-auto my-8 max-w-3xl rounded-2xl bg-white p-5 shadow-2xl" onClick={event => event.stopPropagation()}>
        <div className="mb-4 flex justify-end">
          <button onClick={onClose} className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-bold">Close</button>
        </div>
        <ClientLeadTemplate lead={lead} appointment={appointment} />
        <div className="mt-4">
          <SharedRecordingPlayer
            companyId={companyId}
            token={token}
            leadId={lead.id}
            recordingUrl={lead.recording_url}
            shared={lead.recording_shared}
          />
        </div>
      </div>
    </div>
  );
}
'''
company, count = re.subn(r"function LeadModal\(.*?\nfunction LinkCard", lead_modal + "function LinkCard", company, count=1, flags=re.S)
if count != 1:
    raise SystemExit('Unable to replace CompanyPortal LeadModal')
company_path.write_text(company, encoding='utf-8')

# QC: replace URL-only recording card with real file upload + URL fallback.
qc_path = Path('src/QCQueue.tsx')
qc = qc_path.read_text(encoding='utf-8')
qc = replace_once(
    qc,
    "import { READYOPS_LOGO_DATA_URI } from './brand';",
    "import { READYOPS_LOGO_DATA_URI } from './brand';\nimport { QCRecordingUpload } from './QCRecordingUpload';",
    'QCQueue import',
)
recording_card_pattern = re.compile(
    r'<div className="rounded-xl border border-blue-200 bg-blue-50 p-4"><div className="flex items-center gap-2"><Headphones.*?</div><div className="rounded-xl border border-amber-200',
    re.S,
)
recording_card_replacement = '''<QCRecordingUpload
  leadId={selected.lead.id}
  value={String(values.recording_url || '')}
  shared={Boolean(values.share_recording_with_company)}
  onChange={value => change('recording_url', value)}
  onShareChange={value => change('share_recording_with_company', value)}
/><div className="rounded-xl border border-amber-200'''
qc, count = recording_card_pattern.subn(recording_card_replacement, qc, count=1)
if count != 1:
    raise SystemExit('Unable to replace QC recording card')
qc_path.write_text(qc, encoding='utf-8')

# New appointments store the same concise roofing template clients see.
utils_path = Path('src/portalUtils.ts')
utils = utils_path.read_text(encoding='utf-8')
marker = '/** Builds the standardized Ready Ops roofing lead template stored with each submitted appointment. */'
start = utils.find(marker)
if start < 0:
    raise SystemExit('Unable to find buildLeadTemplate marker')
new_builder = r'''/** Builds the standardized Ready Ops roofing lead template stored with each submitted appointment. */
export function buildLeadTemplate(values: Record<string, unknown>): string {
  const appointmentDate = leadTemplateValue(values, 'appointment_date');
  const appointmentTime = leadTemplateValue(values, 'appointment_time');
  let dateLabel = appointmentDate;
  if (appointmentDate) {
    const parsed = new Date(`${appointmentDate}T12:00:00`);
    if (!Number.isNaN(parsed.getTime())) {
      dateLabel = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(parsed);
    }
  }
  const appointmentDateTime = [dateLabel, appointmentTime ? formatTime(appointmentTime) : ''].filter(Boolean).join(' & ');
  const rawHomeValue = leadTemplateValue(values, 'home_value');
  const homeValueNumber = Number(rawHomeValue.replace(/[$,\s]/g, ''));
  const homeValue = rawHomeValue && Number.isFinite(homeValueNumber)
    ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(homeValueNumber)
    : rawHomeValue;
  const rawSqFt = leadTemplateValue(values, 'sq_ft');
  const sqFtNumber = Number(rawSqFt.replace(/[,\s]/g, ''));
  const sqFt = rawSqFt && Number.isFinite(sqFtNumber)
    ? new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(sqFtNumber)
    : rawSqFt;

  return [
    '**Roof Inspection**',
    '**Customer Information**',
    'App Date & Time: ' + appointmentDateTime,
    'Name: ' + leadTemplateValue(values, 'full_name'),
    'Phone: ' + leadTemplateValue(values, 'phone_number'),
    'Address: ' + leadTemplateValue(values, 'address'),
    'Email: ' + leadTemplateValue(values, 'email').toLowerCase(),
    'Language: ' + leadTemplateValue(values, 'language'),
    '',
    '**Property Details**',
    'Services Needed: ' + leadTemplateValue(values, 'service_needed'),
    'Last Checked On: ' + leadTemplateValue(values, 'last_checked_on'),
    'Home Type: ' + leadTemplateValue(values, 'home_type'),
    'Roof Type: ' + leadTemplateValue(values, 'roof_type'),
    'Roof Age: ' + leadTemplateValue(values, 'roof_age'),
    'Stories: ' + leadTemplateValue(values, 'stories'),
    'Insurance: ' + leadTemplateValue(values, 'insurance'),
    'Insurance Name: ' + leadTemplateValue(values, 'insurance_name'),
    'Contract: ' + (leadTemplateValue(values, 'contract') || 'No'),
    'Home Value: ' + homeValue,
    'SQ FT: ' + sqFt,
    'Web Link: ' + leadTemplateValue(values, 'web_url'),
    '',
    '**Additional Information**',
    'Notes: ' + leadTemplateValue(values, 'notes'),
    'Size of Hail: ' + leadTemplateValue(values, 'hail_size'),
    'Claim Filed: ' + leadTemplateValue(values, 'claim_filed'),
    'Visible Damage: ' + leadTemplateValue(values, 'visible_damage'),
    'Damage Type: ' + leadTemplateValue(values, 'damage_type'),
    'Add. Properties: ' + leadTemplateValue(values, 'additional_properties'),
    '2nd Address: ' + leadTemplateValue(values, 'second_address'),
  ].join('\n');
}
'''
utils = utils[:start] + new_builder
utils_path.write_text(utils, encoding='utf-8')

print('Applied client lead template, schedule headings, and recording upload patch.')
