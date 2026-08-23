import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Building2, CalendarDays, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, CircleDollarSign,
  ClipboardCopy, ExternalLink, FileText, Filter, Home, Link2, Menu, Package, Pencil, Plus, RefreshCw, Search, Settings,
  ShieldCheck, ShieldX, Trash2, UsersRound, WalletCards, BarChart3, Wifi, Handshake, ThumbsDown, ThumbsUp, UserX,
} from 'lucide-react';
import { supabase } from './supabase';
import { ThemeToggle } from './ThemeContext';
import { AdminPanel } from './AdminPanel';
import type { Agent, Profile, Team } from './types';
import { useScheduleStore } from './useScheduleStore';
import { AdminReports } from './AdminReports';
import { AdminInvoices } from './AdminInvoices';
import { AdminPayroll } from './AdminPayroll';
import { AdminSchedulingManager } from './AdminSchedulingManager';

type ScheduleStore = ReturnType<typeof useScheduleStore>;
type StaffTab = 'agents' | 'managers' | 'team';
type View = 'overview' | 'reports' | 'invoices' | 'payroll';
type IconComponent = typeof Home;

type CompanyOps = {
  account_status: string;
  qc_pending: number;
  approved_leads: number;
  scheduled_upcoming: number;
  active_package: boolean;
  package: { payment_status?: string | null } | null;
};

type OutcomeMetrics = {
  good: number;
  signed: number;
  bad: number;
  noShow: number;
  denied: number;
};

const EMPTY_OUTCOME_METRICS: OutcomeMetrics = { good: 0, signed: 0, bad: 0, noShow: 0, denied: 0 };

type Props = {
  store: ScheduleStore;
  profile: Profile | null;
  signOut: () => Promise<void> | void;
};

type SidebarItem = readonly [string, string, IconComponent];

const SIDEBAR_STORAGE_KEY = 'readyops-sidebar-collapsed';
const TOPBAR_STORAGE_KEY = 'readyops-topbar-collapsed';

const SIDEBAR_MAIN: readonly SidebarItem[] = [
  ['overview', 'Overview', Home],
  ['qc', 'QC Queue', ShieldCheck],
  ['companies', 'Companies & Scheduling', Building2],
  ['leads', 'Leads', FileText],
] as const;

const SIDEBAR_MANAGEMENT: readonly SidebarItem[] = [
  ['staff', 'People & Teams', UsersRound],
  ['active-users', 'Active Users', Wifi],
  ['reports', 'Reports', BarChart3],
  ['invoices', 'Invoices', WalletCards],
  ['payroll', 'Payroll', CircleDollarSign],
] as const;

function getInitialSidebarCollapsed(): boolean {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === '1';
}

function getInitialView(): View {
  if (typeof window === 'undefined') return 'overview';
  const requested = new URLSearchParams(window.location.search).get('view');
  return requested === 'reports' || requested === 'invoices' || requested === 'payroll'
    ? requested
    : 'overview';
}

