import {createContext,useContext} from 'react';
import type {VerifiedDraft,VerifiedField} from '../supabase/functions/_shared/recordingVerification';
export const RecordingVerificationContext=createContext<VerifiedDraft|undefined>(undefined);
export function RecordingVerificationBadge({field}:{field:string}){
 const review=useContext(RecordingVerificationContext);
 if(!review)return null;
 const finding=review.findings[field as VerifiedField]||{status:'lead_only'};
 const labels={confirmed:'Recording Confirmed',review:'Needs Review',lead_only:'Lead Data Only',mismatch:'Mismatch Detected'};
 const tones={confirmed:'border-green-200 bg-green-50 text-green-800',review:'border-amber-200 bg-amber-50 text-amber-900',lead_only:'border-blue-200 bg-blue-50 text-blue-700',mismatch:'border-red-200 bg-red-50 text-red-800'};
 return <span className="block text-[10px] font-normal"><details className="inline-block max-w-full align-middle">
  <summary className={`cursor-pointer rounded border px-1.5 py-0.5 ${tones[finding.status]}`}>{labels[finding.status]}{finding.updated?` · Updated from ${finding.original||'blank'}`:''}</summary>
  <span className="block whitespace-pre-wrap rounded border border-slate-200 bg-white p-2 text-xs text-slate-700">{finding.detail||''}{finding.excerpt?`\n“${finding.excerpt}”`:'Not established by this recording.'}{finding.timestamp!=null?` · ${finding.timestamp}s`:''}</span>
 </details></span>;
}
