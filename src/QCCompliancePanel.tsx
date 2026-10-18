import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase';
import { PortalSection } from './PortalSection';
import { complianceRisk, transcriptComplianceCues } from './complianceReview';
import { formatDate } from './dateDisplay';
import { useAuth } from './AuthContext';
type State = { status: string; fingerprint: string; provider?: string; version?: string; refreshed_on?: string; restricted: boolean; internal_opt_out: boolean; duplicate_count: number; review?: {decision: string; evidence: string; expires_at: string; override_restriction?: boolean} };
const styles: Record<string,string>={match:'text-red-700 bg-red-50',not_found:'text-green-700 bg-green-50',failed:'text-orange-700 bg-orange-50',not_checked:'text-slate-600 bg-slate-100'};
const labels: Record<string,string>={match:'DNC MATCH',not_found:'NOT FOUND ON DNC DATASET',failed:'DNC CHECK FAILED',not_checked:'NOT CHECKED'};
export function QCCompliancePanel({leadId,phone,qcStatus}:{leadId:string;phone:string;qcStatus:string}) {
 const {profile}=useAuth(); const isAdmin=profile?.role==='admin';
 const [state,setState]=useState<State|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[evidence,setEvidence]=useState(''),[source,setSource]=useState(''),[override,setOverride]=useState(false),[transcript,setTranscript]=useState(''),[copyMessage,setCopyMessage]=useState(''),[showOverride,setShowOverride]=useState(false),[notice,setNotice]=useState('');
 const load=useCallback(async()=>{setBusy(true);setError('');try{const {data,error}=await supabase.rpc('qc_dnc_check',{p_lead_id:leadId});if(error)throw error;setState(data as State);const t=await supabase.from('qc_lead_transcripts').select('transcript').eq('lead_id',leadId).maybeSingle();if(t.error)throw t.error;setTranscript(t.data?.transcript||'');}catch(e){setState(null);setError(e instanceof Error?e.message:String((e as {message?:string}).message||e));}finally{setBusy(false);}},[leadId,phone]);
 useEffect(()=>{void load();},[load]);
 useEffect(()=>{setEvidence('');setSource('');setOverride(false);setShowOverride(false);setNotice('');setCopyMessage('');},[leadId]);
 const cues=transcriptComplianceCues(transcript),risk=complianceRisk(cues,state?.restricted??true);
 async function openManualCheck(){
  let number=phone.replace(/\D/g,'');if(number.length===11&&number.startsWith('1'))number=number.slice(1);
  if(!/^[2-9]\d{9}$/.test(number)){setCopyMessage('Correct the phone number before checking.');return;}
  // Open in the click gesture so popup protection does not block it. Never put
  // customer numbers in an undocumented third-party URL or submit a search.
  const tab=window.open('https://www.freednclist.com/','_blank','noopener,noreferrer');
  void tab;
  try{await navigator.clipboard.writeText(number);setCopyMessage('Number copied. Paste into FreeDNCList and run the check there. Opening the site does not mark this lead checked.');}
  catch{setCopyMessage(`Clipboard unavailable. Copy this number manually: ${number}`);}
 }
 async function action(optOut=false,decision='clear',adminOverride=override) {if(!state)return;setBusy(true);setError('');setNotice('');try{const r=await supabase.rpc(optOut?'qc_record_opt_out':'qc_dnc_review',optOut?{p_lead_id:leadId,p_reason:evidence}:{p_lead_id:leadId,p_fingerprint:state.fingerprint,p_decision:decision,p_evidence:evidence,p_source:source,p_override:adminOverride,p_findings:cues});if(r.error)throw r.error;await load();if(adminOverride&&decision==='clear'&&!optOut){setNotice('Admin override saved. You can continue QC approval, then use Send Lead to Company.');setShowOverride(false);}}catch(e){setError(e instanceof Error?e.message:String((e as {message?:string}).message||e));}finally{setBusy(false);}}
 return <section className="mb-4 rounded-xl border border-blue-200 bg-white p-4 text-sm">
  <div className="flex flex-wrap gap-2 text-xs font-bold"><span className={`rounded px-2 py-1 ${styles[state?.status||'failed']}`}>{labels[state?.status||'failed']}</span><span>{risk}</span><span>QC: {qcStatus}</span></div>
  <div className="my-3"><button type="button" onClick={()=>void openManualCheck()} className="rounded-lg border border-blue-300 px-3 py-2 text-sm font-bold text-blue-700">Copy Number &amp; Open FreeDNCList ↗</button><p role="status" className="mt-1 text-xs text-slate-600">{copyMessage||'Manual website check. The result must be reviewed and recorded separately.'}</p></div>
  {error&&<p role="alert" className="my-2 text-orange-700">{error}</p>}
  {notice&&<p role="status" className="my-2 font-bold text-green-700">{notice}</p>}
  {state&&!state.restricted&&state.review?.override_restriction&&<p className="my-2 rounded-lg bg-blue-50 p-3 font-bold text-blue-900">Admin override active — QC approval and sending are available. The original lookup result remains recorded.</p>}
  {isAdmin&&state?.restricted&&<div className="my-3 rounded-lg border border-amber-300 bg-amber-50 p-3">
   <p className="font-bold text-amber-950">DNC advisory — Admin sending available</p>
   <p className="mt-1 text-xs text-amber-900">This warning does not block Admin approval or Send Lead to Company. You may optionally record reviewed evidence below. The original DNC result stays visible.</p>
   <button type="button" disabled={busy} aria-expanded={showOverride} onClick={()=>setShowOverride(!showOverride)} className="mt-2 rounded-lg bg-blue-700 px-3 py-2 font-bold text-white disabled:opacity-40">Record Optional Compliance Review</button>
   {showOverride&&<div className="mt-3">
    <label className="block text-xs font-bold">Reason and reviewed evidence (at least 20 characters)<textarea aria-label="Admin override reason and evidence" className="mt-1 w-full rounded-lg border p-2 text-slate-900" value={evidence} onChange={e=>setEvidence(e.target.value)}/></label>
    <label className="mt-2 block text-xs font-bold">Evidence reference (at least 5 characters)<input aria-label="Admin override evidence reference" placeholder="Recording timestamp or document reference" className="mt-1 w-full rounded-lg border p-2 text-slate-900" value={source} onChange={e=>setSource(e.target.value)}/></label>
    <button type="button" disabled={busy||evidence.trim().length<20||source.trim().length<5} onClick={()=>void action(false,'clear',true)} className="mt-3 rounded-lg bg-blue-700 px-3 py-2 font-bold text-white disabled:opacity-40">Save Admin Override</button>
   </div>}
  </div>}
  <PortalSection title="Compliance Evidence — Show / Hide">
   <p className="text-xs text-slate-600">Imported data only. A negative lookup is not permission to call. {state?.restricted?'Compliance clearance required.':'Documented reviewer clearance on file.'}</p>
   <dl className="my-3 grid gap-1 text-xs"><div>Provider: {state?.provider||'No dataset covering this number'}</div><div>Version: {state?.version||'—'} · Dataset refreshed: {state?.refreshed_on?formatDate(state.refreshed_on):'—'}</div><div>Internal opt-out: {state?.internal_opt_out?'Yes':'No recorded request'} · Other matching leads: {state?.duplicate_count??'—'}</div><div>Transcript: {transcript?'Available':'Unavailable — review recording and consent evidence'}</div></dl>
   <p className="text-xs font-bold">Transcript review cues (rules-based; advisory only)</p><p className="text-xs text-slate-500">Confidence describes a wording match, not intent or legal compliance. Review the recording, homeowner authority, appointment and address before clearance.</p>
   {cues.map((c,i)=><div key={i} className="my-2 rounded border border-amber-200 bg-amber-50 p-2 text-xs"><strong>{c.label} · {c.confidence}{c.timestamp?` · ${c.timestamp}`:''}</strong><blockquote className="my-1 whitespace-pre-wrap">{c.excerpt}</blockquote><p>{c.explanation}</p></div>)}
   <textarea aria-label="Compliance evidence and reviewer notes" placeholder="Confirmed consent evidence, homeowner/appointment/address review, final decision and reason (minimum 20 characters)" className="mt-3 w-full rounded-lg border p-2" value={evidence} onChange={e=>setEvidence(e.target.value)}/>
   <input aria-label="Consent evidence source" placeholder="Evidence source / recording timestamp / document reference" className="my-2 w-full rounded-lg border p-2" value={source} onChange={e=>setSource(e.target.value)}/>
   {isAdmin&&<label className="block text-xs"><input type="checkbox" checked={override} onChange={e=>setOverride(e.target.checked)}/> Authorized exception: documented applicable grounds and approval. Original finding remains visible.</label>}
   <div className="mt-3 flex flex-wrap gap-2"><button disabled={busy} onClick={()=>void load()} className="rounded-lg border px-3 py-2">Recheck</button><button disabled={busy||evidence.trim().length<20||source.trim().length<5} onClick={()=>void action()} className="rounded-lg bg-blue-600 px-3 py-2 font-bold text-white disabled:opacity-40">Save reviewed clearance</button><button disabled={busy||evidence.trim().length<5} onClick={()=>void action(true)} className="rounded-lg bg-red-700 px-3 py-2 font-bold text-white disabled:opacity-40">Record Do Not Contact</button><button disabled={busy||evidence.trim().length<20||source.trim().length<5} onClick={()=>void action(false,'restricted')} className="rounded-lg border px-3 py-2">Keep restricted</button></div>
   <p className="mt-2 text-xs text-slate-500">Clearance expires after 24 hours and is invalidated by phone, dataset, suppression or transcript changes.</p>
  </PortalSection>
 </section>;
}