export function AdminReferenceDashboard({ store, profile, signOut }: Props) {
  const [view, setView] = useState<View>(getInitialView);
  const [staffTab, setStaffTab] = useState<StaffTab>('agents');
  const [search, setSearch] = useState('');
  const [teamFilter, setTeamFilter] = useState('all');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(getInitialSidebarCollapsed);
  const [topbarCollapsed, setTopbarCollapsed] = useState(
    () => typeof window !== 'undefined' && window.localStorage.getItem(TOPBAR_STORAGE_KEY) === '1',
  );
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 900);
  const [showManage, setShowManage] = useState(false);
  const [manageTab, setManageTab] = useState<string | undefined>();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [ops, setOps] = useState<CompanyOps[]>([]);
  const [outcomes, setOutcomes] = useState<OutcomeMetrics>(EMPTY_OUTCOME_METRICS);
  const [loadingOps, setLoadingOps] = useState(true);
  const [companyPortalsOnline, setCompanyPortalsOnline] = useState(0);
  const [userMenu, setUserMenu] = useState(false);
  const [showSchedulingManager, setShowSchedulingManager] = useState(false);
  const [schedulingManagerMode, setSchedulingManagerMode] = useState<'company' | 'locations'>('locations');
  const [schedulingLocationId, setSchedulingLocationId] = useState<string | undefined>();
  const [reportStatus, setReportStatus] = useState('all');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requested = params.get('view');
    if (requested === 'appointments' || requested === 'slots') {
      const company = params.get('company');
      window.location.replace(company ? `/admin/operations?company=${encodeURIComponent(company)}` : '/admin/operations');
    }
  }, []);

  async function refreshDashboard() {
    setLoadingOps(true);
    const [profilesRes, opsRes, presenceRes, appointmentStatusRes, deniedRes] = await Promise.all([
      supabase.from('profiles').select('*').order('display_name'),
      supabase.rpc('get_company_operations_overview'),
      supabase
        .from('company_portal_presence')
        .select('*', { count: 'exact', head: true })
        .gte('last_seen_at', new Date(Date.now() - 90_000).toISOString()),
      supabase.from('portal_appointments').select('client_status,canonical_status,sales_outcome,attendance_status'),
      supabase.from('portal_leads').select('*', { count: 'exact', head: true }).eq('qc_status', 'denied'),
    ]);
    if (profilesRes.data) setProfiles(profilesRes.data as Profile[]);
    if (opsRes.data) setOps(opsRes.data as CompanyOps[]);
    if (!presenceRes.error) setCompanyPortalsOnline(presenceRes.count || 0);
    if (!appointmentStatusRes.error) {
      const rows = appointmentStatusRes.data || [];
      setOutcomes({
        good: rows.filter(row => String(row.client_status || '').toLowerCase() === 'good' || ['good', 'good_inspected'].includes(String(row.canonical_status || '').toLowerCase())).length,
        signed: rows.filter(row => [row.client_status, row.canonical_status, row.sales_outcome].some(value => String(value || '').toLowerCase() === 'signed_contract')).length,
        bad: rows.filter(row => String(row.client_status || '').toLowerCase() === 'bad' || String(row.canonical_status || '').toLowerCase() === 'bad' || String(row.sales_outcome || '').toLowerCase() === 'lost').length,
        noShow: rows.filter(row => String(row.client_status || '').toLowerCase() === 'no_show' || String(row.canonical_status || '').toLowerCase() === 'no_show' || String(row.attendance_status || '').toLowerCase().includes('no_show')).length,
        denied: deniedRes.error ? 0 : deniedRes.count || 0,
      });
    }
    setLoadingOps(false);
  }

  useEffect(() => { void refreshDashboard(); }, []);

  useEffect(() => {
    const timer = window.setInterval(async () => {
      const { count, error } = await supabase
        .from('company_portal_presence')
        .select('*', { count: 'exact', head: true })
        .gte('last_seen_at', new Date(Date.now() - 90_000).toISOString());
      if (!error) setCompanyPortalsOnline(count || 0);
    }, 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, sidebarCollapsed ? '1' : '0');
  }, [sidebarCollapsed]);

  useEffect(() => {
    window.localStorage.setItem(TOPBAR_STORAGE_KEY, topbarCollapsed ? '1' : '0');
  }, [topbarCollapsed]);

  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth < 900;
      setIsMobile(mobile);
      if (!mobile) setMobileSidebarOpen(false);
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const metrics = useMemo(() => ({
    companies: store.companies.filter(c => c.account_status === 'Active').length,
    qc: ops.reduce((sum, c) => sum + Number(c.qc_pending || 0), 0),
    approved: ops.reduce((sum, c) => sum + Number(c.approved_leads || 0), 0),
    appointments: ops.reduce((sum, c) => sum + Number(c.scheduled_upcoming || 0), 0),
    packages: ops.filter(c => c.active_package).length,
    payments: ops.filter(c => c.package?.payment_status === 'pending').length,
  }), [ops, store.companies]);

  const agentRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return [...store.agents]
      .filter(agent => teamFilter === 'all' || agent.team_id === teamFilter)
      .filter(agent => !q || [agent.name, agent.email, teamName(store.teams, agent.team_id)]
        .filter(Boolean).some(value => String(value).toLowerCase().includes(q)))
      .sort((a, b) => {
        if (staffTab === 'team') {
          const teamCompare = teamName(store.teams, a.team_id).localeCompare(teamName(store.teams, b.team_id));
          if (teamCompare) return teamCompare;
        }
        return a.name.localeCompare(b.name);
      });
  }, [store.agents, store.teams, search, teamFilter, staffTab]);

  const managerRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return profiles
      .filter(p => p.role === 'manager')
      .filter(p => teamFilter === 'all' || p.team_id === teamFilter)
      .filter(p => !q || [p.display_name, p.email, teamName(store.teams, p.team_id || '')]
        .filter(Boolean).some(value => String(value).toLowerCase().includes(q)))
      .sort((a, b) => a.display_name.localeCompare(b.display_name));
  }, [profiles, store.teams, search, teamFilter]);

  function openManage(tab?: string) {
    setManageTab(tab);
    setShowManage(true);
  }

  function openSchedulingManager(mode: 'company' | 'locations', locationId?: string) {
    setSchedulingManagerMode(mode);
    setSchedulingLocationId(locationId);
    setShowSchedulingManager(true);
  }

  function closeMobileSidebar() {
    setMobileSidebarOpen(false);
  }

  function navigate(key: string) {
    closeMobileSidebar();
    if (key === 'overview') setView('overview');
    else if (key === 'qc') window.location.href = '/qc';
    else if (key === 'companies') window.location.href = '/admin/operations';
    else if (key === 'staff') { setView('overview'); setStaffTab('agents'); scrollStaff(); }
    else if (key === 'reports') { setReportStatus('all'); setView('reports'); }
    else if (key === 'invoices') setView('invoices');
    else if (key === 'payroll') setView('payroll');
    else if (key === 'active-users') window.location.href = '/admin/active-users';
    else if (key === 'leads') window.location.href = '/admin/crm';
    else openManage();
  }

  function openReport(status: string) {
    setReportStatus(status);
    setView('reports');
  }

  function toggleSidebar() {
    if (isMobile) setMobileSidebarOpen(open => !open);
    else setSidebarCollapsed(collapsed => !collapsed);
  }

  async function addTeam() {
    const name = window.prompt('Team name');
    if (!name?.trim()) return;
    const abbreviation = window.prompt('Team abbreviation (example: OCTO, MSR, BRL)')?.trim().toUpperCase();
    if (!abbreviation) return;
    const { error } = await supabase.from('teams').insert({ name: name.trim(), abbreviation });
    if (error) window.alert(error.message);
    else await store.refetch();
  }

  async function deleteAgent(agent: Agent) {
    if (!window.confirm(`Delete ${agent.name}? This removes the ReadyOps agent record and unlinks any user account.`)) return;
    await supabase.from('profiles').update({ agent_id: null }).eq('agent_id', agent.id);
    const { error } = await supabase.from('agents').delete().eq('id', agent.id);
    if (error) window.alert(error.message);
    else await store.refetch();
  }

  function agentPortalLink(agent: Agent): string {
    if (!agent.portal_slug || !agent.access_token) return '';
    return `${window.location.origin}/agent/${agent.portal_slug}/${agent.access_token}`;
  }

  async function regenerateAgentPortalLink(agent: Agent) {
    const existing = Boolean(agent.portal_slug && agent.access_token);
    if (!window.confirm(existing
      ? `Generate a new private lead link for ${agent.name}? The old link will stop working immediately.`
      : `Generate a private lead link for ${agent.name}?`)) return;
    const { data, error } = await supabase.rpc('regenerate_agent_portal_link', { p_agent_id: agent.id });
    if (error) {
      window.alert(error.message);
      return;
    }
    await store.refetch();
    const result = data as { portal_slug?: string; access_token?: string } | null;
    if (result?.portal_slug && result?.access_token) {
      const link = `${window.location.origin}/agent/${result.portal_slug}/${result.access_token}`;
      try { await navigator.clipboard.writeText(link); } catch { /* copy is optional */ }
      window.alert(`New agent portal link created for ${agent.name}. The link was copied when browser permissions allowed it.`);
    }
  }

  const currentSection = view;
  const shellClasses = [
    'readyops-ref-shell',
    sidebarCollapsed ? 'is-sidebar-collapsed' : '',
    topbarCollapsed ? 'is-topbar-collapsed' : '',
    mobileSidebarOpen ? 'is-mobile-sidebar-open' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={shellClasses}>
      <button
        type="button"
        className="readyops-ref-sidebar-backdrop"
        aria-label="Close navigation"
        onClick={closeMobileSidebar}
      />

      <aside className="readyops-ref-sidebar">
        <button className="readyops-ref-wordmark" onClick={() => navigate('overview')} aria-label="Ready Ops home">
          <span>Ready</span><span>Ops</span>
        </button>
        <button type="button" className="readyops-sidebar-edge-toggle" onClick={() => setSidebarCollapsed(v => !v)} title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}>{sidebarCollapsed ? <ChevronRight size={15}/> : <ChevronLeft size={15}/>}</button>
        <SidebarGroup title="MAIN" collapsed={sidebarCollapsed && !isMobile} items={SIDEBAR_MAIN} active={currentSection} onSelect={navigate} />
        <SidebarGroup title="MANAGEMENT" collapsed={sidebarCollapsed && !isMobile} items={SIDEBAR_MANAGEMENT} active={currentSection} onSelect={navigate} />
      </aside>

      <div className="readyops-ref-workspace">
        <div className="readyops-ref-scene" aria-hidden="true">
          <Skyline />
          <div className="readyops-ref-watermark">R</div>
        </div>

        <header className="readyops-ref-topbar">
          <div className="flex min-w-0 items-center gap-3">
            <button className="readyops-ref-icon-button" onClick={toggleSidebar} title={isMobile ? 'Open navigation' : 'Collapse / expand sidebar'}><Menu size={17}/></button>
            <div className="min-w-0">
              <h1 className="truncate text-base font-extrabold">Ready Ops</h1>
              <p className="truncate text-[11px] opacity-70">Admin Dashboard — Full Access</p>
            </div>
          </div>
          <div className="readyops-ref-top-actions">
            <span className="readyops-ref-live"><i/> Live</span>
            <span className="readyops-ref-admin"><i/> Admin</span>
            <button className="readyops-ref-manage" onClick={() => openManage()}><Settings size={14}/> Manage</button>
            <ThemeToggle />
            <div className="relative">
              <button className="readyops-ref-user" onClick={() => setUserMenu(v => !v)}>
                <span className="readyops-ref-avatar">{initials(profile?.display_name || 'Admin')}</span>
                <span className="hidden sm:inline">Admin</span><ChevronDown size={13}/>
              </button>
              {userMenu && <div className="readyops-ref-user-menu"><button onClick={() => void signOut()}>Sign Out</button></div>}
            </div>
          </div>
        </header>
        <button
          type="button"
          className="readyops-topbar-edge-toggle"
          onClick={() => setTopbarCollapsed(value => !value)}
          title={topbarCollapsed ? 'Show top header' : 'Hide top header'}
          aria-label={topbarCollapsed ? 'Show top header' : 'Hide top header'}
          aria-expanded={!topbarCollapsed}
        >
          {topbarCollapsed ? <ChevronDown size={15}/> : <ChevronUp size={15}/>}
        </button>

        <main className="readyops-ref-main">
          {view === 'overview' ? <>
            <PageHeader
              title="Overview"
              subtitle="Command Center"
              actions={(
                <>
                  <button className="readyops-ref-primary" onClick={() => openManage('add-company')}><Plus size={14}/> Add Company</button>
                  <button className="readyops-ref-green" onClick={() => openManage('agents')}><Plus size={14}/> Add Agent</button>
                  <button className="readyops-ref-purple" onClick={() => openSchedulingManager('locations')}><Plus size={14}/> Add Location</button>
                  <button className="readyops-ref-secondary" onClick={() => openManage('companies')}><Settings size={14}/> Edit Status</button>
                </>
              )}
            />

            <section className="readyops-ref-metrics">
              <MetricCard label="ACTIVE COMPANIES" value={metrics.companies} note={companyPortalsOnline ? `${companyPortalsOnline} using portal now` : 'No portal activity now'} icon={Building2} tone="blue" loading={loadingOps} onClick={() => { window.location.href = '/admin/operations?status=active'; }}/>
              <MetricCard label="QC PENDING" value={metrics.qc} note={metrics.qc ? 'Needs review' : 'No items pending'} icon={ShieldCheck} tone="orange" loading={loadingOps} onClick={() => { window.location.href = '/qc?status=pending'; }}/>
              <MetricCard label="QC DENIED" value={outcomes.denied} note={outcomes.denied ? 'Open denied leads' : 'No denied leads'} icon={ShieldX} tone="red" loading={loadingOps} onClick={() => { window.location.href = '/qc?status=denied'; }}/>
              <MetricCard label="APPROVED LEADS" value={metrics.approved} note="Open approved leads" icon={CheckCircle2} tone="green" loading={loadingOps} onClick={() => { window.location.href = '/qc?status=approved'; }}/>
              <MetricCard label="GOOD" value={outcomes.good} note="Client-marked good leads" icon={ThumbsUp} tone="green" loading={loadingOps} onClick={() => openReport('good')}/>
              <MetricCard label="SIGNED DEALS" value={outcomes.signed} note="Signed contracts" icon={Handshake} tone="purple" loading={loadingOps} onClick={() => openReport('signed_contract')}/>
              <MetricCard label="BAD" value={outcomes.bad} note="Bad or lost leads" icon={ThumbsDown} tone="red" loading={loadingOps} onClick={() => openReport('bad')}/>
              <MetricCard label="NO SHOWS" value={outcomes.noShow} note="Homeowner no shows" icon={UserX} tone="orange" loading={loadingOps} onClick={() => openReport('no_show')}/>
              <MetricCard label="UPCOMING APPOINTMENTS" value={metrics.appointments} note="Today & Tomorrow" icon={CalendarDays} tone="purple" loading={loadingOps} onClick={() => { window.location.href = '/admin/operations'; }}/>
              <MetricCard label="ACTIVE PACKAGES" value={metrics.packages} note={metrics.packages ? 'Packages running' : 'No active packages'} icon={Package} tone="blue" loading={loadingOps} onClick={() => { window.location.href = '/admin/operations?status=active-package'; }}/>
              <MetricCard label="PENDING PAYMENTS" value={metrics.payments} note={metrics.payments ? 'Follow up required' : 'All caught up'} icon={CircleDollarSign} tone="red" loading={loadingOps} onClick={() => { window.location.href = '/admin/operations?status=pending-payment'; }}/>
            </section>

            <section id="readyops-staff" className="readyops-ref-card readyops-ref-staff-card">
              <div className="readyops-ref-card-heading"><h3>People & Teams</h3></div>
              <div className="readyops-ref-tabs">
                <button className={staffTab === 'agents' ? 'active' : ''} onClick={() => setStaffTab('agents')}>All Agents</button>
                <button className={staffTab === 'managers' ? 'active' : ''} onClick={() => setStaffTab('managers')}>Managers</button>
                <button className={staffTab === 'team' ? 'active' : ''} onClick={() => setStaffTab('team')}>By Team</button>
              </div>
              <div className="readyops-ref-toolbar">
                <div className="readyops-ref-search"><Search size={14}/><input value={search} onChange={e => setSearch(e.target.value)} placeholder={staffTab === 'managers' ? 'Search managers...' : 'Search agents...'}/></div>
                <div className="ml-auto flex flex-wrap gap-2">
                  <button className="readyops-ref-primary" onClick={() => openManage(staffTab === 'managers' ? undefined : 'agents')}><Plus size={14}/> {staffTab === 'managers' ? 'Add Manager' : 'Add Agent'}</button>
                  <button className="readyops-ref-secondary" onClick={() => void addTeam()}><Plus size={14}/> Add Team</button>
                  <label className="readyops-ref-filter"><Filter size={14}/><select value={teamFilter} onChange={e => setTeamFilter(e.target.value)}><option value="all">Filter</option>{store.teams.map(team => <option key={team.id} value={team.id}>{team.abbreviation}</option>)}</select></label>
                </div>
              </div>
              <div className="readyops-ref-table-wrap">
                {staffTab === 'managers' ? (
                  <table className="readyops-ref-table"><thead><tr><th>MANAGER NAME</th><th>TEAM</th><th>LINKED USER</th><th>STATUS</th><th>ACTIONS</th></tr></thead><tbody>{managerRows.map(manager => {
                    const team = store.teams.find(t => t.id === manager.team_id);
                    return <tr key={manager.id}><td>{manager.display_name}</td><td><TeamBadge team={team}/></td><td>{manager.email || '—'}</td><td><StatusBadge/></td><td><div className="readyops-ref-actions"><button onClick={() => openManage()}><Pencil size={14}/></button></div></td></tr>;
                  })}</tbody></table>
                ) : (
                  <table className="readyops-ref-table"><thead><tr><th>AGENT NAME</th><th>TEAM</th><th>LINKED USER</th><th>STATUS</th><th>ACTIONS</th></tr></thead><tbody>{agentRows.map(agent => {
                    const team = store.teams.find(t => t.id === agent.team_id);
                    const linked = profiles.find(p => p.agent_id === agent.id);
                    const portalLink = agentPortalLink(agent);
                    return <tr key={agent.id}><td>{agent.name}</td><td><TeamBadge team={team}/></td><td>{linked?.display_name || agent.email || '—'}</td><td><StatusBadge active={agent.active !== false}/></td><td><div className="readyops-ref-actions">{portalLink && <><button title="Copy Agent Portal Link" onClick={() => void navigator.clipboard.writeText(portalLink)}><ClipboardCopy size={14}/></button><button title="Open Agent Lead Portal" onClick={() => window.open(portalLink, '_blank', 'noopener,noreferrer')}><ExternalLink size={14}/></button></>}<button title={portalLink ? 'Generate New Agent Link' : 'Generate Agent Link'} onClick={() => void regenerateAgentPortalLink(agent)}>{portalLink ? <RefreshCw size={14}/> : <Link2 size={14}/>}</button><button title="Edit Agent" onClick={() => openManage('agents')}><Pencil size={14}/></button><button title="Delete Agent" className="danger" onClick={() => void deleteAgent(agent)}><Trash2 size={14}/></button></div></td></tr>;
                  })}</tbody></table>
                )}
              </div>
            </section>
          </> : view === 'reports' ? (
            <AdminReports initialStatusFilter={reportStatus} />
          ) : view === 'invoices' ? (
            <AdminInvoices />
          ) : (
            <AdminPayroll />
          )}
        </main>
      </div>

      {showSchedulingManager && (
        <AdminSchedulingManager
          store={store}
          initialMode={schedulingManagerMode}
          initialLocationId={schedulingLocationId}
          onClose={() => setShowSchedulingManager(false)}
        />
      )}
      {showManage && <AdminPanel store={store} onClose={() => setShowManage(false)} initialTab={manageTab}/>} 
    </div>
  );
}

