import { useEffect, useMemo, useState } from 'react';
import {
  Building2, CalendarDays, CheckCircle2, ChevronDown, CircleDollarSign,
  Clock3, FileText, Filter, Home, LayoutDashboard, Menu, Package, Pencil,
  Plus, Search, Settings, ShieldCheck, Trash2, UserRound, UsersRound,
  WalletCards, ChartNoAxesCombined
} from 'lucide-react';
import { supabase } from './supabase';
import { ThemeToggle } from './ThemeContext';
import { AdminPanel } from './AdminPanel';
import type { Agent, Profile, Team } from './types';
import type { useScheduleStore } from './useScheduleStore';

type ScheduleStore = ReturnType<typeof useScheduleStore>;
type StaffTab = 'agents' | 'managers' | 'team';
type View = 'overview' | 'slots';

type CompanyOps = {
  account_status: string;
  qc_pending: number;
  approved_leads: number;
  scheduled_upcoming: number;
  active_package: boolean;
  package: { payment_status?: string | null } | null;
};

type Props = {
  store: ScheduleStore;
  profile: Profile | null;
  signOut: () => Promise<void> | void;
  renderSlots: () => React.ReactNode;
};

const SIDEBAR_MAIN = [
  ['overview', 'Overview', Home],
  ['qc', 'QC Queue', ShieldCheck],
  ['companies', 'Companies & Packages', Building2],
  ['slots', 'Time Slots', CalendarDays],
  ['leads', 'Leads', FileText],
  ['appointments', 'Appointments', CalendarDays],
] as const;

const SIDEBAR_MANAGEMENT = [
  ['staff', 'Agents & Managers', UsersRound],
  ['teams', 'Teams', UsersRound],
  ['reports', 'Reports', ChartNoAxesCombined],
  ['invoices', 'Invoices', WalletCards],
  ['payroll', 'Payroll', CircleDollarSign],
  ['settings', 'Settings', Settings],
] as const;

