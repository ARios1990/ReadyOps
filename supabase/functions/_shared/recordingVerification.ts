// Shared by the Edge assessment and QC draft editor. No lead writes happen here.
export const VERIFIED_FIELDS = {
 roof_age:'Roof Age',home_type:'Home Type',roof_type:'Roof Type',stories:'Stories',insurance:'Insurance',
 insurance_name:'Insurance Name',contract:'Roofing Contract',visible_damage:'Visible Damage',damage_type:'Damage Type',
 claim_filed:'Claim Filed',appointment_date:'Appointment Date',appointment_time:'Appointment Time',
 homeowner_authority:'Homeowner Status',address:'Property Address',full_name:'Customer Name',language:'Language',
 contact_name:'Actual Contact',contact_role:'Contact Role',public_adjuster_agreement:'Public Adjuster Agreement',
 conditional_roofing_obligation:'Conditional Roofing Obligation',
} as const;
export type VerifiedField=keyof typeof VERIFIED_FIELDS;
export type Observation={field:VerifiedField;value:string;certainty:'confirmed'|'approximate'|'uncertain'|'conflicting';
 confidence:'high'|'medium'|'low';excerpt:string;speaker:'customer'|'both'|'agent'|'unknown';
 basis:'explicit'|'customer_speech'|'relative_date'|'unknown';timestamp:number|null};
export type VerificationWarning={title:string;detail:string;excerpt:string};
export type RecordingVerification={version:1;lead_id:string;recording_url:string;transcript_key:string;
 observations:Observation[];warnings:VerificationWarning[];notes:string;contract_kind:string;original_speech:boolean};
export type FieldFinding={status:'confirmed'|'review'|'lead_only'|'mismatch';excerpt?:string;timestamp?:number|null;
 original?:string;value?:string;updated?:boolean;detail?:string};
export type VerifiedDraft={verification:RecordingVerification;findings:Partial<Record<VerifiedField,FieldFinding>>;
 warnings:VerificationWarning[];history:{field:string;before:string;after:string;excerpt:string;recording_url:string}[]};
