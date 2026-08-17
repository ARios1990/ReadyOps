from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(path: str, old: str, new: str) -> None:
    file_path = ROOT / path
    text = file_path.read_text(encoding="utf-8")
    if old not in text:
        raise RuntimeError(f"Pattern not found in {path}: {old[:120]!r}")
    file_path.write_text(text.replace(old, new, 1), encoding="utf-8")


# ReadyMode popup links: accept a custom Recording URL field and keep the ReadyMode lead ID.
replace_once(
    "src/portalUtils.ts",
    "  'second_address=(Profile.2nd Address)',\n].join('&');",
    "  'second_address=(Profile.2nd Address)',\n  // Create this as a ReadyMode custom CRM field and populate it once the call recording is finalized.\n  'recording_url=(Profile.Recording URL)',\n  'rm_lead_id=(Lead.id)',\n].join('&');",
)

# Agent booking page: hidden recording prefill + branded header.
replace_once(
    "src/AgentBookingPortal.tsx",
    "import { addDays, buildLeadTemplate, copyText, formatDateLong, formatDateShort, formatTime, getPortalSessionId, localDate, rpcError, startOfWeek } from './portalUtils';",
    "import { addDays, buildLeadTemplate, copyText, formatDateLong, formatDateShort, formatTime, getPortalSessionId, localDate, rpcError, startOfWeek } from './portalUtils';\nimport { READYOPS_LOGO_DATA_URI } from './brand';",
)
replace_once(
    "src/AgentBookingPortal.tsx",
    "      <header className=\"border-b border-slate-200 bg-white\">\n        <div className=\"mx-auto max-w-5xl px-4 py-5 sm:px-6\">\n          <div className=\"flex items-start justify-between gap-4\">\n            <div>\n              <p className=\"text-xs font-bold uppercase tracking-[0.18em] text-blue-600\">Ready Ops</p>\n              <h1 className=\"mt-1 text-2xl font-bold\">{company.name}</h1>\n              {company.state && <p className=\"text-sm text-slate-500\">{company.state}</p>}\n            </div>\n            <div className=\"rounded-xl bg-blue-50 px-3 py-2 text-right text-xs text-blue-700\"><span className=\"font-bold\">Live availability</span><br />{settings.timezone}</div>\n          </div>\n        </div>\n      </header>",
    "      <header className=\"readyops-brand-header border-b\">\n        <div className=\"mx-auto max-w-5xl px-4 py-4 sm:px-6\">\n          <div className=\"flex items-center justify-between gap-4\">\n            <div className=\"flex items-center gap-4\">\n              <img src={READYOPS_LOGO_DATA_URI} alt=\"ReadyOps\" className=\"readyops-brand-logo\" />\n              <div className=\"border-l border-white/15 pl-4\">\n                <h1 className=\"text-xl font-bold text-white\">{company.name}</h1>\n                {company.state && <p className=\"readyops-brand-subtitle text-sm\">{company.state}</p>}\n              </div>\n            </div>\n            <div className=\"rounded-xl border border-blue-400/20 bg-blue-500/10 px-3 py-2 text-right text-xs text-blue-100\"><span className=\"font-bold text-white\">Live availability</span><br />{settings.timezone}</div>\n          </div>\n        </div>\n      </header>",
)
replace_once(
    "src/AgentBookingPortal.tsx",
    "        {error && <div className=\"rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700\">{error}</div>}\n",
    "        {error && <div className=\"rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700\">{error}</div>}\n        {formValues.recording_url && <div className=\"rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-xs font-semibold text-blue-800\">ReadyMode recording attached for QC. The company will not receive the audio unless QC explicitly shares it.</div>}\n",
)
replace_once(
    "src/AgentBookingPortal.tsx",
    "second_address: get('second_address','2nd_address'), agent_token: get('agent_token')",
    "second_address: get('second_address','2nd_address'), recording_url: get('recording_url','recording','recording_link','audio_url','call_recording'), readymode_call_log_id: get('rm_call_log_id','readymode_call_log_id','call_log_id'), agent_token: get('agent_token')",
)

