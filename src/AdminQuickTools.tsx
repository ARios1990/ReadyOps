import { useEffect, useMemo, useState } from 'react';
import { ClipboardCopy, ExternalLink, Loader2, Trash2, UserCog, Users, X } from 'lucide-react';
import { supabase } from './supabase';
import type { Agent, Profile, Team } from './types';
import { copyText, rpcError } from './portalUtils';

type Tab = 'agents' | 'managers';
type ManagerLink = {
  id: string;
  name: string;
  team_id: string;
  portal_slug: string;
  access_token: string;
  active: boolean;
};

export function AdminQuickTools() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('agents');
  const [agents, setAgents] = useState<Agent[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [managerLinks, setManagerLinks] = useState<ManagerLink[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const [managerName, setManagerName] = useState('');
  const [managerEmail, setManagerEmail] = useState('');
  const [managerPassword, setManagerPassword] = useState('');
  const [managerTeam, setManagerTeam] = useState('');
  const [creatingManager, setCreatingManager] = useState(false);
  const [creatingLink, setCreatingLink] = useState(false);

  async function loadStaff() {
    setLoading(true);
    setMessage('');
    const [agentsRes, teamsRes, profilesRes, managerLinksRes] = await Promise.all([
      supabase.from('agents').select('*').order('name'),
      supabase.from('teams').select('*').order('name'),
      supabase.from('profiles').select('*').order('display_name'),
      supabase.from('manager_portal_links').select('*').order('name'),
    ]);
    if (agentsRes.error || teamsRes.error || profilesRes.error || managerLinksRes.error) {
      setMessage(rpcError(agentsRes.error || teamsRes.error || profilesRes.error || managerLinksRes.error));
    }
    setAgents((agentsRes.data || []) as Agent[]);
    setTeams((teamsRes.data || []) as Team[]);
    setProfiles((profilesRes.data || []) as Profile[]);
    setManagerLinks((managerLinksRes.data || []) as ManagerLink[]);
    setLoading(false);
  }

  useEffect(() => { if (open) void loadStaff(); }, [open]);

  const managers = useMemo(() => profiles.filter(profile => profile.role === 'manager'), [profiles]);

  async function clearAllManualBlocks() {
    const ok = window.confirm('Clear ALL manually blocked time slots for every company?\n\nThis will NOT delete real appointments or QC leads.');
    if (!ok) return;
    setMessage('');
    const { data, error } = await supabase.rpc('admin_clear_manual_slot_blocks');
    if (error) {
      setMessage(rpcError(error));
      return;
    }
    setMessage(`Cleared ${Number(data || 0)} manual time-slot block${Number(data || 0) === 1 ? '' : 's'}. Refreshing schedule...`);
    window.setTimeout(() => window.location.reload(), 700);
  }

  async function createPrivateManagerLink() {
    if (!managerName.trim() || !managerTeam) {
      setMessage('Manager name and team are required for a private manager link.');
      return;
    }
    setCreatingLink(true);
    setMessage('');
    const team = teams.find(item => item.id === managerTeam);
    const slugBase = managerName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'manager';
    const suffix = Math.random().toString(36).slice(2, 6);
    const portalSlug = `${slugBase}-${team?.abbreviation.toLowerCase() || 'team'}-manager-${suffix}`;
    const { error } = await supabase.from('manager_portal_links').insert({
      name: managerName.trim(),
      team_id: managerTeam,
      portal_slug: portalSlug,
    });
    if (error) setMessage(rpcError(error));
    else {
      setMessage('Private manager link created.');
      await loadStaff();
    }
    setCreatingLink(false);
  }

  async function createManager() {
    if (!managerName.trim() || !managerEmail.trim() || !managerPassword || !managerTeam) {
      setMessage('Manager name, email, password and team are required for a login account.');
      return;
    }
    setCreatingManager(true);
    setMessage('');
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      setMessage('Your admin session expired. Sign in again.');
      setCreatingManager(false);
      return;
    }

    const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-user`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
        Apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({
        email: managerEmail.trim().toLowerCase(),
        password: managerPassword,
        display_name: managerName.trim(),
        role: 'manager',
        team_id: managerTeam,
        agent_id: null,
      }),
    });

    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      setMessage(result.error || 'Unable to create manager.');
    } else {
      setManagerEmail('');
      setManagerPassword('');
      setMessage('Manager login created successfully.');
      await loadStaff();
    }
    setCreatingManager(false);
  }

  return (
    <>
      <div className="fixed bottom-5 right-5 z-40 flex flex-col items-end gap-2">
        {message && !open && <div className="max-w-sm rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs font-medium text-slate-700 shadow-lg">{message}</div>}
        <button onClick={() => void clearAllManualBlocks()} className="inline-flex items-center gap-2 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-bold text-white shadow-lg hover:bg-red-700" title="Clears manual red blocks only; does not delete appointments"><Trash2 size={15} /> Clear All Manual Blocks</button>
        <button onClick={() => setOpen(true)} className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-bold text-white shadow-lg hover:bg-slate-800"><UserCog size={15} /> Agents & Managers</button>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div className="max-h-[88vh] w-full max-w-5xl overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div><h2 className="font-bold text-slate-900">Agents & Managers</h2><p className="text-xs text-slate-500">Team assignments, private lead links and manager access.</p></div>
              <button onClick={() => setOpen(false)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><X size={18} /></button>
            </div>

            <div className="flex gap-1 border-b border-slate-100 bg-slate-50 px-5 py-2">
              <button onClick={() => setTab('agents')} className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold ${tab === 'agents' ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-white'}`}><Users size={14} /> Agents</button>
              <button onClick={() => setTab('managers')} className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold ${tab === 'managers' ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-white'}`}><UserCog size={14} /> Managers</button>
            </div>

            {message && <div className="mx-5 mt-4 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-xs font-medium text-blue-800">{message}</div>}

            <div className="max-h-[68vh] overflow-auto p-5">
              {loading ? <div className="py-16 text-center"><Loader2 className="mx-auto animate-spin text-blue-600" /></div> : tab === 'agents' ? (
                <div className="overflow-x-auto rounded-xl border border-slate-200">
                  <table className="w-full min-w-[800px] text-sm">
                    <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3 text-left">Agent</th><th className="px-3 py-3 text-left">Email</th><th className="px-3 py-3 text-left">Team</th><th className="px-4 py-3 text-right">Agent Leads</th></tr></thead>
                    <tbody className="divide-y divide-slate-100">
                      {agents.map(agent => {
                        const team = teams.find(item => item.id === agent.team_id);
                        const leadUrl = agent.portal_slug && agent.access_token ? `${window.location.origin}/agent/${agent.portal_slug}/${agent.access_token}` : '';
                        return <tr key={agent.id} className="hover:bg-slate-50"><td className="px-4 py-3 font-bold text-slate-900">{agent.name}</td><td className="px-3 py-3 text-slate-500">{agent.email || '—'}</td><td className="px-3 py-3">{team ? <span className="rounded-full bg-blue-50 px-2 py-1 text-[10px] font-bold text-blue-700">{team.abbreviation} — {team.name}</span> : <span className="text-xs text-slate-400">No team</span>}</td><td className="px-4 py-3 text-right">{leadUrl ? <div className="flex justify-end gap-1"><button title="Copy agent lead link" onClick={() => void copyText(leadUrl)} className="rounded-lg border border-slate-200 p-2 text-slate-600"><ClipboardCopy size={13} /></button><a href={leadUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold text-white">Check Leads <ExternalLink size={13} /></a></div> : <span className="text-xs text-slate-400">No portal link</span>}</td></tr>;
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="space-y-5">
                  <section className="overflow-x-auto rounded-xl border border-slate-200">
                    <div className="border-b border-slate-100 p-4"><h3 className="font-bold text-slate-900">Private Manager Links</h3><p className="mt-1 text-xs text-slate-500">No login is required. Keep these links private; each manager sees only their assigned team's agents and company links.</p></div>
                    <table className="w-full min-w-[720px] text-sm"><thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3 text-left">Manager</th><th className="px-3 py-3 text-left">Team</th><th className="px-4 py-3 text-right">Private Dashboard</th></tr></thead><tbody className="divide-y divide-slate-100">{managerLinks.map(manager => { const team = teams.find(item => item.id === manager.team_id); const url = `${window.location.origin}/manager/${manager.portal_slug}/${manager.access_token}`; return <tr key={manager.id}><td className="px-4 py-3 font-bold">{manager.name}</td><td className="px-3 py-3">{team ? <span className="rounded-full bg-violet-50 px-2 py-1 text-[10px] font-bold text-violet-700">{team.abbreviation} — {team.name}</span> : <span className="text-xs text-red-500">Team unavailable</span>}</td><td className="px-4 py-3 text-right"><div className="flex justify-end gap-1"><button onClick={() => void copyText(url)} title="Copy manager link" className="rounded-lg border border-slate-200 p-2 text-slate-600"><ClipboardCopy size={13} /></button><a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold text-white">Open Manager <ExternalLink size={13} /></a></div></td></tr>; })}</tbody></table>
                  </section>

                  <section className="rounded-xl border border-slate-200 p-4">
                    <h3 className="font-bold text-slate-900">Create Manager</h3>
                    <p className="mt-1 text-xs text-slate-500">A private link needs only a name and team. Email/password are only needed if you also want a normal login account.</p>
                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                      <input value={managerName} onChange={e => setManagerName(e.target.value)} placeholder="Manager full name" className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm" />
                      <select value={managerTeam} onChange={e => setManagerTeam(e.target.value)} className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm"><option value="">Select team...</option>{teams.map(team => <option key={team.id} value={team.id}>{team.abbreviation} — {team.name}</option>)}</select>
                      <input value={managerEmail} onChange={e => setManagerEmail(e.target.value)} placeholder="Optional login email" type="email" className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm" />
                      <input value={managerPassword} onChange={e => setManagerPassword(e.target.value)} placeholder="Optional temporary password" type="text" className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm" />
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button disabled={creatingLink} onClick={() => void createPrivateManagerLink()} className="rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50">{creatingLink ? 'Creating...' : 'Create Private Link'}</button>
                      <button disabled={creatingManager} onClick={() => void createManager()} className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50">{creatingManager ? 'Creating...' : 'Create Login Account'}</button>
                    </div>
                  </section>

                  {managers.length > 0 && <section className="overflow-x-auto rounded-xl border border-slate-200">
                    <div className="border-b border-slate-100 p-4"><h3 className="font-bold text-slate-900">Manager Login Accounts</h3></div>
                    <table className="w-full min-w-[700px] text-sm"><thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3 text-left">Manager</th><th className="px-3 py-3 text-left">Email</th><th className="px-3 py-3 text-left">Team</th><th className="px-4 py-3 text-right">Access</th></tr></thead><tbody className="divide-y divide-slate-100">{managers.map(manager => { const team = teams.find(item => item.id === manager.team_id); return <tr key={manager.id}><td className="px-4 py-3 font-bold">{manager.display_name}</td><td className="px-3 py-3 text-slate-500">{manager.email || '—'}</td><td className="px-3 py-3">{team ? <span className="rounded-full bg-violet-50 px-2 py-1 text-[10px] font-bold text-violet-700">{team.abbreviation} — {team.name}</span> : <span className="text-xs text-red-500">Team not assigned</span>}</td><td className="px-4 py-3 text-right"><span className="text-xs text-slate-400">Logs in normally → /manager</span></td></tr>; })}</tbody></table>
                  </section>}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
