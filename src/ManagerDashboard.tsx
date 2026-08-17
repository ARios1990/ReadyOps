import { useEffect, useMemo, useState } from 'react';
import { ClipboardCopy, ExternalLink, Loader2, RefreshCw, Users } from 'lucide-react';
import { supabase } from './supabase';
import { buildReadyModeBookingLink, copyText, rpcError } from './portalUtils';
import { READYOPS_LOGO_DATA_URI } from './brand';

type TeamInfo = { id: string; name: string; abbreviation: string };
type AgentSummary = {
  id: string;
  name: string;
  email: string | null;
  active: boolean;
  portal_slug: string | null;
  access_token: string | null;
  team_id: string | null;
  total_leads: number;
  qc_pending: number;
  approved: number;
  denied: number;
};
type CompanySummary = {
  id: string;
  name: string;
  state: string | null;
  public_slug: string | null;
  account_status: string;
};
type ManagerIdentity = { id: string; name: string; portal_slug: string };
type ManagerData = {
  manager?: ManagerIdentity;
  team: TeamInfo;
  agents: AgentSummary[];
  companies: CompanySummary[];
  range: { start_date: string; end_date: string };
};
type ManagerDashboardProps = {
  slug?: string;
  token?: string;
  profile?: { team_id?: string | null } | null;
};

export function ManagerDashboard({ slug, token, profile }: ManagerDashboardProps) {
  const privateLinkMode = Boolean(token);
  const [data, setData] = useState<ManagerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  async function load() {
    setLoading(true);
    setError('');

    if (token) {
      const { data: result, error: rpcErr } = await supabase.rpc('get_manager_link_overview', {
        p_access_token: token,
        p_start_date: null,
        p_end_date: null,
      });
      if (rpcErr) {
        setError(rpcError(rpcErr));
        setData(null);
      } else {
        const parsed = result as ManagerData;
        if (slug && parsed.manager?.portal_slug !== slug) {
          setError('Manager link name does not match this access token.');
          setData(null);
        } else {
          setData(parsed);
        }
      }
      setLoading(false);
      return;
    }

    const { data: result, error: rpcErr } = await supabase.rpc('get_manager_team_overview', {
      p_team_id: profile?.team_id || null,
      p_start_date: null,
      p_end_date: null,
    });
    if (rpcErr) {
      setError(rpcError(rpcErr));
      setData(null);
    } else {
      setData(result as ManagerData);
    }
    setLoading(false);
  }

  useEffect(() => { void load(); }, [token, slug, profile?.team_id]);

  const filteredAgents = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!data || !q) return data?.agents || [];
    return data.agents.filter(agent => [agent.name, agent.email].filter(Boolean).some(value => String(value).toLowerCase().includes(q)));
  }, [data, search]);

  async function exitPortal() {
    if (!privateLinkMode) await supabase.auth.signOut();
    window.location.href = '/';
  }

  if (loading && !data) {
    return <div className="min-h-screen bg-slate-50 flex items-center justify-center"><Loader2 className="animate-spin text-blue-600" size={32} /></div>;
  }

  if (!data) {
    return <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6"><div className="max-w-md rounded-2xl border border-red-200 bg-white p-6 text-center shadow-sm"><h1 className="font-bold text-red-700">Manager portal unavailable</h1><p className="mt-2 text-sm text-slate-500">{error || 'This manager link may be disabled.'}</p></div></div>;
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="readyops-brand-header sticky top-0 z-30 border-b">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <div className="flex items-center gap-4"><img src={READYOPS_LOGO_DATA_URI} alt="ReadyOps" className="readyops-brand-logo-sm"/><div className="border-l border-white/15 pl-4"><p className="readyops-brand-subtitle text-xs font-bold uppercase tracking-[0.18em]">Manager Dashboard</p><h1 className="text-xl font-bold text-white">{data.manager?.name || data.team.name}</h1><p className="readyops-brand-subtitle text-xs">Team: {data.team.abbreviation} — {data.team.name}</p></div></div>
          <div className="flex gap-2">
            <button onClick={() => void load()} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600"><RefreshCw size={14} /> Refresh</button>
            <button onClick={() => void exitPortal()} className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-bold text-white">{privateLinkMode ? 'Close' : 'Sign Out'}</button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-5 px-4 py-5 sm:px-6">
        {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="Agents" value={data.agents.length} />
          <Metric label="QC Pending" value={data.agents.reduce((sum, a) => sum + Number(a.qc_pending || 0), 0)} />
          <Metric label="Approved" value={data.agents.reduce((sum, a) => sum + Number(a.approved || 0), 0)} />
          <Metric label="Companies" value={data.companies.filter(c => c.account_status === 'Active').length} />
        </section>

        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div><h2 className="font-bold">Agents</h2><p className="text-xs text-slate-500">Open an agent's private lead portal to review QC pending, approved and denied leads.</p></div>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search agents..." className="rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-400" />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3 text-left">Agent</th><th className="px-3 py-3 text-left">Team</th><th className="px-3 py-3 text-center">Total</th><th className="px-3 py-3 text-center">QC Pending</th><th className="px-3 py-3 text-center">Approved</th><th className="px-3 py-3 text-center">Denied</th><th className="px-4 py-3 text-right">Agent Leads</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {filteredAgents.map(agent => {
                  const agentLink = agent.portal_slug && agent.access_token
                    ? `${window.location.origin}/agent/${agent.portal_slug}/${agent.access_token}`
                    : '';
                  return <tr key={agent.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3"><strong className="block">{agent.name}</strong><span className="text-xs text-slate-400">{agent.email || 'No email'}</span></td>
                    <td className="px-3 py-3"><span className="rounded-full bg-blue-50 px-2 py-1 text-[10px] font-bold text-blue-700">{data.team.abbreviation}</span></td>
                    <td className="px-3 py-3 text-center font-bold">{agent.total_leads}</td>
                    <td className="px-3 py-3 text-center font-bold text-amber-700">{agent.qc_pending}</td>
                    <td className="px-3 py-3 text-center font-bold text-emerald-700">{agent.approved}</td>
                    <td className="px-3 py-3 text-center font-bold text-red-700">{agent.denied}</td>
                    <td className="px-4 py-3 text-right">{agentLink ? <a href={agentLink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold text-white">Agent Leads <ExternalLink size={13} /></a> : <span className="text-xs text-slate-400">Link unavailable</span>}</td>
                  </tr>;
                })}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-2"><Users size={16} className="text-blue-600" /><div><h2 className="font-bold">Team Company Links</h2><p className="text-xs text-slate-500">Copy the ReadyMode popup link with all ReadyMode prefill fields already attached.</p></div></div>
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {data.companies.filter(company => company.public_slug && company.account_status === 'Active').map(company => {
              const base = `${window.location.origin}/book/${company.public_slug}`;
              const readyModeLink = buildReadyModeBookingLink(base);
              return <div key={company.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 p-3">
                <div className="min-w-0"><p className="truncate text-sm font-bold">{company.name}</p><p className="text-xs text-slate-400">{company.state || '—'}</p></div>
                <button onClick={() => void copyText(readyModeLink)} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700"><ClipboardCopy size={13} /> ReadyMode</button>
              </div>;
            })}
          </div>
        </section>
      </main>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</p><p className="mt-1 text-3xl font-black text-slate-900">{value}</p></div>;
}