function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="readyops-ref-page-header">
      <div className="readyops-ref-title-row"><h2>{title}</h2>{subtitle && <span>{subtitle}</span>}</div>
      {actions && <div className="readyops-ref-page-actions">{actions}</div>}
    </div>
  );
}

function SidebarGroup({ title, items, active, onSelect, collapsed }: { title: string; items: readonly SidebarItem[]; active: string; onSelect: (key: string) => void; collapsed: boolean }) {
  return (
    <div className="readyops-ref-nav-group">
      <p>{collapsed ? '•' : title}</p>
      {items.map(([key, label, Icon]) => (
        <button
          key={key}
          className={active === key ? 'active' : ''}
          onClick={() => onSelect(key)}
          title={collapsed ? label : undefined}
          data-tooltip={collapsed ? label : undefined}
        >
          <Icon size={16}/>{!collapsed && <span>{label}</span>}
        </button>
      ))}
    </div>
  );
}

function MetricCard({ label, value, note, icon: Icon, tone, loading, onClick }: { label: string; value: number; note: string; icon: IconComponent; tone: string; loading: boolean; onClick: () => void }) {
  return <button type="button" className={`readyops-ref-metric readyops-ref-metric-link tone-${tone}`} onClick={onClick} aria-label={`${label}: ${loading ? 'loading' : value}. ${note}`}><div><p>{label}</p><strong>{loading ? '—' : value}</strong><span>{note}</span></div><div className="readyops-ref-metric-icon"><Icon size={21}/></div></button>;
}

