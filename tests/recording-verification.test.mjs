import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import React from 'react';
import TestRenderer,{act} from 'react-test-renderer';
import ts from 'typescript';
const require=createRequire(import.meta.url),cache=new Map();
const root=fileURLToPath(new URL('../',import.meta.url));
function load(file){
 const full=['', '.ts','.tsx'].map(ext=>path.resolve(root,file+ext)).find(p=>fs.existsSync(p)&&fs.statSync(p).isFile());
 if(cache.has(full))return cache.get(full);
 const mod={exports:{}};cache.set(full,mod.exports);
 const code=ts.transpileModule(fs.readFileSync(full,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 new Function('exports','require','module',code)(mod.exports,id=>id.startsWith('.')?load(path.relative(root,path.resolve(path.dirname(full),id))):require(id),mod);
 return mod.exports;
}
const {normalizeVerification,applyVerifiedFields,transcriptKey}=load('supabase/functions/_shared/recordingVerification.ts');
const transcript='Customer: My roof is about 22 years old, shingle, one story. Yes, I have insurance with Universal. I signed a public adjuster agreement and must use their partner roofer if my claim succeeds. I need a Spanish-speaking inspector. My name is Pat Example, I am Alex’s spouse. The address is 125 Main Street. Tomorrow at 11 works. I speak both English and Spanish comfortably.';
const context={leadId:'test-lead',recordingUrl:'storage://qc-recordings/test-lead/current.mp3',transcript,originalSpeech:true};
const observation=(field,value,excerpt,extra={})=>({field,value,excerpt,certainty:'confirmed',confidence:'high',speaker:'customer',basis:'explicit',...extra});
const raw={observations:[
 observation('roof_age','about 22','My roof is about 22 years old',{certainty:'approximate'}),
 observation('roof_type','Shingle','My roof is about 22 years old, shingle, one story.'),
 observation('insurance','Yes','Yes, I have insurance with Universal.'),
 observation('insurance_name','Universal','Yes, I have insurance with Universal.'),
 observation('public_adjuster_agreement','Yes','I signed a public adjuster agreement and must use their partner roofer if my claim succeeds.'),
 observation('conditional_roofing_obligation','Yes','I signed a public adjuster agreement and must use their partner roofer if my claim succeeds.'),
 observation('contract','Yes','I signed a public adjuster agreement and must use their partner roofer if my claim succeeds.'),
 observation('language','Spanish','I need a Spanish-speaking inspector.'),
 observation('full_name','Pat Example','My name is Pat Example, I am Alex’s spouse.'),
 observation('contact_name','Pat Example','My name is Pat Example, I am Alex’s spouse.'),
 observation('contact_role','Spouse','My name is Pat Example, I am Alex’s spouse.'),
 observation('address','125 Main St','The address is 125 Main Street.'),
 observation('appointment_date','2099-01-01','Tomorrow at 11 works.',{basis:'relative_date'}),
],warnings:[],notes:'Spoke with Pat Example about the roof inspection.',notes_evidence:['My name is Pat Example, I am Alex’s spouse.'],contract_kind:'public_adjuster'};
const existing={full_name:'Alex Example',address:'123 Main ST',roof_age:'10',roof_type:'Metal',stories:'2',insurance:'No',contract:'No',language:'English',notes:'Original notes must survive',home_value:193400,sq_ft:1105,web_url:'https://example.test/property'};
const verification=normalizeVerification(raw,context);
const {values,draft}=applyVerifiedFields(existing,verification);
assert.equal(values.roof_age,'~22');assert.equal(values.roof_type,'Shingle');assert.equal(values.insurance,'Yes');assert.equal(values.insurance_name,'Universal');
assert.equal(values.full_name,'Alex Example');assert.equal(values.address,'123 Main ST');assert.equal(values.contract,'No');
assert.equal(values.contact_name,'Pat Example');assert.equal(values.contact_role,'Spouse');
assert.equal(values.language,'Spanish');assert.equal(values.public_adjuster_agreement,'Yes');assert.equal(values.conditional_roofing_obligation,'Yes');
for(const key of ['notes','stories','home_value','sq_ft','web_url'])assert.equal(values[key],existing[key]);
assert.equal(draft.findings.full_name.status,'mismatch');assert.equal(draft.findings.address.status,'mismatch');
assert.equal(draft.findings.appointment_date.status,'review');assert.equal(values.appointment_date,undefined,'Never resolves older calls using today');
assert(draft.warnings.some(w=>w.title==='Public Adjuster Agreement'));assert(draft.warnings.some(w=>w.title==='Spanish Language Requirement'));
assert(draft.history.some(h=>h.field==='roof_age'&&h.before==='10'&&h.after==='~22'));
const manual=applyVerifiedFields({...existing,roof_type:'Tile',_qc_manual_fields:['roof_type']},verification);
assert.equal(manual.values.roof_type,'Tile');assert.equal(manual.draft.findings.roof_type.status,'review');
const unsupported=normalizeVerification({...raw,observations:[observation('roof_age','99','Not actually in this transcript')]},context);
assert.equal(unsupported.observations.length,0);
const agentOnly=normalizeVerification({...raw,observations:[observation('insurance','No','Yes, I have insurance with Universal.',{speaker:'agent'})]},context);
assert.equal(applyVerifiedFields(existing,agentOnly).values.insurance,'No');assert.equal(agentOnly.observations[0].certainty,'uncertain');
const language=(value,excerpt,basis='customer_speech',originalSpeech=true)=>normalizeVerification({observations:[observation('language',value,excerpt,{basis})]},{...context,originalSpeech});
const requiredLanguage=normalizeVerification({observations:[],language_detection:{value:'English',excerpt:'My roof is about 22 years old',confidence:'high',speaker:'customer',basis:'customer_speech'}},context);
assert.equal(requiredLanguage.observations[0].value,'English','Required language assessment becomes a field finding even when the general observation list omits it');
assert.equal(requiredLanguage.observations[0].certainty,'confirmed');
const agentLanguage=normalizeVerification({observations:[observation('language','English','Yes, this is a roofing company, sir.')]},{...context,transcript:'Yes, this is a roofing company, sir.'});
assert.equal(agentLanguage.observations[0].certainty,'uncertain','Company introduction is not evidence of the customer language or a named preference');
const spanishCustomerText='La inspección es completamente gratis. Sí, aquí vivo en Dallas yo. Pues yo salgo hasta la una.';
const spanishCustomer=normalizeVerification({language_detection:{value:'Spanish',excerpt:'La inspección es completamente gratis.',confidence:'high',speaker:'customer',basis:'customer_speech'}},{...context,transcript:spanishCustomerText});
assert.equal(spanishCustomer.observations[0].value,'Spanish');
assert.equal(spanishCustomer.observations[0].certainty,'confirmed');
assert(spanishCustomer.observations[0].excerpt.includes('vivo'),'Language evidence uses the substantive property answer instead of the inspection offer');
const translatedSpanish=normalizeVerification({language_detection:{value:'Spanish',excerpt:'La inspección es completamente gratis.',confidence:'high',speaker:'customer',basis:'customer_speech'}},{...context,transcript:spanishCustomerText,originalSpeech:false});
assert.equal(translatedSpanish.observations[0].certainty,'uncertain','Fallback cannot establish original language from translated speech');
const groundedNotes=normalizeVerification({notes:'Invented summary.',notes_evidence:['Not in the call'],observations:[observation('roof_age','about 22','My roof is about 22 years old',{certainty:'approximate'}),observation('roof_type','Shingle','My roof is about 22 years old, shingle, one story.')]},context);
assert.match(groundedNotes.notes,/about 22 years old/);
assert(!/shingle|one story|193400|Alex Example|Invented/i.test(groundedNotes.notes),'Fallback includes only relevant grounded observations and no source-form or invented details');
assert.equal(normalizeVerification({notes:'Invented summary.',notes_evidence:['Not in the call'],observations:[]},context).notes,'','Missing supported facts remains blank');
const repetitiveNotes=normalizeVerification({...raw,notes:'The customer confirmed the roof is about 22 years old. The inspection will take place at a single-story home.'},context);
assert(!/single-story/i.test(repetitiveNotes.notes),'Routine stories are excluded even if the language model includes them');
assert(repetitiveNotes.warnings.some(w=>w.title==='Inspector Notes Need Review'));
const inventedAge=normalizeVerification({observations:[observation('appointment_time','11:00','Tomorrow at 11 works.')],notes:'The roof is older than 10 years. Visit at 11 AM.',notes_evidence:['Tomorrow at 11 works.']},context);
assert(!/10 years/i.test(inventedAge.notes),'An age needs an established age observation as well as source quotes');
const dncPreserved=normalizeVerification({observations:[],notes:'Routine single-story home.',notes_evidence:['Do not call me again.']},{...context,transcript:'Do not call me again. I only agreed to the requested estimate.'});
assert(dncPreserved.warnings.some(w=>w.title==='Do Not Call Request'&&w.excerpt.includes('Do not call')),'Rejected narrative cannot erase a stop-call request');
const cleanNotes=normalizeVerification({...raw,notes:'The customer requested an inspection tomorrow at 11. The property is insured and has no current roofing contract.',notes_evidence:['Tomorrow at 11 works.','Yes, I have insurance with Universal.']},context);
assert(!cleanNotes.notes.includes('tomorrow'),'Inspector notes do not reinterpret an unanchored older call date');
assert(!cleanNotes.notes.includes('roofing contract'),'Routine negative contract answer stays in form fields');
assert.equal(language('English','My roof is about 22 years old','customer_speech',false).observations[0].certainty,'uncertain','Translated or unverified text cannot establish customer speech language');
assert.equal(language('Spanish','I need a Spanish-speaking inspector.','explicit',false).observations[0].certainty,'confirmed');
assert.equal(language('Bilingual','My roof is about 22 years old').observations[0].certainty,'uncertain');
assert.equal(language('Bilingual','I speak both English and Spanish comfortably.').observations[0].certainty,'confirmed');
const relative=normalizeVerification(raw,{...context,recordedAt:'2026-10-23T02:00:00Z',timezone:'America/Los_Angeles'});
assert.equal(relative.observations.find(o=>o.field==='appointment_date').value,'2026-10-23','Uses call-local Oct 22, not UTC Oct 23');
assert.equal(normalizeVerification(raw,{...context,recordedAt:'2026-99-10',timezone:'invalid'}).observations.find(o=>o.field==='appointment_date').certainty,'uncertain');
const address=normalizeVerification({observations:[observation('address','125 Main Street','The address is 125 Main Street.')]},context);
assert.equal(applyVerifiedFields({...existing,address:'125 Main ST'},address).draft.findings.address.status,'confirmed','Street suffix formatting is not a mismatch');
assert.equal(applyVerifiedFields({...existing,address:'125 Main ST, Example City, FL 32514'},address).draft.findings.address.status,'review','Partial address is not mistaken for a full verified address');
for(const ambiguous of ['Last Friday at 11.', 'Tomorrow, Friday at 11.', 'Friday or Saturday at 11.']){
 const check=normalizeVerification({observations:[observation('appointment_date','2099-01-01',ambiguous,{basis:'relative_date'})]}, {...context,transcript:ambiguous,recordedAt:'2026-10-21',timezone:'America/Chicago'});
 assert.equal(check.observations[0].certainty,'uncertain','Ambiguous or past relative references must be held');
}
console.log('PASS grounded corrections, source binding, identity/address review, adjuster restrictions, manual edits, approximate ages, languages and call-local relative dates');

const {RecordingVerificationWorkspace}=load('src/RecordingVerificationWorkspace.tsx');
let saved,view;
const props={leadId:'test-lead',review:draft,values,onDraftChange:value=>{saved=value;},onRegenerate(){},busy:false};
act(()=>{view=TestRenderer.create(React.createElement(RecordingVerificationWorkspace,props));});
const text=label=>view.root.findAllByType('textarea').find(n=>n.props['aria-label']===label);
act(()=>text('Professional appointment Notes').props.onChange({target:{value:'Reviewer edited appointment notes.'}}));
assert.equal(saved.notes,'Reviewer edited appointment notes.');assert.equal(existing.notes,'Original notes must survive');
act(()=>view.update(React.createElement(RecordingVerificationWorkspace,{...props,review:{...draft,verification:{...verification,notes:'New generated paragraph.'}}})));
assert.equal(text('Professional appointment Notes').props.value,'Reviewer edited appointment notes.','Regeneration preserves manual text');
const label=node=>node.children.map(c=>typeof c==='string'?c:label(c)).join('');
act(()=>view.root.findAllByType('button').find(n=>label(n)==='Reset to Generated').props.onClick());
assert.equal(text('Professional appointment Notes').props.value,'New generated paragraph.');
for(const caption of ['Copy Full Summary','Copy Notes Only','Copy QC Note','Regenerate Summary'])assert(view.root.findAllByType('button').some(n=>label(n)===caption));
act(()=>text('Professional appointment Notes').props.onChange({target:{value:'Keep these reviewer edits across leads.'}}));
const cached=structuredClone(saved);
act(()=>view.unmount());
act(()=>{view=TestRenderer.create(React.createElement(RecordingVerificationWorkspace,{...props,savedDraft:cached}));});
assert.equal(text('Professional appointment Notes').props.value,cached.notes,'Saved per-lead draft reloads');
assert.equal(verification.transcript_key,transcriptKey(transcript));
act(()=>view.unmount());
console.log('PASS independent editable/copyable notes, regeneration/reset behavior and per-lead draft restoration');
