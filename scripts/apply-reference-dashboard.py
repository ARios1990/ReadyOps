from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
path = ROOT / 'src/Dashboard.tsx'
text = path.read_text(encoding='utf-8')

old_import = "import { ThemeToggle } from './ThemeContext';"
new_import = old_import + "\nimport { AdminReferenceDashboard } from './AdminReferenceDashboard';"
if new_import not in text:
    if old_import not in text:
        raise RuntimeError('Dashboard theme import not found')
    text = text.replace(old_import, new_import, 1)

anchor = """  async function handleAddLocation() {
    if (!locCompany || !locLabel.trim()) return;
    await store.addLocation(locCompany, locLabel.trim(), locState.trim() || null);
    setShowAddLocation(false);
    setLocCompany('');
    setLocLabel('');
    setLocState('');
  }

  return (
"""

insertion = """  async function handleAddLocation() {
    if (!locCompany || !locLabel.trim()) return;
    await store.addLocation(locCompany, locLabel.trim(), locState.trim() || null);
    setShowAddLocation(false);
    setLocCompany('');
    setLocLabel('');
    setLocState('');
  }

  if (isAdmin) {
    return (
      <AdminReferenceDashboard
        store={store}
        profile={profile}
        signOut={signOut}
        renderSlots={() => (
          <div className=\"space-y-4\">
            <div className=\"flex flex-wrap gap-3\">
              <div className=\"relative\">
                <Search size={14} className=\"absolute left-3 top-1/2 -translate-y-1/2 text-gray-400\" />
                <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder=\"Search companies...\" className=\"pl-9 pr-4 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 w-[210px]\" />
              </div>
              <div className=\"relative\">
                <Building2 size={14} className=\"absolute left-3 top-1/2 -translate-y-1/2 text-gray-400\" />
                <select value={selectedCompany} onChange={e => setSelectedCompany(e.target.value)} className=\"pl-9 pr-8 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-700 appearance-none min-w-[220px]\"><option value=\"all\">All Companies</option>{store.companies.filter(c => statusFilter === 'all' || c.account_status === statusFilter).map(c => <option key={c.id} value={c.id}>{c.name}{c.state ? ` - ${c.state}` : ''}</option>)}</select>
                <ChevronDown size={14} className=\"absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none\" />
              </div>
              <div className=\"relative\">
                <Users size={14} className=\"absolute left-3 top-1/2 -translate-y-1/2 text-gray-400\" />
                <select value={selectedTeam} onChange={e => setSelectedTeam(e.target.value)} className=\"pl-9 pr-8 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-700 appearance-none min-w-[160px]\"><option value=\"all\">All Teams</option>{store.teams.map(t => <option key={t.id} value={t.id}>{t.abbreviation} - {t.name}</option>)}</select>
                <ChevronDown size={14} className=\"absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none\" />
              </div>
              <div className=\"relative\">
                <Filter size={14} className=\"absolute left-3 top-1/2 -translate-y-1/2 text-gray-400\" />
                <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className=\"pl-9 pr-8 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-700 appearance-none min-w-[130px]\"><option value=\"all\">All Status</option><option value=\"Active\">Active</option><option value=\"Pause\">Pause</option><option value=\"Prospect\">Prospect</option><option value=\"No Longer Working\">No Longer Working</option></select>
                <ChevronDown size={14} className=\"absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none\" />
              </div>
              <button onClick={() => store.refetch()} className=\"flex items-center gap-1.5 px-3 py-2 text-gray-500 bg-white border border-gray-200 rounded-lg text-sm hover:bg-gray-50\"><RefreshCw size={14}/> Refresh</button>
              <div className=\"ml-auto flex items-center gap-4 text-sm text-gray-500\"><span>{filteredRows.length} rows</span><span>{dayBookingCounts[activeDay] || 0} occupied</span></div>
            </div>
            <div className=\"flex gap-0.5 bg-gray-100 p-1 rounded-xl overflow-x-auto\">{DAYS.map(day => { const isActive = activeDay === day; const count = dayBookingCounts[day] || 0; return <button key={day} onClick={() => setActiveDay(day)} className={`px-3 sm:px-4 py-2.5 rounded-lg text-sm font-medium whitespace-nowrap ${isActive ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:bg-white/50'}`}><span>{day}</span><span className=\"ml-1 text-[10px] text-gray-400\">{formatDateShort(localDate(addDays(scheduleWeekAnchor, DAYS.indexOf(day))))}</span>{count > 0 && <span className={`ml-1 text-[10px] px-1.5 py-0.5 rounded-full ${isActive ? 'bg-blue-100 text-blue-700' : 'bg-gray-200 text-gray-500'}`}>{count}</span>}</button>; })}</div>
            <div className=\"flex flex-wrap gap-2\">{store.teams.map(team => <span key={team.id} className={`text-[10px] font-bold px-2 py-1 rounded ${getTeamPillColor(team.abbreviation)}`}>{team.abbreviation}</span>)}<span className=\"text-[10px] px-2 py-1 rounded bg-emerald-50 border border-emerald-200 text-emerald-600 font-medium\">Green = Open</span><span className=\"text-[10px] px-2 py-1 rounded bg-red-600 border border-red-700 text-white font-medium\">Red = Weekly block or current-week appointment</span></div>
            <div className=\"bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden\"><ScheduleGrid rows={filteredRows} companies={store.companies} isBooked={store.isBooked} isPortalBooked={store.isPortalBooked} getCompanyTeams={store.getCompanyTeams} onToggle={store.toggleBooking} onStatusChange={store.updateCompanyStatus} canEdit={canEdit} isAdmin={true} activeDay={activeDay} /></div>
          </div>
        )}
      />
    );
  }

  return (
"""

if 'AdminReferenceDashboard' in text and 'renderSlots={() =>' in text:
    pass
elif anchor not in text:
    raise RuntimeError('Dashboard insertion anchor not found')
else:
    text = text.replace(anchor, insertion, 1)

path.write_text(text, encoding='utf-8')
print('Integrated reference-matched admin dashboard.')