# QC queue: recording player, private-by-default share checkbox, branding.
replace_once(
    "src/QCQueue.tsx",
    "import { ArrowLeft, CheckCircle2, ExternalLink, Filter, RefreshCw, Save, Send, ShieldCheck, Shuffle, XCircle } from 'lucide-react';",
    "import { ArrowLeft, CheckCircle2, ExternalLink, Filter, Headphones, RefreshCw, Save, Send, ShieldCheck, Shuffle, XCircle } from 'lucide-react';",
)
replace_once(
    "src/QCQueue.tsx",
    "import { buildExternalFormUrl, formatDateLong, formatTime, localDate, rpcError } from './portalUtils';",
    "import { buildExternalFormUrl, formatDateLong, formatTime, localDate, rpcError } from './portalUtils';\nimport { READYOPS_LOGO_DATA_URI } from './brand';",
)
replace_once(
    "src/QCQueue.tsx",
    "  async function saveEdits(){if(!selected)return;setBusy(true);setError(''); const top:Obj={}; ['full_name','phone_number','address','city','state','zip_code','email','language','service_needed','notes','home_value','sq_ft','web_url'].forEach(k=>top[k]=values[k]??''); top.form_data={...selected.lead.form_data,...values}; const {error:e}=await supabase.rpc('qc_update_lead',{p_lead_id:selected.lead.id,p_patch:top}); if(e)setError(rpcError(e));else{setMessage('Lead changes saved.');await load();} setBusy(false);}",
    "  async function saveEdits(){if(!selected)return;setBusy(true);setError(''); const top:Obj={}; ['full_name','phone_number','address','city','state','zip_code','email','language','service_needed','notes','home_value','sq_ft','web_url'].forEach(k=>top[k]=values[k]??''); top.recording_url=values.recording_url??''; top.share_recording_with_company=Boolean(values.share_recording_with_company); const cleanForm={...selected.lead.form_data,...values}; delete cleanForm.recording_url; delete cleanForm.recording; delete cleanForm.recording_link; delete cleanForm.audio_url; delete cleanForm.call_recording; delete cleanForm.share_recording_with_company; top.form_data=cleanForm; const {error:e}=await supabase.rpc('qc_update_lead',{p_lead_id:selected.lead.id,p_patch:top}); if(e)setError(rpcError(e));else{setMessage('Lead changes saved.');await load();} setBusy(false);}",
)
replace_once(
    "src/QCQueue.tsx",
    "  async function review(decision:'approved'|'denied'){if(!selected)return;setBusy(true);setError('');const {data,error:e}=await supabase.rpc('qc_review_lead',{p_lead_id:selected.lead.id,p_decision:decision,p_reason:decision==='denied'?denyReason:null,p_notes:null});if(e)setError(rpcError(e));else{setMessage(decision==='approved'?'Lead approved and released to company.':'Lead QC denied; company cannot see it.'); if((data as Obj)?.same_day_notification_queued){await sendQueued(selected.lead.company_id,'same_day');} await load();setSelected(null);}setBusy(false);}",
    "  async function review(decision:'approved'|'denied'){if(!selected)return;setBusy(true);setError('');const {error:shareError}=await supabase.rpc('qc_update_lead',{p_lead_id:selected.lead.id,p_patch:{recording_url:values.recording_url??'',share_recording_with_company:Boolean(values.share_recording_with_company)}});if(shareError){setError(rpcError(shareError));setBusy(false);return;}const {data,error:e}=await supabase.rpc('qc_review_lead',{p_lead_id:selected.lead.id,p_decision:decision,p_reason:decision==='denied'?denyReason:null,p_notes:null});if(e)setError(rpcError(e));else{setMessage(decision==='approved'?'Lead approved and released to company.':'Lead QC denied; company cannot see it.'); if((data as Obj)?.same_day_notification_queued){await sendQueued(selected.lead.company_id,'same_day');} await load();setSelected(null);}setBusy(false);}",
)
replace_once(
    "src/QCQueue.tsx",
    "    <header className=\"sticky top-0 z-30 border-b bg-white\"><div className=\"mx-auto flex max-w-[1600px] items-center justify-between px-4 py-3\"><div className=\"flex items-center gap-3\"><button onClick={()=>location.href='/'} className=\"rounded-lg border p-2\"><ArrowLeft size={16}/></button><div><p className=\"text-xs font-bold uppercase tracking-widest text-blue-600\">Ready Ops</p><h1 className=\"text-xl font-bold\">QC — Quality Control</h1></div></div><button onClick={()=>void load()} className=\"rounded-lg border p-2\"><RefreshCw size={16}/></button></div></header>",
    "    <header className=\"readyops-brand-header sticky top-0 z-30 border-b\"><div className=\"mx-auto flex max-w-[1600px] items-center justify-between px-4 py-3\"><div className=\"flex items-center gap-3\"><button onClick={()=>location.href='/'} className=\"rounded-lg border border-white/20 bg-white/5 p-2 text-white\"><ArrowLeft size={16}/></button><img src={READYOPS_LOGO_DATA_URI} alt=\"ReadyOps\" className=\"readyops-brand-logo-sm\"/><div className=\"border-l border-white/15 pl-3\"><p className=\"readyops-brand-subtitle text-xs font-bold uppercase tracking-widest\">Quality Control</p><h1 className=\"text-xl font-bold text-white\">QC Queue</h1></div></div><button onClick={()=>void load()} className=\"rounded-lg border border-white/20 bg-white/5 p-2 text-white\"><RefreshCw size={16}/></button></div></header>",
)
replace_once(
    "src/QCQueue.tsx",
    "<th>Address</th><th>Auto Qual</th><th>QC</th><th></th>",
    "<th>Address</th><th>Recording</th><th>Auto Qual</th><th>QC</th><th></th>",
)
replace_once(
    "src/QCQueue.tsx",
    "<td className=\"max-w-[260px] truncate\">{row.lead.address}</td><td><span className=\"rounded-full bg-slate-100 px-2 py-1 text-[10px] font-bold\">",
    "<td className=\"max-w-[260px] truncate\">{row.lead.address}</td><td>{row.lead.recording_url?<span className=\"inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-1 text-[10px] font-bold text-blue-700\"><Headphones size={11}/> Audio</span>:<span className=\"text-[10px] font-semibold text-slate-400\">Missing</span>}</td><td><span className=\"rounded-full bg-slate-100 px-2 py-1 text-[10px] font-bold\">",
)
replace_once(
    "src/QCQueue.tsx",
    "<aside className=\"space-y-4\"><div className=\"rounded-xl border border-amber-200 bg-amber-50 p-4\"><h3 className=\"font-bold text-amber-900\">Company Requirements</h3>",
    "<aside className=\"space-y-4\"><div className=\"rounded-xl border border-blue-200 bg-blue-50 p-4\"><div className=\"flex items-center gap-2\"><Headphones size={16} className=\"text-blue-700\"/><h3 className=\"font-bold text-blue-950\">ReadyMode Recording</h3></div>{values.recording_url?<><audio controls preload=\"none\" src={String(values.recording_url)} className=\"mt-3 w-full\"/><a href={String(values.recording_url)} target=\"_blank\" rel=\"noreferrer\" className=\"mt-2 inline-flex items-center gap-1 text-xs font-bold text-blue-700\"><ExternalLink size={12}/> Open audio link</a></>:<p className=\"mt-2 text-xs text-slate-500\">No ReadyMode recording is attached yet.</p>}<label className=\"mt-3 flex items-start gap-2 rounded-lg border border-blue-200 bg-white p-3 text-xs font-semibold text-slate-700\"><input type=\"checkbox\" checked={Boolean(values.share_recording_with_company)} onChange={e=>change('share_recording_with_company',e.target.checked)} className=\"mt-0.5\"/><span>Share recording with company after QC approval.<span className=\"mt-1 block font-normal text-slate-500\">Off by default. If unchecked, the company and representative cannot see the audio.</span></span></label></div><div className=\"rounded-xl border border-amber-200 bg-amber-50 p-4\"><h3 className=\"font-bold text-amber-900\">Company Requirements</h3>",
)

