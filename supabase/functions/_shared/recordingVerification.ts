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
export type RecordingVerification={version:1|2|3|4|5|6|7|8;lead_id:string;recording_url:string;transcript_key:string;
 observations:Observation[];warnings:VerificationWarning[];notes:string;contract_kind:string;original_speech:boolean};
export type FieldFinding={status:'confirmed'|'review'|'lead_only'|'mismatch';excerpt?:string;timestamp?:number|null;
 original?:string;value?:string;updated?:boolean;detail?:string};
export type VerifiedDraft={verification:RecordingVerification;findings:Partial<Record<VerifiedField,FieldFinding>>;
 warnings:VerificationWarning[];history:{field:string;before:string;after:string;excerpt:string;recording_url:string}[]};
export const verificationSchema={type:'object',additionalProperties:false,properties:{
 language_detection:{type:'object',additionalProperties:false,properties:{
  value:{type:'string',enum:['English','Spanish','Bilingual','Unknown']},confidence:{type:'string',enum:['high','medium','low']},
  excerpt:{type:'string'},speaker:{type:'string',enum:['customer','both','agent','unknown']},basis:{type:'string',enum:['explicit','customer_speech','unknown']},
 },required:['value','confidence','excerpt','speaker','basis']},
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
},required:['language_detection','observations','warnings','notes','notes_evidence','contract_kind']};
// User-provided ReadyOps_Inspector_Notes_Updated_2026-10-27.xlsx,
// Notes Standards!A2:B10 and Inspector View!I2:J7. Rules are applied to new
// summaries only; workbook examples never overwrite live lead facts.
export const inspectorNoteInstructions=[
 'Write the inspector Notes as one natural paragraph of TWO TO FOUR concise sentences with normal capitalization. This is a direct handoff for the inspector, separate from the general call summary.',
 'Use this sentence structure where supported: "Spoke with [actual contact], [confirmed role], regarding [visit purpose and specific affected property]. [Relevant insurance or condition] and [special request or visit instruction]. Appointment confirmed for [time] at [address]." Omit unsupported clauses and combine naturally; never output brackets or placeholders. Use a stated Mr./Mrs./Ms. only when supported, never infer an honorific or gender.',
 'Begin with "Spoke with" and end with the supported appointment or access details. Avoid report-style openings such as "The purpose of the contact was", "The customer confirmed that", and "The appointment was set". Rewrite the current call summary into the concise inspector handoff; verify every retained fact against the current transcript.',
 'Preserve the exact affected structure and requested work: roof damage to a shed or detached building is not damage to the main house. Include a stated request to adjust a tarp or another specific onsite request, without promising the inspector will perform it. Insurance on that structure is relevant when explicitly confirmed. Do not add a roof age for the main house to a shed estimate unless the call establishes that age applies to the shed.',
 'Follow this order where supported: actual contact and visit purpose; relevant confirmed roof age or specific damage/estimate scope; special requests or who will meet the inspector; final confirmed appointment date/time and necessary access instructions. Combine sentences to avoid repetition.',
 'State only facts established in the call. Use the actual contact name only if stated or separately confirmed; otherwise say the homeowner or customer. A named homeowner in the form is not proof that this person spoke. Preserve approximate ages and ranges.',
 'Describe damage only as reported. Damage Yes requires an explicit report and the actual affected part. Damage No requires a clear statement of no known damage. Uncertain or unmentioned damage stays Not Sure or is omitted; never turn missing discussion into no damage. Siding, doors, carports, drywall and tree issues do not establish roof damage.',
 'Omit stories, roof type, routine no-contract status, property value, square footage, generic lead-lane framing and other repetitive form details. Mention insurance, claims or contractor/adjuster restrictions only when relevant and explicitly established. A public-adjuster agreement is not proof that a claim is filed or approved.',
 'Preserve service scope, second-property locations, requested photos, courtesy calls, gate/visitor-pass instructions and who will attend when stated. Leave unknown age, damage, insurance, claims and appointment times blank rather than inventing them.',
 'Keep unresolved name/address/recording/form conflicts and specific follow-up in QC warnings; never silently resolve a mismatch. Later explicit human confirmation takes precedence over an older unresolved workbook example.',
 'Retain any explicit DNC request and its context, including later acceptance of a specific estimate. Never erase the DNC request or interpret that acceptance as blanket consent to unrelated sales calls; flag review for unauthorized sales follow-up. Do not claim a legal determination.',
 'Notes must be supported by notes_evidence containing exact contiguous transcript passages for every factual statement. Keep internal QC follow-up separate from the clean inspector paragraph unless it is a concrete visit/compliance instruction the inspector needs.',
].join(' ');
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
 'The required language_detection object must assess the CUSTOMER language on every call. When original_speech is true and the customer has a clear substantive utterance in English or Spanish, return that language, high confidence, basis customer_speech and an exact quote of that CUSTOMER utterance. Quote the customer asking a question about the visit or answering about THEIR property; never quote the caller introducing the roofing company or offering inspections. The language need not be named aloud: ordinary spoken English is basis customer_speech, NEVER basis explicit. A greeting, yes/no alone, unclear speaker, or translated transcript is insufficient: return Unknown with low confidence and basis unknown. An explicit customer preference overrides spoken language: use basis explicit ONLY when the quote actually names the language they want. Never copy the saved lead language as evidence. Also include the corresponding language observation.',
 inspectorNoteInstructions,
].join(' ');
export function transcriptKey(text:string):string{
 // Cache identity only; never used as an authentication or permission check.
 let hash=2166136261;for(let i=0;i<text.length;i++)hash=Math.imul(hash^text.charCodeAt(i),16777619);
 return `${text.length}:${hash>>>0}`;
}
const normalize=(text:unknown)=>String(text??'').normalize('NFKC').toLowerCase().replace(/[“”]/g,'"').replace(/[‘’]/g,"'").replace(/\s+/g,' ').trim();
const supported=(quote:unknown,transcript:string)=>typeof quote==='string'&&quote.trim().length>=4&&normalize(transcript).includes(normalize(quote));
function clearCustomerLanguage(transcript:string,originalSpeech:boolean):Record<string,unknown>|undefined{
 if(!originalSpeech)return;
 // These are substantive customer questions/property statements, not names,
 // greetings, location-based assumptions, or the caller's inspection offer.
 const en=transcript.match(/\bWhat time can you (?:get here|come|arrive)\??|\bAre you licensed in [^.!?]{2,60}\??/i)?.[0];
 const es=transcript.match(/\baqu[íi] vivo [^.!?]{3,90}[.!?]?|\byo salgo hasta [^.!?]{3,90}[.!?]?|\byo ya estoy aqu[íi][^.!?]{0,50}[.!?]?/i)?.[0];
 if(Boolean(en)===Boolean(es))return;
 return {field:'language',value:en?'English':'Spanish',excerpt:en||es,certainty:'confirmed',confidence:'high',speaker:'customer',basis:'customer_speech'};
}
function notesFromVerifiedFields(observations:Observation[],transcript:string):string{
 const get=(field:VerifiedField)=>observations.find(o=>o.field===field&&o.confidence==='high'&&['confirmed','approximate'].includes(o.certainty)&&['customer','both'].includes(o.speaker));
 const purpose=/roof\s+inspection|inspecci[oó]n(?:es)?[^.!?]{0,90}tech/i.test(transcript)?'a roof inspection':'the requested visit';
 const result=[`Spoke with the customer regarding ${purpose}.`];
 const age=get('roof_age');
 if(age){const value=age.value.replace(/\s*years?$/i,'').trim().replace(/^~/,'approximately ');result.push(`The roof was described as ${age.certainty==='approximate'&&!/approximately|about|around/i.test(value)?'approximately ':''}${value} years old.`);}
 const damage=get('damage_type');
 if(damage&&get('visible_damage')?.value==='Yes'&&supported(damage.value,damage.excerpt))result.push(`Reported damage: ${damage.value}.`);
 const time=get('appointment_time');
 if(time&&/^([01]\d|2[0-3]):[0-5]\d$/.test(time.value)){const [h,m]=time.value.split(':').map(Number);result.push(`Visit time confirmed for ${h%12||12}:${String(m).padStart(2,'0')} ${h<12?'AM':'PM'}.`);}
 return result.length>1?result.slice(0,4).join(' '):'';
}
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
 let candidates=[...(Array.isArray(input.observations)?input.observations:[])];
 const language=input.language_detection as Record<string,unknown>|undefined;
 if(language&&typeof language==='object'){
  const preference=candidates.find(item=>item?.field==='language'&&item.basis==='explicit'&&/\benglish\b|\bspanish\b|ingl[eé]s|espa[ñn]ol|biling[uü]/i.test(String(item.excerpt)));
  candidates=candidates.filter(item=>item?.field!=='language');
  candidates.push(preference||{...language,field:'language',certainty:language.value==='Unknown'?'uncertain':'confirmed'});
 }
 const clearLanguage=clearCustomerLanguage(context.transcript,context.originalSpeech);
 if(clearLanguage&&!candidates.some(item=>item?.field==='language'&&item.basis==='explicit'&&/\benglish\b|\bspanish\b|ingl[eé]s|espa[ñn]ol|biling[uü]/i.test(String(item.excerpt)))){
  candidates=candidates.filter(item=>item?.field!=='language');candidates.push(clearLanguage);
 }
 for(const item of candidates){
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
  if(obs.field==='language'&&obs.basis==='customer_speech'&&obs.excerpt.trim().split(/\s+/).length<4)obs.certainty='uncertain';
  if(obs.field==='language'&&obs.basis==='explicit'&&!/\benglish\b|\bspanish\b|ingl[eé]s|espa[ñn]ol|biling[uü]/i.test(obs.excerpt))obs.certainty='uncertain';
  if(obs.field==='language'&&/this is (?:a |the )?(?:roofing|construction) company|we(?:'re|'ll| are| will be).*conducting.*inspections|le marcamos de|mi nombre es|inspecci[oó]n es completamente gratis/i.test(obs.excerpt))obs.certainty='uncertain';
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
 let notes=typeof input.notes==='string'&&noteQuotes.length&&noteQuotes.every(q=>supported(q,context.transcript))?input.notes.replace(/\s+/g,' ').trim().slice(0,8000):'';
 const established=(field:VerifiedField)=>observations.some(o=>o.field===field&&o.confidence==='high'&&['confirmed','approximate'].includes(o.certainty));
 const repetitive=/\b(?:single[- ]story|two[- ]story|one[- ]story|\d+[- ]stor(?:y|ies)|square feet|sq\.?\s*ft|property value|roof type|shingle roof|metal roof|tile roof)\b|\bno (?:current |active |signed )?(?:roofing )?contract\b/i.test(notes);
 const unsupportedAge=/\broof\b[^.!?]{0,80}\b(?:years? old|older than|age)\b/i.test(notes)&&!established('roof_age');
 const unsupportedDamage=/\b(?:missing shingles|eave damage|no (?:known )?damage|reported[^.!?]{0,60}damage)\b/i.test(notes)&&!established('visible_damage')&&!established('damage_type');
 if(notes&&(repetitive||unsupportedAge||unsupportedDamage)){
  const excerpt=noteQuotes.find(q=>supported(q,context.transcript)) as string|undefined;
  if(excerpt)warnings.push({title:'Inspector Notes Need Review',detail:'The generated paragraph included repetitive or unconfirmed details. Only supported field facts are included below; review the call for any omitted visit instructions.',excerpt});
  notes='';
 }
 if(!notes)notes=notesFromVerifiedFields(observations,context.transcript);
 const dnc=context.transcript.match(/\b(?:do not call|don't call|stop calling|no me llam(?:e|es|en)|no me vuelva(?:n)? a llamar)[^.!?]{0,160}[.!?]?/i)?.[0];
 if(dnc&&!warnings.some(w=>/\bDNC\b|do not call|stop calling/i.test(w.title+' '+w.detail)))warnings.push({title:'Do Not Call Request',detail:'A stop-call request appears in this recording. Preserve it and review the exact consent and estimate context before any sales follow-up.',excerpt:dnc});
 // An inspector reading an older call must not interpret its "tomorrow" as
 // tomorrow from today. Keep the supported clock time while QC reviews the date.
 if(!anchor)notes=notes.replace(/\b(?:today|tomorrow|hoy|ma[ñn]ana)\b/gi,'').replace(/\bfor\s+at\b/gi,'at').replace(/\s+/g,' ').replace(/\s+([,.])/g,'$1').trim();
 // Routine negative contract answers belong in form fields, not repeated notes.
 notes=notes.replace(/\s+and\s+(?:(?:they|he|she|the customer)\s+)?(?:has|have)\s+no\s+(?:current\s+)?(?:signed\s+)?roofing\s+contract\b/gi,'');
 notes=notes.replace(/,?\s+with no (?:active|current|signed) contract with (?:any|another) roofing company\b/gi,'');
 return {version:8,lead_id:context.leadId,recording_url:context.recordingUrl,transcript_key:transcriptKey(context.transcript),
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
