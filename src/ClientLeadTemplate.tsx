import { useState } from 'react';
import { Check, Copy, ExternalLink, Save } from 'lucide-react';
import { formatTime } from './portalUtils';

type LeadLike = {
  full_name?: string | null;
  phone_number?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip_code?: string | null;
  email?: string | null;
  language?: string | null;
  notes?: string | null;
  service_needed?: string | null;
  home_value?: unknown;
  sq_ft?: unknown;
  web_url?: string | null;
  form_data?: Record<string, unknown>;
};

type AppointmentLike = {
  appointment_date: string;
  start_time: string;
  canonical_status?: string | null;
  status?: string | null;
};

const EMPTY = '—';

function isBlank(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  const text = String(value).trim();
  return text === '' || /^\(profile\.[^)]+\)(?:\?source=readymode)?$/i.test(text);
}

function asText(value: unknown): string {
  if (Array.isArray(value)) return value.map(String).map(item => item.trim()).filter(Boolean).join(', ');
  return isBlank(value) ? '' : String(value).trim();
}

function formValue(lead: LeadLike, ...keys: string[]): string {
  const data = lead.form_data || {};
  for (const key of keys) {
    const value = data[key];
    if (!isBlank(value)) return asText(value);
  }
  return '';
}

function leadValue(lead: LeadLike, topLevel: keyof LeadLike, ...formKeys: string[]): string {
  const value = lead[topLevel];
  if (!isBlank(value)) return asText(value);
  return formValue(lead, ...formKeys);
}

function formatClientDate(value: string): string {
  const parsed = new Date(value + 'T12:00:00');
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(parsed);
}

function formatAddress(lead: LeadLike): string {
  let street = leadValue(lead, 'address', 'address').replace(/\s*,\s*/g, ', ').trim();
  const city = leadValue(lead, 'city', 'city');
  const state = leadValue(lead, 'state', 'state').toUpperCase();
  const zip = leadValue(lead, 'zip_code', 'zip', 'zip_code');

  street = street.replace(/,\s*([A-Z]{2})\s*,\s*(\d{5}(?:-\d{4})?)\b/g, ', $1 $2');
  const lower = street.toLowerCase();
  const parts = [street].filter(Boolean);
  if (city && !lower.includes(city.toLowerCase())) parts.push(city);
  const stateZip = [state, zip].filter(Boolean).join(' ');
  if (stateZip && !(state && lower.includes(state.toLowerCase()) && (!zip || lower.includes(zip)))) parts.push(stateZip);
  return parts.join(', ');
}

function formatCurrency(value: string): string {
  if (!value) return '';
  const numeric = Number(value.replace(/[$,\s]/g, ''));
  if (!Number.isFinite(numeric)) return value;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(numeric);
}

function formatInteger(value: string): string {
  if (!value) return '';
  const numeric = Number(value.replace(/[,\s]/g, ''));
  if (!Number.isFinite(numeric)) return value;
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(numeric);
}

function normalizeLastChecked(value: string): string {
  if (!value) return '';
  if (!/^\d{4}-\d{2}-\d{2}/.test(value)) return value;
  const parsed = new Date(value.slice(0, 10) + 'T12:00:00');
  if (Number.isNaN(parsed.getTime()) || parsed.getFullYear() < 1980) return '';
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(parsed);
}

function serviceTitle(serviceNeeded: string, lead: LeadLike): string {
  const explicitType = formValue(lead, 'service_type', 'industry', 'vertical', 'campaign_type');
  const service = (explicitType || serviceNeeded).trim();
  const normalized = service.toLowerCase();

  if (/\bpdr\b|paintless dent/.test(normalized)) return 'PDR';
  if (/solar|photovoltaic|pv system/.test(normalized)) return 'Solar Inspection';
  if (/tree|arbor|stump/.test(normalized)) return 'Tree Service';
  if (/roof|shingle|hail|storm|leak|repair|estimate|inspection/.test(normalized)) return 'Roofing Inspection';
  return service || 'Roofing Inspection';
}

type RowProps = {
  label: string;
  value: string;
  href?: string;
  field?: string;
  editValue?: string;
  multiline?: boolean;
  inputType?: 'text' | 'email' | 'tel' | 'url';
  onChange?: (key: string, value: string) => void;
};