# Company portal: branded header and only render audio when the privacy-filtered RPC exposes it.
replace_once(
    "src/CompanyPortal.tsx",
    "import { addDays, copyText, formatDateLong, formatTime, localDate, rpcError, startOfWeek } from './portalUtils';",
    "import { addDays, copyText, formatDateLong, formatTime, localDate, rpcError, startOfWeek } from './portalUtils';\nimport { READYOPS_LOGO_DATA_URI } from './brand';",
)
replace_once(
    "src/CompanyPortal.tsx",
    "interface LeadRecord { id: string; lead_code: string; full_name: string; phone_number: string; address: string; city: string | null; state: string | null; zip_code: string | null; email: string | null; language: string | null; notes: string | null; form_data: Record<string, unknown>; qualification_status: string; }",
    "interface LeadRecord { id: string; lead_code: string; full_name: string; phone_number: string; address: string; city: string | null; state: string | null; zip_code: string | null; email: string | null; language: string | null; notes: string | null; form_data: Record<string, unknown>; qualification_status: string; recording_url: string | null; recording_shared?: boolean; }",
)
replace_once(
    "src/CompanyPortal.tsx",
    "      <header className=\"sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur\"><div className=\"mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6\"><div><p className=\"text-xs font-bold uppercase tracking-[0.18em] text-blue-600\">Company Management</p><h1 className=\"text-lg font-bold\">{data.company.name}</h1></div><div className=\"flex items-center gap-2\"><span className=\"hidden rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700 sm:inline\">Secure Link</span><button onClick={() => void load()} className=\"rounded-lg border border-slate-200 p-2 text-slate-600\"><RefreshCw size={16} /></button></div></div></header>",
    "      <header className=\"readyops-brand-header sticky top-0 z-30 border-b\"><div className=\"mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6\"><div className=\"flex items-center gap-4\"><img src={READYOPS_LOGO_DATA_URI} alt=\"ReadyOps\" className=\"readyops-brand-logo-sm\"/><div className=\"border-l border-white/15 pl-4\"><p className=\"readyops-brand-subtitle text-xs font-bold uppercase tracking-[0.18em]\">Company Management</p><h1 className=\"text-lg font-bold text-white\">{data.company.name}</h1></div></div><div className=\"flex items-center gap-2\"><span className=\"hidden rounded-full border border-emerald-300/20 bg-emerald-400/10 px-3 py-1 text-xs font-bold text-emerald-100 sm:inline\">Secure Link</span><button onClick={() => void load()} className=\"rounded-lg border border-white/20 bg-white/5 p-2 text-white\"><RefreshCw size={16} /></button></div></div></header>",
)
replace_once(
    "src/CompanyPortal.tsx",
    "<Detail label=\"Qualification\" value={lead.qualification_status} /><Detail label=\"Representative\" value={appointment.representative_name || 'Unassigned'} /></div><h3 className=\"mt-6 mb-2 font-bold\">Lead Template</h3>",
    "<Detail label=\"Qualification\" value={lead.qualification_status} /><Detail label=\"Representative\" value={appointment.representative_name || 'Unassigned'} /></div>{lead.recording_url&&<div className=\"mt-5 rounded-xl border border-blue-200 bg-blue-50 p-4\"><p className=\"text-xs font-bold uppercase tracking-wide text-blue-700\">Call Recording — Shared by QC</p><audio controls preload=\"none\" src={lead.recording_url} className=\"mt-3 w-full\"/><a href={lead.recording_url} target=\"_blank\" rel=\"noreferrer\" className=\"mt-2 inline-flex items-center gap-1 text-xs font-bold text-blue-700\"><ExternalLink size={12}/> Open audio link</a></div>}<h3 className=\"mt-6 mb-2 font-bold\">Lead Template</h3>",
)

