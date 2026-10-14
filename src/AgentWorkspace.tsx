import { useMemo, useState } from 'react';
import { CalendarDays, ChevronDown, Edit3, ExternalLink, LayoutDashboard, ListChecks, PlusCircle, RefreshCw, WalletCards } from 'lucide-react';
import { ThemeToggle } from './ThemeContext';
import { READYOPS_LOGO_DATA_URI } from './brand';
import { formatDateLong, formatTime } from './portalUtils';
import { leadStatusLabel } from './leadStatusPresentation';
import type { LeadRow } from './AgentPortal';
import './agent-workspace.css';

type View = 'home' | 'leads' | 'book' | 'pay';
const navigation = [['home', 'Overview', LayoutDashboard], ['leads', 'My Leads', ListChecks], ['book', 'Book', PlusCircle], ['pay', 'Payroll', WalletCards]] as const;
export function inspectorOutcome(row: Pick<LeadRow, 'client_status' | 'appointment_status'>) {
  return String(row.client_status || row.appointment_status || 'pending').trim().toLowerCase().replace(/[\s-]+/g, '_');
}
export function isUnsuccessful(row: Pick<LeadRow, 'qc_status' | 'client_status' | 'appointment_status'>) {
  return row.qc_status === 'denied' || row.qc_status === 'approved' && ['bad', 'cancelled', 'canceled', 'lost', 'no_show'].includes(inspectorOutcome(row));
}