export function AdminReferenceDashboard({ store, profile, signOut, renderSlots }: Props) {
  const [view, setView] = useState<View>('overview');
  const [staffTab, setStaffTab] = useState<StaffTab>('agents');
  const [search, setSearch] = useState('');
  const [teamFilter, setTeamFilter] = useState('all');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showManage, setShowManage] = useState(false);
  const [manageTab, setManageTab] = useState<string | undefined>();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [ops, setOps] = useState<CompanyOps[]>([]);
  const [loadingOps, setLoadingOps] = useState(true);
  const [userMenu, setUserMenu] = useState(false);

  async function refreshDashboard() {
    setLoadingOps(true);
    const [profilesRes, opsRes] = await Promise.all([
      supabase.from('profiles').select('*').order('display_name'),
      supabase.rpc('get_company_operations_overview'),
    ]);
    if (profilesRes.data) setProfiles(profilesRes.data as Profile[]);
    if (opsRes.data) setOps(opsRes.data as CompanyOps[]);
    setLoadingOps(false);
  }

  useEffect(() => { void refreshDashboard(); }, []);

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

  function navigate(key: string) {
    if (key === 'overview') setView('overview');
    else if (key === 'qc') window.location.href = '/qc';
    else if (key === 'companies') window.location.href = '/admin/portals';
    else if (key === 'slots' || key === 'appointments') setView('slots');
    else if (key === 'staff') { setView('overview'); setStaffTab('agents'); scrollStaff(); }
    else if (key === 'teams') { setView('overview'); setStaffTab('team'); scrollStaff(); }
    else if (key === 'settings') openManage('companies');
    else if (key === 'leads') { setView('overview'); scrollStaff(); }
    else openManage();
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

  const currentSection = view === 'slots' ? 'slots' : 'overview';

  return (
    <div className={`readyops-ref-shell ${sidebarCollapsed ? 'is-sidebar-collapsed' : ''}`}>
      <aside className="readyops-ref-sidebar">
        <button className="readyops-ref-wordmark" onClick={() => setView('overview')} aria-label="Ready Ops home">
          <span>Ready</span><span>Ops</span>
        </button>
        <SidebarGroup title="MAIN" collapsed={sidebarCollapsed} items={SIDEBAR_MAIN} active={currentSection} onSelect={navigate} />
        <SidebarGroup title="MANAGEMENT" collapsed={sidebarCollapsed} items={SIDEBAR_MANAGEMENT} active="" onSelect={navigate} />
      </aside>

      <div className="readyops-ref-workspace">
        <div className="readyops-ref-scene" aria-hidden="true">
          <Skyline />
          <div className="readyops-ref-watermark">R</div>
        </div>

        <header className="readyops-ref-topbar">
          <div className="flex min-w-0 items-center gap-3">
            <button className="readyops-ref-icon-button" onClick={() => setSidebarCollapsed(v => !v)} title="Toggle sidebar"><Menu size={17}/></button>
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

        <main className="readyops-ref-main">
          {view === 'overview' ? <>
            <div className="readyops-ref-title-row"><h2>Overview</h2><span>Command Center</span></div>

            <section className="readyops-ref-metrics">
              <MetricCard label="ACTIVE COMPANIES" value={metrics.companies} note="+2 this week" icon={Building2} tone="blue" loading={loadingOps}/>
              <MetricCard label="QC PENDING" value={metrics.qc} note={metrics.qc ? 'Needs review' : 'No items pending'} icon={ShieldCheck} tone="orange" loading={loadingOps}/>
              <MetricCard label="APPROVED LEADS" value={metrics.approved} note="+1 today" icon={CheckCircle2} tone="green" loading={loadingOps}/>
              <MetricCard label="UPCOMING APPOINTMENTS" value={metrics.appointments} note="Today & Tomorrow" icon={CalendarDays} tone="purple" loading={loadingOps}/>
              <MetricCard label="ACTIVE PACKAGES" value={metrics.packages} note={metrics.packages ? 'Packages running' : 'No active packages'} icon={Package} tone="blue" loading={loadingOps}/>
              <MetricCard label="PENDING PAYMENTS" value={metrics.payments} note={metrics.payments ? 'Follow up required' : 'All caught up'} icon={CircleDollarSign} tone="red" loading={loadingOps}/>
            </section>

            <section id="readyops-staff" className="readyops-ref-card readyops-ref-staff-card">
              <div className="readyops-ref-card-heading"><h3>Agents & Managers</h3></div>
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
                    return <tr key={agent.id}><td>{agent.name}</td><td><TeamBadge team={team}/></td><td>{linked?.display_name || agent.email || '—'}</td><td><StatusBadge active={agent.active !== false}/></td><td><div className="readyops-ref-actions"><button onClick={() => openManage('agents')}><Pencil size={14}/></button><button className="danger" onClick={() => void deleteAgent(agent)}><Trash2 size={14}/></button></div></td></tr>;
                  })}</tbody></table>
                )}
              </div>
            </section>

            <section className="readyops-ref-card readyops-ref-quick-card">
              <div className="readyops-ref-tabs readyops-ref-tabs-large">
                <button className="active">Overview</button>
                <button onClick={() => window.location.href = '/qc'}>QC Queue</button>
                <button onClick={() => window.location.href = '/admin/portals'}>Companies & Packages</button>
                <button onClick={() => setView('slots')}>Time Slots</button>
              </div>
              <div className="readyops-ref-quick-actions">
                <button className="readyops-ref-primary" onClick={() => openManage('add-company')}><Plus size={14}/> Add Company</button>
                <button className="readyops-ref-green" onClick={() => openManage('agents')}><Plus size={14}/> Add Agent</button>
                <button className="readyops-ref-purple" onClick={() => setView('slots')}><Plus size={14}/> Add Location Row</button>
                <button className="readyops-ref-secondary" onClick={() => openManage('companies')}><Settings size={14}/> Edit Status</button>
              </div>
            </section>
          </> : (
            <section className="readyops-ref-slots-view">
              <div className="readyops-ref-title-row"><h2>Time Slots</h2><button onClick={() => setView('overview')}>← Back to Overview</button></div>
              {renderSlots()}
            </section>
          )}
        </main>
      </div>

      {showManage && <AdminPanel store={store} onClose={() => setShowManage(false)} initialTab={manageTab}/>} 
    </div>
  );
}

function SidebarGroup({ title, items, active, onSelect, collapsed }: { title: string; items: ReadonlyArray<readonly [string, string, React.ComponentType<{size?: number}>]>; active: string; onSelect: (key: string) => void; collapsed: boolean }) {
  return <div className="readyops-ref-nav-group"><p>{collapsed ? '•' : title}</p>{items.map(([key, label, Icon]) => <button key={key} className={active === key ? 'active' : ''} onClick={() => onSelect(key)} title={collapsed ? label : undefined}><Icon size={16}/>{!collapsed && <span>{label}</span>}</button>)}</div>;
}

function MetricCard({ label, value, note, icon: Icon, tone, loading }: { label: string; value: number; note: string; icon: React.ComponentType<{size?: number}>; tone: string; loading: boolean }) {
  return <article className={`readyops-ref-metric tone-${tone}`}><div><p>{label}</p><strong>{loading ? '—' : value}</strong><span>{note}</span></div><div className="readyops-ref-metric-icon"><Icon size={21}/></div></article>;
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
