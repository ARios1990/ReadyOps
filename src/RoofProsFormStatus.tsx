import {useCallback,useEffect,useRef,useState} from 'react';
import {ExternalLink,FileCheck2} from 'lucide-react';
import {supabase} from './supabase';
import {roofProsHelper, type ManualTicket} from './roofProsHelper';
export const ROOF_PROS_COMPANY_ID='d12e8b8c-fd25-45c0-8d43-9b4aecdcda0c';
const excluded=new Set(['44f9d82b-2247-4185-bae6-44ca6a2aa013','c1fc6f84-4c9f-469e-a036-8d08e7c4b53d','52123081-6cc7-48d0-bad8-8fc96ebf0141','9f158006-8bce-4928-aa13-8c686d00d91a']);
const labels:Record<string,string>={queued:'Waiting for Google Form preparation',preparing:'Preparing Google Form',submitting:'Submitting Google Form',submitted:'Google Form submitted',needs_info:'Details or recording needed',uncertain:'Submission needs review',manual_preparing:'Preparing your manual review form',manual_review:'Ready for you to review and Submit in Google',manual_submitting:'Your Submit was clicked — waiting for Google confirmation'};
type Delivery={id:string;status:string;submitted_at?:string;error_message?:string};
export function RoofProsFormStatus({leadId,companyId,sent,approved}:{leadId:string;companyId:string;sent:boolean;approved:boolean}){
 const [job,setJob]=useState<Delivery|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[message,setMessage]=useState(''),[needsHelper,setNeedsHelper]=useState(false);
 const applicable=companyId===ROOF_PROS_COMPANY_ID;
 const currentLead=useRef(leadId);currentLead.current=leadId;
 const refresh=useCallback(async()=>{
  setLoading(true);
  const {data,error:failure}=await supabase.rpc('roof_pros_form_status',{p_lead_id:leadId,p_retry:false});
  if(currentLead.current!==leadId)return;
  if(failure)setError(failure.message);else setJob(data as Delivery|null);
  setLoading(false);
 },[leadId]);
 useEffect(()=>{setJob(null);setError('');setMessage('');setNeedsHelper(false);if(applicable)void refresh();},[applicable,refresh]);
 useEffect(()=>{if(!applicable)return;const focus=()=>void refresh();window.addEventListener('focus',focus);const interval=window.setInterval(focus,15000);return()=>{window.removeEventListener('focus',focus);clearInterval(interval);};},[applicable,refresh]);
 async function prepare(){
  setBusy(true);setError('');setMessage('');
  try {
   try{await roofProsHelper('ping');setNeedsHelper(false);}catch{setNeedsHelper(true);throw Error('Install the Roof Pros Chrome helper once, then reload ReadyOps.');}
   const {data,error:failure}=await supabase.rpc('roof_pros_manual_prepare',{p_lead_id:leadId});
   if(failure)throw failure;
   await roofProsHelper('prepare',data as ManualTicket);
   setMessage('Google Form opened. The helper will fill the fields and attach the recording. Review everything there and click Submit yourself.');
  }catch(failure){setError(failure instanceof Error?failure.message:String((failure as {message?:string})?.message||failure));}
  finally{setBusy(false);await refresh();}
 }
 async function resume(){setBusy(true);setError('');try{await roofProsHelper('resume',job?.id);}catch(failure){setError(failure instanceof Error?failure.message:'Unable to reopen the original draft.');}finally{setBusy(false);}}
 async function checkHelper(){setBusy(true);setError('');try{const connection=await roofProsHelper('ping');setNeedsHelper(false);setMessage(`Roof Pros helper connected${connection.version?' (version '+connection.version+')':''}. Preparation is available after approval and Send.`);}catch(failure){setNeedsHelper(true);setError(failure instanceof Error?failure.message:'Install the helper, then reload ReadyOps.');}finally{setBusy(false);}}
 if(!applicable)return null;
 const held=job?.status.startsWith('manual_');
 const showPrepare=!excluded.has(leadId)&&(!job||['queued','needs_info'].includes(job.status))&&!job?.error_message?.startsWith('MANUAL_REVIEW_HOLD:');
 const canPrepare=approved&&sent&&showPrepare;
 return <section className="rounded-xl border border-blue-200 bg-blue-50 p-4 md:col-span-2" aria-label="Roof Pros Google Form">
  <h3 className="text-sm font-black text-blue-950">Roof Pros Google Form</h3>
  <p className="mt-1 text-xs font-semibold text-slate-700">{job?labels[job.status]:'Approve and Send this lead, then prepare its form here.'}</p>
  <p className="mt-1 text-xs text-slate-600">Prepare the customer details and matching recording with Telemarketer Name set to Horacio. You review the Google Form and click Submit yourself.</p>
  {job?.submitted_at&&<p className="mt-1 text-xs font-bold text-emerald-800">Submitted {new Date(job.submitted_at).toLocaleString('en-US')}</p>}
  {(error||job?.error_message)&&<p role="alert" className="mt-2 text-xs text-amber-900">{error||job?.error_message}</p>}
  {message&&<p role="status" className="mt-2 text-xs text-blue-900">{message}</p>}
  <div className="mt-3 flex flex-wrap gap-2">
   {showPrepare&&<button type="button" disabled={busy||loading||!canPrepare} onClick={()=>void prepare()} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"><FileCheck2 size={16}/>{busy?'Preparing…':'Prepare Form + Recording'}</button>}
   {held&&<button type="button" disabled={busy} onClick={()=>void resume()} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white"><ExternalLink size={16}/>Open Prepared Form</button>}
   <button type="button" disabled={busy||loading} onClick={()=>void refresh()} className="rounded border bg-white px-3 py-1 text-xs font-bold">Refresh form status</button>
  </div>
  {!approved||!sent?<p className="mt-2 text-xs text-slate-600">Available after QC approval and Send Lead.</p>:null}
  <details className="mt-3 text-xs text-slate-700" open={needsHelper||undefined}><summary className="cursor-pointer font-bold">One-time Chrome helper setup</summary><ol className="mt-2 list-decimal space-y-2 pl-5"><li><a className="font-bold text-blue-700 underline" href="/roof-pros-helper.zip" download>Download the Roof Pros helper</a> and extract the ZIP to a folder you will keep.</li><li>Open Chrome’s Extensions page, turn on Developer mode, choose Load unpacked, and select the extracted folder containing manifest.json.</li><li>Reload ReadyOps in that same Chrome profile. Sign in to Google as mastersreadyservices2025@gmail.com.</li></ol><button type="button" disabled={busy} onClick={()=>void checkHelper()} className="mt-2 rounded border bg-white px-3 py-1 font-bold">Check helper connection</button><p className="mt-2">The helper only prepares the Roof Pros form when you press the button. Codex does not need to be open. Chrome must remain online through your review and Google’s receipt.</p></details>
 </section>;
}
