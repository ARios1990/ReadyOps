import {useEffect,useState} from 'react';
import {supabase} from './supabase';
export const ROOF_PROS_COMPANY_ID='d12e8b8c-fd25-45c0-8d43-9b4aecdcda0c';
const labels:Record<string,string>={queued:'Queued for Google Form',preparing:'Preparing Google Form',submitting:'Submitting Google Form',submitted:'Google Form submitted',needs_info:'Details or recording needed',uncertain:'Submission needs review'};
type Delivery={status:string;submitted_at?:string;error_message?:string};
export function RoofProsFormStatus({leadId,companyId,sent}:{leadId:string;companyId:string;sent:boolean}){
 const [job,setJob]=useState<Delivery|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const applicable=companyId===ROOF_PROS_COMPANY_ID;
 async function refresh(retry=false){
  setBusy(true);setError('');
  const {data,error:failure}=await supabase.rpc('roof_pros_form_status',{p_lead_id:leadId,p_retry:retry});
  if(failure)setError(failure.message);else setJob(data as Delivery|null);
  setBusy(false);
 }
 useEffect(()=>{if(applicable)void refresh();},[leadId,applicable]);
 if(!applicable)return null;
 return <section className="rounded-xl border border-blue-200 bg-blue-50 p-4 md:col-span-2" aria-label="Roof Pros Google Form">
  <h3 className="text-sm font-black text-blue-950">Roof Pros Google Form</h3>
  <p className="mt-1 text-xs text-slate-700">{job?labels[job.status]:'Queued automatically after QC approval and Send Lead.'}</p>
  <p className="mt-1 text-xs text-slate-600">One submission per lead, including its recording. Processing requires the signed-in Google browser worker and an awake computer.</p>
  {job?.submitted_at&&<p className="mt-1 text-xs font-bold text-emerald-800">Submitted {new Date(job.submitted_at).toLocaleString('en-US')}</p>}
  {(error||job?.error_message)&&<p role="alert" className="mt-2 text-xs text-amber-900">{error||job?.error_message}</p>}
  <div className="mt-2 flex gap-2"><button type="button" disabled={busy} onClick={()=>void refresh()} className="rounded border bg-white px-3 py-1 text-xs font-bold">Refresh form status</button>
  {sent&&(!job||job.status==='needs_info')&&<button type="button" disabled={busy} onClick={()=>void refresh(true)} className="rounded bg-blue-600 px-3 py-1 text-xs font-bold text-white">{job?'Retry after correcting details':'Queue Google Form'}</button>}</div>
 </section>;
}
