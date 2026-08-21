import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, Building2, CalendarDays, ChevronDown, ChevronUp, Clipboard,
  ExternalLink, Loader2, RefreshCw, ShieldCheck
} from 'lucide-react';
import { supabase } from './supabase';
import { copyText, formatDateLong, formatTime, rpcError } from './portalUtils';

type PackageRecord = {
  id: string;
  package_name: string | null;
  lead_target: number;
  amount_per_lead: number | null;
  package_total: number | null;
  payment_date: string | null;
  payment_status: string;
  status: string;
  delivered_leads: number;
  pending_leads: number;
};

type CompanyOps = {
  company_id: string;
  company_name: string;
  state: string | null;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  account_status: string;
  public_slug: string | null;
  agent_link: string | null;
  company_link: string | null;
  total_leads: number;
  approved_leads: number;
  qc_pending: number;
  scheduled_upcoming: number;
  active_package: boolean;
  package: PackageRecord | null;
};

type AppointmentRow = {
  id: string;
  lead_id: string;
  appointment_date: string;
  start_time: string;
  status: string;
  client_status?: string | null;
  inspector_notes?: string | null;
};

type LeadRow = {
  id: string;
  lead_code: string;
  full_name: string;
  phone_number: string;
  address: string;
  agent_name: string | null;
  qc_status: string;
  qc_denial_reason: string | null;
};

type DetailRow = AppointmentRow & { lead?: LeadRow };

type Tone = 'blue' | 'amber' | 'emerald' | 'violet' | 'cyan' | 'red' | 'slate';

