import { ExternalLink } from 'lucide-react';
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

function Row({ label, value, href }: { label: string; value: string; href?: string }) {
  const displayValue = value || EMPTY;

  return (
    <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 py-0.5 text-sm leading-5">
      <strong className="shrink-0 font-bold text-slate-950">{label}</strong>
      {href && value ? (
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
    </div>
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
}: {
  lead: LeadLike;
  appointment: AppointmentLike;
  showLabel?: boolean;
  showStatusButtons?: boolean;
}) {
  const serviceNeeded = leadValue(lead, 'service_needed', 'service_needed', 'services_needed', 'services_need');
  const homeValue = formatCurrency(leadValue(lead, 'home_value', 'home_value'));
  const squareFeet = formatInteger(leadValue(lead, 'sq_ft', 'sq_ft', 'square_feet', 'square_footage'));
  const webLink = leadValue(lead, 'web_url', 'web_url', 'web_link', 'zillow_url', 'zillow_link');
  const notes = leadValue(lead, 'notes', 'notes');

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
            <Row label="Name:" value={leadValue(lead, 'full_name', 'full_name', 'name')} />
            <Row label="Phone:" value={leadValue(lead, 'phone_number', 'phone_number', 'phone')} />
            <Row label="Address:" value={formatAddress(lead)} />
            <Row label="Email:" value={leadValue(lead, 'email', 'email').toLowerCase()} />
            <Row label="Language:" value={leadValue(lead, 'language', 'language')} />
            <Row label="Services Needed:" value={serviceNeeded} />
          </Section>

          <Section title="Property Details" columns>
            <Row label="Roof Age:" value={formValue(lead, 'roof_age')} />
            <Row label="Home Type:" value={formValue(lead, 'home_type')} />
            <Row label="Roof Type:" value={formValue(lead, 'roof_type')} />
            <Row label="Stories:" value={formValue(lead, 'stories')} />
            <Row label="Insurance:" value={formValue(lead, 'insurance')} />
            <Row label="Insurance Name:" value={formValue(lead, 'insurance_name')} />
            <Row label="Contract:" value={formValue(lead, 'contract')} />
            <Row label="Home Value:" value={homeValue} />
            <Row label="SQ FT:" value={squareFeet} />
            <Row label="Web Link:" value={webLink} href={webLink || undefined} />
          </Section>

          <Section title="Additional Information" columns>
            <Row label="Notes:" value={notes} />
            <Row label="Last Checked On:" value={normalizeLastChecked(formValue(lead, 'last_checked_on', 'last_inspection_date'))} />
            <Row label="Size of Hail:" value={formValue(lead, 'hail_size', 'size_of_hail')} />
            <Row label="Claim Filed:" value={formValue(lead, 'claim_filed', 'file_claim')} />
            <Row label="Visible Damage:" value={formValue(lead, 'visible_damage')} />
            <Row label="Damage Type:" value={formValue(lead, 'damage_type', 'type_of_damage')} />
            <Row label="Add. Properties:" value={formValue(lead, 'additional_properties', 'add_properties')} />
            <Row label="2nd Address:" value={formValue(lead, 'second_address', 'other_address')} />
          </Section>
        </div>

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
    </div>
  );
}