export function AgentWorkspace({ name, token, rows, companies, mode, setMode, payDate, setPayDate, payDates, range, loading, message, error, reload, correct }: {
  name: string; token: string; rows: LeadRow[]; companies: { id: string; name: string; public_slug: string; state?: string | null }[];
  mode: 'this' | 'previous' | 'all'; setMode: (value: 'this' | 'previous' | 'all') => void;
  payDate: string; setPayDate: (value: string) => void; payDates: string[]; range: { start: string; end: string };
  loading: boolean; message: string; error: string; reload: () => void; correct: (row: LeadRow) => void;
}) {
  const [view, setView] = useState<View>('home');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [companySearch, setCompanySearch] = useState('');
  const count = (values: string[]) => rows.filter(r => r.qc_status === 'approved' && values.includes(inspectorOutcome(r))).length;
  const good = count(['good', 'good_inspected', 'inspected']);
  const signed = count(['signed_contract', 'sold']);
  const bad = count(['bad', 'cancelled', 'canceled', 'lost']);
  const noShow = count(['no_show']);
  const denied = rows.filter(r => r.qc_status === 'denied').length;
  const corrections = rows.filter(r => r.qc_status === 'needs_correction');
  const unsuccessful = rows.filter(isUnsuccessful);
  const upcoming = rows.filter(r => r.qc_status === 'approved' && !isUnsuccessful(r)).sort((a,b) => `${a.appointment_date} ${a.start_time}`.localeCompare(`${b.appointment_date} ${b.start_time}`));
  const filtered = useMemo(() => rows.filter(row => {
    const term = search.trim().toLowerCase();
    const matches = !term || [row.name, row.phone, row.address, row.company_name, row.lead_code].some(value => value?.toLowerCase().includes(term));
    return matches && (filter === 'all' || filter === 'unsuccessful' && isUnsuccessful(row) || filter === 'bad' && row.qc_status === 'approved' && ['bad','cancelled','canceled','lost'].includes(inspectorOutcome(row)) || filter === 'no_show' && row.qc_status === 'approved' && inspectorOutcome(row) === 'no_show' || row.qc_status === filter);
  }).sort((a,b) => `${a.appointment_date} ${a.start_time}`.localeCompare(`${b.appointment_date} ${b.start_time}`)), [rows, filter, search]);
  function go(next: View) { setView(next); window.scrollTo({ top: 0, behavior: 'auto' }); }
  const nav = () => navigation.map(([key,label,Icon]) => <button key={key} type="button" aria-current={view === key ? 'page' : undefined} onClick={() => go(key)}><Icon size={19}/><span>{label}</span></button>);
  const metrics = <section className="aw-metrics" aria-label="Lead outcomes">
    <article><span>Successful</span><strong>{good + signed}</strong><p>Good <b>{good}</b> · Signed Contract <b>{signed}</b></p></article>
    <article><span>Open / Follow-Up</span><strong>{rows.length - unsuccessful.length - good - signed}</strong><p>Pending, rescheduled, or needs correction</p></article>
    <article><span>Unsuccessful</span><strong>{unsuccessful.length}</strong><p>Bad <b>{bad}</b> · No Show <b>{noShow}</b> · QC Denied <b>{denied}</b></p><button type="button" onClick={() => {setFilter('unsuccessful');go('leads');}}>View unsuccessful leads</button></article>
  </section>;
  return <div className="agent-workspace">
    <aside className="aw-sidebar"><img src={READYOPS_LOGO_DATA_URI} alt="ReadyOps"/><p>AGENT WORKSPACE</p><nav aria-label="Agent desktop navigation">{nav()}</nav><div className="aw-person"><span className="aw-avatar">{name.slice(0,1)}</span><div>{name}<small>Agent portal</small></div></div></aside>
    <div className="aw-body"><header className="aw-header"><img src={READYOPS_LOGO_DATA_URI} alt="ReadyOps"/><span className="aw-desktop-caption">Your appointments, all in one place</span><div><ThemeToggle/><button type="button" aria-label="Refresh agent portal" disabled={loading} onClick={reload}><RefreshCw size={18} className={loading ? 'animate-spin' : ''}/></button></div></header>
    <main className="aw-main"><div className="aw-heading"><div><small>READYOPS / AGENT PORTAL</small><h1>Welcome back, {name}</h1><p>Keep your leads moving. See what needs attention.</p></div><button className="aw-primary" onClick={() => go('book')}><PlusCircle size={18}/>Book appointment</button></div>
    {error && <p className="aw-alert" role="alert">{error}</p>}{message && <p className="aw-notice" role="status">{message}</p>}
    <section className="aw-period" aria-label="Appointment filters"><div><CalendarDays size={18}/><strong>{formatDateLong(range.start)} – {formatDateLong(range.end)}</strong></div><label><span className="sr-only">Date range</span><select aria-label="Date range" value={mode} onChange={e => {setPayDate('');setMode(e.target.value as typeof mode);}}><option value="this">This Week</option><option value="previous">Previous Week</option><option value="all">All Recent</option></select></label><label>Payroll Pay Date<select value={payDate} onChange={e => setPayDate(e.target.value)}><option value="">All in date filter</option>{payDates.map(date => <option key={date} value={date}>{formatDateLong(date)}</option>)}</select></label></section>
    {view === 'home' && <>{metrics}<div className="aw-notice"><strong>{corrections.length ? `${corrections.length} lead${corrections.length === 1 ? '' : 's'} need correction` : 'No corrections needed'}</strong><p>{corrections.length ? 'Review the QC notes and resubmit the original lead.' : 'Check your approved appointments and company updates below.'}</p>{corrections.length > 0 && <button onClick={() => {setFilter('needs_correction');go('leads');}}>Review corrections</button>}</div><section className="aw-panel"><div className="aw-panel-heading"><h2>Appointments in this period</h2><button onClick={() => {setFilter('all');go('leads');}}>View all leads</button></div>{upcoming.length ? upcoming.slice(0,3).map(row => <AgentLeadCard key={row.lead_id} row={row} correct={correct}/>) : <p className="aw-empty">No approved appointments in this period.</p>}</section></>}
    {view === 'leads' && <section className="aw-panel"><div className="aw-panel-heading"><h2>My Leads</h2><span>{filtered.length} matching leads</span></div><div className="aw-lead-filters"><input aria-label="Search leads" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, phone, company or address"/><select aria-label="Lead status" value={filter} onChange={e => setFilter(e.target.value)}><option value="all">All statuses</option><option value="needs_correction">Needs Correction</option><option value="pending">QC Pending</option><option value="in_review">QC In Review</option><option value="manager_approved">Awaiting Final QC</option><option value="approved">QC Approved</option><option value="unsuccessful">Unsuccessful</option><option value="bad">Bad / Canceled</option><option value="no_show">No Show</option><option value="denied">QC Denied</option></select></div>{filtered.length ? filtered.map(row => <AgentLeadCard key={row.lead_id} row={row} correct={correct}/>) : <p className="aw-empty">No leads match this view.</p>}</section>}
    {view === 'book' && <section className="aw-panel"><h2>Book an appointment</h2><p>Choose a company. Your agent information stays attached.</p><input className="aw-company-search" aria-label="Find a company" value={companySearch} onChange={e => setCompanySearch(e.target.value)} placeholder="Find a company or state"/><div className="aw-companies">{companies.filter(c => `${c.name} ${c.state || ''}`.toLowerCase().includes(companySearch.toLowerCase())).map(c => <a key={c.id} href={`/book/${c.public_slug}?agent_token=${encodeURIComponent(token)}&agent=${encodeURIComponent(name)}`}><span>{c.name}{c.state ? ` — ${c.state}` : ''}</span><ExternalLink size={16}/></a>)}</div></section>}
    {view === 'pay' && <>{metrics}<section className="aw-panel"><h2>Payroll schedule</h2><p>Payroll weeks run Sunday–Saturday. Leads are assigned by appointment date, with the pay date on the following Saturday.</p><div className="aw-pay-dates">{payDates.map(date => <button key={date} aria-pressed={payDate === date} onClick={() => {setPayDate(date);setFilter('all');go('leads');}}>{formatDateLong(date)} · View leads</button>)}</div>{!payDates.length && <p className="aw-empty">No payroll dates in this period.</p>}</section></>}
    </main><nav className="aw-bottom" aria-label="Agent mobile navigation">{nav()}</nav></div>
  </div>;
}
function AgentLeadCard({row, correct}: {row: LeadRow; correct: (row: LeadRow) => void}) {
  return <article className="aw-lead"><div className="aw-date"><span>{new Date(`${row.appointment_date}T12:00:00`).toLocaleDateString('en-US',{month:'short'})}</span><strong>{row.appointment_date.slice(-2)}</strong></div><div className="aw-lead-main"><h3>{row.name}</h3><p>{row.company_name}</p><p>{formatDateLong(row.appointment_date)} · {formatTime(row.start_time)}</p><div className="aw-statuses"><span className={isUnsuccessful(row) ? 'aw-status aw-status-bad' : 'aw-status'}>{row.qc_status === 'approved' ? 'QC Approved' : leadStatusLabel(row.qc_status)}</span><span>Inspector: {leadStatusLabel(row.client_status || row.appointment_status || 'pending')}</span></div><details><summary>View details <ChevronDown size={15}/></summary><div className="aw-lead-details"><strong>Full address</strong><p>{row.address || 'No address recorded'}</p><a href={`tel:${row.phone}`}>{row.phone}</a><dl><div><dt>Inspector notes</dt><dd>{row.inspector_notes || 'No update yet'}</dd></div><div><dt>QC notes</dt><dd>{row.qc_reason || 'No QC note'}</dd></div><div><dt>Payroll week</dt><dd>{row.payroll_week_start} – {row.payroll_week_end}</dd></div><div><dt>Pay date</dt><dd>{row.pay_date || '—'}</dd></div></dl></div></details>{row.qc_status === 'needs_correction' && <button className="aw-correct" type="button" onClick={() => correct(row)}><Edit3 size={16}/>Open & Correct</button>}</div></article>;
}
