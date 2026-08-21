import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft, Loader2, RefreshCw, Search, ShieldCheck, Users, Wifi, Clock,
} from 'lucide-react';
import { supabase } from './supabase';

type PresenceRow = {
  user_id: string;
  session_started_at: string;
  last_seen_at: string;
  current_path: string | null;
  updated_at: string;
};

type ProfileRow = {
  id: string;
  role: string | null;
  display_name: string | null;
  email: string | null;
};

type Row = PresenceRow & { profile: ProfileRow | null };

const ONLINE_WINDOW_MS = 90_000;
const REFRESH_MS = 15_000;

function isOnline(lastSeen: string, now: number): boolean {
  return now - new Date(lastSeen).getTime() <= ONLINE_WINDOW_MS;
}

function formatTimeAgo(iso: string, now: number): string {
  const diff = Math.max(0, now - new Date(iso).getTime());
  const s = Math.floor(diff / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function roleTone(role: string | null | undefined): string {
  switch (role) {
    case 'admin': return 'bg-amber-50 text-amber-800 border-amber-200';
    case 'manager': return 'bg-blue-50 text-blue-800 border-blue-200';
    case 'qc': return 'bg-emerald-50 text-emerald-800 border-emerald-200';
    case 'agent': return 'bg-slate-50 text-slate-700 border-slate-200';
    default: return 'bg-slate-50 text-slate-500 border-slate-200';
  }
}

export function ActiveUsers() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async (initial: boolean) => {
    if (initial) setLoading(true);
    else setRefreshing(true);
    setError('');

    const { data: presenceData, error: presenceError } = await supabase
      .from('user_presence')
      .select('user_id, session_started_at, last_seen_at, current_path, updated_at')
      .order('last_seen_at', { ascending: false });

    if (presenceError) {
      setError(presenceError.message);
      if (initial) setLoading(false);
      else setRefreshing(false);
      return;
    }

    const presence = (presenceData || []) as PresenceRow[];
    const userIds = [...new Set(presence.map(p => p.user_id))];
    let profileMap = new Map<string, ProfileRow>();

    if (userIds.length) {
      const { data: profileData, error: profileError } = await supabase
        .from('profiles')
        .select('id, role, display_name, email')
        .in('id', userIds);
      if (profileError) {
        setError(profileError.message);
        if (initial) setLoading(false);
        else setRefreshing(false);
        return;
      }
      profileMap = new Map((profileData || []).map(p => [p.id as string, p as ProfileRow]));
    }

    setRows(presence.map(p => ({ ...p, profile: profileMap.get(p.user_id) || null })));
    setNow(Date.now());
    if (initial) setLoading(false);
    else setRefreshing(false);
  }, []);

  useEffect(() => { void load(true); }, [load]);

  useEffect(() => {
    const poll = window.setInterval(() => { void load(false); }, REFRESH_MS);
    const tick = window.setInterval(() => setNow(Date.now()), 5_000);
    const channel = supabase
      .channel('user_presence_admin')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'user_presence' }, () => {
        void load(false);
      })
      .subscribe();
    return () => {
      window.clearInterval(poll);
      window.clearInterval(tick);
      void supabase.removeChannel(channel);
    };
  }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(row => {
      const parts = [
        row.profile?.display_name,
        row.profile?.email,
        row.profile?.role,
        row.current_path,
      ].filter(Boolean).map(v => String(v).toLowerCase());
      return parts.some(v => v.includes(q));
    });
  }, [rows, search]);

  const online = filtered.filter(r => isOnline(r.last_seen_at, now));
  const recent = filtered.filter(r => !isOnline(r.last_seen_at, now));

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <button
              onClick={() => { window.location.href = '/'; }}
              className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              <ArrowLeft size={14} /> Dashboard
            </button>
            <div className="min-w-0">
              <h1 className="flex items-center gap-2 text-lg font-bold text-slate-900">
                <Users size={18} className="text-blue-600" /> Active Users
              </h1>
              <p className="truncate text-xs text-slate-500">Live view of who has ReadyOps open right now.</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="hidden items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 sm:flex">
              <span className="relative inline-flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60"></span>
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500"></span>
              </span>
              {online.length} online
            </div>
            <button
              onClick={() => { void load(false); }}
              disabled={refreshing || loading}
              className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-60"
            >
              <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} /> Refresh
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1400px] px-4 py-5 sm:px-6">
        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <StatCard label="Online now" value={online.length} tone="emerald" icon={Wifi} />
          <StatCard label="Recently active" value={recent.length} tone="blue" icon={Clock} />
          <StatCard label="Total tracked" value={rows.length} tone="slate" icon={ShieldCheck} />
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by name, email, role, or page..."
              className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center rounded-2xl border border-slate-200 bg-white py-16">
            <Loader2 className="animate-spin text-blue-600" size={28} />
          </div>
        ) : (
          <div className="space-y-6">
            <PresenceSection
              title="Online Now"
              subtitle="Active within the last 90 seconds"
              rows={online}
              onlineState
              now={now}
              emptyText="No one is currently online."
            />
            <PresenceSection
              title="Recently Active"
              subtitle="Last seen more than 90 seconds ago"
              rows={recent}
              onlineState={false}
              now={now}
              emptyText="No recent activity to show."
            />
          </div>
        )}
      </main>
    </div>
  );
}

