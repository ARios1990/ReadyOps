import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CalendarDays, CheckCircle2, Clipboard, ExternalLink, Loader2, Plus, RefreshCw, Save, ShieldCheck, Trash2, Users } from 'lucide-react';
import { supabase } from './supabase';
import { PortalFormField, PortalFormSection } from './DynamicLeadForm';
import { addDays, copyText, formatDateLong, formatTime, localDate, rpcError, startOfWeek } from './portalUtils';

interface Location { id: string; location_label: string; state: string | null; }
interface ScheduleRule { id: string; location_id: string | null; day_of_week: number; is_open: boolean; start_time: string; end_time: string; slot_minutes: number; max_per_slot: number; max_per_day: number; }
interface ScheduleException { id: string; location_id: string | null; exception_date: string; is_closed: boolean; start_time: string | null; end_time: string | null; note: string | null; }
interface Representative { id: string; name: string; phone: string | null; email: string | null; location_id: string | null; active: boolean; access_token: string; }
interface LeadRecord { id: string; lead_code: string; full_name: string; phone_number: string; address: string; city: string | null; state: string | null; zip_code: string | null; email: string | null; language: string | null; notes: string | null; form_data: Record<string, unknown>; qualification_status: string; }
interface Appointment { id: string; appointment_date: string; start_time: string; end_time: string; status: string; rep_status: string; attendance_status: string; inspection_status: string; sales_outcome: string; representative_id: string | null; representative_name: string | null; location_label: string | null; lead: LeadRecord; latest_checkin: { verified?: boolean; distance_m?: number; checked_in_at?: string } | null; }
interface AuditLog { id: string; action: string; actor_type: string; actor_name: string | null; entity_type: string; old_value: unknown; new_value: unknown; created_at: string; }
interface SettingsRecord {
  company_id: string; public_slug: string; portal_enabled: boolean; allow_public_booking: boolean; company_access_enabled: boolean; company_access_token: string; timezone: string;
  requirements_short: string; requirements_detail: string; qualification_rules: Record<string, unknown>; form_mode: 'internal' | 'external' | 'internal_external'; form_schema: PortalFormSection[];
  external_form_provider: string | null; external_form_url: string | null; external_prefill_map: Record<string, string>; external_submission_map: Record<string, string>;
  check_in_radius_m: number; check_in_before_minutes: number; check_in_after_minutes: number;
}
interface CompanyPortalData {
  company: { id: string; name: string; state: string | null; email: string | null; phone: string | null };
  settings: SettingsRecord;
  locations: Location[];
  schedule_rules: ScheduleRule[];
  exceptions: ScheduleException[];
  representatives: Representative[];
  appointments: Appointment[];
  audit_logs: AuditLog[];
}

