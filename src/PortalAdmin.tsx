import { useEffect, useState } from 'react';
import { ArrowLeft, Clipboard, ExternalLink, Loader2, RefreshCw, ShieldCheck } from 'lucide-react';
import { supabase } from './supabase';
import { copyText, rpcError } from './portalUtils';

interface PortalSetting { company_id: string; public_slug: string; portal_enabled: boolean; allow_public_booking: boolean; company_access_enabled: boolean; company_access_token: string; form_mode: string; }
interface Company { id: string; name: string; state: string | null; account_status: string; }

export function PortalAdmin() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [settings, setSettings] = useState<PortalSetting[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true); setError('');
    const [companyRes, settingsRes] = await Promise.all([
      supabase.from('roster_companies').select('id,name,state,account_status').order('name'),
      supabase.from('company_portal_settings').select('company_id,public_slug,portal_enabled,allow_public_booking,company_access_enabled,company_access_token,form_mode'),
    ]);
    if (companyRes.error || settingsRes.error) setError(rpcError(companyRes.error || settingsRes.error));
    setCompanies((companyRes.data || []) as Company[]);
    setSettings((settingsRes.data || []) as PortalSetting[]);
    setLoading(false);
  }

  useEffect(() => { void load(); }, []);

  if (loading) return <div className="min-h-screen flex items-center justify-center bg-slate-50"><Loader2 className="animate-spin text-blue-600" /></div>;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white"><div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6"><div className="flex items-center gap-3"><button onClick={() => { window.location.href = '/'; }} className="rounded-lg border border-slate-200 p-2"><ArrowLeft size={16} /></button><div><p className="text-xs font-bold uppercase tracking-[0.18em] text-blue-600">Ready Ops Admin</p><h1 className="text-xl font-bold">Portal Links & Access</h1></div></div><button onClick={() => void load()} className="rounded-lg border border-slate-200 p-2"><RefreshCw size={16} /></button></div></header>
      <main className="mx-auto max-w-6xl px-4 py-5 sm:px-6">
        {error && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
        <div className="mb-4 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900"><ShieldCheck size={16} className="mr-2 inline" />Agent links are shareable. Company management links are private and token-protected.</div>
        <div className="space-y-3">{companies.map(company => { const setting = settings.find(item => item.company_id === company.id); if (!setting) return null; const agentLink = `${window.location.origin}/book/${setting.public_slug}`; const companyLink = `${window.location.origin}/company/${company.id}/manage/${setting.company_access_token}`; return <article key={company.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between"><div><h2 className="font-bold">{company.name}{company.state ? ` — ${company.state}` : ''}</h2><div className="mt-2 flex flex-wrap gap-2 text-[10px] font-bold"><span className={`rounded-full px-2 py-1 ${setting.portal_enabled ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{setting.portal_enabled ? 'AGENT PORTAL ON' : 'AGENT PORTAL OFF'}</span><span className="rounded-full bg-blue-50 px-2 py-1 text-blue-700">{setting.form_mode.replace(/_/g, ' ').toUpperCase()}</span></div></div><div className="flex flex-wrap gap-2"><button onClick={() => void copyText(agentLink)} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold"><Clipboard size={13} /> Copy Agent Link</button><button onClick={() => window.open(agentLink, '_blank', 'noopener,noreferrer')} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold"><ExternalLink size={13} /> Agent</button><button onClick={() => void copyText(companyLink)} className="inline-flex items-center gap-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800"><Clipboard size={13} /> Copy Company Link</button><button onClick={() => window.open(companyLink, '_blank', 'noopener,noreferrer')} className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold text-white"><ExternalLink size={13} /> Manage</button></div></div></article>; })}</div>
      </main>
    </div>
  );
}