function TeamBadge({ team }: { team?: Team }) {
  if (!team) return <span className="readyops-ref-team team-none">—</span>;
  const key = team.abbreviation.toLowerCase();
  return <span className={`readyops-ref-team team-${key}`}>{team.abbreviation}</span>;
}

function StatusBadge({ active = true }: { active?: boolean }) {
  return <span className={`readyops-ref-status ${active ? '' : 'inactive'}`}>{active ? 'Active' : 'Inactive'}</span>;
}

function teamName(teams: Team[], id: string): string {
  return teams.find(team => team.id === id)?.name || '';
}

function initials(value: string): string {
  return value.split(/\s+/).filter(Boolean).slice(0, 2).map(x => x[0]?.toUpperCase()).join('') || 'AD';
}

function scrollStaff() {
  window.setTimeout(() => document.getElementById('readyops-staff')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
}

function Skyline() {
  return <svg viewBox="0 0 1400 260" preserveAspectRatio="none" aria-hidden="true">
    <g fill="currentColor" opacity=".38">
      <path d="M0 230h40v-52h18v52h33v-88h28v88h18v-36h28v36h44v-112h31v112h20v-70h32v70h30v-150h15v-38h14v38h18v150h28v-94h27v94h42v-124h36v124h18v-58h30v58h54v-175h17v-34h12v34h16v175h30v-92h36v92h29v-55h31v55h47v-148h12v-29h10v29h13v148h23v-84h33v84h43v-116h28v116h26v-48h30v48h42v-133h31v133h39v-72h25v72h56v-102h30v102h22v-60h31v60h40v30H0z"/>
      <path opacity=".28" d="M0 242h1400v18H0z"/>
    </g>
  </svg>;
}