# Main admin dashboard branding.
replace_once(
    "src/Dashboard.tsx",
    "import { addDays, formatDateShort, localDate, scheduleWeekStart } from './portalUtils';",
    "import { addDays, formatDateShort, localDate, scheduleWeekStart } from './portalUtils';\nimport { READYOPS_LOGO_DATA_URI } from './brand';",
)
replace_once(
    "src/Dashboard.tsx",
    "      <header className=\"bg-white border-b border-gray-200 shadow-sm sticky top-0 z-30\">",
    "      <header className=\"readyops-brand-header border-b shadow-sm sticky top-0 z-30\">",
)
replace_once(
    "src/Dashboard.tsx",
    "            <div className=\"w-9 h-9 bg-gradient-to-br from-blue-500 to-blue-700 rounded-xl flex items-center justify-center\">\n              <Calendar className=\"text-white\" size={18} />\n            </div>\n            <div>\n              <h1 className=\"text-lg font-bold text-gray-900 leading-tight\">Ready Ops</h1>\n              <p className=\"text-xs text-gray-500\">",
    "            <img src={READYOPS_LOGO_DATA_URI} alt=\"ReadyOps\" className=\"readyops-brand-logo-sm\" />\n            <div className=\"border-l border-white/15 pl-3\">\n              <h1 className=\"text-sm font-bold text-white leading-tight\">Operations Dashboard</h1>\n              <p className=\"readyops-brand-subtitle text-xs\">",
)