function StatCard({
  label, value, tone, icon: Icon,
}: {
  label: string;
  value: number;
  tone: 'emerald' | 'blue' | 'slate';
  icon: typeof Wifi;
}) {
  const tones: Record<typeof tone, string> = {
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    blue: 'bg-blue-50 text-blue-700 border-blue-200',
    slate: 'bg-slate-50 text-slate-700 border-slate-200',
  };
  return (
    <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
        <p className="mt-1 text-2xl font-bold text-slate-900">{value}</p>
      </div>
      <div className={`flex h-10 w-10 items-center justify-center rounded-xl border ${tones[tone]}`}>
        <Icon size={18} />
      </div>
    </div>
  );
}

function PresenceSection({
  title, subtitle, rows, onlineState, now, emptyText,
}: {
  title: string;
  subtitle: string;
  rows: Row[];
  onlineState: boolean;
  now: number;
  emptyText: string;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-100 px-5 py-4">
        <div>
          <h2 className="text-sm font-bold text-slate-900">{title}</h2>
          <p className="text-xs text-slate-500">{subtitle}</p>
        </div>
        <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600">{rows.length}</span>
      </header>

      {rows.length === 0 ? (
        <div className="px-5 py-10 text-center text-sm text-slate-500">{emptyText}</div>
      ) : (
        <>
          <div className="hidden md:block">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-100 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-3 font-semibold">Status</th>
                  <th className="px-5 py-3 font-semibold">User</th>
                  <th className="px-5 py-3 font-semibold">Role</th>
                  <th className="px-5 py-3 font-semibold">Current Page</th>
                  <th className="px-5 py-3 font-semibold">Session Started</th>
                  <th className="px-5 py-3 font-semibold">Last Seen</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(row => (
                  <tr key={row.user_id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60">
                    <td className="px-5 py-3">
                      <StatusDot online={onlineState} />
                    </td>
                    <td className="px-5 py-3">
                      <div className="font-semibold text-slate-900">{row.profile?.display_name || 'Unnamed user'}</div>
                      <div className="text-xs text-slate-500">{row.profile?.email || '—'}</div>
                    </td>
                    <td className="px-5 py-3">
                      <RoleBadge role={row.profile?.role || null} />
                    </td>
                    <td className="px-5 py-3">
                      <PathPill path={row.current_path} />
                    </td>
                    <td className="px-5 py-3 text-slate-600">{formatDateTime(row.session_started_at)}</td>
                    <td className="px-5 py-3 text-slate-600">{formatTimeAgo(row.last_seen_at, now)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid gap-3 p-4 md:hidden">
            {rows.map(row => (
              <article key={row.user_id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <StatusDot online={onlineState} />
                    <div>
                      <div className="text-sm font-semibold text-slate-900">{row.profile?.display_name || 'Unnamed user'}</div>
                      <div className="text-xs text-slate-500">{row.profile?.email || '—'}</div>
                    </div>
                  </div>
                  <RoleBadge role={row.profile?.role || null} />
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                  <div>
                    <dt className="font-semibold uppercase tracking-wide text-slate-400">Page</dt>
                    <dd className="mt-0.5"><PathPill path={row.current_path} /></dd>
                  </div>
                  <div>
                    <dt className="font-semibold uppercase tracking-wide text-slate-400">Session</dt>
                    <dd className="mt-0.5 text-slate-600">{formatDateTime(row.session_started_at)}</dd>
                  </div>
                  <div>
                    <dt className="font-semibold uppercase tracking-wide text-slate-400">Last seen</dt>
                    <dd className="mt-0.5 text-slate-600">{formatTimeAgo(row.last_seen_at, now)}</dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function StatusDot({ online }: { online: boolean }) {
  if (online) {
    return (
      <span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">
        <span className="relative inline-flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-70"></span>
          <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500"></span>
        </span>
        Online
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
      <span className="h-2 w-2 rounded-full bg-slate-400" />
      Away
    </span>
  );
}

function RoleBadge({ role }: { role: string | null }) {
  const label = role ? role.charAt(0).toUpperCase() + role.slice(1) : 'Unknown';
  return (
    <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${roleTone(role)}`}>
      {label}
    </span>
  );
}

function PathPill({ path }: { path: string | null }) {
  if (!path) return <span className="text-xs text-slate-400">—</span>;
  return (
    <span className="inline-block max-w-[280px] truncate rounded-md bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-700" title={path}>
      {path}
    </span>
  );
}
