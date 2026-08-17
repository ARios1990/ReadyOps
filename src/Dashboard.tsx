import { useState } from 'react';
import {
  Calendar, LogOut, Building2, Users, RefreshCw, MapPin,
  Shield, User, ChevronDown, Loader2, Settings, Search, Filter, Plus, UserPlus
} from 'lucide-react';
import { useAuth } from './AuthContext';
import { useScheduleStore } from './useScheduleStore';
import { ScheduleGrid } from './ScheduleGrid';
import { AdminPanel } from './AdminPanel';
import { DAYS, ScheduleRow } from './types';

export function Dashboard() {
  const { profile, signOut } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const store = useScheduleStore();

  const [activeDay, setActiveDay] = useState<string>('Monday');
  const [selectedCompany, setSelectedCompany] = useState<string>('all');
  const [selectedTeam, setSelectedTeam] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('Active');
  const [searchQuery, setSearchQuery] = useState('');
  const [showAdmin, setShowAdmin] = useState(false);
  const [adminTab, setAdminTab] = useState<string | undefined>(undefined);

  // Quick add modals
  const [showAddLocation, setShowAddLocation] = useState(false);
  const [locCompany, setLocCompany] = useState('');
  const [locLabel, setLocLabel] = useState('');
  const [locState, setLocState] = useState('');

  if (store.loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="animate-spin text-blue-600" size={32} />
          <p className="text-sm text-gray-500">Loading schedule...</p>
        </div>
      </div>
    );
  }

  const userTeam = (() => {
    if (!profile?.agent_id) return null;
    const agent = store.agents.find(a => a.id === profile.agent_id);
    if (!agent) return null;
    return store.teams.find(t => t.id === agent.team_id) || null;
  })();

  const filteredRows: ScheduleRow[] = (() => {
    let rows = store.scheduleRows;

    if (statusFilter !== 'all') {
      rows = rows.filter(r => {
        const c = store.companies.find(co => co.id === r.companyId);
        return c?.account_status === statusFilter;
      });
    }

    if (selectedTeam !== 'all') {
      rows = rows.filter(r => {
        const teamsList = store.getCompanyTeams(r.companyId);
        return teamsList.some(t => t.id === selectedTeam);
      });
    }

    if (selectedCompany !== 'all') {
      rows = rows.filter(r => r.companyId === selectedCompany);
    }

    if (!isAdmin && userTeam) {
      rows = rows.filter(r => {
        const teamsList = store.getCompanyTeams(r.companyId);
        return teamsList.some(t => t.id === userTeam.id);
      });
    }

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      rows = rows.filter(r =>
        r.companyName.toLowerCase().includes(q) ||
        (r.state && r.state.toLowerCase().includes(q)) ||
        (r.locationLabel && r.locationLabel.toLowerCase().includes(q))
      );
    }

    return rows;
  })();

  const canEdit = (companyId: string) => {
    if (isAdmin) return true;
    if (!userTeam) return false;
    const teamsList = store.getCompanyTeams(companyId);
    return teamsList.some(t => t.id === userTeam.id);
  };

  const dayBookingCounts = DAYS.reduce((acc, day) => {
    acc[day] = store.bookings.filter(b => b.day === day).length;
    return acc;
  }, {} as Record<string, number>);

  function openAdminTab(tab: string) {
    setAdminTab(tab);
    setShowAdmin(true);
  }

  async function handleAddLocation() {
    if (!locCompany || !locLabel.trim()) return;
    await store.addLocation(locCompany, locLabel.trim(), locState.trim() || null);
    setShowAddLocation(false);
    setLocCompany('');
    setLocLabel('');
    setLocState('');
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 shadow-sm sticky top-0 z-30">
        <div className="max-w-[1800px] mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-gradient-to-br from-blue-500 to-blue-700 rounded-xl flex items-center justify-center">
              <Calendar className="text-white" size={18} />
            </div>
            <div>
              <h1 className="text-lg font-bold text-gray-900 leading-tight">Time Slot Scheduler</h1>
              <p className="text-xs text-gray-500">
                {isAdmin ? 'Admin Dashboard -- Full Access' : (
                  userTeam
                    ? `Team: ${userTeam.name} (${userTeam.abbreviation})`
                    : `Agent: ${profile?.display_name}`
                )}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 px-2.5 py-1 bg-green-50 border border-green-200 rounded-full">
              <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse"></span>
              <span className="text-xs text-green-700 font-medium">Live</span>
            </div>

            {userTeam && !isAdmin && (
              <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold ${getTeamPillStyle(userTeam.abbreviation)}`}>
                {userTeam.abbreviation}
              </div>
            )}

            <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium ${
              isAdmin ? 'bg-amber-50 text-amber-700 border border-amber-200' : 'bg-blue-50 text-blue-700 border border-blue-200'
            }`}>
              {isAdmin ? <Shield size={13} /> : <User size={13} />}
              {isAdmin ? 'Admin' : 'Agent'}
            </div>

            {isAdmin && (
              <button
                onClick={() => { setAdminTab(undefined); setShowAdmin(!showAdmin); }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  showAdmin ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                <Settings size={14} /> Manage
              </button>
            )}

            <button
              onClick={signOut}
              className="flex items-center gap-1.5 px-3 py-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg text-sm transition-colors"
            >
              <LogOut size={15} />
            </button>
          </div>
        </div>
      </header>

      {/* Admin Panel */}
      {showAdmin && isAdmin && (
        <AdminPanel store={store} onClose={() => setShowAdmin(false)} initialTab={adminTab} />
      )}

      <main className="max-w-[1800px] mx-auto px-4 sm:px-6 py-5">
        {/* Team scope notice for agents */}
        {!isAdmin && userTeam && (
          <div className={`mb-4 px-4 py-3 rounded-xl border ${getTeamBannerStyle(userTeam.abbreviation)}`}>
            <div className="flex items-center gap-2">
              <Users size={16} />
              <span className="text-sm font-medium">
                Viewing <strong>{userTeam.name}</strong> companies only.
              </span>
            </div>
            <p className="text-xs mt-1 opacity-75">You can book/unbook time slots for your team's companies.</p>
          </div>
        )}

        {!isAdmin && !userTeam && (
          <div className="mb-4 px-4 py-3 rounded-xl border border-amber-200 bg-amber-50 text-amber-800">
            <p className="text-sm font-medium">Your account is not yet linked to an agent profile.</p>
            <p className="text-xs mt-1">Ask your admin to assign you to a team.</p>
          </div>
        )}

        {/* Action Buttons (Admin) */}
        {isAdmin && (
          <div className="flex flex-wrap gap-2 mb-4">
            <button
              onClick={() => openAdminTab('add-company')}
              className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 text-white rounded-lg text-xs font-medium hover:bg-blue-700 transition-colors shadow-sm"
            >
              <Plus size={13} /> Add Company
            </button>
            <button
              onClick={() => openAdminTab('agents')}
              className="flex items-center gap-1.5 px-3 py-2 bg-teal-600 text-white rounded-lg text-xs font-medium hover:bg-teal-700 transition-colors shadow-sm"
            >
              <UserPlus size={13} /> Add Agent
            </button>
            <button
              onClick={() => setShowAddLocation(true)}
              className="flex items-center gap-1.5 px-3 py-2 bg-indigo-600 text-white rounded-lg text-xs font-medium hover:bg-indigo-700 transition-colors shadow-sm"
            >
              <MapPin size={13} /> Add Location Row
            </button>
            <button
              onClick={() => openAdminTab('companies')}
              className="flex items-center gap-1.5 px-3 py-2 bg-gray-100 text-gray-700 border border-gray-200 rounded-lg text-xs font-medium hover:bg-gray-200 transition-colors"
            >
              <Settings size={13} /> Edit Status
            </button>
          </div>
        )}

        {/* Add Location Modal */}
        {showAddLocation && isAdmin && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
            <div className="bg-white rounded-xl shadow-xl p-6 max-w-sm w-full mx-4">
              <h3 className="text-sm font-bold text-gray-800 mb-4 flex items-center gap-2">
                <MapPin size={16} /> Add Location Row
              </h3>
              <p className="text-xs text-gray-500 mb-4">
                Add a new location/service area row for a company. Each location gets its own time slot schedule.
              </p>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Company *</label>
                  <select
                    value={locCompany}
                    onChange={e => setLocCompany(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Select company...</option>
                    {store.companies.filter(c => c.account_status === 'Active').map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Location Label *</label>
                  <input
                    type="text"
                    value={locLabel}
                    onChange={e => setLocLabel(e.target.value)}
                    placeholder="e.g. Amarillo TX, Round Rock TX"
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">State</label>
                  <input
                    type="text"
                    value={locState}
                    onChange={e => setLocState(e.target.value)}
                    placeholder="e.g. TX"
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
              <div className="flex gap-2 mt-5 justify-end">
                <button
                  onClick={() => setShowAddLocation(false)}
                  className="px-4 py-2 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
                >Cancel</button>
                <button
                  onClick={handleAddLocation}
                  disabled={!locCompany || !locLabel.trim()}
                  className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >Add Location</button>
              </div>
            </div>
          </div>
        )}

        {/* Filters Row */}
        <div className="flex flex-wrap gap-3 mb-5">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search companies..."
              className="pl-9 pr-4 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 w-[200px]"
            />
          </div>

          <div className="relative">
            <Building2 size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <select
              value={selectedCompany}
              onChange={e => setSelectedCompany(e.target.value)}
              className="pl-9 pr-8 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 appearance-none min-w-[220px]"
            >
              <option value="all">All Companies</option>
              {store.companies
                .filter(c => statusFilter === 'all' || c.account_status === statusFilter)
                .map(c => (
                  <option key={c.id} value={c.id}>{c.name}{c.state ? ` - ${c.state}` : ''}</option>
                ))
              }
            </select>
            <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          </div>

          {isAdmin && (
            <div className="relative">
              <Users size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <select
                value={selectedTeam}
                onChange={e => setSelectedTeam(e.target.value)}
                className="pl-9 pr-8 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 appearance-none min-w-[160px]"
              >
                <option value="all">All Teams</option>
                {store.teams.map(t => (
                  <option key={t.id} value={t.id}>{t.abbreviation} - {t.name}</option>
                ))}
              </select>
              <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            </div>
          )}

          <div className="relative">
            <Filter size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              className="pl-9 pr-8 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 appearance-none min-w-[130px]"
            >
              <option value="all">All Status</option>
              <option value="Active">Active</option>
              <option value="Pause">Pause</option>
              <option value="Prospect">Prospect</option>
              <option value="No Longer Working">No Longer Working</option>
            </select>
            <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          </div>

          <button
            onClick={() => store.refetch()}
            className="flex items-center gap-1.5 px-3 py-2 text-gray-500 bg-white border border-gray-200 rounded-lg text-sm hover:bg-gray-50 transition-colors"
          >
            <RefreshCw size={14} /> Refresh
          </button>

          <div className="ml-auto flex items-center gap-4 text-sm text-gray-500">
            <span>{filteredRows.length} rows</span>
            <span>{store.bookings.filter(b => b.day === activeDay).length} booked</span>
          </div>
        </div>

        {/* Day Tabs */}
        <div className="flex gap-0.5 mb-5 bg-gray-100 p-1 rounded-xl overflow-x-auto">
          {DAYS.map(day => {
            const isActive = activeDay === day;
            const count = dayBookingCounts[day] || 0;
            return (
              <button
                key={day}
                onClick={() => setActiveDay(day)}
                className={`relative px-3 sm:px-4 py-2.5 rounded-lg text-sm font-medium transition-all whitespace-nowrap ${
                  isActive
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700 hover:bg-white/50'
                }`}
              >
                <span className="hidden sm:inline">{day}</span>
                <span className="sm:hidden">{day.slice(0, 3)}</span>
                {count > 0 && (
                  <span className={`ml-1 text-[10px] px-1.5 py-0.5 rounded-full ${
                    isActive ? 'bg-blue-100 text-blue-700' : 'bg-gray-200 text-gray-500'
                  }`}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Team Legend */}
        <div className="flex flex-wrap gap-2 mb-4">
          {store.teams.map(team => (
            <span
              key={team.id}
              className={`text-[10px] font-bold px-2 py-1 rounded ${getTeamPillColor(team.abbreviation)}`}
            >
              {team.abbreviation}
            </span>
          ))}
          <span className="text-[10px] px-2 py-1 rounded bg-emerald-50 border border-emerald-200 text-emerald-600 font-medium">
            Green = Open
          </span>
          <span className="text-[10px] px-2 py-1 rounded bg-red-600 border border-red-700 text-white font-medium">
            Red = Booked
          </span>
        </div>

        {/* Grid */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <ScheduleGrid
            rows={filteredRows}
            companies={store.companies}
            isBooked={store.isBooked}
            getCompanyTeams={store.getCompanyTeams}
            onToggle={store.toggleBooking}
            onStatusChange={store.updateCompanyStatus}
            canEdit={canEdit}
            isAdmin={isAdmin}
            activeDay={activeDay}
          />
        </div>

        <div className="mt-4 text-center text-xs text-gray-400">
          {isAdmin
            ? 'Admin -- full control. Click status badges to edit. Use toolbar to add companies/agents/locations.'
            : 'Agent -- book open slots for your team\'s companies. Changes sync live.'}
        </div>
      </main>
    </div>
  );
}

function getTeamPillColor(abbr: string): string {
  const colors: Record<string, string> = {
    MRS: 'bg-blue-100 text-blue-700', BRL: 'bg-purple-100 text-purple-700',
    TJ: 'bg-orange-100 text-orange-700', PHL: 'bg-teal-100 text-teal-700',
    OCTO: 'bg-rose-100 text-rose-700', WOO: 'bg-amber-100 text-amber-700',
    SSL: 'bg-cyan-100 text-cyan-700', NIC: 'bg-green-100 text-green-700',
  };
  return colors[abbr] || 'bg-gray-100 text-gray-700';
}

function getTeamPillStyle(abbr: string): string {
  const colors: Record<string, string> = {
    MRS: 'bg-blue-600 text-white', BRL: 'bg-purple-600 text-white',
    TJ: 'bg-orange-600 text-white', PHL: 'bg-teal-600 text-white',
    OCTO: 'bg-rose-600 text-white', WOO: 'bg-amber-600 text-white',
    SSL: 'bg-cyan-600 text-white', NIC: 'bg-green-600 text-white',
  };
  return colors[abbr] || 'bg-gray-600 text-white';
}

function getTeamBannerStyle(abbr: string): string {
  const colors: Record<string, string> = {
    MRS: 'bg-blue-50 border-blue-200 text-blue-800', BRL: 'bg-purple-50 border-purple-200 text-purple-800',
    TJ: 'bg-orange-50 border-orange-200 text-orange-800', PHL: 'bg-teal-50 border-teal-200 text-teal-800',
    OCTO: 'bg-rose-50 border-rose-200 text-rose-800', WOO: 'bg-amber-50 border-amber-200 text-amber-800',
    SSL: 'bg-cyan-50 border-cyan-200 text-cyan-800', NIC: 'bg-green-50 border-green-200 text-green-800',
  };
  return colors[abbr] || 'bg-gray-50 border-gray-200 text-gray-800';
}
