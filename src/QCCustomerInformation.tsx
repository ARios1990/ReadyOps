import { useEffect, useId, useRef, useState, type RefObject } from 'react';
import { ChevronDown, ChevronUp, Eye, EyeOff } from 'lucide-react';
import { cleanProfileValue, ROOFING_SERVICE_OPTIONS } from './bookingDefaults';
import { LANGUAGE_OPTIONS } from './appointmentQualifiers';

const SERVICES = [...ROOFING_SERVICE_OPTIONS.slice(0, -1), 'Exterior Inspection', 'Other'];
const STATES = 'AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC'.split(' ');
const control = 'mt-1 min-h-11 w-full min-w-0 rounded-md border border-blue-100 bg-white px-2 py-2 text-sm font-medium text-slate-900 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100';

export function QCCustomerInformation({ values, appointment, onChange, serviceRef }: { values: Record<string, unknown>; appointment: string; onChange: (key: string, value: string) => void; serviceRef: RefObject<HTMLSelectElement> }) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const detailsId = useId();
  const addressRef = useRef<HTMLTextAreaElement>(null);
  const form = (values.form_data || {}) as Record<string, unknown>;
  const value = (key: string) => cleanProfileValue(values[key] ?? form[key] ?? (key === 'zip_code' ? form.zip : ''));
  const service = SERVICES.find(item => item.toLowerCase() === value('service_needed').toLowerCase()) || value('service_needed');
  const address = value('address');
  useEffect(() => {
    const field = addressRef.current;
    if (!field) return;
    const resize = () => { field.style.height = 'auto'; field.style.height = `${Math.max(44, field.scrollHeight)}px`; };
    resize();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize);
    observer?.observe(field);
    return () => observer?.disconnect();
  }, [address]);
  const textField = (key: string, label: string, type = 'text', hidden = false) => <label className="block min-w-0 text-sm font-bold text-slate-950">{label}<input aria-label={label} type={type} value={value(key)} tabIndex={hidden ? -1 : undefined} onChange={event => onChange(key, event.target.value)} className={control}/></label>;
  return <div className="grid min-w-0 gap-3 py-2 sm:grid-cols-2">
    <label className="block min-w-0 text-sm font-bold text-slate-950">Services Needed<select ref={serviceRef} aria-label="Services Needed" required value={service} onChange={event => onChange('service_needed', event.target.value)} className={control}><option value="">Select Service</option>{service && !SERVICES.includes(service) && <option value={service} disabled>{service}</option>}{SERVICES.map(item => <option key={item} value={item}>{item}</option>)}</select></label>
    <div className="min-w-0 text-sm text-slate-800"><strong className="block font-bold text-slate-950">App Date &amp; Time</strong><p className="mt-1 flex min-h-11 items-center break-words py-2">{appointment}</p></div>
    {textField('full_name', 'Customer Name')}{textField('phone_number', 'Phone Number', 'tel')}
    <label className="block min-w-0 text-sm font-bold text-slate-950 sm:col-span-2">Address<textarea ref={addressRef} aria-label="Address" rows={2} value={address} onChange={event => onChange('address', event.target.value)} className={control + ' resize-y overflow-hidden whitespace-pre-wrap break-words'}/></label>
    <label className="block min-w-0 text-sm font-bold text-slate-950">Language<select aria-label="Language" value={value('language')} onChange={event => onChange('language', event.target.value)} className={control}><option value="">Select…</option>{value('language') && !LANGUAGE_OPTIONS.includes(value('language')) && <option value={value('language')}>{value('language')}</option>}{LANGUAGE_OPTIONS.map(item => <option key={item}>{item}</option>)}</select></label>
    {textField('email', 'Email', 'email')}
    <div className="sm:col-span-2"><button type="button" aria-expanded={detailsOpen} aria-controls={detailsId} onClick={() => setDetailsOpen(open => !open)} className="inline-flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700">{detailsOpen ? <EyeOff size={14}/> : <Eye size={14}/>} {detailsOpen ? 'Hide Address Details' : 'Show Address Details'} {detailsOpen ? <ChevronUp size={13}/> : <ChevronDown size={13}/>}</button></div>
    <div id={detailsId} aria-hidden={!detailsOpen} className="grid transition-[grid-template-rows,opacity] duration-200 motion-reduce:transition-none sm:col-span-2" style={{ gridTemplateRows: detailsOpen ? '1fr' : '0fr', opacity: detailsOpen ? 1 : 0 }}><div className="min-h-0 overflow-hidden"><div className="grid gap-3 sm:grid-cols-3">
      {textField('city', 'City', 'text', !detailsOpen)}
      <label className="block min-w-0 text-sm font-bold text-slate-950">State<select aria-label="State" value={value('state').toUpperCase()} tabIndex={detailsOpen ? undefined : -1} onChange={event => onChange('state', event.target.value)} className={control}><option value="">Select State</option>{value('state') && !STATES.includes(value('state').toUpperCase()) && <option value={value('state').toUpperCase()}>{value('state')}</option>}{STATES.map(item => <option key={item}>{item}</option>)}</select></label>
      {textField('zip_code', 'ZIP Code', 'text', !detailsOpen)}
    </div></div></div>
  </div>;
}