function Row({
  label,
  value,
  href,
  field,
  editValue,
  multiline = false,
  inputType = 'text',
  onChange,
}: RowProps) {
  const displayValue = value || EMPTY;
  const editable = Boolean(field && onChange);
  const controlClass =
    'min-w-0 flex-1 rounded-md border border-transparent bg-blue-50/70 px-2 py-1 font-medium text-slate-900 outline-none transition placeholder:text-slate-400 hover:border-blue-200 focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-100';

  return (
    <label className="flex min-w-0 flex-wrap items-baseline gap-x-2 py-0.5 text-sm leading-5">
      <strong className="shrink-0 font-bold text-slate-950">{label}</strong>
      {editable ? (
        <span className="flex min-w-[140px] flex-1 items-center gap-1">
          {multiline ? (
            <textarea
              aria-label={label.replace(/:$/, '')}
              value={editValue ?? value}
              placeholder={EMPTY}
              onChange={(event) => onChange?.(field!, event.target.value)}
              className={controlClass + ' min-h-28 resize-y'}
            />
          ) : (
            <input
              aria-label={label.replace(/:$/, '')}
              type={inputType}
              value={editValue ?? value}
              placeholder={EMPTY}
              onChange={(event) => onChange?.(field!, event.target.value)}
              className={controlClass}
            />
          )}
          {href && (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              aria-label="Open Property Link"
              className="shrink-0 rounded p-1 text-blue-700 hover:bg-blue-100"
            >
              <ExternalLink size={13} />
            </a>
          )}
        </span>
      ) : href && value ? (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-w-0 items-center gap-1.5 break-all font-medium text-blue-700 hover:underline"
        >
          Open Property Link <ExternalLink size={12} />
        </a>
      ) : (
        <span className="min-w-0 break-words font-medium text-slate-800">{displayValue}</span>
      )}
    </label>
  );
}

function Section({ title, children, columns = false }: { title: string; children: React.ReactNode; columns?: boolean }) {
  return (
    <section>
      <h3 className="mb-2 text-sm font-black text-blue-600">{title}</h3>
      <div className={columns ? 'grid gap-x-6 sm:grid-cols-2' : ''}>{children}</div>
    </section>
  );
}

const STATUS_BUTTONS = [
  ['QC DENIED', 'bg-violet-700'],
  ['GOOD', 'bg-emerald-600'],
  ['SIGNED CONTRACT', 'bg-blue-900'],
  ['BAD', 'bg-red-600'],
  ['NO SHOW', 'bg-amber-400 text-slate-950'],
] as const;

