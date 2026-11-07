import {VERIFIED_FIELDS,type VerifiedDraft,type VerifiedField} from '../supabase/functions/_shared/recordingVerification';
import {formatRoofAge,formatStories,formatTime} from './portalUtils';
import {RecordingVerificationBadge,RecordingVerificationContext} from './RecordingVerificationBadge';
export function RecordingVerificationWorkspace({review,values}:{review:VerifiedDraft;values:Record<string,unknown>}){
 const visibleFields=Object.entries(VERIFIED_FIELDS).filter(([key])=>!['public_adjuster_agreement','conditional_roofing_obligation'].includes(key));
 const display=(key:string)=>values[key]==null||values[key]===''?'—':key==='roof_age'?formatRoofAge(values[key]):key==='stories'?formatStories(values[key]):key==='appointment_time'?formatTime(String(values[key])):String(values[key]);
 const visibleWarnings=review.warnings.filter(warning=>warning.title!=='Inspector Notes Need Review');
 return <RecordingVerificationContext.Provider value={review}><section className="mt-4 space-y-4" aria-label="Recording verification workspace">
  <div className="rounded-xl border border-blue-200 bg-white p-3">
   <h4 className="text-sm font-black text-slate-950">Recording Verification / QC Review</h4>
   <p className="mt-1 text-xs text-slate-600">Recording-supported corrections are pending in the lead form. Review them and use Save Changes. QC approval and Send remain separate.</p>
   {visibleWarnings.length>0&&<ul className="mt-3 space-y-2">{visibleWarnings.map((w,i)=><li key={i} className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-950"><strong>{w.title}:</strong> {w.detail}<details className="mt-1"><summary className="cursor-pointer">Transcript evidence</summary><p className="mt-1 whitespace-pre-wrap">“{w.excerpt}”</p></details></li>)}</ul>}
   <div className="mt-3 grid gap-2 sm:grid-cols-2">{visibleFields.map(([field,label])=><div key={field} className="rounded border border-slate-100 p-2 text-xs"><strong>{label}</strong><p>{display(field)}</p><RecordingVerificationBadge field={field}/></div>)}</div>
   {review.history.length>0&&<details className="mt-3 text-xs"><summary className="cursor-pointer font-bold">Recording correction history ({review.history.length})</summary>{review.history.map((entry,i)=><p key={i} className="mt-1">{VERIFIED_FIELDS[entry.field as VerifiedField]||entry.field}: {entry.before||'blank'} → {entry.after}</p>)}</details>}
  </div>
 </section></RecordingVerificationContext.Provider>;
}