export function AdminOperationsHome({ onOpenAppointments }: { onOpenAppointments: () => void }) {
  const [companies, setCompanies] = useState<CompanyOps[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [scope, setScope] = useState<'active' | 'all' | 'payment'>('active');
  const [expandedCompany, setExpandedCompany] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, DetailRow[]>>({});
  const [detailLoading, setDetailLoading] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError('');
    const { data, error: rpcErr } = await supabase.rpc('get_company_operations_overview');
    if (rpcErr) setError(rpcError(rpcErr));
    else setCompanies((data || []) as CompanyOps[]);
    setLoading(false);
  }

  useEffect(() => { void load(); }, []);

  async function toggleCompany(companyId: string) {
    if (expandedCompany === companyId) {
      setExpandedCompany(null);
      return;
    }
    setExpandedCompany(companyId);
    if (details[companyId]) return;
    setDetailLoading(companyId);

    const today = new Date();
    const start = new Date(today); start.setDate(start.getDate() - 14);
    const end = new Date(today); end.setDate(end.getDate() + 60);
    const toDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

    const { data: appointments, error: appointmentError } = await supabase
      .from('portal_appointments')
      .select('id,lead_id,appointment_date,start_time,status,client_status,inspector_notes')
      .eq('company_id', companyId)
      .gte('appointment_date', toDate(start))
      .lte('appointment_date', toDate(end))
      .order('appointment_date', { ascending: true })
      .order('start_time', { ascending: true });

    if (appointmentError) {
      setError(rpcError(appointmentError));
      setDetailLoading(null);
      return;
    }

    const appts = (appointments || []) as AppointmentRow[];
    const leadIds = [...new Set(appts.map(item => item.lead_id))];
    let leadMap = new Map<string, LeadRow>();
    if (leadIds.length) {
      const { data: leads, error: leadError } = await supabase
        .from('portal_leads')
        .select('id,lead_code,full_name,phone_number,address,agent_name,qc_status,qc_denial_reason')
        .in('id', leadIds);
      if (leadError) setError(rpcError(leadError));
      else leadMap = new Map(((leads || []) as LeadRow[]).map(lead => [lead.id, lead]));
    }

    setDetails(prev => ({ ...prev, [companyId]: appts.map(appt => ({ ...appt, lead: leadMap.get(appt.lead_id) })) }));
    setDetailLoading(null);
  }

  const totals = useMemo(() => ({
    activeCompanies: companies.filter(c => c.account_status === 'Active').length,
    qcPending: companies.reduce((sum, c) => sum + Number(c.qc_pending || 0), 0),
    approved: companies.reduce((sum, c) => sum + Number(c.approved_leads || 0), 0),
    upcoming: companies.reduce((sum, c) => sum + Number(c.scheduled_upcoming || 0), 0),
    activePackages: companies.filter(c => c.active_package).length,
    pendingPayments: companies.filter(c => c.package?.payment_status === 'pending').length,
  }), [companies]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return companies.filter(company => {
      if (scope === 'active' && !company.active_package && company.qc_pending === 0 && company.scheduled_upcoming === 0) return false;
      if (scope === 'payment' && company.package?.payment_status !== 'pending') return false;
      if (!q) return true;
      return [company.company_name, company.state, company.contact_name, company.email]
        .filter(Boolean)
        .some(value => String(value).toLowerCase().includes(q));
    });
  }, [companies, search, scope]);

  if (loading) {
    return <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center"><Loader2 className="mx-auto animate-spin text-blue-600" /><p className="mt-3 text-sm text-slate-500">Loading Ready Ops overview...</p></div>;
  }

  return <div className="space-y-5">
    <section className="overflow-hidden rounded-2xl bg-slate-950 p-5 text-white shadow-sm sm:p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-blue-300">Ready Ops Command Center</p>
          <h2 className="mt-1 text-2xl font-bold">Company & Lead Operations</h2>
          <p className="mt-1 max-w-2xl text-sm text-slate-300">Packages, QC, upcoming appointments and payment status in one place. Open a company to review its scheduled leads.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => { window.location.href = '/qc'; }} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white"><ShieldCheck size={16}/> QC Queue</button>
          <button onClick={() => { window.location.href = '/admin/portals'; }} className="inline-flex items-center gap-2 rounded-xl bg-white/10 px-4 py-2.5 text-sm font-bold text-white ring-1 ring-white/20"><Building2 size={16}/> Companies & Packages</button>
          <button onClick={onOpenAppointments} className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-bold text-slate-900"><CalendarDays size={16}/> Appointments</button>
        </div>
      </div>
    </section>

    {error && <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700"><AlertTriangle size={16}/>{error}</div>}

    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
      <Metric label="Active Companies" value={totals.activeCompanies} tone="blue" />
      <Metric label="QC Pending" value={totals.qcPending} tone={totals.qcPending ? 'amber' : 'slate'} />
      <Metric label="Approved Leads" value={totals.approved} tone="emerald" />
      <Metric label="Upcoming" value={totals.upcoming} tone="violet" />
      <Metric label="Active Packages" value={totals.activePackages} tone="cyan" />
      <Metric label="Pending Payments" value={totals.pendingPayments} tone={totals.pendingPayments ? 'red' : 'slate'} />
    </section>

    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-col gap-3 border-b border-slate-100 p-4 lg:flex-row lg:items-center lg:justify-between">
        <div><h3 className="font-bold text-slate-900">Companies</h3><p className="text-xs text-slate-500">Default view focuses on companies with active packages, QC work or upcoming appointments.</p></div>
        <div className="flex flex-wrap gap-2">
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search company..." className="rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-400" />
          <select value={scope} onChange={e => setScope(e.target.value as typeof scope)} className="rounded-xl border border-slate-200 px-3 py-2 text-sm"><option value="active">Current Work</option><option value="payment">Pending Payment</option><option value="all">All Companies</option></select>
          <button onClick={() => void load()} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600"><RefreshCw size={14}/> Refresh</button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-[1250px] w-full text-sm">
          <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500"><tr>
            <th className="px-4 py-3 text-left">Company</th><th className="px-3 py-3 text-center">Leads</th><th className="px-3 py-3 text-center">QC Pending</th><th className="px-3 py-3 text-center">Approved</th><th className="px-3 py-3 text-center">Upcoming</th><th className="px-3 py-3 text-left">Package Progress</th><th className="px-3 py-3 text-right">$/Lead</th><th className="px-3 py-3 text-right">Package Total</th><th className="px-3 py-3 text-left">Payment</th><th className="px-4 py-3 text-right">Links</th>
          </tr></thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.map(company => {
              const pkg = company.package;
              const delivered = Number(pkg?.delivered_leads || 0);
              const target = Number(pkg?.lead_target || 0);
              const progress = target ? Math.min(100, Math.round(delivered / target * 100)) : 0;
              const expanded = expandedCompany === company.company_id;
              return <tr key={company.company_id} className="align-top"><td colSpan={10} className="p-0">
                <div className={`grid min-w-[1250px] grid-cols-[260px_70px_90px_80px_80px_220px_90px_110px_150px_150px] items-center ${expanded ? 'bg-blue-50/30' : 'hover:bg-slate-50'}`}>
                  <button onClick={() => void toggleCompany(company.company_id)} className="flex items-center gap-3 px-4 py-4 text-left"><span className="text-slate-400">{expanded ? <ChevronUp size={16}/> : <ChevronDown size={16}/>}</span><span><strong className="block text-slate-900">{company.company_name}</strong><span className="text-xs text-slate-500">{company.state || '—'}{company.contact_name ? ` • ${company.contact_name}` : ''}</span><span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-bold ${company.account_status === 'Active' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>{company.account_status}</span></span></button>
                  <Count value={company.total_leads}/><Count value={company.qc_pending} warn/><Count value={company.approved_leads}/><Count value={company.scheduled_upcoming}/>
                  <div className="px-3 py-3">{pkg ? <><div className="flex justify-between text-xs"><span className="font-bold text-slate-700">{delivered}/{target}</span><span className="text-slate-400">{pkg.pending_leads} remaining</span></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-blue-600" style={{width:`${progress}%`}} /></div><p className="mt-1 truncate text-[10px] text-slate-400">{pkg.package_name || 'Active Package'} • {progress}%</p></> : <span className="text-xs text-slate-400">No active package</span>}</div>
                  <Money value={pkg?.amount_per_lead}/><Money value={pkg?.package_total}/>
                  <div className="px-3 py-3">{pkg ? <><span className={`rounded-full px-2 py-1 text-[10px] font-bold ${pkg.payment_status === 'complete' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>{pkg.payment_status === 'complete' ? 'PAYMENT COMPLETE' : 'PENDING PAYMENT'}</span>{pkg.payment_date && <p className="mt-1 text-[10px] text-slate-400">{formatDateLong(pkg.payment_date)}</p>}</> : <span className="text-xs text-slate-400">—</span>}</div>
                  <div className="flex justify-end gap-1 px-4 py-3">{company.agent_link && <button title="Copy agent booking link" onClick={() => void copyText(`${window.location.origin}${company.agent_link}`)} className="rounded-lg border border-slate-200 p-2 text-slate-600"><Clipboard size={13}/></button>}{company.company_link && <button title="Open company portal" onClick={() => window.open(`${window.location.origin}${company.company_link}`, '_blank','noopener,noreferrer')} className="rounded-lg bg-slate-900 p-2 text-white"><ExternalLink size={13}/></button>}</div>
                </div>
                {expanded && <CompanyDetails company={company} rows={details[company.company_id] || []} loading={detailLoading === company.company_id} />}
              </td></tr>;
            })}
          </tbody>
        </table>
      </div>
      {filtered.length === 0 && <div className="p-10 text-center text-sm text-slate-400">No companies match this view.</div>}
    </section>
  </div>;
}

function CompanyDetails({ company, rows, loading }: { company: CompanyOps; rows: DetailRow[]; loading: boolean }) {
  return <div className="border-t border-blue-100 bg-blue-50/20 px-5 py-4">
    <div className="mb-3 flex items-center justify-between"><div><h4 className="font-bold text-slate-900">Scheduled Leads — {company.company_name}</h4><p className="text-xs text-slate-500">Recent 14 days + next 60 days.</p></div><span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-blue-700 ring-1 ring-blue-100">{rows.length} scheduled</span></div>
    {loading ? <div className="py-6 text-center text-sm text-slate-400"><Loader2 className="mx-auto mb-2 animate-spin"/>Loading leads...</div> : rows.length === 0 ? <div className="rounded-xl border border-dashed border-slate-200 bg-white p-5 text-center text-sm text-slate-400">No scheduled leads in this window.</div> : <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white"><table className="min-w-[900px] w-full text-xs"><thead className="bg-slate-50 text-slate-500"><tr><th className="px-3 py-2 text-left">Appointment</th><th className="px-3 py-2 text-left">Lead</th><th className="px-3 py-2 text-left">Homeowner</th><th className="px-3 py-2 text-left">Phone</th><th className="px-3 py-2 text-left">Address</th><th className="px-3 py-2 text-left">Agent</th><th className="px-3 py-2 text-left">QC</th><th className="px-3 py-2 text-left">Company Status</th></tr></thead><tbody className="divide-y divide-slate-100">{rows.map(row => <tr key={row.id}><td className="px-3 py-2 font-bold text-blue-700">{formatDateLong(row.appointment_date)} • {formatTime(row.start_time)}</td><td className="px-3 py-2">{row.lead?.lead_code || '—'}</td><td className="px-3 py-2 font-semibold">{row.lead?.full_name || '—'}</td><td className="px-3 py-2">{row.lead?.phone_number || '—'}</td><td className="max-w-[220px] truncate px-3 py-2">{row.lead?.address || '—'}</td><td className="px-3 py-2">{row.lead?.agent_name || '—'}</td><td className="px-3 py-2"><Status value={row.lead?.qc_status || '—'}/>{row.lead?.qc_denial_reason && <p className="mt-1 max-w-[180px] text-[10px] text-red-600">{row.lead.qc_denial_reason}</p>}</td><td className="px-3 py-2"><Status value={row.client_status || row.status}/>{row.inspector_notes && <p className="mt-1 max-w-[200px] truncate text-[10px] text-slate-400" title={row.inspector_notes}>{row.inspector_notes}</p>}</td></tr>)}</tbody></table></div>}
  </div>;
}

function Metric({label,value,tone}:{label:string;value:number;tone:Tone}){const styles:Record<Tone,string>={blue:'bg-blue-50 text-blue-700 border-blue-100',amber:'bg-amber-50 text-amber-700 border-amber-100',emerald:'bg-emerald-50 text-emerald-700 border-emerald-100',violet:'bg-violet-50 text-violet-700 border-violet-100',cyan:'bg-cyan-50 text-cyan-700 border-cyan-100',red:'bg-red-50 text-red-700 border-red-100',slate:'bg-white text-slate-700 border-slate-200'};return <div className={`rounded-2xl border p-4 ${styles[tone]}`}><p className="text-[10px] font-bold uppercase tracking-wide opacity-70">{label}</p><p className="mt-1 text-2xl font-bold">{value}</p></div>}
function Count({value,warn=false}:{value:number;warn?:boolean}){return <div className={`px-3 py-4 text-center font-bold ${warn&&value>0?'text-amber-700':'text-slate-700'}`}>{value}</div>}
function Money({value}:{value:number|null|undefined}){return <div className="px-3 py-4 text-right font-semibold text-slate-700">{value==null?'—':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(Number(value))}</div>}
function Status({value}:{value:string}){const v=value.toLowerCase();const cls=v.includes('denied')||v==='bad'||v.includes('cancel')?'bg-red-50 text-red-700':v.includes('approve')||v==='good'||v.includes('signed')||v.includes('complete')?'bg-emerald-50 text-emerald-700':v.includes('pending')||v.includes('follow')?'bg-amber-50 text-amber-700':'bg-slate-100 text-slate-600';return <span className={`rounded-full px-2 py-1 text-[10px] font-bold uppercase ${cls}`}>{value.replace(/_/g,' ')}</span>}