export function ClientLeadTemplate({
  lead,
  appointment,
  showLabel = true,
  showStatusButtons = false,
  editValues,
  onChange,
  onSave,
  saving = false,
}: {
  lead: LeadLike;
  appointment: AppointmentLike;
  showLabel?: boolean;
  showStatusButtons?: boolean;
  editValues?: Record<string, unknown>;
  onChange?: (key: string, value: string) => void;
  onSave?: () => void | Promise<void>;
  saving?: boolean;
}) {
  const serviceNeeded = leadValue(lead, 'service_needed', 'service_needed', 'services_needed', 'services_need');
  const rawHomeValue = leadValue(lead, 'home_value', 'home_value');
  const rawSquareFeet = leadValue(lead, 'sq_ft', 'sq_ft', 'square_feet', 'square_footage');
  const homeValue = formatCurrency(rawHomeValue);
  const squareFeet = formatInteger(rawSquareFeet);
  const webLink = leadValue(lead, 'web_url', 'web_url', 'web_link', 'zillow_url', 'zillow_link');
  const notes = leadValue(lead, 'notes', 'notes');
  const editable = Boolean(onChange);
  const [copied, setCopied] = useState(false);

  const editValue = (key: string, fallback: string): string => {
    if (editValues && Object.prototype.hasOwnProperty.call(editValues, key)) {
      const value = editValues[key];
      return value === null || value === undefined ? '' : String(value);
    }
    return fallback;
  };

  const copyLead = {
    ...lead,
    ...(editValues || {}),
    form_data: {
      ...(lead.form_data || {}),
      ...(editValues || {}),
    },
  } as LeadLike;
  const copyService = leadValue(
    copyLead,
    'service_needed',
    'service_needed',
    'services_needed',
    'services_need',
  );
  const copyTitle = serviceTitle(copyService, copyLead).replace(
    /^Roofing Inspection$/i,
    'Roof Inspection',
  );
  const copyValue = (value: unknown) => asText(value) || EMPTY;
  const copyWebLink = leadValue(
    copyLead,
    'web_url',
    'web_url',
    'web_link',
    'zillow_url',
    'zillow_link',
  );
  const copyText = [
    `**${copyTitle}**`,
    '**Customer Information**',
    `App Date & Time: ${formatClientDate(appointment.appointment_date)} • ${formatTime(appointment.start_time)}`,
    `Name: ${copyValue(leadValue(copyLead, 'full_name', 'full_name', 'name'))}`,
    `Phone: ${copyValue(leadValue(copyLead, 'phone_number', 'phone_number', 'phone'))}`,
    `Address: ${copyValue(formatAddress(copyLead))}`,
    `Email: ${copyValue(leadValue(copyLead, 'email', 'email').toLowerCase())}`,
    `Language: ${copyValue(leadValue(copyLead, 'language', 'language'))}`,
    `Services Need: ${copyValue(copyService)}`,
    '**Property Details**',
    `Roof Age: ${copyValue(formValue(copyLead, 'roof_age'))}`,
    `Home Type: ${copyValue(formValue(copyLead, 'home_type'))}`,
    `Roof Type: ${copyValue(formValue(copyLead, 'roof_type'))}`,
    `Stories: ${copyValue(formValue(copyLead, 'stories'))}`,
    `Insurance: ${copyValue(formValue(copyLead, 'insurance'))}`,
    `Insurance Name: ${copyValue(formValue(copyLead, 'insurance_name'))}`,
    `Contract: ${copyValue(formValue(copyLead, 'contract'))}`,
    `Home Value: ${copyValue(formatCurrency(leadValue(copyLead, 'home_value', 'home_value')))}`,
    `SQ FT: ${copyValue(formatInteger(leadValue(copyLead, 'sq_ft', 'sq_ft', 'square_feet', 'square_footage')))}`,
    `Web Link: ${copyWebLink ? 'Open Property Link' : EMPTY}`,
    '**Additional Information**',
    `Notes: ${copyValue(leadValue(copyLead, 'notes', 'notes'))}`,
    `Last Checked On: ${copyValue(normalizeLastChecked(formValue(copyLead, 'last_checked_on', 'last_inspection_date')))}`,
    `Size of Hail: ${copyValue(formValue(copyLead, 'hail_size', 'size_of_hail'))}`,
    `Claim Filed: ${copyValue(formValue(copyLead, 'claim_filed', 'file_claim'))}`,
    `Visible Damage: ${copyValue(formValue(copyLead, 'visible_damage'))}`,
    `Damage Type: ${copyValue(formValue(copyLead, 'damage_type', 'type_of_damage'))}`,
    `Add. Properties: ${copyValue(formValue(copyLead, 'additional_properties', 'add_properties'))}`,
    `2nd Address: ${copyValue(formValue(copyLead, 'second_address', 'other_address'))}`,
  ].join('\n');

  async function copyLeadTemplate() {
    await navigator.clipboard.writeText(copyText);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <div className="space-y-3">
      {showLabel && (
        <p className="px-3 text-xs font-black uppercase tracking-[0.18em] text-blue-600">
          Lead Template
        </p>
      )}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <h2 className="bg-blue-600 px-4 py-2.5 text-center text-xl font-black uppercase text-white">
          {serviceTitle(serviceNeeded, lead)}
        </h2>

        <div className="space-y-5 px-5 py-4">
          <Section title="Customer Information">
            <Row label="App Date & Time:" value={formatClientDate(appointment.appointment_date) + ' • ' + formatTime(appointment.start_time)} />
            <Row label="Name:" field="full_name" value={leadValue(lead, 'full_name', 'full_name', 'name')} editValue={editValue('full_name', leadValue(lead, 'full_name', 'full_name', 'name'))} onChange={onChange} />
            <Row label="Phone:" field="phone_number" inputType="tel" value={leadValue(lead, 'phone_number', 'phone_number', 'phone')} editValue={editValue('phone_number', leadValue(lead, 'phone_number', 'phone_number', 'phone'))} onChange={onChange} />
            <Row label="Address:" field="address" value={formatAddress(lead)} editValue={editValue('address', formatAddress(lead))} onChange={onChange} />
            <Row label="Email:" field="email" inputType="email" value={leadValue(lead, 'email', 'email').toLowerCase()} editValue={editValue('email', leadValue(lead, 'email', 'email').toLowerCase())} onChange={onChange} />
            <Row label="Language:" field="language" value={leadValue(lead, 'language', 'language')} editValue={editValue('language', leadValue(lead, 'language', 'language'))} onChange={onChange} />
            <Row label="Services Needed:" field="service_needed" value={serviceNeeded} editValue={editValue('service_needed', serviceNeeded)} onChange={onChange} />
          </Section>

          <Section title="Property Details" columns>
            <Row label="Roof Age:" field="roof_age" value={formValue(lead, 'roof_age')} editValue={editValue('roof_age', formValue(lead, 'roof_age'))} onChange={onChange} />
            <Row label="Home Type:" field="home_type" value={formValue(lead, 'home_type')} editValue={editValue('home_type', formValue(lead, 'home_type'))} onChange={onChange} />
            <Row label="Roof Type:" field="roof_type" value={formValue(lead, 'roof_type')} editValue={editValue('roof_type', formValue(lead, 'roof_type'))} onChange={onChange} />
            <Row label="Stories:" field="stories" value={formValue(lead, 'stories')} editValue={editValue('stories', formValue(lead, 'stories'))} onChange={onChange} />
            <Row label="Insurance:" field="insurance" value={formValue(lead, 'insurance')} editValue={editValue('insurance', formValue(lead, 'insurance'))} onChange={onChange} />
            <Row label="Insurance Name:" field="insurance_name" value={formValue(lead, 'insurance_name')} editValue={editValue('insurance_name', formValue(lead, 'insurance_name'))} onChange={onChange} />
            <Row label="Contract:" field="contract" value={formValue(lead, 'contract')} editValue={editValue('contract', formValue(lead, 'contract'))} onChange={onChange} />
            <Row label="Home Value:" field="home_value" value={homeValue} editValue={editValue('home_value', rawHomeValue)} onChange={onChange} />
            <Row label="SQ FT:" field="sq_ft" value={squareFeet} editValue={editValue('sq_ft', rawSquareFeet)} onChange={onChange} />
            <Row label="Web Link:" field="web_url" inputType="url" value={webLink} editValue={editValue('web_url', webLink)} href={webLink || undefined} onChange={onChange} />
          </Section>

          <Section title="Additional Information" columns>
            <div className="col-span-full space-y-2">
              <Row label="Notes:" field="notes" multiline value={notes} editValue={editValue('notes', notes)} onChange={onChange} />
              <div className="border-t border-blue-100 pt-1">
                <Row label="Last Checked On:" field="last_checked_on" value={normalizeLastChecked(formValue(lead, 'last_checked_on', 'last_inspection_date'))} editValue={editValue('last_checked_on', formValue(lead, 'last_checked_on', 'last_inspection_date'))} onChange={onChange} />
              </div>
            </div>
            <Row label="Size of Hail:" field="hail_size" value={formValue(lead, 'hail_size', 'size_of_hail')} editValue={editValue('hail_size', formValue(lead, 'hail_size', 'size_of_hail'))} onChange={onChange} />
            <Row label="Claim Filed:" field="claim_filed" value={formValue(lead, 'claim_filed', 'file_claim')} editValue={editValue('claim_filed', formValue(lead, 'claim_filed', 'file_claim'))} onChange={onChange} />
            <Row label="Visible Damage:" field="visible_damage" value={formValue(lead, 'visible_damage')} editValue={editValue('visible_damage', formValue(lead, 'visible_damage'))} onChange={onChange} />
            <Row label="Damage Type:" field="damage_type" value={formValue(lead, 'damage_type', 'type_of_damage')} editValue={editValue('damage_type', formValue(lead, 'damage_type', 'type_of_damage'))} onChange={onChange} />
            <Row label="Add. Properties:" field="additional_properties" value={formValue(lead, 'additional_properties', 'add_properties')} editValue={editValue('additional_properties', formValue(lead, 'additional_properties', 'add_properties'))} onChange={onChange} />
            <Row label="2nd Address:" field="second_address" value={formValue(lead, 'second_address', 'other_address')} editValue={editValue('second_address', formValue(lead, 'second_address', 'other_address'))} onChange={onChange} />
          </Section>
        </div>

        {editable && (
          <div className="border-t border-blue-100 bg-blue-50/60 px-3 py-3">
            <button
              type="button"
              disabled={saving}
              onClick={() => void onSave?.()}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-black text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Save size={15} />
              {saving ? 'Saving…' : 'Save Lead Information'}
            </button>
          </div>
        )}

        {showStatusButtons && (
          <div className="flex flex-wrap gap-2 border-t border-slate-100 px-3 py-3">
            {STATUS_BUTTONS.map(([label, tone]) => (
              <button
                key={label}
                type="button"
                className={'min-w-0 flex-1 whitespace-nowrap rounded-lg px-2.5 py-2 text-[10px] font-black text-white shadow-sm ' + tone}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      <section className="overflow-hidden rounded-xl border border-blue-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-blue-100 bg-blue-50 px-4 py-3">
          <div>
            <h3 className="text-sm font-black text-slate-950">Copy &amp; Send Lead</h3>
            <p className="text-xs text-slate-600">
              All fields stay visible. Missing answers are shown as —.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void copyLeadTemplate()}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-black text-white shadow-sm hover:bg-blue-700"
          >
            {copied ? <Check size={15} /> : <Copy size={15} />}
            {copied ? 'Copied' : 'Copy Lead Template'}
          </button>
        </div>
        <textarea
          aria-label="Copy-ready lead template"
          value={copyText}
          readOnly
          spellCheck={false}
          className="min-h-[31rem] w-full resize-y border-0 bg-white px-4 py-4 font-mono text-sm leading-6 text-slate-900 outline-none focus:ring-2 focus:ring-inset focus:ring-blue-300"
        />
      </section>
    </div>
  );
}
