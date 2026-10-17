import { formatDateTime } from './dateDisplay';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Building2, Loader2, RefreshCw, Search, ShieldCheck, Users, Wifi, Clock,
} from 'lucide-react';
import { supabase } from './supabase';
import { AdminWorkspaceShell } from './AdminWorkspaceShell';
import { useAuth } from './AuthContext';

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

type CompanyPresenceRow = {
  session_id?: string; actor_key?: string; actor_user_id?: string; actor_kind?: string; actor_name?: string; actor_role?: string;
  company_id: string;
  session_started_at: string;
  last_seen_at: string;
  current_section: string | null;
  updated_at: string;
};

type CompanyRow = CompanyPresenceRow & { company_name: string; company_state: string | null };

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




export function ActiveUsers() {
  const {profile}=useAuth();
  const [kind,setKind]=useState('all');
  const [days,setDays]=useState(30);
  const [expanded,setExpanded]=useState<Record<string,boolean>>({companies:true,staff:true,companyRecent:true,staffOnline:true});
  const [rows, setRows] = useState<Row[]>([]);
  const [companyRows, setCompanyRows] = useState<CompanyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async (initial: boolean) => {
    if (initial) setLoading(true);
    else setRefreshing(true);
    setError('');

    const [userPresenceResult, companyPresenceResult, sessionResult] = await Promise.all([
      supabase
        .from('user_presence')
        .select('user_id, session_started_at, last_seen_at, current_path, updated_at')
        .order('last_seen_at', { ascending: false }),
      supabase
        .from('company_portal_presence')
        .select('company_id, session_started_at, last_seen_at, current_section, updated_at')
        .order('last_seen_at', { ascending: false }),
      supabase.from('company_portal_sessions').select('company_id,session_id,actor_key,actor_user_id,actor_kind,actor_name,actor_role,session_started_at,last_seen_at,current_section').order('last_seen_at',{ascending:false}),
    ]);

    if (userPresenceResult.error || companyPresenceResult.error || sessionResult.error) {
      setError((userPresenceResult.error || companyPresenceResult.error || sessionResult.error)?.message || 'Unable to load presence activity.');
      if (initial) setLoading(false);
      else setRefreshing(false);
      return;
    }

    const presence = (userPresenceResult.data || []) as PresenceRow[];
    const sessions=(sessionResult.data||[]) as CompanyPresenceRow[];
    const seenCompanies=new Set(sessions.map(s=>s.company_id));
    const companyPresence=[...sessions,...((companyPresenceResult.data||[]) as CompanyPresenceRow[]).filter(s=>!seenCompanies.has(s.company_id))];
    const userIds = [...new Set(presence.map(p => p.user_id))];
    const companyIds = [...new Set(companyPresence.map(p => p.company_id))];
    let profileMap = new Map<string, ProfileRow>();
    let companyMap = new Map<string, { id: string; name: string; state: string | null }>();

    const [profileResult, companyResult] = await Promise.all([
      userIds.length
        ? supabase.from('profiles').select('id, role, display_name, email').in('id', userIds)
        : Promise.resolve({ data: [], error: null }),
      companyIds.length
        ? supabase.from('roster_companies').select('id, name, state').in('id', companyIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (profileResult.error || companyResult.error) {
        setError((profileResult.error || companyResult.error)?.message || 'Unable to load presence details.');
        if (initial) setLoading(false);
        else setRefreshing(false);
        return;
    }

    profileMap = new Map((profileResult.data || []).map(p => [p.id as string, p as ProfileRow]));
    companyMap = new Map((companyResult.data || []).map(c => [c.id as string, c as { id: string; name: string; state: string | null }]));

    setRows(presence.map(p => ({ ...p, profile: profileMap.get(p.user_id) || null })));
    setCompanyRows(companyPresence.map(p => {
      const company = companyMap.get(p.company_id);
      return { ...p, company_name: company?.name || 'Unknown company', company_state: company?.state || null };
    }));
    setNow(Date.now());
    if (initial) setLoading(false);
    else setRefreshing(false);
  }, []);

  useEffect(() => { void load(true); }, [load]);

  useEffect(() => {
    const poll = window.setInterval(() => { void load(false); }, REFRESH_MS);
    const tick = window.setInterval(() => setNow(Date.now()), 5_000);
    const channel = supabase
      .channel('readyops_presence_admin')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'user_presence' }, () => {
        void load(false);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'company_portal_presence' }, () => {
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

  const filteredCompanies = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return companyRows;
    return companyRows.filter(row => [row.company_name, row.company_state, row.current_section,row.actor_name,row.actor_role]
      .filter(Boolean)
      .some(value => String(value).toLowerCase().includes(q)));
  }, [companyRows, search]);

  const online = filtered.filter(r => isOnline(r.last_seen_at, now));
  const recent = filtered.filter(r => !isOnline(r.last_seen_at, now));
  const companiesOnline = filteredCompanies.filter(r => isOnline(r.last_seen_at, now));
  const companiesRecent = filteredCompanies.filter(r => !isOnline(r.last_seen_at, now));

  const cutoff=now-days*86400000;
  const staffRecent=recent.filter(r=>new Date(r.last_seen_at).getTime()>=cutoff);
  const companyRecent=companiesRecent.filter(r=>new Date(r.last_seen_at).getTime()>=cutoff);
  const older=[...recent.filter(r=>new Date(r.last_seen_at).getTime()<cutoff).map(staffActivity),...companiesRecent.filter(r=>new Date(r.last_seen_at).getTime()<cutoff).map(companyActivity)];
  const flip=(id:string)=>setExpanded(s=>({...s,[id]:!s[id]}));
  const all=(value:boolean)=>setExpanded(Object.fromEntries(['companies','staff','companyOnline','companyRecent','staffOnline','staffRecent','older'].map(k=>[k,value])));
  const group=(id:string,title:string,items:Activity[],icon:typeof Users=Users)=><ActivityGroup key={id} title={title} items={items} now={now} open={!!expanded[id]} toggle={()=>flip(id)} icon={icon}/>;
  return <AdminWorkspaceShell active="active-users" title="Active Users" subtitle="Monitor staff and company portal activity" actions={<><span className="rounded-full bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700">● Live</span><button disabled={loading||refreshing} onClick={()=>void load(false)} className="readyops-ref-secondary"><RefreshCw size={15} className={refreshing?'animate-spin':''}/> Refresh</button></>}>
   <div className="space-y-4">
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
     <StatCard label="Staff Online" value={online.length} icon={Users}/><StatCard label="Company Portals Online" value={new Set(companiesOnline.filter(r=>r.actor_kind!=='staff').map(r=>r.company_id)).size} icon={Building2}/><StatCard label="Recently Active" value={staffRecent.length+companyRecent.length} icon={Clock}/><StatCard label="Total Tracked" value={rows.length+companyRows.length} icon={ShieldCheck}/>
    </div>
    <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-white p-3">
     <label className="relative min-w-0 grow basis-64"><Search size={16} className="absolute left-3 top-3 text-slate-400"/><input aria-label="Search activity" placeholder="Search staff or companies…" value={search} onChange={e=>setSearch(e.target.value)} className="w-full rounded-lg border py-2 pl-9 pr-3 text-sm"/></label>
     {['all','staff','companies'].map(k=><button key={k} onClick={()=>setKind(k)} aria-pressed={kind===k} className={`rounded-full px-4 py-2 text-sm font-semibold ${kind===k?'bg-blue-600 text-white':'border bg-slate-50 text-slate-700'}`}>{k[0].toUpperCase()+k.slice(1)}</button>)}
     <select aria-label="Recent activity date range" value={days} onChange={e=>setDays(Number(e.target.value))} className="rounded-lg border p-2 text-sm">{[7,30,90].map(n=><option key={n} value={n}>Last {n} days</option>)}</select>
     <button className="rounded-lg border px-3 py-2 text-sm font-semibold text-blue-700" onClick={()=>all(true)}>Expand All</button><button className="rounded-lg border px-3 py-2 text-sm font-semibold text-blue-700" onClick={()=>all(false)}>Collapse All</button>
    </div>
    <p className="text-xs text-slate-500">Staff visits use the signed-in account. Shared links alone cannot identify the person. Older records are unverified. Counts include separate portal sessions; company-online count excludes identified staff visits.</p>
    {error&&<p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {loading?<div className="flex justify-center p-12"><Loader2 className="animate-spin text-blue-600"/></div>:<>
     <div className={`grid gap-4 ${kind==='all'?'xl:grid-cols-[1.4fr_1fr]':''}`}>
      {kind!=='staff'&&<section className="min-w-0 rounded-xl border bg-white p-3 sm:p-4"><SectionHeading title="Company Portals" count={filteredCompanies.length} icon={Building2} open={!!expanded.companies} toggle={()=>flip('companies')}/>{expanded.companies&&<div className="mt-3 space-y-3">{group('companyOnline','Online Now',companiesOnline.map(companyActivity),Wifi)}{group('companyRecent','Recently Active',companyRecent.map(companyActivity),Clock)}</div>}</section>}
      {kind!=='companies'&&<section className="min-w-0 rounded-xl border bg-white p-3 sm:p-4"><SectionHeading title="Staff Activity" count={filtered.length} icon={Users} open={!!expanded.staff} toggle={()=>flip('staff')}/>{expanded.staff&&<div className="mt-3 space-y-3">{group('staffOnline','Online Now',online.map(staffActivity),Wifi)}{group('staffRecent','Recently Active Staff',staffRecent.map(staffActivity),Clock)}</div>}</section>}
     </div>
     {group('older','Older Activity',older.filter(r=>kind==='all'||(kind==='staff'?r.type==='staff':r.type==='company')),Clock)}
    </>}
    <p className="text-xs text-slate-400">Your signed-in account: {profile?.display_name||'Staff'} · Activity refreshes every 15 seconds.</p>
   </div>
  </AdminWorkspaceShell>;
}
type Activity={id:string;type:'staff'|'company';name:string;detail:string;identity:string;last:string;page:string|null};
function staffActivity(r:Row):Activity{return {id:r.user_id,type:'staff',name:r.profile?.display_name||r.profile?.email||'Unnamed staff',detail:r.profile?.role||'Staff',identity:'Signed-in staff',last:r.last_seen_at,page:r.current_path};}
function companyActivity(r:CompanyRow):Activity{return {id:[r.company_id,r.session_id||'legacy',r.actor_key||'unknown'].join(':'),type:'company',name:r.company_name,detail:r.company_state||'—',identity:r.actor_kind==='staff'?`${r.actor_name||'Staff'} · ${r.actor_role||'Staff'} visit`:r.actor_kind==='company_verified'?`${r.actor_name||'Company user'} · Verified company user`:'Shared link — identity unverified',last:r.last_seen_at,page:r.current_section};}
function pageLabel(value:string|null){if(!value)return '—';if(value.startsWith('/company/'))return 'Company Portal';if(value==='/'||value.includes('overview'))return 'Overview';if(value.includes('qc'))return 'QC Queue';if(value.includes('payroll'))return 'Payroll';if(value.includes('crm')||value.includes('lead'))return 'Leads';if(value.includes('active-users'))return 'Active Users';if(value.includes('setup'))return 'Setup';return value.split('?')[0].replace(/^\/|\/$/g,'').replace(/[-_]/g,' ').slice(0,45);}
function StatCard({label,value,icon:Icon}:{label:string;value:number;icon:typeof Users}){return <div className="flex items-center gap-3 rounded-xl border bg-white p-4"><span className="rounded-full bg-blue-50 p-3 text-blue-600"><Icon size={23}/></span><div><strong className="text-3xl text-slate-900">{value}</strong><p className="text-xs text-slate-500 sm:text-sm">{label}</p></div></div>;}
function SectionHeading({title,count,icon:Icon,open,toggle}:{title:string;count:number;icon:typeof Users;open:boolean;toggle:()=>void}){return <div className="flex items-center justify-between gap-2"><h2 className="flex min-w-0 items-center gap-2 text-sm font-bold text-slate-900 sm:text-base"><Icon className="shrink-0 text-blue-600" size={20}/>{title}<span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs">{count}</span></h2><button aria-expanded={open} onClick={toggle} className="shrink-0 rounded-lg border px-3 py-2 text-xs font-bold text-blue-600">{open?'Hide ⌃':'Show ⌄'}</button></div>;}
function ActivityGroup({title,items,now,open,toggle,icon}:{title:string;items:Activity[];now:number;open:boolean;toggle:()=>void;icon:typeof Users}){
 const [page,setPage]=useState(0);const max=Math.max(0,Math.ceil(items.length/5)-1),current=Math.min(page,max),visible=items.slice(current*5,current*5+5);
 return <section className="min-w-0 overflow-hidden rounded-xl border bg-white"><header className="bg-slate-50/70 p-3"><SectionHeading title={title} count={items.length} icon={icon} open={open} toggle={toggle}/></header>{open&&<>{!items.length?<p className="p-5 text-sm text-slate-500">No activity in this group.</p>:<>
  <div className="hidden overflow-x-auto md:block"><table className="w-full text-left text-xs"><thead className="bg-slate-100 text-slate-600"><tr>{['Name / Company','Visitor / Role','Status','Last Page','Last Active'].map(h=><th key={h} className="px-3 py-3 font-semibold">{h}</th>)}</tr></thead><tbody>{visible.map(r=><tr key={r.id} className="border-t border-slate-100"><td className="px-3 py-3"><strong className="text-slate-900">{r.name}</strong><p className="mt-1 text-slate-500">{r.detail}</p></td><td className="px-3 py-3"><span className={`font-semibold ${r.identity.includes('unverified')?'text-amber-700':r.type==='company'&&r.identity.includes('visit')?'text-blue-700':'text-slate-700'}`}>{r.identity}</span></td><td className="px-3 py-3"><Status online={isOnline(r.last,now)}/></td><td className="px-3 py-3 text-slate-600">{pageLabel(r.page)}</td><td className="whitespace-nowrap px-3 py-3 text-slate-600" title={formatDateTime(r.last)}>{formatTimeAgo(r.last,now)}</td></tr>)}</tbody></table></div>
  <div className="divide-y md:hidden">{visible.map(r=><article key={r.id} className="space-y-2 p-3 text-sm"><div className="flex justify-between gap-2"><strong>{r.name}</strong><Status online={isOnline(r.last,now)}/></div><p className="text-xs font-semibold text-blue-800">{r.identity}</p><p className="text-xs text-slate-500">{r.detail} · {pageLabel(r.page)} · {formatTimeAgo(r.last,now)}</p></article>)}</div>
  <footer className="flex items-center justify-between gap-2 border-t p-3 text-xs text-slate-500"><span>Showing {current*5+1}–{Math.min(items.length,current*5+5)} of {items.length}</span><div className="flex gap-2"><button aria-label={`Previous ${title} page`} disabled={!current} onClick={()=>setPage(current-1)} className="rounded border px-2 py-1 disabled:opacity-30">‹</button><span className="rounded bg-blue-600 px-2 py-1 text-white">{current+1}</span><button aria-label={`Next ${title} page`} disabled={current>=max} onClick={()=>setPage(current+1)} className="rounded border px-2 py-1 disabled:opacity-30">›</button></div></footer>
 </>}</>}</section>;
}
function Status({online}:{online:boolean}){return <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-1 text-xs font-semibold ${online?'bg-emerald-50 text-emerald-700':'bg-amber-50 text-amber-700'}`}>● {online?'Online':'Away'}</span>;}
