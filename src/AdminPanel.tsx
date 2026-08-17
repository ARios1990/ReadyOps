import React, { useState, useEffect } from 'react';
import {
  X, Plus, Link2, Unlink, Users, Building2, Search, UserPlus,
  Pencil, Trash2, EyeOff, Eye, Save, Check
} from 'lucide-react';
import { supabase } from './supabase';
import { Profile, Agent, Team, Company, CompanyLocation, CompanyTeam } from './types';

interface AdminPanelProps {
  store: {
    agents: Agent[];
    teams: Team[];
    companies: Company[];
    locations: CompanyLocation[];
    companyTeams: CompanyTeam[];
    refetch: () => Promise<void>;
    removeLocation: (locationId: string) => Promise<void>;
    setCompanyTeams: (companyId: string, teamIds: string[]) => Promise<void>;
    getCompanyTeams: (companyId: string) => Team[];
  };
  onClose: () => void;
  initialTab?: string;
}

type Tab = 'companies' | 'agents' | 'users' | 'add-company' | 'create-user';

export function AdminPanel({ store, onClose, initialTab }: AdminPanelProps) {
  const [tab, setTab] = useState<Tab>((initialTab as Tab) || 'companies');

  useEffect(() => {
    if (initialTab) setTab(initialTab as Tab);
  }, [initialTab]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [search, setSearch] = useState('');

  // Add company form
  const [newName, setNewName] = useState('');
  const [newState, setNewState] = useState('');
  const [newContact, setNewContact] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newTeam, setNewTeam] = useState('');
  const [newRequirementsNote, setNewRequirementsNote] = useState('');
  const [newNotes, setNewNotes] = useState('');
  const [addLoading, setAddLoading] = useState(false);
  const [addMsg, setAddMsg] = useState('');

  // Create user form
  const [cuEmail, setCuEmail] = useState('');
  const [cuPassword, setCuPassword] = useState('');
  const [cuName, setCuName] = useState('');
  const [cuRole, setCuRole] = useState<'admin' | 'agent'>('agent');
  const [cuAgent, setCuAgent] = useState('');
  const [cuLoading, setCuLoading] = useState(false);
  const [cuMsg, setCuMsg] = useState('');

  // Editing
  const [editingCompany, setEditingCompany] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<Company>>({});
  const [assigningCompany, setAssigningCompany] = useState<string | null>(null);
  const [assignTeamIds, setAssignTeamIds] = useState<string[]>([]);
  // User linking
  const [linkingProfile, setLinkingProfile] = useState<string | null>(null);
  const [selectedAgent, setSelectedAgent] = useState('');

  // Confirm dialogs
  const [confirmDelete, setConfirmDelete] = useState<{ type: 'company' | 'agent'; id: string; name: string } | null>(null);

  useEffect(() => {
    fetchProfiles();
  }, []);

  async function fetchProfiles() {
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false });
    if (data) setProfiles(data);
  }

  // === Company Actions ===
  async function handleAddCompany(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setAddLoading(true);
    setAddMsg('');
    const { error } = await supabase.from('roster_companies').insert({
      name: newName.trim(),
      state: newState.trim() || null,
      contact_name: newContact.trim() || null,
      phone: newPhone.trim() || null,
      email: newEmail.trim() || null,
      team_id: newTeam || null,
      requirements_note: newRequirementsNote.trim() || null,
      notes: newNotes.trim() || null,
      account_status: 'Active',
    });
    if (error) {
      setAddMsg(error.message.includes('unique') ? 'Company already exists.' : error.message);
    } else {
      setAddMsg('Company added!');
      setNewName(''); setNewState(''); setNewContact(''); setNewPhone(''); setNewEmail(''); setNewTeam(''); setNewRequirementsNote(''); setNewNotes('');
      await store.refetch();
    }
    setAddLoading(false);
  }

  async function hideCompany(companyId: string, hidden: boolean) {
    await supabase
      .from('roster_companies')
      .update({ account_status: hidden ? 'Hidden' : 'Active' })
      .eq('id', companyId);
    await store.refetch();
  }

  async function deleteCompany(companyId: string) {
    await supabase.from('roster_companies').delete().eq('id', companyId);
    setConfirmDelete(null);
    await store.refetch();
  }

  async function saveCompanyEdit(companyId: string) {
    await supabase.from('roster_companies').update({
      name: editForm.name,
      state: editForm.state || null,
      contact_name: editForm.contact_name || null,
      phone: editForm.phone || null,
      email: editForm.email || null,
      requirements_note: editForm.requirements_note || null,
      notes: editForm.notes || null,
    }).eq('id', companyId);
    setEditingCompany(null);
    setEditForm({});
    await store.refetch();
  }

  // === Agent Actions ===
  async function deleteAgent(agentId: string) {
    await supabase.from('profiles').update({ agent_id: null }).eq('agent_id', agentId);
    await supabase.from('agents').delete().eq('id', agentId);
    setConfirmDelete(null);
    await store.refetch();
  }

  // === User Actions ===
  async function linkAgentToProfile(profileId: string, agentId: string) {
    await supabase.from('profiles').update({ agent_id: agentId }).eq('id', profileId);
    await fetchProfiles();
    setLinkingProfile(null);
    setSelectedAgent('');
  }

  async function unlinkAgent(profileId: string) {
    await supabase.from('profiles').update({ agent_id: null }).eq('id', profileId);
    await fetchProfiles();
  }

  async function handleCreateUser(e: React.FormEvent) {
    e.preventDefault();
    if (!cuEmail || !cuPassword || !cuName) return;
    setCuLoading(true);
    setCuMsg('');

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      setCuMsg('Not authenticated');
      setCuLoading(false);
      return;
    }

    const res = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-user`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
          Apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({
          email: cuEmail,
          password: cuPassword,
          display_name: cuName,
          role: cuRole,
          agent_id: cuAgent || null,
        }),
      }
    );

    const data = await res.json();
    if (!res.ok) {
      setCuMsg(data.error || 'Failed to create user');
    } else {
      setCuMsg('User created successfully!');
      setCuEmail(''); setCuPassword(''); setCuName(''); setCuRole('agent'); setCuAgent('');
      await fetchProfiles();
    }
    setCuLoading(false);
  }

  const filteredCompanies = store.companies.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    (c.state && c.state.toLowerCase().includes(search.toLowerCase()))
  );

  const filteredProfiles = profiles.filter(p =>
    p.display_name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="border-b border-gray-200 bg-gray-50">
      <div className="max-w-[1800px] mx-auto px-4 sm:px-6 py-4">
        {/* Header + Tabs */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-4">
            <h2 className="text-base font-bold text-gray-800">Admin Panel</h2>
            <div className="flex gap-0.5 bg-gray-200 p-0.5 rounded-lg overflow-x-auto">
              {([
                { key: 'companies', icon: Building2, label: 'Companies' },
                { key: 'agents', icon: Users, label: 'Agents' },
                { key: 'users', icon: UserPlus, label: 'Agent Names' },
                { key: 'add-company', icon: Plus, label: 'Add Company' },
                { key: 'create-user', icon: UserPlus, label: 'Create User' },
              ] as { key: Tab; icon: typeof Building2; label: string }[]).map(t => (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all whitespace-nowrap ${
                    tab === t.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  <t.icon size={12} className="inline mr-1" /> {t.label}
                </button>
              ))}
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-200 rounded-lg transition-colors">
            <X size={18} className="text-gray-500" />
          </button>
        </div>

        {/* Search (for companies, agents, users tabs) */}
        {(tab === 'companies' || tab === 'agents' || tab === 'users') && (
          <div className="mb-3">
            <div className="relative max-w-sm">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder={`Search ${tab}...`}
                className="w-full pl-9 pr-4 py-2 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
        )}

        {/* Delete Confirmation Modal */}
        {confirmDelete && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
            <div className="bg-white rounded-xl shadow-xl p-6 max-w-sm w-full mx-4">
              <h3 className="text-base font-bold text-gray-900 mb-2">Confirm Delete</h3>
              <p className="text-sm text-gray-600 mb-4">
                Are you sure you want to permanently delete <strong>{confirmDelete.name}</strong>?
                This cannot be undone.
              </p>
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => setConfirmDelete(null)}
                  className="px-4 py-2 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
                >Cancel</button>
                <button
                  onClick={() => {
                    if (confirmDelete.type === 'company') deleteCompany(confirmDelete.id);
                    else deleteAgent(confirmDelete.id);
                  }}
                  className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700"
                >Delete</button>
              </div>
            </div>
          </div>
        )}

        {/* === COMPANIES TAB === */}
        {tab === 'companies' && (
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden max-h-[360px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 sticky top-0 z-10">
                <tr>
                  <th className="text-left py-2 px-4 font-medium text-gray-500 text-xs uppercase">Company</th>
                  <th className="text-left py-2 px-3 font-medium text-gray-500 text-xs uppercase w-16">State</th>
                  <th className="text-left py-2 px-3 font-medium text-gray-500 text-xs uppercase w-20">Status</th>
                  <th className="text-left py-2 px-3 font-medium text-gray-500 text-xs uppercase w-20">Team</th>
                  <th className="text-right py-2 px-4 font-medium text-gray-500 text-xs uppercase w-56">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredCompanies.slice(0, 60).map(c => {
                  const isEditing = editingCompany === c.id;
                  const isHidden = c.account_status === 'Hidden';
                  const companyLocs = store.locations.filter(l => l.company_id === c.id);
                  const assignedTeams = store.getCompanyTeams(c.id);
                  const displayNote = c.requirements_note?.trim() || c.notes?.trim();

                  if (isEditing) {
                    return (
                      <tr key={c.id} className="bg-blue-50/50">
                        <td className="py-2 px-4" colSpan={3}>
                          <div className="flex flex-wrap gap-2">
                            <input value={editForm.name || ''} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} className="px-2 py-1 text-xs border rounded w-[160px]" placeholder="Name" />
                            <input value={editForm.state || ''} onChange={e => setEditForm(f => ({ ...f, state: e.target.value }))} className="px-2 py-1 text-xs border rounded w-[50px]" placeholder="State" />
                            <input value={editForm.contact_name || ''} onChange={e => setEditForm(f => ({ ...f, contact_name: e.target.value }))} className="px-2 py-1 text-xs border rounded w-[120px]" placeholder="Contact" />
                            <input value={editForm.phone || ''} onChange={e => setEditForm(f => ({ ...f, phone: e.target.value }))} className="px-2 py-1 text-xs border rounded w-[110px]" placeholder="Phone" />
                            <input value={editForm.email || ''} onChange={e => setEditForm(f => ({ ...f, email: e.target.value }))} className="px-2 py-1 text-xs border rounded w-[160px]" placeholder="Email" />
                            <textarea value={editForm.requirements_note || ''} onChange={e => setEditForm(f => ({ ...f, requirements_note: e.target.value }))} className="px-2 py-1 text-xs border rounded w-[260px] min-h-[44px]" placeholder="Requirements note shown on time slots" />
                            <textarea value={editForm.notes || ''} onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))} className="px-2 py-1 text-xs border rounded w-[220px] min-h-[44px]" placeholder="Internal notes" />
                          </div>
                        </td>
                        <td className="py-2 px-3">
                          <div className="flex flex-wrap gap-0.5">
                            {assignedTeams.map(t => (
                              <span key={t.id} className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${getTeamColor(t.abbreviation)}`}>{t.abbreviation}</span>
                            ))}
                          </div>
                        </td>
                        <td className="py-2 px-4 text-right">
                          <div className="flex gap-1 justify-end">
                            <button onClick={() => saveCompanyEdit(c.id)} className="text-xs px-2 py-1 bg-blue-600 text-white rounded flex items-center gap-1"><Save size={11} /> Save</button>
                            <button onClick={() => { setEditingCompany(null); setEditForm({}); }} className="text-xs px-2 py-1 bg-gray-100 text-gray-600 rounded">Cancel</button>
                          </div>
                        </td>
                      </tr>
                    );
                  }

                  return (
                    <React.Fragment key={c.id}>
                      <tr className={`hover:bg-gray-50 ${isHidden ? 'opacity-50' : ''}`}>
                        <td className="py-2 px-4 font-medium text-gray-800">
                          {c.name}
                          {c.contact_name && <span className="text-xs text-gray-400 ml-2">({c.contact_name})</span>}
                          {companyLocs.length > 0 && <span className="text-[9px] ml-2 bg-blue-100 text-blue-600 px-1 py-0.5 rounded">{companyLocs.length} loc</span>}
                          {displayNote && (
                            <span title={displayNote} className="mt-1 block max-w-[280px] truncate text-[10px] font-medium text-amber-700">
                              Note: {displayNote}
                            </span>
                          )}
                        </td>
                        <td className="py-2 px-3 text-gray-500 text-xs">{c.state || '-'}</td>
                        <td className="py-2 px-3">
                          <span className={`text-[10px] px-2 py-0.5 rounded font-medium ${
                            c.account_status === 'Active' ? 'bg-green-100 text-green-700' :
                            c.account_status === 'Hidden' ? 'bg-gray-200 text-gray-500' :
                            c.account_status === 'Pause' ? 'bg-yellow-100 text-yellow-700' :
                            c.account_status === 'No Longer Working' ? 'bg-red-100 text-red-600' :
                            'bg-gray-100 text-gray-600'
                          }`}>{c.account_status}</span>
                        </td>
                        <td className="py-2 px-3">
                          {assigningCompany === c.id ? (
                            <div className="flex flex-wrap gap-1 items-center">
                              {store.teams.map(t => {
                                const isChecked = assignTeamIds.includes(t.id);
                                return (
                                  <label key={t.id} className={`text-[9px] font-bold px-1.5 py-0.5 rounded cursor-pointer border transition-all ${
                                    isChecked ? `${getTeamColor(t.abbreviation)} border-transparent ring-1 ring-blue-400` : 'bg-gray-50 text-gray-400 border-gray-200 hover:bg-gray-100'
                                  }`}>
                                    <input
                                      type="checkbox"
                                      checked={isChecked}
                                      onChange={() => {
                                        setAssignTeamIds(prev =>
                                          prev.includes(t.id) ? prev.filter(id => id !== t.id) : [...prev, t.id]
                                        );
                                      }}
                                      className="hidden"
                                    />
                                    {t.abbreviation}
                                  </label>
                                );
                              })}
                              <button onClick={() => { store.setCompanyTeams(c.id, assignTeamIds); setAssigningCompany(null); }} className="text-[10px] px-1.5 py-0.5 bg-blue-600 text-white rounded ml-1">Save</button>
                              <button onClick={() => setAssigningCompany(null)} className="text-[10px] px-1.5 py-0.5 bg-gray-200 rounded">X</button>
                            </div>
                          ) : (
                            <button
                              onClick={() => { setAssigningCompany(c.id); setAssignTeamIds(assignedTeams.map(t => t.id)); }}
                              className="flex flex-wrap gap-0.5 cursor-pointer hover:ring-1 ring-blue-300 rounded px-1 py-0.5"
                            >
                              {assignedTeams.length > 0 ? assignedTeams.map(t => (
                                <span key={t.id} className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${getTeamColor(t.abbreviation)}`}>{t.abbreviation}</span>
                              )) : (
                                <span className="text-[9px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">None</span>
                              )}
                            </button>
                          )}
                        </td>
                        <td className="py-2 px-4 text-right">
                          <div className="flex gap-1 justify-end">
                            <button onClick={() => { setEditingCompany(c.id); setEditForm({ name: c.name, state: c.state, contact_name: c.contact_name, phone: c.phone, email: c.email, requirements_note: c.requirements_note, notes: c.notes }); }} className="p-1 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded" title="Edit"><Pencil size={13} /></button>
                            <button onClick={() => hideCompany(c.id, !isHidden)} className="p-1 text-gray-400 hover:text-amber-600 hover:bg-amber-50 rounded" title={isHidden ? 'Show' : 'Hide'}>{isHidden ? <Eye size={13} /> : <EyeOff size={13} />}</button>
                            <button onClick={() => setConfirmDelete({ type: 'company', id: c.id, name: c.name })} className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded" title="Delete"><Trash2 size={13} /></button>
                          </div>
                        </td>
                      </tr>
                      {companyLocs.map(loc => (
                        <tr key={loc.id} className="bg-blue-50/30">
                          <td className="py-1 px-4 pl-8 text-xs text-blue-700 border-b border-gray-50" colSpan={3}>
                            &#8627; {loc.location_label}{loc.state ? ` (${loc.state})` : ''}
                          </td>
                          <td className="py-1 px-3 border-b border-gray-50"></td>
                          <td className="py-1 px-4 text-right border-b border-gray-50">
                            <button onClick={() => store.removeLocation(loc.id)} className="text-[10px] px-1.5 py-0.5 text-red-500 hover:bg-red-50 rounded"><Trash2 size={10} className="inline" /> Remove</button>
                          </td>
                        </tr>
                      ))}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
            {filteredCompanies.length > 60 && (
              <div className="text-center py-2 text-xs text-gray-400">
                Showing 60 of {filteredCompanies.length} - use search to narrow down
              </div>
            )}
          </div>
        )}

        {/* === AGENTS TAB === */}
        {tab === 'agents' && (
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden max-h-[360px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 sticky top-0 z-10">
                <tr>
                  <th className="text-left py-2 px-4 font-medium text-gray-500 text-xs uppercase">Agent Name</th>
                  <th className="text-left py-2 px-3 font-medium text-gray-500 text-xs uppercase">Team</th>
                  <th className="text-left py-2 px-3 font-medium text-gray-500 text-xs uppercase">Linked User</th>
                  <th className="text-right py-2 px-4 font-medium text-gray-500 text-xs uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {store.agents
                  .filter(a => a.name.toLowerCase().includes(search.toLowerCase()))
                  .map(agent => {
                    const team = store.teams.find(t => t.id === agent.team_id);
                    const linkedProfile = profiles.find(p => p.agent_id === agent.id);
                    return (
                      <tr key={agent.id} className="hover:bg-gray-50">
                        <td className="py-2 px-4 font-medium text-gray-800">{agent.name}</td>
                        <td className="py-2 px-3">
                          {team && (
                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${getTeamColor(team.abbreviation)}`}>
                              {team.abbreviation}
                            </span>
                          )}
                        </td>
                        <td className="py-2 px-3 text-xs text-gray-500">
                          {linkedProfile ? linkedProfile.display_name : <span className="text-gray-300 italic">Unlinked</span>}
                        </td>
                        <td className="py-2 px-4 text-right">
                          <button
                            onClick={() => setConfirmDelete({ type: 'agent', id: agent.id, name: agent.name })}
                            className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
                            title="Delete agent"
                          ><Trash2 size={13} /></button>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        )}

        {/* === USERS / AGENT NAMES TAB === */}
        {tab === 'users' && (
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden max-h-[360px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 sticky top-0 z-10">
                <tr>
                  <th className="text-left py-2 px-4 font-medium text-gray-500 text-xs uppercase">User</th>
                  <th className="text-left py-2 px-3 font-medium text-gray-500 text-xs uppercase">Role</th>
                  <th className="text-left py-2 px-3 font-medium text-gray-500 text-xs uppercase">Linked Agent</th>
                  <th className="text-left py-2 px-3 font-medium text-gray-500 text-xs uppercase">Team</th>
                  <th className="text-right py-2 px-4 font-medium text-gray-500 text-xs uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredProfiles.map(p => {
                  const agent = p.agent_id ? store.agents.find(a => a.id === p.agent_id) : null;
                  const team = agent ? store.teams.find(t => t.id === agent.team_id) : null;
                  return (
                    <tr key={p.id} className="hover:bg-gray-50">
                      <td className="py-2 px-4 font-medium text-gray-800">{p.display_name}</td>
                      <td className="py-2 px-3">
                        <span className={`text-xs font-medium px-2 py-0.5 rounded ${
                          p.role === 'admin' ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'
                        }`}>{p.role}</span>
                      </td>
                      <td className="py-2 px-3 text-xs">
                        {agent ? agent.name : <span className="text-gray-400 italic">Not linked</span>}
                      </td>
                      <td className="py-2 px-3">
                        {team && (
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${getTeamColor(team.abbreviation)}`}>
                            {team.abbreviation}
                          </span>
                        )}
                      </td>
                      <td className="py-2 px-4 text-right">
                        {linkingProfile === p.id ? (
                          <div className="flex items-center gap-1 justify-end">
                            <select
                              value={selectedAgent}
                              onChange={e => setSelectedAgent(e.target.value)}
                              className="text-xs px-2 py-1 border rounded bg-white max-w-[150px]"
                            >
                              <option value="">Select agent...</option>
                              {store.agents.map(a => {
                                const t = store.teams.find(tm => tm.id === a.team_id);
                                return <option key={a.id} value={a.id}>{a.name} ({t?.abbreviation})</option>;
                              })}
                            </select>
                            <button
                              onClick={() => selectedAgent && linkAgentToProfile(p.id, selectedAgent)}
                              disabled={!selectedAgent}
                              className="text-xs px-2 py-1 bg-blue-600 text-white rounded disabled:opacity-40"
                            ><Check size={11} /></button>
                            <button
                              onClick={() => setLinkingProfile(null)}
                              className="text-xs px-2 py-1 bg-gray-100 rounded"
                            >X</button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1 justify-end">
                            <button
                              onClick={() => setLinkingProfile(p.id)}
                              className="text-xs px-2 py-1 text-blue-600 hover:bg-blue-50 rounded flex items-center gap-1"
                            >
                              <Link2 size={11} /> {agent ? 'Change' : 'Link'}
                            </button>
                            {agent && (
                              <button
                                onClick={() => unlinkAgent(p.id)}
                                className="text-xs px-2 py-1 text-red-600 hover:bg-red-50 rounded flex items-center gap-1"
                              >
                                <Unlink size={11} />
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* === ADD COMPANY TAB === */}
        {tab === 'add-company' && (
          <div className="bg-white rounded-lg border border-gray-200 p-6 max-w-lg">
            <h3 className="text-sm font-bold text-gray-800 mb-4 flex items-center gap-2">
              <Building2 size={16} /> Register New Company
            </h3>
            <form onSubmit={handleAddCompany} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Company Name *</label>
                  <input type="text" value={newName} onChange={e => setNewName(e.target.value)} required placeholder="e.g. UNC Roofing"
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">State</label>
                  <input type="text" value={newState} onChange={e => setNewState(e.target.value)} placeholder="e.g. TX, FL, GA"
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Contact Name</label>
                  <input type="text" value={newContact} onChange={e => setNewContact(e.target.value)} placeholder="Primary contact"
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Phone</label>
                  <input type="text" value={newPhone} onChange={e => setNewPhone(e.target.value)} placeholder="(xxx) xxx-xxxx"
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Email</label>
                  <input type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)} placeholder="email@example.com"
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Assign Team</label>
                  <select value={newTeam} onChange={e => setNewTeam(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    <option value="">No team</option>
                    {store.teams.map(t => <option key={t.id} value={t.id}>{t.abbreviation} - {t.name}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Requirements Note</label>
                <textarea
                  value={newRequirementsNote}
                  onChange={e => setNewRequirementsNote(e.target.value)}
                  placeholder="Small note shown under this company on the time-slot board"
                  className="w-full min-h-[64px] px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Internal Notes</label>
                <textarea
                  value={newNotes}
                  onChange={e => setNewNotes(e.target.value)}
                  placeholder="Optional admin note"
                  className="w-full min-h-[56px] px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              {addMsg && <p className={`text-xs ${addMsg.includes('added') ? 'text-green-600' : 'text-red-600'}`}>{addMsg}</p>}
              <button type="submit" disabled={addLoading || !newName.trim()}
                className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2">
                <Plus size={14} /> {addLoading ? 'Adding...' : 'Add Company'}
              </button>
            </form>
          </div>
        )}

        {/* === CREATE USER TAB === */}
        {tab === 'create-user' && (
          <div className="bg-white rounded-lg border border-gray-200 p-6 max-w-lg">
            <h3 className="text-sm font-bold text-gray-800 mb-4 flex items-center gap-2">
              <UserPlus size={16} /> Create New User Account
            </h3>
            <form onSubmit={handleCreateUser} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Display Name *</label>
                <input type="text" value={cuName} onChange={e => setCuName(e.target.value)} required placeholder="Full name"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Email *</label>
                  <input type="email" value={cuEmail} onChange={e => setCuEmail(e.target.value)} required placeholder="user@email.com"
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Password *</label>
                  <input type="text" value={cuPassword} onChange={e => setCuPassword(e.target.value)} required placeholder="Min 6 chars"
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Role</label>
                  <select value={cuRole} onChange={e => setCuRole(e.target.value as 'admin' | 'agent')}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    <option value="agent">Agent</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Link to Agent</label>
                  <select value={cuAgent} onChange={e => setCuAgent(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    <option value="">None (link later)</option>
                    {store.agents.map(a => {
                      const t = store.teams.find(tm => tm.id === a.team_id);
                      return <option key={a.id} value={a.id}>{a.name} ({t?.abbreviation})</option>;
                    })}
                  </select>
                </div>
              </div>
              {cuMsg && <p className={`text-xs ${cuMsg.includes('success') ? 'text-green-600' : 'text-red-600'}`}>{cuMsg}</p>}
              <button type="submit" disabled={cuLoading || !cuEmail || !cuPassword || !cuName}
                className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50 flex items-center gap-2">
                <UserPlus size={14} /> {cuLoading ? 'Creating...' : 'Create User'}
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}

function getTeamColor(abbr: string): string {
  const colors: Record<string, string> = {
    MRS: 'bg-blue-100 text-blue-700',
    BRL: 'bg-purple-100 text-purple-700',
    TJ: 'bg-orange-100 text-orange-700',
    PHL: 'bg-teal-100 text-teal-700',
    OCTO: 'bg-rose-100 text-rose-700',
    WOO: 'bg-amber-100 text-amber-700',
    SSL: 'bg-cyan-100 text-cyan-700',
    NIC: 'bg-green-100 text-green-700',
  };
  return colors[abbr] || 'bg-gray-100 text-gray-700';
}
