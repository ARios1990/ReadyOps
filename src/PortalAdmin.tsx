import { type ReactNode, useEffect, useMemo, useState } from 'react';
import {
  Ban, Building2, CalendarDays, CheckCircle2, ChevronDown, ChevronUp, Clipboard,
  Copy, ExternalLink, Link2, Loader2, MapPin, PackageCheck, Pencil, Plus, RefreshCw,
  Search, Settings, ShieldCheck, UsersRound, WalletCards,
} from 'lucide-react';
import { supabase } from './supabase';
import { copyText, formatDateLong, formatTime, localDate, rpcError } from './portalUtils';
import { ReadyModeAgentTools } from './ReadyModeAgentTools';
import { AdminSchedulingManager } from './AdminSchedulingManager';
import { useScheduleStore } from './useScheduleStore';
import { TIME_SLOTS, formatTimeAmPm, type CompanyLocation } from './types';
import { AdminWorkspaceShell } from './AdminWorkspaceShell';

// Admin RPC payloads are intentionally flexible because several legacy and
// current database response shapes are rendered on this operations screen.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Obj = Record<string, any>;
type ScheduleStore = ReturnType<typeof useScheduleStore>;
type PackageDraft = { lead_target: string; amount_per_lead: string; package_total: string; payment_date: string; payment_status: string };
type SlugEditorState = { companyId: string; companyName: string; value: string };
const EMPTY_PACKAGE: PackageDraft = { lead_target: '', amount_per_lead: '', package_total: '', payment_date: '', payment_status: 'pending' };

function normalizeSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export function PortalAdmin() {
  const store = useScheduleStore();
  const [companies, setCompanies] = useState<Obj[]>([]);
  const [agents, setAgents] = useState<Obj[]>([]);
  const [locations, setLocations] = useState<CompanyLocation[]>([]);
  const [locationAgents, setLocationAgents] = useState<Obj[]>([]);
  const [packageScopes, setPackageScopes] = useState<Obj[]>([]);
  const [representatives, setRepresentatives] = useState<Obj[]>([]);
  const [settings, setSettings] = useState<Obj[]>([]);
  const [expanded, setExpanded] = useState('');
  const [detail, setDetail] = useState<Obj[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [filter, setFilter] = useState<'active' | 'pending-payment' | 'all'>('active');
  const [search, setSearch] = useState('');
  const [companyFilter, setCompanyFilter] = useState('');
  const [locationFilter, setLocationFilter] = useState('');
  const [teamFilter, setTeamFilter] = useState('');
  const [agentFilter, setAgentFilter] = useState('');
  const [appointmentDate, setAppointmentDate] = useState(() => localDate(new Date()));
  const [pkg, setPkg] = useState<PackageDraft>(EMPTY_PACKAGE);
  const [packageAllLocations, setPackageAllLocations] = useState(true);
  const [packageLocationIds, setPackageLocationIds] = useState<string[]>([]);
  const [inviteName, setInviteName] = useState('');
  const [inviteLink, setInviteLink] = useState('');
  const [manager, setManager] = useState<{ companyId: string; mode: 'company' | 'locations'; locationId?: string } | null>(null);
  const [slugEditor, setSlugEditor] = useState<SlugEditorState | null>(null);
  const [slugSaving, setSlugSaving] = useState(false);

  async function load() {
    setLoading(true);
    setError('');
    const [companyRes, agentRes, locationRes, assignmentRes, scopeRes, representativeRes, settingsRes] = await Promise.all([
      supabase.rpc('get_company_operations_overview'),
      supabase.from('agents').select('id,name,email,portal_slug,access_token,active').order('name'),
      supabase.from('company_locations').select('*').order('sort_order').order('location_label'),
      supabase.from('company_location_agents').select('*'),
      supabase.from('company_package_locations').select('*'),
      supabase.from('company_representatives').select('id,company_id,location_id,name,email,phone,active').order('name'),
      supabase.from('company_portal_settings').select('company_id,requirements_short,requirements_detail,qualification_rules'),
    ]);
    const firstError = companyRes.error || agentRes.error || locationRes.error || assignmentRes.error || scopeRes.error || representativeRes.error || settingsRes.error;
    if (firstError) setError(rpcError(firstError));
    else {
      setCompanies((companyRes.data || []) as Obj[]);
      setAgents((agentRes.data || []) as Obj[]);
      setLocations((locationRes.data || []) as CompanyLocation[]);
      setLocationAgents((assignmentRes.data || []) as Obj[]);
      setPackageScopes((scopeRes.data || []) as Obj[]);
      setRepresentatives((representativeRes.data || []) as Obj[]);
      setSettings((settingsRes.data || []) as Obj[]);
    }
    setLoading(false);
  }

  useEffect(() => { void load(); }, []);
  useEffect(() => {
    const requestedCompany = new URLSearchParams(window.location.search).get('company');
    if (requestedCompany && companies.some(company => company.company_id === requestedCompany) && expanded !== requestedCompany) {
      const company = companies.find(item => item.company_id === requestedCompany);
      if (company) void toggleCompany(company);
    }
    // The query parameter is a one-time deep link from QC, not a controlled filter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companies]);

  const visible = useMemo(() => companies.filter(company => {
    const companyLocations = locations.filter(item => item.company_id === company.company_id);
    const companyTeams = store.getCompanyTeams(company.company_id);
    const matchesStatus = filter === 'all' || (filter === 'pending-payment' ? company.package?.payment_status === 'pending' : company.account_status === 'Active' || company.active_package);
    const matchesSearch = !search.trim() || `${company.company_name} ${company.state || ''} ${company.contact_name || ''}`.toLowerCase().includes(search.trim().toLowerCase());
    const matchesCompany = !companyFilter || company.company_id === companyFilter;
    const matchesLocation = !locationFilter || companyLocations.some(item => item.id === locationFilter);
    const matchesTeam = !teamFilter || companyTeams.some(team => team.id === teamFilter);
    const matchesAgent = !agentFilter || companyLocations.some(item => locationAgents.some(link => link.location_id === item.id && link.agent_id === agentFilter));
    return matchesStatus && matchesSearch && matchesCompany && matchesLocation && matchesTeam && matchesAgent;
  }), [agentFilter, companies, companyFilter, filter, locationAgents, locationFilter, locations, search, store, teamFilter]);

  const totals = useMemo(() => ({
    companies: visible.length,
    qc: visible.reduce((count, company) => count + Number(company.qc_pending || 0), 0),
    remaining: visible.reduce((count, company) => count + Number(company.package?.pending_leads || 0), 0),
    pendingPayments: visible.filter(company => company.package?.payment_status === 'pending').length,
  }), [visible]);

  async function toggleCompany(company: Obj) {
    if (expanded === company.company_id) { setExpanded(''); return; }
    setExpanded(company.company_id);
    setPkg(EMPTY_PACKAGE);
    setPackageAllLocations(true);
    setPackageLocationIds([]);
    const { data, error: queueError } = await supabase.rpc('get_qc_queue', {
      p_start_date: localDate(new Date(Date.now() - 60 * 86400000)),
      p_end_date: localDate(new Date(Date.now() + 120 * 86400000)),
      p_company_id: company.company_id,
      p_qc_status: null,
    });
    if (queueError) setError(rpcError(queueError)); else setDetail((data || []) as Obj[]);
  }

  async function createPackage(companyId: string) {
    if (!pkg.lead_target) return;
    if (!packageAllLocations && packageLocationIds.length === 0) { setError('Select at least one location or choose All company locations.'); return; }
    const { error: createError } = await supabase.rpc('create_location_scoped_company_package', {
      p_company_id: companyId,
      p_lead_target: Number(pkg.lead_target),
      p_amount_per_lead: Number(pkg.amount_per_lead || 0),
      p_package_total: Number(pkg.package_total || 0),
      p_payment_date: pkg.payment_date || null,
      p_payment_status: pkg.payment_status,
      p_package_name: 'Lead Package',
      p_location_ids: packageAllLocations ? [] : packageLocationIds,
    });
    if (createError) setError(rpcError(createError));
    else {
      setMessage('New location-aware package created.');
      setPkg(EMPTY_PACKAGE); setPackageAllLocations(true); setPackageLocationIds([]);
      await load();
    }
  }

  async function createInvite() {
    const { data, error: inviteError } = await supabase.rpc('create_company_onboarding_invite', { p_company_name_hint: inviteName || null, p_expires_days: 14 });
    if (inviteError) setError(rpcError(inviteError));
    else {
      const result = data as Obj;
      setInviteLink(`${location.origin}/join/${result.invite_slug}/${result.invite_token}`);
      setMessage('Company signup link created.');
    }
  }

  function openSlugEditor(company: Obj) {
    setError('');
    setMessage('');
    setSlugEditor({
      companyId: String(company.company_id),
      companyName: String(company.company_name || 'Company'),
      value: String(company.public_slug || normalizeSlug(String(company.company_name || 'company'))),
    });
  }

  async function saveCompanySlug() {
    if (!slugEditor || slugSaving) return;
    const publicSlug = normalizeSlug(slugEditor.value);
    if (publicSlug.length < 2) {
      setError('The company slug must contain at least two letters or numbers.');
      return;
    }

    setSlugSaving(true);
    setError('');
    const { error: updateError } = await supabase.from('company_portal_settings').upsert({
      company_id: slugEditor.companyId,
      public_slug: publicSlug,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'company_id' });

    if (updateError) {
      setError(updateError.code === '23505'
        ? `The slug “${publicSlug}” is already assigned to another company.`
        : updateError.message);
    } else {
      setMessage(`Booking slug saved for ${slugEditor.companyName}: ${publicSlug}`);
      setSlugEditor(null);
      await load();
    }
    setSlugSaving(false);
  }

  async function duplicateLocation(item: CompanyLocation) {
    const label = `${item.location_label} Copy ${new Date().toISOString().slice(11, 19).replace(/:/g, '')}`;
    const source = Object.fromEntries(Object.entries(item).filter(([key]) => !['id', 'created_at', 'updated_at'].includes(key)));
    const { data, error: duplicateError } = await supabase.from('company_locations').insert({ ...source, location_label: label, active: true }).select('*').single();
    if (duplicateError || !data) { setError(duplicateError?.message || 'Unable to duplicate location.'); return; }
    const agentIds = locationAgents.filter(link => link.location_id === item.id).map(link => link.agent_id);
    if (agentIds.length) {
      const { error: assignmentError } = await supabase.from('company_location_agents').insert(agentIds.map(agent_id => ({ location_id: data.id, agent_id })));
      if (assignmentError) setError(`Location duplicated, but agent assignments failed: ${assignmentError.message}`);
    }
    setMessage(`${item.location_label} duplicated without copying appointments or slot blocks.`);
    await Promise.all([load(), store.refetch()]);
  }

  async function setLocationActive(item: CompanyLocation, active: boolean) {
    const { error: updateError } = await supabase.from('company_locations').update({ active, updated_at: new Date().toISOString() }).eq('id', item.id);
    if (updateError) setError(updateError.message);
    else {
      setMessage(`${item.location_label} ${active ? 'activated' : 'deactivated'}. Existing appointments and legacy company-wide blocks were not changed.`);
      await Promise.all([load(), store.refetch()]);
    }
  }

  if (loading || store.loading) return <div className="min-h-screen flex items-center justify-center bg-slate-50"><Loader2 className="animate-spin text-blue-600" /></div>;

  const pageActions = <><button onClick={() => document.getElementById('company-signup')?.scrollIntoView({ behavior: 'smooth' })} className="readyops-ref-primary"><Plus size={14} /> Add Company</button><button disabled={!expanded && visible.length === 0} onClick={() => setManager({ companyId: expanded || visible[0]?.company_id, mode: 'locations' })} className="readyops-ref-secondary disabled:opacity-40"><Plus size={14} /> Add Location</button><button onClick={() => document.getElementById('company-list')?.scrollIntoView({ behavior: 'smooth' })} className="readyops-ref-secondary"><PackageCheck size={14} /> Packages</button><button onClick={() => { location.href = '/qc'; }} className="readyops-ref-secondary"><ShieldCheck size={14} /> QC Queue</button><button onClick={() => { location.href = '/'; }} className="readyops-ref-secondary"><Settings size={14} /> Full Setup</button></>;

  return <AdminWorkspaceShell active="companies" title="Company Operations & Scheduling" subtitle="Manage company packages, payments, locations, links, and appointment availability in one place." actions={pageActions}>
    <div className="mx-auto max-w-[1600px] space-y-5">
      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {message && <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-700">{message}</div>}
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Metric icon={<Building2 />} label="Active / Incomplete Companies" value={totals.companies} /><Metric icon={<ShieldCheck />} label="QC Pending" value={totals.qc} /><Metric icon={<PackageCheck />} label="Package Leads Remaining" value={totals.remaining} /><Metric icon={<WalletCards />} label="Pending Payments" value={totals.pendingPayments} /></section>
      <section id="company-signup" className="rounded-2xl border bg-white p-4"><div className="flex flex-col gap-3 lg:flex-row lg:items-end"><div className="flex-1"><h2 className="font-bold">New Company Signup Link</h2><p className="text-xs text-slate-500">Send this secure onboarding link to a new client. Their submission creates the company, portal links, default schedule, and optional package.</p></div><input value={inviteName} onChange={event => setInviteName(event.target.value)} placeholder="Company name (optional)" className="rounded-lg border px-3 py-2 text-sm" /><button onClick={() => void createInvite()} className="inline-flex items-center justify-center gap-1 rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold text-white"><Link2 size={14} /> Create Signup Link</button></div>{inviteLink && <div className="mt-3 flex gap-2 rounded-xl bg-slate-50 p-3"><input readOnly value={inviteLink} className="min-w-0 flex-1 bg-transparent text-xs" /><button onClick={() => void copyText(inviteLink)} className="rounded-lg border bg-white px-3 py-2 text-xs font-bold"><Clipboard size={13} className="mr-1 inline" />Copy</button></div>}</section>
      <section className="rounded-2xl border bg-white p-3"><div className="grid gap-2 md:grid-cols-2 xl:grid-cols-[1.45fr_repeat(6,minmax(120px,1fr))_auto]"><label className="relative"><Search size={14} className="absolute left-3 top-3 text-slate-400" /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search companies…" className="h-10 w-full rounded-lg border pl-9 pr-3 text-xs" /></label><select value={companyFilter} onChange={event => { setCompanyFilter(event.target.value); setLocationFilter(''); }} className="h-10 rounded-lg border px-3 text-xs font-semibold"><option value="">All Companies</option>{companies.map(company => <option key={company.company_id} value={company.company_id}>{company.company_name}</option>)}</select><select value={locationFilter} onChange={event => setLocationFilter(event.target.value)} className="h-10 rounded-lg border px-3 text-xs font-semibold"><option value="">All Locations</option>{locations.filter(item => item.active !== false && (!companyFilter || item.company_id === companyFilter)).map(item => <option key={item.id} value={item.id}>{item.location_label}</option>)}</select><select value={teamFilter} onChange={event => setTeamFilter(event.target.value)} className="h-10 rounded-lg border px-3 text-xs font-semibold"><option value="">All Teams</option>{store.teams.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}</select><select value={agentFilter} onChange={event => setAgentFilter(event.target.value)} className="h-10 rounded-lg border px-3 text-xs font-semibold"><option value="">All Reps</option>{agents.filter(agent => agent.active !== false).map(agent => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select><select value={filter} onChange={event => setFilter(event.target.value as typeof filter)} className="h-10 rounded-lg border px-3 text-xs font-semibold"><option value="active">Active</option><option value="pending-payment">Pending Payment</option><option value="all">All Statuses</option></select><input aria-label="Appointment date" type="date" value={appointmentDate} onChange={event => setAppointmentDate(event.target.value)} className="h-10 rounded-lg border px-3 text-xs font-semibold" /><button onClick={() => void Promise.all([load(), store.refetch()])} className="readyops-ref-secondary"><RefreshCw size={14} /> Refresh</button></div><p className="mt-2 text-right text-xs font-semibold text-slate-500">{visible.length} companies • {store.portalAppointments.length} occupied appointments this week</p></section>
      <section id="company-list" className="rounded-2xl border bg-white"><div className="flex flex-wrap items-center justify-between gap-3 border-b p-4"><div><h2 className="font-bold">Companies & Scheduling</h2><p className="text-xs text-slate-500">Expand a company for locations, packages, scheduling, reps, qualifications, and sent appointments.</p></div></div>
        <div className="overflow-x-auto"><table className="w-full min-w-[1350px] text-sm"><thead><tr className="text-left text-[10px] uppercase text-slate-400"><th className="p-3">Company</th><th>Total Leads</th><th>QC Pending</th><th>Approved</th><th>Scheduled</th><th>Locations</th><th>Package</th><th>Remaining</th><th>Payment</th><th>Links & Slug</th></tr></thead><tbody>{visible.map(company => {
          const companyLocations = locations.filter(item => item.company_id === company.company_id);
          const activeScopeIds = packageScopes.filter(scope => scope.package_id === company.package?.id).map(scope => scope.location_id);
          return <CompanyRow key={company.company_id} company={company} locations={companyLocations} expanded={expanded === company.company_id} onToggle={() => void toggleCompany(company)} detail={detail} agents={agents} locationAgents={locationAgents} representatives={representatives.filter(rep => rep.company_id === company.company_id)} settings={settings.find(item => item.company_id === company.company_id)} activeScopeIds={activeScopeIds} pkg={pkg} setPkg={setPkg} packageAllLocations={packageAllLocations} setPackageAllLocations={setPackageAllLocations} packageLocationIds={packageLocationIds} setPackageLocationIds={setPackageLocationIds} onCreatePackage={() => void createPackage(company.company_id)} onEditLocation={locationId => setManager({ companyId: company.company_id, mode: 'locations', locationId: locationId || undefined })} onEditCompany={() => setManager({ companyId: company.company_id, mode: 'company' })} onEditSlug={() => openSlugEditor(company)} onDuplicate={item => void duplicateLocation(item)} onSetActive={(item, active) => void setLocationActive(item, active)} store={store} appointmentDate={appointmentDate} />;
        })}</tbody></table></div>
      </section>
      <ReadyModeAgentTools agents={agents} companies={companies} />
    </div>
    {manager && <AdminSchedulingManager store={store} initialMode={manager.mode} initialCompanyId={manager.companyId} initialLocationId={manager.locationId} onClose={() => { setManager(null); void load(); }} />}
    {slugEditor && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" onMouseDown={() => !slugSaving && setSlugEditor(null)}><section role="dialog" aria-modal="true" aria-labelledby="company-slug-title" className="w-full max-w-lg rounded-2xl border bg-white p-5 shadow-2xl" onMouseDown={event => event.stopPropagation()}><div><p className="text-xs font-bold uppercase tracking-widest text-blue-600">ReadyMode Company Variable</p><h2 id="company-slug-title" className="mt-1 text-lg font-black">Booking slug for {slugEditor.companyName}</h2><p className="mt-2 text-sm text-slate-500">Use this exact value for the company’s <strong>ReadyOpsSlug</strong> campaign variable. Changing an existing slug changes its booking URL.</p></div><label className="mt-4 block text-xs font-bold text-slate-600">Company slug<input autoFocus value={slugEditor.value} onChange={event => setSlugEditor({ ...slugEditor, value: normalizeSlug(event.target.value) })} onKeyDown={event => { if (event.key === 'Enter') void saveCompanySlug(); }} placeholder="company-name" className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-3 font-mono text-sm outline-none focus:border-blue-400" /></label><p className="mt-2 text-xs text-slate-500">Booking URL: <span className="font-mono text-blue-700">{location.origin}/book/{normalizeSlug(slugEditor.value) || 'company-name'}</span></p><div className="mt-5 flex flex-wrap justify-end gap-2"><button disabled={slugSaving} onClick={() => setSlugEditor(null)} className="rounded-xl border px-4 py-2.5 text-sm font-bold text-slate-600 disabled:opacity-50">Cancel</button><button disabled={slugSaving || normalizeSlug(slugEditor.value).length < 2} onClick={() => void saveCompanySlug()} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50">{slugSaving && <Loader2 size={15} className="animate-spin" />}{slugSaving ? 'Saving…' : 'Save Slug'}</button></div></section></div>}
  </AdminWorkspaceShell>;
}

type CompanyRowProps = {
  company: Obj; locations: CompanyLocation[]; expanded: boolean; onToggle: () => void; detail: Obj[]; agents: Obj[]; locationAgents: Obj[]; representatives: Obj[]; settings?: Obj; activeScopeIds: string[]; pkg: PackageDraft; setPkg: (value: PackageDraft) => void; packageAllLocations: boolean; setPackageAllLocations: (value: boolean) => void; packageLocationIds: string[]; setPackageLocationIds: (value: string[]) => void; onCreatePackage: () => void; onEditLocation: (locationId: string) => void; onEditCompany: () => void; onEditSlug: () => void; onDuplicate: (item: CompanyLocation) => void; onSetActive: (item: CompanyLocation, active: boolean) => void; store: ScheduleStore; appointmentDate: string;
};

function CompanyRow(props: CompanyRowProps) {
  const { company, locations, expanded, onToggle, detail, agents, locationAgents, representatives, settings, activeScopeIds, pkg, setPkg, packageAllLocations, setPackageAllLocations, packageLocationIds, setPackageLocationIds, onCreatePackage, onEditLocation, onEditCompany, onEditSlug, onDuplicate, onSetActive, store, appointmentDate } = props;
  const publicSlug = String(company.public_slug || '').trim();
  const agentLink = company.agent_link ? `${location.origin}${company.agent_link}` : '';
  const companyLink = company.company_link ? `${location.origin}${company.company_link}` : '';
  const activeLocations = locations.filter(item => item.active !== false);
  return <>
    <tr onClick={onToggle} className="cursor-pointer border-t hover:bg-blue-50/30"><td className="p-3"><div className="flex items-center gap-2">{expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}<div><div className="font-bold">{company.company_name}</div><div className="text-[11px] text-slate-400">{company.state || ''} • {company.account_status}</div></div></div></td><td>{company.total_leads}</td><td><span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-bold text-amber-700">{company.qc_pending}</span></td><td>{company.approved_leads}</td><td>{company.scheduled_upcoming}</td><td>{activeLocations.length}</td><td>{company.package ? `${company.package.delivered_leads}/${company.package.lead_target}` : 'No active package'}</td><td className="font-bold">{company.package?.pending_leads ?? '—'}</td><td>{company.package ? <div><span className={`rounded-full px-2 py-1 text-[10px] font-bold ${company.package.payment_status === 'complete' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>{company.package.payment_status === 'complete' ? 'PAID' : 'PENDING'}</span><div className="mt-1 text-[10px] text-slate-400">{company.package.payment_date || 'No date'}</div></div> : '—'}</td><td onClick={event => event.stopPropagation()}><div className="flex flex-wrap gap-1"><button disabled={!agentLink} onClick={() => void copyText(agentLink)} title={agentLink ? 'Copy agent booking link' : 'Add a slug before copying the booking link'} className="rounded border p-1.5 disabled:cursor-not-allowed disabled:opacity-40"><Clipboard size={12} /></button><button disabled={!companyLink} onClick={() => companyLink && window.open(companyLink, '_blank', 'noopener,noreferrer')} title={companyLink ? 'Open company portal' : 'Add a slug before opening the company portal'} className="rounded bg-slate-900 p-1.5 text-white disabled:cursor-not-allowed disabled:opacity-40"><ExternalLink size={12} /></button><button onClick={onEditSlug} title={publicSlug ? `Edit slug: ${publicSlug}` : 'Add company slug'} className="inline-flex items-center gap-1 rounded border border-blue-200 bg-blue-50 px-2 py-1.5 text-[10px] font-bold text-blue-700"><Link2 size={12} /> {publicSlug ? 'Edit Slug' : 'Add Slug'}</button></div>{publicSlug && <div className="mt-1 max-w-48 truncate font-mono text-[9px] text-slate-400" title={publicSlug}>{publicSlug}</div>}</td></tr>
    {expanded && <tr className="border-t bg-slate-50"><td colSpan={10} className="p-4"><div className="space-y-4">
      <CompanyAvailabilityGrid company={company} locations={activeLocations} store={store} appointmentDate={appointmentDate} onEditLocation={onEditLocation} />
      <section className="grid gap-3 rounded-xl border bg-white p-4 md:grid-cols-[1fr_auto]"><div><h3 className="font-bold">Overview</h3><p className="mt-1 text-xs text-slate-500">{company.contact_name || 'No contact'} • {company.phone || 'No phone'} • {company.email || 'No email'}</p></div><button onClick={onEditCompany} className="inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-xs font-bold"><Pencil size={13} /> Edit Company</button></section>
      <LocationSection company={company} locations={locations} agents={agents} locationAgents={locationAgents} onEditLocation={onEditLocation} onDuplicate={onDuplicate} onSetActive={onSetActive} />
      <div className="grid gap-4 xl:grid-cols-2">
        <PackageSection company={company} locations={activeLocations} activeScopeIds={activeScopeIds} pkg={pkg} setPkg={setPkg} packageAllLocations={packageAllLocations} setPackageAllLocations={setPackageAllLocations} packageLocationIds={packageLocationIds} setPackageLocationIds={setPackageLocationIds} onCreatePackage={onCreatePackage} />
        <section className="rounded-xl border bg-white p-4"><h3 className="font-bold">Scheduling</h3><div className="mt-2 space-y-2 text-xs">{activeLocations.length ? activeLocations.map(item => <div key={item.id} className="flex justify-between rounded-lg bg-slate-50 p-2"><span>{item.location_label}</span><strong>{String(item.start_time || '09:00').slice(0, 5)}–{String(item.end_time || '18:00').slice(0, 5)} • {item.max_per_day ?? 5}/day</strong></div>) : <p className="text-slate-400">Company-wide schedule rules are in use.</p>}</div></section>
        <section className="rounded-xl border bg-white p-4"><h3 className="flex items-center gap-1 font-bold"><UsersRound size={14} /> Reps</h3><div className="mt-2 space-y-2 text-xs">{representatives.length ? representatives.map(rep => <div key={rep.id} className="rounded-lg bg-slate-50 p-2"><strong>{rep.name}</strong> • {locations.find(item => item.id === rep.location_id)?.location_label || 'All locations'}<div className="text-slate-400">{rep.email || rep.phone || 'No contact'}</div></div>) : <p className="text-slate-400">No company representatives configured.</p>}</div></section>
        <section className="rounded-xl border bg-white p-4"><h3 className="font-bold">Qualifications</h3><p className="mt-2 whitespace-pre-line text-xs text-slate-600">{settings?.requirements_short || settings?.requirements_detail || company.requirements_note || 'No requirements configured.'}</p>{settings?.qualification_rules && <pre className="mt-2 max-h-28 overflow-auto rounded-lg bg-slate-950 p-2 text-[10px] text-slate-200">{JSON.stringify(settings.qualification_rules, null, 2)}</pre>}</section>
      </div>
      <section className="rounded-xl border bg-white p-4"><h3 className="font-bold">Scheduled / Submitted Leads</h3><div className="mt-2 max-h-72 overflow-auto rounded-xl border"><table className="w-full text-xs"><thead><tr className="text-left text-slate-400"><th className="p-2">Appointment</th><th>Homeowner</th><th>Agent</th><th>QC</th><th>Status</th></tr></thead><tbody>{detail.map(row => <tr key={row.lead.id} className="border-t"><td className="p-2">{row.appointment.appointment_date} {formatTime(String(row.appointment.start_time))}</td><td>{row.lead.full_name}<div className="text-[10px] text-slate-400">{row.lead.phone_number} • {row.lead.address}</div></td><td>{row.agent?.name || row.lead.agent_name}</td><td>{row.lead.qc_status}</td><td>{row.appointment.client_status || row.appointment.status}</td></tr>)}</tbody></table></div></section>
    </div></td></tr>}
  </>;
}

function CompanyAvailabilityGrid({ company, locations, store, appointmentDate, onEditLocation }: { company: Obj; locations: CompanyLocation[]; store: ScheduleStore; appointmentDate: string; onEditLocation: (locationId: string) => void }) {
  const date = new Date(`${appointmentDate}T12:00:00`);
  const dayName = date.toLocaleDateString('en-US', { weekday: 'long' });
  const companyTeams = store.getCompanyTeams(company.company_id);
  const teams = companyTeams.length ? companyTeams : [{ id: 'all', name: 'All Teams', abbreviation: 'ALL' }];
  const locationRows: Array<CompanyLocation | null> = locations.length ? locations : [null];
  return <section className="overflow-hidden rounded-xl border bg-white shadow-sm"><div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3"><div><h3 className="font-bold">Appointment Availability — {formatDateLong(appointmentDate)}</h3><p className="text-xs text-slate-500">Live company blocks and occupied appointments by location and team.</p></div><button onClick={() => onEditLocation(locations[0]?.id || '')} className="inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-xs font-bold"><CalendarDays size={13} /> Edit Schedule</button></div><div className="overflow-x-auto"><table className="w-full min-w-[1160px] text-xs"><thead className="bg-slate-50 text-slate-500"><tr><th className="w-28 p-3 text-left">Location</th><th className="w-24 text-left">Team</th>{TIME_SLOTS.map(slot => <th key={slot} className="px-1 py-3 text-center">{formatTimeAmPm(slot)}</th>)}</tr></thead><tbody>{locationRows.flatMap(location => teams.map((team, teamIndex) => <tr key={`${location?.id || 'company'}-${team.id}`} className="border-t"><td className="p-3 font-bold">{teamIndex === 0 ? (location?.location_label || 'Company-wide') : ''}</td><td className="font-bold text-slate-700">{team.abbreviation || team.name}</td>{TIME_SLOTS.map(slot => { const status = availabilityStatus(company.company_id, location, appointmentDate, dayName, slot, store); return <td key={slot} className="px-1 py-2"><span className={`block rounded-md border px-1 py-2 text-center text-[10px] font-bold ${status === 'Open' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : status === 'Occupied' ? 'border-blue-300 bg-blue-50 text-blue-700' : status === 'Blocked' ? 'border-red-300 bg-red-500 text-white' : 'border-slate-300 bg-slate-100 text-slate-500'}`}>{status}</span></td>; })}</tr>))}</tbody></table></div></section>;
}

function availabilityStatus(companyId: string, location: CompanyLocation | null, appointmentDate: string, dayName: string, slot: string, store: ScheduleStore): 'Open' | 'Occupied' | 'Blocked' | 'Closed' {
  const locationId = location?.id || null;
  const hour = Number(slot);
  const hour24 = hour >= 8 && hour <= 11 ? hour : hour === 12 ? 12 : hour + 12;
  const slotStart = hour24 * 60;
  const start = timeMinutes(location?.start_time, 9 * 60);
  const end = timeMinutes(location?.end_time, 18 * 60);
  const dayOpen = !location?.available_days?.length || location.available_days.includes(dayName);
  if (!dayOpen || slotStart < start || slotStart >= end) return 'Closed';
  const occupied = store.portalAppointments.some(appointment => appointment.company_id === companyId && appointment.appointment_date === appointmentDate && appointment.start_time.slice(0, 5) === `${String(hour24).padStart(2, '0')}:00` && (appointment.location_id === null || appointment.location_id === locationId));
  if (occupied) return 'Occupied';
  if (store.isBooked(companyId, locationId, dayName, slot) || store.isScheduleExceptionBlocked(companyId, locationId, dayName, slot)) return 'Blocked';
  return 'Open';
}

function timeMinutes(value: string | null | undefined, fallback: number): number { if (!value) return fallback; const [hours, minutes] = value.split(':').map(Number); return Number.isFinite(hours) && Number.isFinite(minutes) ? hours * 60 + minutes : fallback; }

function LocationSection({ company, locations, agents, locationAgents, onEditLocation, onDuplicate, onSetActive }: { company: Obj; locations: CompanyLocation[]; agents: Obj[]; locationAgents: Obj[]; onEditLocation: (id: string) => void; onDuplicate: (item: CompanyLocation) => void; onSetActive: (item: CompanyLocation, active: boolean) => void }) {
  return <section className="rounded-xl border bg-white p-4"><div className="mb-3 flex items-center justify-between"><div><h3 className="font-bold">Locations</h3><p className="text-xs text-slate-500">Offices, branches, service areas, and markets under this company.</p></div><button onClick={() => onEditLocation('')} className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white"><Plus size={13} /> Add Location</button></div>{locations.length === 0 ? <p className="rounded-lg border border-dashed p-4 text-sm text-slate-400">No detailed locations. Legacy company-wide scheduling remains active.</p> : <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-xs"><thead><tr className="text-left text-slate-400"><th className="p-2">Location</th><th>City / State</th><th>Assigned Reps</th><th>Hours</th><th>Daily Capacity</th><th>Service ZIPs</th><th>Actions</th></tr></thead><tbody>{locations.map(item => {
    const assigned = locationAgents.filter(link => link.location_id === item.id).map(link => agents.find(agent => agent.id === link.agent_id)?.name).filter(Boolean);
    return <tr key={item.id} className={`border-t ${item.active === false ? 'opacity-50' : ''}`}><td className="p-2 font-bold"><MapPin size={12} className="mr-1 inline text-blue-600" />{item.location_label}{item.office_name ? <div className="pl-4 text-[10px] font-normal text-slate-400">{item.office_name}</div> : null}</td><td>{[item.city, item.state].filter(Boolean).join(', ') || '—'}</td><td>{assigned.join(', ') || 'Unassigned'}</td><td>{item.available_days?.map(day => day.slice(0, 3)).join(', ') || 'Default'}<div className="text-[10px] text-slate-400">{String(item.start_time || '09:00').slice(0, 5)}–{String(item.end_time || '18:00').slice(0, 5)}</div></td><td>{item.max_per_day ?? 5}<div className="text-[10px] text-slate-400">{item.max_per_hour ?? 1}/hour • {item.slot_interval_minutes ?? 60} min</div></td><td>{item.service_zips?.length || 0}</td><td><div className="flex flex-wrap gap-1"><button onClick={() => onEditLocation(item.id)} className="rounded border p-1.5" title="Edit"><Pencil size={12} /></button><button onClick={() => { location.href = `/?view=appointments&company=${company.company_id}&location=${item.id}`; }} className="rounded border p-1.5" title="Appointments"><CalendarDays size={12} /></button><button onClick={() => onDuplicate(item)} className="rounded border p-1.5" title="Duplicate"><Copy size={12} /></button><button onClick={() => onSetActive(item, item.active === false)} className="rounded border p-1.5" title={item.active === false ? 'Activate' : 'Deactivate'}>{item.active === false ? <CheckCircle2 size={12} /> : <Ban size={12} />}</button></div></td></tr>;
  })}</tbody></table></div>}</section>;
}

function PackageSection({ company, locations, activeScopeIds, pkg, setPkg, packageAllLocations, setPackageAllLocations, packageLocationIds, setPackageLocationIds, onCreatePackage }: { company: Obj; locations: CompanyLocation[]; activeScopeIds: string[]; pkg: PackageDraft; setPkg: (value: PackageDraft) => void; packageAllLocations: boolean; setPackageAllLocations: (value: boolean) => void; packageLocationIds: string[]; setPackageLocationIds: (value: string[]) => void; onCreatePackage: () => void }) {
  return <section className="rounded-xl border bg-white p-4"><h3 className="font-bold">Packages</h3>{company.package && <div className="mt-2 rounded-lg bg-blue-50 p-3 text-xs"><strong>{company.package.package_name}</strong> • {company.package.delivered_leads}/{company.package.lead_target} delivered<div className="mt-1 text-blue-700">Scope: {activeScopeIds.length ? locations.filter(item => activeScopeIds.includes(item.id)).map(item => item.location_label).join(', ') : 'All company locations'}</div></div>}<div className="mt-3 grid grid-cols-2 gap-2"><Input label="Lead Total" value={pkg.lead_target} onChange={value => setPkg({ ...pkg, lead_target: value })} /><Input label="Amount / Lead" value={pkg.amount_per_lead} onChange={value => setPkg({ ...pkg, amount_per_lead: value })} /><Input label="Package Total" value={pkg.package_total} onChange={value => setPkg({ ...pkg, package_total: value })} /><Input label="Payment Date" type="date" value={pkg.payment_date} onChange={value => setPkg({ ...pkg, payment_date: value })} /><label className="col-span-2 text-[10px] font-bold text-slate-500">Payment Status<select value={pkg.payment_status} onChange={event => setPkg({ ...pkg, payment_status: event.target.value })} className="mt-1 w-full rounded-lg border p-2 text-xs"><option value="pending">Pending Payment</option><option value="complete">Payment Complete</option></select></label></div><label className="mt-3 flex items-center gap-2 text-xs font-bold"><input type="checkbox" checked={packageAllLocations} onChange={event => { setPackageAllLocations(event.target.checked); if (event.target.checked) setPackageLocationIds([]); }} /> All company locations</label>{!packageAllLocations && <div className="mt-2 grid gap-1 sm:grid-cols-2">{locations.map(item => <label key={item.id} className="rounded border p-2 text-xs"><input type="checkbox" className="mr-2" checked={packageLocationIds.includes(item.id)} onChange={() => setPackageLocationIds(packageLocationIds.includes(item.id) ? packageLocationIds.filter(id => id !== item.id) : [...packageLocationIds, item.id])} />{item.location_label}</label>)}</div>}<button onClick={onCreatePackage} className="mt-3 inline-flex w-full items-center justify-center gap-1 rounded-lg bg-blue-600 p-2 text-xs font-bold text-white"><Plus size={13} /> Create Package</button></section>;
}

function Metric({ icon, label, value }: { icon: ReactNode; label: string; value: number }) { return <div className="rounded-2xl border bg-white p-4"><div className="flex items-center gap-2 text-blue-600">{icon}<span className="text-xs font-bold uppercase tracking-wide">{label}</span></div><div className="mt-2 text-3xl font-black">{value}</div></div>; }
function Input({ label, value, onChange, type = 'number' }: { label: string; value: string; onChange: (value: string) => void; type?: string }) { return <label className="text-[10px] font-bold text-slate-500">{label}<input type={type} value={value} onChange={event => onChange(event.target.value)} className="mt-1 w-full rounded-lg border p-2 text-xs" /></label>; }