export const verificationSchema={type:'object',additionalProperties:false,properties:{
 observations:{type:'array',items:{type:'object',additionalProperties:false,properties:{
  field:{type:'string',enum:Object.keys(VERIFIED_FIELDS)},value:{type:'string'},
  certainty:{type:'string',enum:['confirmed','approximate','uncertain','conflicting']},
  confidence:{type:'string',enum:['high','medium','low']},excerpt:{type:'string'},
  speaker:{type:'string',enum:['customer','both','agent','unknown']},
  basis:{type:'string',enum:['explicit','customer_speech','relative_date','unknown']},
 },required:['field','value','certainty','confidence','excerpt','speaker','basis']}},
 warnings:{type:'array',items:{type:'object',additionalProperties:false,properties:{title:{type:'string'},detail:{type:'string'},excerpt:{type:'string'}},required:['title','detail','excerpt']}},
 notes:{type:'string'},notes_evidence:{type:'array',items:{type:'string'}},
 contract_kind:{type:'string',enum:['none','roofing_company','public_adjuster','conditional_roofing','multiple_estimates','nonperforming_contractor','unknown']},
},required:['observations','warnings','notes','notes_evidence','contract_kind']};
export const verificationInstructions=[
 'Also produce recording_verification. Extract the final customer-confirmed value for each discussed field; omit unmentioned fields.',
 'Every observation and warning must include an EXACT contiguous transcript excerpt with enough context to identify the customer confirmation. Never use lead data or an agent question as proof.',
 'Use high confidence and confirmed only for clear customer statements or an agent read-back the customer explicitly accepts. Agent-only or unclear speaker evidence is review-only.',
 'Use existing form vocabulary where possible: insurance/contract/claim_filed/public_adjuster_agreement/conditional_roofing_obligation Yes or No; visible_damage Yes or None reported; homeowner_authority Homeowner, Authorized decision-maker, Neither, Unsure.',
 'Home types: Single Family Home, Town Home, Multifamily Home, Commercial, Mobile Home, or an explicitly stated custom type. Roof types: Shingle, Metal, Tile, Flat, Wood, or the stated custom type. Preserve approximate roof ages as approximately N or a stated range; never turn an estimate into an exact age.',
 'Identify actual contact_name/contact_role separately. A spouse, tenant, family member or property manager is not automatically the named homeowner. Do not infer authority.',
 'Distinguish signed roofing-company contracts from public-adjuster agreements, conditional partner-roofer obligations, unsigned estimates and contractors who failed to perform. A public-adjuster agreement alone is not proof of a signed roofing-company contract, nor proof there are no restrictions. Warn about supported restrictions without making legal conclusions.',
 'Flag only real supported issues: identity or property conflicts, unclear final appointment, prior no-show, existing contractor/adjuster restrictions, missing homeowner, required courtesy call, insurance conflict or inspector language request. No generic missing-data warnings.',
 'Appointment dates must be YYYY-MM-DD and final appointment time HH:mm in the property local timezone. Resolve relative dates ONLY with a supplied actual recording date and property timezone; without both, use uncertain and do not guess. Never use today, server time, upload time or lead creation time as a call date. Flag multiple unresolved appointment times.',
 'For language, explicit customer preference takes precedence: a request for a Spanish-speaking inspector means Spanish even if the call was in English. Bilingual requires clear comfort and willingness in BOTH English and Spanish, never a greeting or a few borrowed words. Never infer language from name, accent, ethnicity, location or only the agent speech. If original_speech is false, customer_speech alone is insufficient; only explicit customer preference can verify language.',
 'Write notes as one concise professional paragraph focused on the actual contact, inspection, supported roof/damage facts, estimates or contractors, final confirmed appointment, availability and customer requests. Do not copy lead notes as confirmed facts. Include notes_evidence quoting each supporting transcript passage. Keep review warnings out of the notes paragraph; they belong in warnings. Never invent timestamps.',
].join(' ');
export function transcriptKey(text:string):string{
 // Cache identity only; never used as an authentication or permission check.
 let hash=2166136261;for(let i=0;i<text.length;i++)hash=Math.imul(hash^text.charCodeAt(i),16777619);
 return `${text.length}:${hash>>>0}`;
}
const normalize=(text:unknown)=>String(text??'').normalize('NFKC').toLowerCase().replace(/[“”]/g,'"').replace(/[‘’]/g,"'").replace(/\s+/g,' ').trim();
const supported=(quote:unknown,transcript:string)=>typeof quote==='string'&&quote.trim().length>=4&&normalize(transcript).includes(normalize(quote));
function recordingDay(recordedAt?:string,timezone?:string):string{
 if(!recordedAt||!timezone)return '';
 try{
  new Intl.DateTimeFormat('en-US',{timeZone:timezone});
  if(/^\d{4}-\d{2}-\d{2}$/.test(recordedAt)){
   const parsed=new Date(recordedAt+'T12:00:00Z');return Number.isNaN(parsed.valueOf())||parsed.toISOString().slice(0,10)!==recordedAt?'':recordedAt;
  }
  if(!/^\d{4}-\d{2}-\d{2}T/.test(recordedAt)||!/(?:Z|[+-]\d{2}:\d{2})$/.test(recordedAt))return '';
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(recordedAt));
  return ['year','month','day'].map(type=>parts.find(p=>p.type===type)?.value).join('-');
 }catch{return '';}
}
function relativeDate(quote:string,anchor:string):string{
 const text=normalize(quote);let offset:number|undefined;
 if(/\b(last|previous|past|pasado|pasada)\b/.test(text))return '';
 const days=['sunday|domingo','monday|lunes','tuesday|martes','wednesday|miércoles|miercoles','thursday|jueves','friday|viernes','saturday|sábado|sabado'];
 const mentioned=days.map((day,index)=>new RegExp(`\\b(${day})\\b`).test(text)?index:-1).filter(index=>index>=0);
 if(mentioned.length>1)return '';
 if(/\b(tomorrow|mañana)\b/.test(text))offset=1;
 else if(/\b(today|hoy)\b/.test(text))offset=0;
 else{
  const target=mentioned[0]??-1;
  if(target>=0){offset=(target-new Date(anchor+'T12:00:00Z').getUTCDay()+7)%7;if(offset===0)return '';}
 }
 if(offset===undefined)return '';
 const result=new Date(new Date(anchor+'T12:00:00Z').getTime()+offset*86400000);
 if(mentioned.length&&mentioned[0]!==result.getUTCDay())return '';
 return result.toISOString().slice(0,10);
}
export function normalizeVerification(raw:unknown,context:{leadId:string;recordingUrl:string;transcript:string;originalSpeech:boolean;recordedAt?:string;timezone?:string}):RecordingVerification{
 const input=(raw&&typeof raw==='object'?raw:{}) as Record<string,unknown>;
 const anchor=recordingDay(context.recordedAt,context.timezone);
 const observations:Observation[]=[];
 for(const item of Array.isArray(input.observations)?input.observations:[]){
  if(!item||!Object.prototype.hasOwnProperty.call(VERIFIED_FIELDS,item.field)||!supported(item.excerpt,context.transcript)||typeof item.value!=='string'||!item.value.trim())continue;
  const obs={...item,value:item.value.trim().slice(0,1500),timestamp:null} as Observation;
  if(!['confirmed','approximate','uncertain','conflicting'].includes(obs.certainty))obs.certainty='uncertain';
  if(obs.certainty==='approximate'&&obs.field!=='roof_age')obs.certainty='uncertain';
  if(!['high','medium','low'].includes(obs.confidence))obs.confidence='low';
  if(!['customer','both'].includes(obs.speaker))obs.certainty='uncertain';
  if(obs.basis==='unknown')obs.certainty='uncertain';
  if(obs.field==='contract'&&['public_adjuster','conditional_roofing'].includes(String(input.contract_kind)))obs.certainty='uncertain';
  if(obs.field==='language'&&(!['English','Spanish','Bilingual'].includes(obs.value)||
   (!context.originalSpeech&&obs.basis!=='explicit')))obs.certainty='uncertain';
  if(obs.field==='language'&&obs.value==='Bilingual'&&!/\bbilingual\b|\b(?:both|either)\b.*\b(?:english|spanish)\b|\b(?:ambos|cualquiera)\b.*\b(?:idiomas|inglés|ingles|español)\b/i.test(obs.excerpt))obs.certainty='uncertain';
  if(obs.field==='appointment_date'&&obs.basis==='relative_date'){
   const resolved=anchor?relativeDate(obs.excerpt,anchor):'';
   if(!resolved)obs.certainty='uncertain';else obs.value=resolved;
  }
  if(obs.field==='appointment_date'){
   const date=new Date(obs.value+'T00:00:00Z');
   if(!/^\d{4}-\d{2}-\d{2}$/.test(obs.value)||Number.isNaN(date.valueOf())||date.toISOString().slice(0,10)!==obs.value)obs.certainty='uncertain';
   if(!/\b(?:19|20)\d{2}\b/.test(obs.excerpt)&&!anchor)obs.certainty='uncertain';
  }
  if(obs.field==='appointment_time'&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(obs.value))obs.certainty='uncertain';
  if(['insurance','contract','claim_filed','public_adjuster_agreement','conditional_roofing_obligation'].includes(obs.field)&&!['Yes','No'].includes(obs.value))obs.certainty='uncertain';
  if(obs.field==='roof_age'&&!/^(?:~?\d+(?:\+|-\d+)?|(?:approximately|about|around|approx\.?)\s*\d+)(?:\s*years?)?$/i.test(obs.value))obs.certainty='uncertain';
  // Multiple contradictory candidates without a single final answer are held.
  const prior=observations.find(x=>x.field===obs.field);
  if(prior){if(normalize(prior.value)!==normalize(obs.value)){prior.certainty='conflicting';obs.certainty='conflicting';}else continue;}
  observations.push(obs);
 }
 const warnings:VerificationWarning[]=(Array.isArray(input.warnings)?input.warnings:[])
  .filter(w=>w&&typeof w.title==='string'&&typeof w.detail==='string'&&supported(w.excerpt,context.transcript))
  .map(w=>({title:w.title.slice(0,100),detail:w.detail.slice(0,1500),excerpt:w.excerpt.slice(0,2000)}));
 const noteQuotes=Array.isArray(input.notes_evidence)?input.notes_evidence:[];
 const notes=typeof input.notes==='string'&&noteQuotes.length&&noteQuotes.every(q=>supported(q,context.transcript))?input.notes.replace(/\s+/g,' ').trim().slice(0,8000):'';
 return {version:1,lead_id:context.leadId,recording_url:context.recordingUrl,transcript_key:transcriptKey(context.transcript),
  observations,warnings,notes,contract_kind:String(input.contract_kind||'unknown'),original_speech:context.originalSpeech};
}
function addressKey(value:string){
 const replacements:Record<string,string>={street:'st',drive:'dr',place:'pl',road:'rd',avenue:'ave',boulevard:'blvd',lane:'ln',court:'ct',circle:'cir',terrace:'ter',north:'n',south:'s',east:'e',west:'w'};
 return normalize(value).replace(/[.,#]/g,' ').replace(/\b\w+\b/g,w=>replacements[w]||w).replace(/\s+/g,' ').trim();
}
export function applyVerifiedFields(current:Record<string,unknown>,verification:RecordingVerification):{values:Record<string,unknown>;draft:VerifiedDraft}{
 const values={...current};
 const prior=current._qc_recording_review as VerifiedDraft|undefined;
 const history=[...(prior?.history||(current._qc_recording_history as VerifiedDraft['history'])||[])];
 const findings:VerifiedDraft['findings']={};const warnings=[...verification.warnings];
 const manual=new Set((Array.isArray(current._qc_manual_fields)?current._qc_manual_fields:[]) as string[]);
 for(const field of Object.keys(VERIFIED_FIELDS) as VerifiedField[])findings[field]={status:'lead_only'};
 const addWarning=(title:string,detail:string,excerpt:string)=>{if(!warnings.some(w=>w.title===title&&w.detail===detail))warnings.push({title,detail,excerpt});};
 for(const observation of verification.observations){
  const {field,excerpt}=observation;const before=String(current[field]??'');
  let after=field==='roof_age'?observation.value.replace(/^(?:approximately|approx\.?|about|around)\s*(\d+)/i,'~$1').replace(/\s*years?$/i,'').trim():observation.value;
  if(field==='roof_age'&&observation.certainty==='approximate'&&/^\d+$/.test(after))after='~'+after;
  const identity=['full_name','address'].includes(field);
  const same=field==='address'?addressKey(before)===addressKey(after):normalize(before)===normalize(after);
  const finding:FieldFinding={status:'confirmed',excerpt,timestamp:observation.timestamp,original:before,value:after};
  if(observation.confidence!=='high'||!['confirmed','approximate'].includes(observation.certainty)){
   finding.status='review';finding.detail='The recording does not establish a clear final value.';
  }else if(field==='address'&&!same&&addressKey(before).startsWith(addressKey(after)+' ')){
   finding.status='review';finding.detail='Only part of the existing address was confirmed.';
  }else if(identity&&!same){
   finding.status='mismatch';finding.detail='Verify the correct identity or property before changing this field.';
   addWarning(field==='full_name'?'Name Mismatch':'Address Mismatch',`Existing: ${before||'not supplied'}. Recording: ${after}. Verify before changing the customer record.`,excerpt);
  }else if(manual.has(field)&&!same){
   finding.status='review';finding.detail='Your manual correction was preserved.';
   addWarning('Manual Correction Preserved',`${VERIFIED_FIELDS[field]} differs from the recording. Review your saved correction.`,excerpt);
  }else if(!identity&&!same){
   values[field]=after;finding.updated=true;
   if(!history.some(h=>h.field===field&&h.before===before&&h.after===after&&h.recording_url===verification.recording_url))history.push({field,before,after,excerpt,recording_url:verification.recording_url});
  }
  if(field==='roof_age'&&observation.certainty==='approximate')finding.detail='Approximate age as stated by the customer.';
  if(field==='language'&&finding.status==='confirmed'&&after==='Spanish'&&observation.basis==='explicit')addWarning('Spanish Language Requirement','Customer prefers Spanish. Confirm the requested language when assigning the inspector.',excerpt);
  if(field==='insurance'&&!same&&finding.status==='confirmed')addWarning('Insurance Discrepancy',`Insurance updated from ${before||'not supplied'} to ${after} using the customer confirmation.`,excerpt);
  findings[field]=finding;
 }
 // A public adjuster agreement does not establish a roofing-company contract.
 if(['public_adjuster','conditional_roofing'].includes(verification.contract_kind)){
  const restriction=verification.observations.find(x=>['public_adjuster_agreement','conditional_roofing_obligation'].includes(x.field)&&x.value==='Yes');
  if(restriction)addWarning('Public Adjuster Agreement','A stated adjuster agreement or conditional roofing obligation may restrict contractor selection. Verify the restrictions before proceeding.',restriction.excerpt);
 }
 const draft={verification,findings,warnings,history};values._qc_recording_review=draft;values._qc_recording_history=history;
 return {values,draft};
}