type Tab = 'appointments' | 'schedule' | 'requirements' | 'forms' | 'reps' | 'audit';
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function CompanyPortal({ companyId, token }: { companyId: string; token: string }) {
  const [data, setData] = useState<CompanyPortalData | null>(null);
  const [tab, setTab] = useState<Tab>('appointments');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [selectedLead, setSelectedLead] = useState<Appointment | null>(null);
  const [settingsDraft, setSettingsDraft] = useState<SettingsRecord | null>(null);
  const [formSchema, setFormSchema] = useState<PortalFormSection[]>([]);
  const [prefillJson, setPrefillJson] = useState('{}');
  const [newRep, setNewRep] = useState({ name: '', phone: '', email: '', location_id: '' });
  const [newException, setNewException] = useState({ exception_date: '', is_closed: true, start_time: '09:00', end_time: '18:00', note: '', location_id: '' });
  const [scheduleLocation, setScheduleLocation] = useState<string>('');

  const windowStart = localDate(addDays(startOfWeek(), -7));
  const windowEnd = localDate(addDays(startOfWeek(), 28));

  async function load() {
    setLoading(true);
    setError('');
    const { data: result, error: rpcErr } = await supabase.rpc('get_company_management_portal', {
      p_company_id: companyId,
      p_access_token: token,
      p_start_date: windowStart,
      p_end_date: windowEnd,
    });
    if (rpcErr) {
      setError(rpcError(rpcErr));
      setData(null);
    } else {
      const portal = result as CompanyPortalData;
      setData(portal);
      setSettingsDraft(portal.settings);
      setFormSchema(portal.settings.form_schema || []);
      setPrefillJson(JSON.stringify(portal.settings.external_prefill_map || {}, null, 2));
    }
    setLoading(false);
  }

  useEffect(() => { void load(); }, [companyId, token]);

  function notify(message: string) {
    setSuccess(message);
    window.setTimeout(() => setSuccess(''), 2500);
  }

  async function saveSettings(patch: Record<string, unknown>, message = 'Settings saved.') {
    setBusy(true); setError('');
    const { error: rpcErr } = await supabase.rpc('update_company_portal_settings', { p_company_id: companyId, p_access_token: token, p_patch: patch });
    if (rpcErr) setError(rpcError(rpcErr)); else { notify(message); await load(); }
    setBusy(false);
  }

  async function saveRequirements() {
    if (!settingsDraft) return;
    await saveSettings({
      public_slug: settingsDraft.public_slug,
      portal_enabled: settingsDraft.portal_enabled,
      allow_public_booking: settingsDraft.allow_public_booking,
      company_access_enabled: settingsDraft.company_access_enabled,
      timezone: settingsDraft.timezone,
      requirements_short: settingsDraft.requirements_short,
      requirements_detail: settingsDraft.requirements_detail,
      qualification_rules: settingsDraft.qualification_rules,
      check_in_radius_m: settingsDraft.check_in_radius_m,
      check_in_before_minutes: settingsDraft.check_in_before_minutes,
      check_in_after_minutes: settingsDraft.check_in_after_minutes,
    });
  }

  async function saveForms() {
    if (!settingsDraft) return;
    let map: Record<string, string> = {};
    try { map = JSON.parse(prefillJson) as Record<string, string>; } catch { setError('External prefill mapping must be valid JSON.'); return; }
    await saveSettings({
      form_mode: settingsDraft.form_mode,
      form_schema: formSchema,
      external_form_provider: settingsDraft.external_form_provider || '',
      external_form_url: settingsDraft.external_form_url || '',
      external_prefill_map: map,
    }, 'Form settings saved.');
  }

  async function saveRule(day: number, draft: Partial<ScheduleRule>) {
    setBusy(true); setError('');
    const { error: rpcErr } = await supabase.rpc('upsert_company_schedule_rule', {
      p_company_id: companyId,
      p_access_token: token,
      p_rule: {
        location_id: scheduleLocation || null,
        day_of_week: day,
        is_open: draft.is_open ?? true,
        start_time: (draft.start_time || '09:00').slice(0, 5),
        end_time: (draft.end_time || '18:00').slice(0, 5),
        slot_minutes: Number(draft.slot_minutes || 60),
        max_per_slot: Number(draft.max_per_slot || 1),
        max_per_day: Number(draft.max_per_day || 8),
      },
    });
    if (rpcErr) setError(rpcError(rpcErr)); else { notify(`${DAY_NAMES[day]} schedule saved.`); await load(); }
    setBusy(false);
  }

  async function createException() {
    if (!newException.exception_date) { setError('Select an exception date.'); return; }
    setBusy(true); setError('');
    const payload = { ...newException, location_id: newException.location_id || null, start_time: newException.is_closed ? null : newException.start_time, end_time: newException.is_closed ? null : newException.end_time };
    const { error: rpcErr } = await supabase.rpc('create_company_schedule_exception', { p_company_id: companyId, p_access_token: token, p_exception: payload });
    if (rpcErr) setError(rpcError(rpcErr)); else { setNewException({ exception_date: '', is_closed: true, start_time: '09:00', end_time: '18:00', note: '', location_id: '' }); notify('Schedule exception added.'); await load(); }
    setBusy(false);
  }

  async function deleteException(id: string) {
    setBusy(true);
    const { error: rpcErr } = await supabase.rpc('delete_company_schedule_exception', { p_company_id: companyId, p_access_token: token, p_exception_id: id });
    if (rpcErr) setError(rpcError(rpcErr)); else { notify('Exception removed.'); await load(); }
    setBusy(false);
  }

  async function createRep() {
    if (!newRep.name.trim()) { setError('Representative name is required.'); return; }
    setBusy(true); setError('');
    const { error: rpcErr } = await supabase.rpc('create_company_representative', { p_company_id: companyId, p_access_token: token, p_representative: { ...newRep, location_id: newRep.location_id || null } });
    if (rpcErr) setError(rpcError(rpcErr)); else { setNewRep({ name: '', phone: '', email: '', location_id: '' }); notify('Representative created.'); await load(); }
    setBusy(false);
  }

  async function updateRep(rep: Representative, patch: Record<string, unknown>) {
    setBusy(true); setError('');
    const { error: rpcErr } = await supabase.rpc('update_company_representative', { p_company_id: companyId, p_access_token: token, p_representative_id: rep.id, p_patch: patch });
    if (rpcErr) setError(rpcError(rpcErr)); else { notify('Representative updated.'); await load(); }
    setBusy(false);
  }

  async function assignRep(appointmentId: string, repId: string) {
    setBusy(true); setError('');
    const { error: rpcErr } = await supabase.rpc('assign_appointment_representative', { p_company_id: companyId, p_access_token: token, p_appointment_id: appointmentId, p_representative_id: repId || null });
    if (rpcErr) setError(rpcError(rpcErr)); else { notify('Representative assignment updated.'); await load(); }
    setBusy(false);
  }

  async function updateAppointmentStatus(appointmentId: string, status: string) {
    setBusy(true); setError('');
    const { error: rpcErr } = await supabase.rpc('company_update_appointment_status', { p_company_id: companyId, p_access_token: token, p_appointment_id: appointmentId, p_status: status });
    if (rpcErr) setError(rpcError(rpcErr)); else { notify('Appointment status updated.'); await load(); }
    setBusy(false);
  }

  async function rotateCompanyToken() {
    if (!window.confirm('Regenerate the company management link? The current private link will stop working immediately.')) return;
    setBusy(true); setError('');
    const { data: newToken, error: rpcErr } = await supabase.rpc('regenerate_company_access_token', { p_company_id: companyId, p_access_token: token });
    if (rpcErr) setError(rpcError(rpcErr));
    else if (newToken) {
      const url = `${window.location.origin}/company/${companyId}/manage/${String(newToken)}`;
      window.history.replaceState({}, '', url);
      window.location.reload();
    }
    setBusy(false);
  }

  function updateFormField(sectionIndex: number, fieldIndex: number, patch: Partial<PortalFormField>) {
    setFormSchema(prev => prev.map((section, si) => si !== sectionIndex ? section : { ...section, fields: section.fields.map((field, fi) => fi !== fieldIndex ? field : { ...field, ...patch }) }));
  }

  function addFormField(sectionIndex: number) {
    const id = crypto.randomUUID().slice(0, 8);
    setFormSchema(prev => prev.map((section, index) => index !== sectionIndex ? section : { ...section, fields: [...section.fields, { key: `custom_${id}`, label: 'New Question', type: 'text', required: false }] }));
  }

  function removeFormField(sectionIndex: number, fieldIndex: number) {
    setFormSchema(prev => prev.map((section, si) => si !== sectionIndex ? section : { ...section, fields: section.fields.filter((_, fi) => fi !== fieldIndex) }));
  }

  const scheduleRules = useMemo(() => {
    const map = new Map<number, ScheduleRule>();
    (data?.schedule_rules || []).filter(rule => (rule.location_id || '') === scheduleLocation).forEach(rule => map.set(rule.day_of_week, rule));
    return map;
  }, [data, scheduleLocation]);

  if (loading && !data) return <PageState icon={<Loader2 className="animate-spin" />} title="Loading company portal..." />;
  if (!data || !settingsDraft) return <PageState icon={<AlertTriangle />} title="Company portal unavailable" detail={error || 'This secure link may be invalid or disabled.'} />;

  const agentLink = `${window.location.origin}/book/${settingsDraft.public_slug}`;
  const companyLink = `${window.location.origin}/company/${companyId}/manage/${token}`;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur"><div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6"><div><p className="text-xs font-bold uppercase tracking-[0.18em] text-blue-600">Company Management</p><h1 className="text-lg font-bold">{data.company.name}</h1></div><div className="flex items-center gap-2"><span className="hidden rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700 sm:inline">Secure Link</span><button onClick={() => void load()} className="rounded-lg border border-slate-200 p-2 text-slate-600"><RefreshCw size={16} /></button></div></div></header>

      <main className="mx-auto max-w-7xl px-4 py-5 sm:px-6">
        {error && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
        {success && <div className="mb-4 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700"><CheckCircle2 size={16} /> {success}</div>}

        <section className="mb-5 grid gap-3 md:grid-cols-2">
          <LinkCard title="Agent Booking Link" value={agentLink} onCopy={() => void copyText(agentLink)} onOpen={() => window.open(agentLink, '_blank', 'noopener,noreferrer')} />
          <LinkCard title="Private Company Link" value={companyLink} onCopy={() => void copyText(companyLink)} onOpen={() => window.open(companyLink, '_blank', 'noopener,noreferrer')} privateLink />
        </section>

        <nav className="mb-5 flex gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1">
          {([['appointments','Appointments',CalendarDays],['schedule','Schedule',CalendarDays],['requirements','Requirements',ShieldCheck],['forms','Forms',Clipboard],['reps','Reps',Users],['audit','Audit',ShieldCheck]] as [Tab,string,typeof CalendarDays][]).map(([key,label,Icon]) => <button key={key} onClick={() => setTab(key)} className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold ${tab === key ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}><Icon size={14} />{label}</button>)}
        </nav>

        {tab === 'appointments' && <section className="space-y-3"><div><h2 className="text-lg font-bold">Appointments</h2><p className="text-sm text-slate-500">Homeowner preview, rep assignment, attendance and appointment outcome.</p></div>{data.appointments.length === 0 ? <Empty text="No appointments in this date window." /> : data.appointments.map(appt => <article key={appt.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between"><button onClick={() => setSelectedLead(appt)} className="text-left"><p className="text-xs font-bold text-blue-600">{formatDateLong(appt.appointment_date)} • {formatTime(appt.start_time)}</p><h3 className="mt-1 font-bold">{appt.lead.full_name}</h3><p className="text-sm text-slate-600">{appt.lead.phone_number} • {appt.lead.address}</p><p className="mt-1 text-xs text-slate-400">{appt.location_label || 'Company-wide'} • {appt.attendance_status.replace(/_/g, ' ')}</p></button><div className="grid gap-2 sm:grid-cols-2 lg:min-w-[420px]"><select value={appt.representative_id || ''} onChange={e => void assignRep(appt.id, e.target.value)} disabled={busy} className="rounded-xl border border-slate-200 px-3 py-2 text-sm"><option value="">Unassigned</option>{data.representatives.filter(rep => rep.active).map(rep => <option key={rep.id} value={rep.id}>{rep.name}</option>)}</select><select value={appt.status} onChange={e => void updateAppointmentStatus(appt.id, e.target.value)} disabled={busy} className="rounded-xl border border-slate-200 px-3 py-2 text-sm"><option value="confirmed">Confirmed</option><option value="assigned">Assigned</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option></select></div></div></article>)}</section>}

        {tab === 'requirements' && <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="mb-5 flex items-center justify-between"><div><h2 className="font-bold">Portal & Qualification Settings</h2><p className="text-sm text-slate-500">Changes are reflected on the agent link.</p></div><button disabled={busy} onClick={() => void saveRequirements()} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white"><Save size={15} /> Save</button></div><div className="grid gap-4 sm:grid-cols-2"><TextField label="Public URL Slug" value={settingsDraft.public_slug} onChange={value => setSettingsDraft({ ...settingsDraft, public_slug: value })} /><TextField label="Timezone" value={settingsDraft.timezone} onChange={value => setSettingsDraft({ ...settingsDraft, timezone: value })} /><Toggle label="Agent Portal Enabled" checked={settingsDraft.portal_enabled} onChange={value => setSettingsDraft({ ...settingsDraft, portal_enabled: value })} /><Toggle label="Allow Agent Booking" checked={settingsDraft.allow_public_booking} onChange={value => setSettingsDraft({ ...settingsDraft, allow_public_booking: value })} /><div className="sm:col-span-2"><TextArea label="Quick Requirements" value={settingsDraft.requirements_short} onChange={value => setSettingsDraft({ ...settingsDraft, requirements_short: value })} /></div><div className="sm:col-span-2"><TextArea label="Detailed Requirements" value={settingsDraft.requirements_detail} onChange={value => setSettingsDraft({ ...settingsDraft, requirements_detail: value })} /></div><NumberField label="Minimum Roof Age" value={numberOrBlank(settingsDraft.qualification_rules.minimum_roof_age)} onChange={value => setSettingsDraft({ ...settingsDraft, qualification_rules: { ...settingsDraft.qualification_rules, minimum_roof_age: value === '' ? null : Number(value) } })} /><NumberField label="Minimum SQ FT" value={numberOrBlank(settingsDraft.qualification_rules.minimum_sq_ft)} onChange={value => setSettingsDraft({ ...settingsDraft, qualification_rules: { ...settingsDraft.qualification_rules, minimum_sq_ft: value === '' ? null : Number(value) } })} /><Toggle label="Contract Must Be No" checked={Boolean(settingsDraft.qualification_rules.contract_must_be_no)} onChange={value => setSettingsDraft({ ...settingsDraft, qualification_rules: { ...settingsDraft.qualification_rules, contract_must_be_no: value } })} /><Toggle label="Block Disqualified Leads" checked={Boolean(settingsDraft.qualification_rules.block_disqualified)} onChange={value => setSettingsDraft({ ...settingsDraft, qualification_rules: { ...settingsDraft.qualification_rules, block_disqualified: value } })} /><NumberField label="GPS Check-In Radius (meters)" value={String(settingsDraft.check_in_radius_m)} onChange={value => setSettingsDraft({ ...settingsDraft, check_in_radius_m: Number(value || 152) })} /><div className="flex items-end"><button disabled={busy} onClick={() => void rotateCompanyToken()} className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-bold text-red-700">Regenerate Private Company Link</button></div></div></section>}

        {tab === 'schedule' && <section className="space-y-5"><div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><h2 className="font-bold">Weekly Schedule</h2><p className="text-sm text-slate-500">Edit availability by company or service area.</p></div><div><label className="mb-1 block text-xs font-semibold text-slate-500">Schedule Scope</label><select value={scheduleLocation} onChange={e => setScheduleLocation(e.target.value)} className="rounded-xl border border-slate-200 px-3 py-2 text-sm"><option value="">Company-wide</option>{data.locations.map(loc => <option key={loc.id} value={loc.id}>{loc.location_label}{loc.state ? `, ${loc.state}` : ''}</option>)}</select></div></div><div className="space-y-2">{DAY_NAMES.map((name, day) => <ScheduleRuleRow key={name} day={day} name={name} rule={scheduleRules.get(day)} busy={busy} onSave={draft => void saveRule(day, draft)} />)}</div></div><div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="font-bold">Closed Dates / Special Hours</h2><div className="mt-4 grid gap-3 md:grid-cols-6"><input type="date" value={newException.exception_date} onChange={e => setNewException({ ...newException, exception_date: e.target.value })} className="rounded-xl border border-slate-200 px-3 py-2 text-sm" /><select value={newException.location_id} onChange={e => setNewException({ ...newException, location_id: e.target.value })} className="rounded-xl border border-slate-200 px-3 py-2 text-sm"><option value="">Company-wide</option>{data.locations.map(loc => <option key={loc.id} value={loc.id}>{loc.location_label}</option>)}</select><label className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm"><input type="checkbox" checked={newException.is_closed} onChange={e => setNewException({ ...newException, is_closed: e.target.checked })} /> Closed</label>{!newException.is_closed && <><input type="time" value={newException.start_time} onChange={e => setNewException({ ...newException, start_time: e.target.value })} className="rounded-xl border border-slate-200 px-3 py-2 text-sm" /><input type="time" value={newException.end_time} onChange={e => setNewException({ ...newException, end_time: e.target.value })} className="rounded-xl border border-slate-200 px-3 py-2 text-sm" /></>}<button onClick={() => void createException()} disabled={busy} className="rounded-xl bg-blue-600 px-3 py-2 text-sm font-bold text-white">Add</button></div><div className="mt-4 space-y-2">{data.exceptions.map(item => <div key={item.id} className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2 text-sm"><span><strong>{formatDateLong(item.exception_date)}</strong> — {item.is_closed ? 'Closed' : `${formatTime(item.start_time || '')}–${formatTime(item.end_time || '')}`} {item.note ? `• ${item.note}` : ''}</span><button onClick={() => void deleteException(item.id)} className="text-red-600"><Trash2 size={15} /></button></div>)}</div></div></section>}

        {tab === 'forms' && <section className="space-y-5"><div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="mb-5 flex items-center justify-between"><div><h2 className="font-bold">Appointment Form</h2><p className="text-sm text-slate-500">Use the built-in form, a client form, or both.</p></div><button onClick={() => void saveForms()} disabled={busy} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white"><Save size={15} /> Save Form</button></div><div className="grid gap-4 sm:grid-cols-2"><div><label className="mb-1 block text-xs font-semibold text-slate-600">Form Mode</label><select value={settingsDraft.form_mode} onChange={e => setSettingsDraft({ ...settingsDraft, form_mode: e.target.value as SettingsRecord['form_mode'] })} className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm"><option value="internal">Internal Ready Ops Form</option><option value="external">External Form</option><option value="internal_external">Internal + External</option></select></div>{settingsDraft.form_mode !== 'internal' && <><TextField label="External Provider" value={settingsDraft.external_form_provider || ''} onChange={value => setSettingsDraft({ ...settingsDraft, external_form_provider: value })} /><div className="sm:col-span-2"><TextField label="External Form URL" value={settingsDraft.external_form_url || ''} onChange={value => setSettingsDraft({ ...settingsDraft, external_form_url: value })} /></div><div className="sm:col-span-2"><TextArea label="Prefill Mapping JSON (internal field → external query parameter)" value={prefillJson} onChange={setPrefillJson} /></div></>}</div></div>{settingsDraft.form_mode !== 'external' && <div className="space-y-4">{formSchema.map((section, sectionIndex) => <div key={section.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="mb-3 flex items-center justify-between"><input value={section.title} onChange={e => setFormSchema(prev => prev.map((item, idx) => idx === sectionIndex ? { ...item, title: e.target.value } : item))} className="text-base font-bold outline-none" /><button onClick={() => addFormField(sectionIndex)} className="inline-flex items-center gap-1 rounded-lg bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700"><Plus size={13} /> Add Question</button></div><div className="space-y-2">{section.fields.map((field, fieldIndex) => <FormFieldEditor key={`${section.id}-${field.key}`} field={field} onChange={patch => updateFormField(sectionIndex, fieldIndex, patch)} onRemove={() => removeFormField(sectionIndex, fieldIndex)} />)}</div></div>)}</div>}</section>}

        {tab === 'reps' && <section className="space-y-4"><div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="font-bold">Add Representative</h2><div className="mt-4 grid gap-3 md:grid-cols-5"><input placeholder="Full name" value={newRep.name} onChange={e => setNewRep({ ...newRep, name: e.target.value })} className="rounded-xl border border-slate-200 px-3 py-2 text-sm" /><input placeholder="Phone" value={newRep.phone} onChange={e => setNewRep({ ...newRep, phone: e.target.value })} className="rounded-xl border border-slate-200 px-3 py-2 text-sm" /><input placeholder="Email" value={newRep.email} onChange={e => setNewRep({ ...newRep, email: e.target.value })} className="rounded-xl border border-slate-200 px-3 py-2 text-sm" /><select value={newRep.location_id} onChange={e => setNewRep({ ...newRep, location_id: e.target.value })} className="rounded-xl border border-slate-200 px-3 py-2 text-sm"><option value="">All areas</option>{data.locations.map(loc => <option key={loc.id} value={loc.id}>{loc.location_label}</option>)}</select><button disabled={busy} onClick={() => void createRep()} className="rounded-xl bg-blue-600 px-3 py-2 text-sm font-bold text-white">Create Rep</button></div></div><div className="grid gap-3 lg:grid-cols-2">{data.representatives.map(rep => { const repLink = `${window.location.origin}/rep/${rep.access_token}`; return <article key={rep.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex items-start justify-between gap-3"><div><h3 className="font-bold">{rep.name}</h3><p className="text-xs text-slate-500">{rep.phone || 'No phone'} • {rep.email || 'No email'}</p></div><span className={`rounded-full px-2 py-1 text-[10px] font-bold ${rep.active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{rep.active ? 'ACTIVE' : 'DISABLED'}</span></div><div className="mt-3 flex flex-wrap gap-2"><button onClick={() => void copyText(repLink)} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold"><Clipboard size={13} /> Copy Rep Link</button><button onClick={() => window.open(repLink, '_blank', 'noopener,noreferrer')} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold"><ExternalLink size={13} /> Open</button><button onClick={() => void updateRep(rep, { active: !rep.active })} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold">{rep.active ? 'Disable' : 'Enable'}</button><button onClick={() => void updateRep(rep, { regenerate_token: true })} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700">New Link</button></div></article>; })}</div></section>}

        {tab === 'audit' && <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="font-bold">Audit History</h2><div className="mt-4 space-y-2">{data.audit_logs.length === 0 ? <Empty text="No recorded changes yet." /> : data.audit_logs.map(item => <div key={item.id} className="rounded-xl bg-slate-50 px-3 py-2"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-bold text-slate-800">{item.action.replace(/_/g, ' ')}</p><span className="text-xs text-slate-400">{new Date(item.created_at).toLocaleString()}</span></div><p className="mt-1 text-xs text-slate-500">{item.actor_name || item.actor_type} • {item.entity_type}</p></div>)}</div></section>}
      </main>

      {selectedLead && <LeadModal appointment={selectedLead} onClose={() => setSelectedLead(null)} />}
    </div>
  );
}

function ScheduleRuleRow({ day, name, rule, busy, onSave }: { day: number; name: string; rule?: ScheduleRule; busy: boolean; onSave: (draft: Partial<ScheduleRule>) => void }) {
  const [draft, setDraft] = useState<Partial<ScheduleRule>>(() => rule || { day_of_week: day, is_open: day !== 0, start_time: '09:00', end_time: '18:00', slot_minutes: 60, max_per_slot: 1, max_per_day: 8 });
  useEffect(() => setDraft(rule || { day_of_week: day, is_open: day !== 0, start_time: '09:00', end_time: '18:00', slot_minutes: 60, max_per_slot: 1, max_per_day: 8 }), [rule, day]);
  return <div className="grid gap-2 rounded-xl border border-slate-100 bg-slate-50 p-3 md:grid-cols-[110px_90px_repeat(5,1fr)_70px] md:items-center"><strong className="text-sm">{name}</strong><label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={Boolean(draft.is_open)} onChange={e => setDraft({ ...draft, is_open: e.target.checked })} /> Open</label><input type="time" value={String(draft.start_time || '').slice(0,5)} onChange={e => setDraft({ ...draft, start_time: e.target.value })} className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs" /><input type="time" value={String(draft.end_time || '').slice(0,5)} onChange={e => setDraft({ ...draft, end_time: e.target.value })} className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs" /><input title="Minutes between slots" type="number" min="15" value={draft.slot_minutes || 60} onChange={e => setDraft({ ...draft, slot_minutes: Number(e.target.value) })} className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs" /><input title="Max per time slot" type="number" min="1" value={draft.max_per_slot || 1} onChange={e => setDraft({ ...draft, max_per_slot: Number(e.target.value) })} className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs" /><input title="Max per day" type="number" min="1" value={draft.max_per_day || 8} onChange={e => setDraft({ ...draft, max_per_day: Number(e.target.value) })} className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs" /><button disabled={busy} onClick={() => onSave(draft)} className="rounded-lg bg-blue-600 px-2 py-2 text-xs font-bold text-white">Save</button></div>;
}

function FormFieldEditor({ field, onChange, onRemove }: { field: PortalFormField; onChange: (patch: Partial<PortalFormField>) => void; onRemove: () => void }) {
  const optionText = (field.options || []).join(', ');
  return <div className="grid gap-2 rounded-xl bg-slate-50 p-3 md:grid-cols-[1.5fr_1fr_1fr_auto_auto]"><input value={field.label} onChange={e => onChange({ label: e.target.value })} className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm" /><select value={field.type} onChange={e => onChange({ type: e.target.value })} className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm"><option value="text">Text</option><option value="textarea">Long Text</option><option value="phone">Phone</option><option value="email">Email</option><option value="address">Address</option><option value="number">Number</option><option value="currency">Currency</option><option value="url">URL</option><option value="select">Dropdown</option><option value="multiselect">Multi Select</option><option value="date">Date</option><option value="time">Time</option></select>{(field.type === 'select' || field.type === 'multiselect') ? <input value={optionText} onChange={e => onChange({ options: e.target.value.split(',').map(v => v.trim()).filter(Boolean) })} placeholder="Option 1, Option 2" className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs" /> : <input value={field.key} onChange={e => onChange({ key: e.target.value.replace(/\s+/g, '_').toLowerCase() })} className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs text-slate-500" />}<label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={Boolean(field.required)} onChange={e => onChange({ required: e.target.checked })} /> Required</label><button onClick={onRemove} className="text-red-600"><Trash2 size={15} /></button></div>;
}

function LeadModal({ appointment, onClose }: { appointment: Appointment; onClose: () => void }) { const lead = appointment.lead; return <div className="fixed inset-0 z-50 overflow-y-auto bg-black/40 p-4" onClick={onClose}><div className="mx-auto my-8 max-w-3xl rounded-2xl bg-white p-5 shadow-2xl" onClick={e => e.stopPropagation()}><div className="flex items-start justify-between"><div><p className="text-xs font-bold text-blue-600">{lead.lead_code}</p><h2 className="text-xl font-bold">{lead.full_name}</h2><p className="text-sm text-slate-500">{formatDateLong(appointment.appointment_date)} • {formatTime(appointment.start_time)}</p></div><button onClick={onClose} className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-bold">Close</button></div><div className="mt-5 grid gap-3 sm:grid-cols-2"><Detail label="Phone" value={lead.phone_number} /><Detail label="Address" value={[lead.address, lead.city, lead.state, lead.zip_code].filter(Boolean).join(', ')} /><Detail label="Email" value={lead.email} /><Detail label="Language" value={lead.language} /><Detail label="Qualification" value={lead.qualification_status} /><Detail label="Representative" value={appointment.representative_name || 'Unassigned'} /></div><h3 className="mt-6 mb-2 font-bold">Lead Template</h3><div className="grid gap-2 sm:grid-cols-2">{Object.entries(lead.form_data || {}).map(([key,value]) => <Detail key={key} label={key.replace(/_/g,' ')} value={Array.isArray(value) ? value.join(', ') : value == null ? '' : String(value)} />)}</div>{lead.notes && <div className="mt-4 rounded-xl bg-slate-50 p-3"><p className="text-xs font-bold text-slate-500">Notes</p><p className="mt-1 whitespace-pre-line text-sm">{lead.notes}</p></div>}</div></div>; }
function LinkCard({ title, value, onCopy, onOpen, privateLink=false }: { title:string; value:string; onCopy:()=>void; onOpen:()=>void; privateLink?:boolean }) { return <div className={`rounded-2xl border p-4 ${privateLink ? 'border-amber-200 bg-amber-50' : 'border-blue-200 bg-blue-50'}`}><p className="text-xs font-bold text-slate-700">{title}</p><p className="mt-1 truncate text-xs text-slate-500">{value}</p><div className="mt-3 flex gap-2"><button onClick={onCopy} className="inline-flex items-center gap-1 rounded-lg bg-white px-3 py-2 text-xs font-bold shadow-sm"><Clipboard size={13} /> Copy</button><button onClick={onOpen} className="inline-flex items-center gap-1 rounded-lg bg-white px-3 py-2 text-xs font-bold shadow-sm"><ExternalLink size={13} /> Open</button></div></div>; }
function TextField({ label,value,onChange }:{label:string;value:string;onChange:(value:string)=>void}) { return <div><label className="mb-1 block text-xs font-semibold text-slate-600">{label}</label><input value={value} onChange={e=>onChange(e.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm" /></div>; }
function TextArea({ label,value,onChange }:{label:string;value:string;onChange:(value:string)=>void}) { return <div><label className="mb-1 block text-xs font-semibold text-slate-600">{label}</label><textarea value={value} onChange={e=>onChange(e.target.value)} className="min-h-24 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm" /></div>; }
function NumberField({ label,value,onChange }:{label:string;value:string;onChange:(value:string)=>void}) { return <div><label className="mb-1 block text-xs font-semibold text-slate-600">{label}</label><input type="number" value={value} onChange={e=>onChange(e.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm" /></div>; }
function Toggle({ label,checked,onChange }:{label:string;checked:boolean;onChange:(value:boolean)=>void}) { return <label className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-3 text-sm font-medium"><span>{label}</span><input type="checkbox" checked={checked} onChange={e=>onChange(e.target.checked)} /></label>; }
function Detail({ label,value }:{label:string;value:unknown}) { return <div className="rounded-xl bg-slate-50 p-3"><p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</p><p className="mt-1 break-words text-sm font-medium text-slate-800">{value == null || value === '' ? '—' : String(value)}</p></div>; }
function Empty({ text }:{text:string}) { return <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-400">{text}</div>; }
function PageState({ icon,title,detail }:{icon:React.ReactNode;title:string;detail?:string}) { return <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6"><div className="max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm"><div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-500">{icon}</div><h1 className="font-bold">{title}</h1>{detail && <p className="mt-2 text-sm text-slate-500">{detail}</p>}</div></div>; }
function numberOrBlank(value:unknown):string { return value === null || value === undefined || value === '' ? '' : String(value); }
