import {useEffect,useRef,useState} from 'react';
import {ClipboardCopy,RefreshCw} from 'lucide-react';
import {VERIFIED_FIELDS,type VerifiedDraft,type VerifiedField} from '../supabase/functions/_shared/recordingVerification';
import {appointmentLabel} from './appointmentQualifiers';
import {formatRoofAge,formatStories,formatTime} from './portalUtils';
import {RecordingVerificationBadge,RecordingVerificationContext} from './RecordingVerificationBadge';
export type AppointmentSummaryDraft={lead_id:string;notes:string;qc_note:string;generated_notes:string;generated_qc_note:string};
export function RecordingVerificationWorkspace({leadId,review,values,savedDraft,onDraftChange,onRegenerate,busy}:{
 leadId:string;review:VerifiedDraft;values:Record<string,unknown>;savedDraft?:AppointmentSummaryDraft;
 onDraftChange?:(draft:AppointmentSummaryDraft)=>void;onRegenerate:()=>void;busy:boolean;
}){
 const [draft,setDraft]=useState<AppointmentSummaryDraft>(()=>savedDraft?.lead_id===leadId?savedDraft:{lead_id:leadId,notes:'',qc_note:'',generated_notes:'',generated_qc_note:''});
 const changeRef=useRef(onDraftChange);changeRef.current=onDraftChange;
 const [copyStatus,setCopyStatus]=useState('');
 const source=JSON.stringify(review.verification);
 const warnings=review.warnings.map(w=>`${w.title}: ${w.detail}`).join('\n');
 useEffect(()=>{
  const old=draft.lead_id===leadId?draft:savedDraft?.lead_id===leadId?savedDraft:undefined;
  const generatedNotes=review.verification.notes;
  const next={lead_id:leadId,generated_notes:generatedNotes,generated_qc_note:warnings,
   notes:old&&old.notes!==old.generated_notes?old.notes:generatedNotes,
   qc_note:old&&old.qc_note!==old.generated_qc_note?old.qc_note:warnings};
  setDraft(next);changeRef.current?.(next);
  // Current manual text is intentionally preserved when new analysis arrives.
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[leadId,source]);
 function edit(patch:Partial<AppointmentSummaryDraft>){const next={...draft,...patch};setDraft(next);onDraftChange?.(next);}
 const visibleFields=Object.entries(VERIFIED_FIELDS).filter(([key])=>!['public_adjuster_agreement','conditional_roofing_obligation'].includes(key));
 const display=(key:string)=>values[key]==null||values[key]===''?'—':key==='roof_age'?formatRoofAge(values[key]):key==='stories'?formatStories(values[key]):key==='appointment_time'?formatTime(String(values[key])):String(values[key]);
 const fullSummary=[
  'Roofing Appointment Summary','Customer Information',`App Date & Time: ${appointmentLabel(values)||'—'}`,
  ...[['full_name','Name'],['contact_name','Actual Contact'],['contact_role','Contact Role'],['phone_number','Phone'],['address','Address'],['email','Email'],['language','Language'],['service_needed','Services Need']]
   .filter(([key])=>!['contact_name','contact_role'].includes(key)||values[key]).map(([key,label])=>`${label}: ${display(key)}`),
  'Property Details',...visibleFields.filter(([key])=>!['full_name','address','language','contact_name','contact_role','appointment_date','appointment_time'].includes(key))
   .map(([key,label])=>`${label}: ${display(key)}`),
  ...[['home_value','Home Value'],['sq_ft','SQ FT'],['web_url','Web Link']].map(([key,label])=>`${label}: ${display(key)}`),
  `Notes: ${draft.notes}`,draft.qc_note?`QC Note: ${draft.qc_note}`:'',
 ].filter(Boolean).join('\n');
 const copy=async(text:string)=>{try{await navigator.clipboard.writeText(text);setCopyStatus('Copied to clipboard.');}catch{setCopyStatus('Clipboard access is unavailable. Select the text to copy it.');}};
 return <RecordingVerificationContext.Provider value={review}><section className="mt-4 space-y-4" aria-label="Recording verification workspace">
  <div className="rounded-xl border border-blue-200 bg-white p-3">
   <h4 className="text-sm font-black text-slate-950">Recording Verification / QC Review</h4>
   <p className="mt-1 text-xs text-slate-600">Recording-supported corrections are pending in the lead form. Review them and use Save Changes. QC approval and Send remain separate.</p>
   {review.warnings.length>0&&<ul className="mt-3 space-y-2">{review.warnings.map((w,i)=><li key={i} className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-950"><strong>{w.title}:</strong> {w.detail}<details className="mt-1"><summary className="cursor-pointer">Transcript evidence</summary><p className="mt-1 whitespace-pre-wrap">“{w.excerpt}”</p></details></li>)}</ul>}
   <div className="mt-3 grid gap-2 sm:grid-cols-2">{visibleFields.map(([field,label])=><div key={field} className="rounded border border-slate-100 p-2 text-xs"><strong>{label}</strong><p>{display(field)}</p><RecordingVerificationBadge field={field}/></div>)}</div>
   {review.history.length>0&&<details className="mt-3 text-xs"><summary className="cursor-pointer font-bold">Recording correction history ({review.history.length})</summary>{review.history.map((entry,i)=><p key={i} className="mt-1">{VERIFIED_FIELDS[entry.field as VerifiedField]||entry.field}: {entry.before||'blank'} → {entry.after}</p>)}</details>}
  </div>
  <div className="rounded-xl border border-blue-200 bg-white p-3">
   <h4 className="text-sm font-black text-slate-950">Roofing Appointment Summary</h4>
   <p className="mt-1 text-xs text-slate-600">Edit or copy these separately. Generated narrative does not overwrite the original lead Notes.</p>
   <p className="mt-2 text-xs"><strong>App Date &amp; Time:</strong> {appointmentLabel(values)||'—'}<br/><strong>Name:</strong> {String(values.full_name||'—')}<br/><strong>Actual Contact:</strong> {String(values.contact_name||values.full_name||'—')}<br/><strong>Language:</strong> {String(values.language||'—')}</p>
   <label className="mt-3 block text-xs font-bold">Notes<textarea aria-label="Professional appointment Notes" value={draft.notes} onChange={e=>edit({notes:e.target.value})} className="mt-1 min-h-32 w-full rounded-lg border border-slate-200 p-2 text-xs font-normal leading-5"/></label>
   <label className="mt-3 block text-xs font-bold">QC Note<textarea aria-label="Appointment QC Note" value={draft.qc_note} onChange={e=>edit({qc_note:e.target.value})} className="mt-1 min-h-20 w-full rounded-lg border border-slate-200 p-2 text-xs font-normal leading-5"/></label>
   <div className="mt-2 flex flex-wrap gap-2">{[['Copy Full Summary',fullSummary],['Copy Notes Only',draft.notes],['Copy QC Note',draft.qc_note]].map(([label,text])=><button key={label} type="button" onClick={()=>copy(text)} className="inline-flex items-center gap-1 rounded-lg border px-2 py-1.5 text-xs font-bold"><ClipboardCopy size={12}/>{label}</button>)}
    <button type="button" disabled={busy} onClick={onRegenerate} className="inline-flex items-center gap-1 rounded-lg border px-2 py-1.5 text-xs font-bold"><RefreshCw size={12}/>Regenerate Summary</button>
    <button type="button" onClick={()=>edit({notes:draft.generated_notes,qc_note:draft.generated_qc_note})} className="rounded-lg border px-2 py-1.5 text-xs font-bold">Reset to Generated</button>
   </div>
   {copyStatus&&<p role="status" className="mt-2 text-xs text-slate-600">{copyStatus}</p>}
  </div>
 </section></RecordingVerificationContext.Provider>;
}