# Manager dashboard branding.
replace_once(
    "src/ManagerDashboard.tsx",
    "import { buildReadyModeBookingLink, copyText, rpcError } from './portalUtils';",
    "import { buildReadyModeBookingLink, copyText, rpcError } from './portalUtils';\nimport { READYOPS_LOGO_DATA_URI } from './brand';",
)
replace_once(
    "src/ManagerDashboard.tsx",
    "      <header className=\"sticky top-0 z-30 border-b border-slate-200 bg-white\">",
    "      <header className=\"readyops-brand-header sticky top-0 z-30 border-b\">",
)
replace_once(
    "src/ManagerDashboard.tsx",
    "          <div>\n            <p className=\"text-xs font-bold uppercase tracking-[0.18em] text-blue-600\">Ready Ops Manager</p>\n            <h1 className=\"text-xl font-bold\">{data?.team?.name || 'Manager Dashboard'}</h1>\n            {data?.team && <p className=\"text-xs text-slate-500\">Team: {data.team.abbreviation}</p>}\n          </div>",
    "          <div className=\"flex items-center gap-4\"><img src={READYOPS_LOGO_DATA_URI} alt=\"ReadyOps\" className=\"readyops-brand-logo-sm\"/><div className=\"border-l border-white/15 pl-4\"><p className=\"readyops-brand-subtitle text-xs font-bold uppercase tracking-[0.18em]\">Manager Dashboard</p><h1 className=\"text-xl font-bold text-white\">{data?.team?.name || 'Manager Dashboard'}</h1>{data?.team && <p className=\"readyops-brand-subtitle text-xs\">Team: {data.team.abbreviation}</p>}</div></div>",
)

# Login branding with the supplied ReadyOps logo.
replace_once(
    "src/LoginPage.tsx",
    "import { ArrowLeft, Calendar, Eye, EyeOff, KeyRound, LogIn, Mail, UserPlus } from 'lucide-react';",
    "import { ArrowLeft, Eye, EyeOff, KeyRound, LogIn, Mail, UserPlus } from 'lucide-react';\nimport { READYOPS_LOGO_DATA_URI } from './brand';",
)
replace_once(
    "src/LoginPage.tsx",
    "          <div className=\"w-16 h-16 bg-gradient-to-br from-blue-400 to-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-xl shadow-blue-500/20\">\n            <Calendar className=\"text-white\" size={32} />\n          </div>\n          <h1 className=\"text-3xl font-bold text-white\">Ready Ops</h1>",
    "          <div className=\"mx-auto mb-5 flex justify-center\"><img src={READYOPS_LOGO_DATA_URI} alt=\"ReadyOps\" className=\"h-auto w-[260px] max-w-full\" /></div>\n          <h1 className=\"sr-only\">Ready Ops</h1>",
)

print('Applied ReadyMode recording privacy UI and ReadyOps branding.')
