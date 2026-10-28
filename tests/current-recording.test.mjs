import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import React from 'react';
import TestRenderer, {act} from 'react-test-renderer';
import ts from 'typescript';
const require=createRequire(import.meta.url);
const compile=source=>ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const selection={exports:{}};
new Function('exports',compile(fs.readFileSync(new URL('../supabase/functions/transcribe-and-qualify/recordingSelection.ts',import.meta.url),'utf8')))(selection.exports);
const {selectRecordingInput}=selection.exports;
const verificationModule={exports:{}};
new Function('exports',compile(fs.readFileSync(new URL('../supabase/functions/_shared/recordingVerification.ts',import.meta.url),'utf8')))(verificationModule.exports);
const verification=verificationModule.exports;

const old='storage://qc-recordings/lead/old.mp3', fresh='storage://qc-recordings/lead/new.mp3';
const base={leadId:'lead',savedRecordingUrl:old,requestedRecordingUrl:fresh,clientTranscript:'OLD CLIENT',savedTranscript:'OLD SAVED',forceTranscription:false};
assert.deepEqual(selectRecordingInput(base),{recordingUrl:fresh,transcript:'',changed:true});
assert.equal(selectRecordingInput({...base,requestedRecordingUrl:old,forceTranscription:true}).transcript,'');
assert.equal(selectRecordingInput({...base,requestedRecordingUrl:old}).transcript,'OLD CLIENT');
assert.equal(selectRecordingInput({...base,savedRecordingUrl:'',requestedRecordingUrl:''}).transcript,'OLD CLIENT');
assert.equal(selectRecordingInput({...base,savedRecordingUrl:''}).recordingUrl,fresh);
for(const url of ['storage://qc-recordings/other/new.mp3','storage://qc-recordings/lead/../other.mp3','https://unrelated.invalid/audio.mp3']) assert.throws(()=>selectRecordingInput({...base,requestedRecordingUrl:url}));

let invoked, localAudio, view;
const saved={transcript:'OLD SAVED',summary:'OLD SUMMARY',method:'manual',assessment:null};
const supabase={auth:{getSession:async()=>({data:{session:{access_token:'test'}}}),getUser:async()=>({data:{user:{id:'reviewer'}}})},
 storage:{from:()=>({createSignedUrl:async path=>({data:{signedUrl:`https://audio.invalid/${path}`}})})},
 from:()=>({select(){return this;},eq(){return this;},maybeSingle:async()=>({data:saved}),upsert:async()=>({error:null})}),
 functions:{invoke:async(name,options)=>{invoked=options.body;return {data:{transcript:'NEW AUDIO TRANSCRIPT',summary:'NEW SUMMARY',qualification_status:'needs_review',reasons:[]}};}}};
const mod={exports:{}};
new Function('exports','require','module',compile(fs.readFileSync(new URL('../src/QCRecordingUpload.tsx',import.meta.url),'utf8')))(mod.exports,id=>id.includes('recordingVerification')?verification:id==='./RecordingVerificationWorkspace'?{RecordingVerificationWorkspace:()=>null}:id==='./supabase'?{supabase}:id==='./localWhisperClient'?{transcribeWithLocalWhisper:async url=>{localAudio=url;return 'NEW LOCAL AUDIO';}}:id==='./leadTypes'?{getLane:()=>({})}:id==='./inspectorNote'?{buildInspectorNote:()=>''}:id==='./recordingImport'?{recordingNotes:text=>text}:require(id),mod);
const props={leadId:'lead',value:old,onChange(){}};
await act(async()=>{view=TestRenderer.create(React.createElement(mod.exports.QCRecordingUpload,props));});
assert.equal(view.root.findAllByType('textarea')[0].props.value,'OLD SAVED');
await act(async()=>{view.update(React.createElement(mod.exports.QCRecordingUpload,{...props,value:fresh}));});
assert.equal(view.root.findAllByType('textarea')[0].props.value,'','Replacement clears old transcript');
const label=node=>node.children.map(c=>typeof c==='string'?c:label(c)).join('');
await act(async()=>{await view.root.findAllByType('button').find(n=>label(n).trim()==='AI Transcribe & Qualify').props.onClick();});
assert.equal(invoked.recording_url,fresh);
assert.equal(invoked.force_transcription,true);
assert.equal(invoked.transcript,undefined);
assert.equal(view.root.findAllByType('textarea')[0].props.value,'NEW AUDIO TRANSCRIPT');
await act(async()=>{await view.root.findAllByType('button').find(n=>label(n).trim()==='Free AI Transcribe').props.onClick();});
assert.equal(localAudio,'https://audio.invalid/lead/new.mp3');
assert.equal(view.root.findAllByType('textarea')[0].props.value,'NEW LOCAL AUDIO');
view.unmount();
console.log('PASS replacement audio selection, forced fresh transcript, same-lead storage validation, cleared old UI and both transcription actions');

// Automatic verification fills the caller's draft and ignores a late result for replaced audio.
const priorWindow=globalThis.window;
globalThis.window={setTimeout:fn=>setTimeout(fn,0),clearTimeout};
const priorInvoke=supabase.functions.invoke;
const priorSaved={...saved};
const verifiedText='Customer: My roof is 22 years old. Yes, I have insurance.';
const verifiedAssessment={recording_verification:verification.normalizeVerification({observations:[
 {field:'roof_age',value:'22',certainty:'confirmed',confidence:'high',speaker:'customer',basis:'explicit',excerpt:'My roof is 22 years old.'},
 {field:'insurance',value:'Yes',certainty:'confirmed',confidence:'high',speaker:'customer',basis:'explicit',excerpt:'Yes, I have insurance.'}
]}, {leadId:'lead',recordingUrl:fresh,transcript:verifiedText,originalSpeech:true})};
Object.assign(saved,{transcript:verifiedText,assessment:null,method:'ai-openai'});
let autoBody,autoDraft,autoCount=0;
supabase.functions.invoke=async(name,options)=>{autoBody=options.body;autoCount++;return {data:{transcript:verifiedText,assessment:verifiedAssessment,qualification_status:'needs_review'}};};
const autoProps={...props,value:fresh,leadForm:{roof_age:'10',insurance:'No',_qc_manual_fields:['insurance']},onVerification:value=>{autoDraft=verification.applyVerifiedFields({roof_age:'10',insurance:'No',_qc_manual_fields:['insurance']},value);}};
await act(async()=>{view=TestRenderer.create(React.createElement(mod.exports.QCRecordingUpload,autoProps));});
await act(async()=>{await new Promise(resolve=>setTimeout(resolve,30));});
assert.equal(autoBody.verify_only,true);assert.equal(autoBody.force_transcription,true,'Legacy transcripts are refreshed against their actual audio');
assert.equal(autoDraft.values.roof_age,'22');assert.equal(autoDraft.values.insurance,'No','Manual edits survive automatic verification');assert.equal(autoCount,1);
await act(async()=>view.unmount());
let finishOld;
autoDraft=undefined;
supabase.functions.invoke=()=>new Promise(resolve=>{finishOld=resolve;});
await act(async()=>{view=TestRenderer.create(React.createElement(mod.exports.QCRecordingUpload,autoProps));});
await act(async()=>{await new Promise(resolve=>setTimeout(resolve,20));});
await act(async()=>{view.update(React.createElement(mod.exports.QCRecordingUpload,{...autoProps,value:'storage://qc-recordings/lead/replacement.mp3'}));});
await act(async()=>{finishOld({data:{transcript:verifiedText,assessment:verifiedAssessment}});});
assert.equal(autoDraft,undefined,'A late old-audio assessment never corrects the new recording draft');
assert.equal(view.root.findAllByType('textarea')[0].props.value,'');
await act(async()=>view.unmount());
supabase.functions.invoke=priorInvoke;Object.assign(saved,priorSaved);
if(priorWindow===undefined)delete globalThis.window;else globalThis.window=priorWindow;
console.log('PASS automatic pending draft correction, manual preservation, one analysis per source and stale audio result rejection');

// Exercise the deployed handler with simulated storage/OpenAI, without real calls or lead writes.
let handler, storedUrl, transcriptWrite, signedPath, transcriptionCalls, changedDuringCall, lostAttach;
const admin={auth:{getUser:async()=>({data:{user:{id:'reviewer'}}})},storage:{from:()=>({createSignedUrl:async path=>{signedPath=path;return {data:{signedUrl:'https://audio.invalid/current'}};}})},from(table){
 let update, filter, expected;
 const q={select(){return q;},eq(key,val){if(key==='recording_url'){filter=true;expected=val;}return q;},is(key,val){filter=true;expected=val;return q;},update(data){update=data;return q;},
 async maybeSingle(){
  if(table==='profiles')return {data:{role:'admin'}};
  if(table==='qc_lead_transcripts')return {data:saved};
  if(table==='company_portal_settings')return {data:null};
  if(table==='portal_leads'){
   if(update){if(lostAttach || (filter&&storedUrl!==expected))return {data:null};storedUrl=update.recording_url;return {data:{id:'lead'}};}
   return {data:{id:'lead',company_id:'company',recording_url:storedUrl,form_data:{}}};
  }
 },async upsert(data){transcriptWrite=data;return {error:null};},then(resolve){resolve({error:null});}};
 return q;
}};
const fakeFetch=async url=>{
 if(url==='https://audio.invalid/current')return new Response('audio-bytes',{headers:{'content-type':'audio/mpeg'}});
 if(url.endsWith('/audio/transcriptions')){transcriptionCalls++;if(changedDuringCall)storedUrl='storage://qc-recordings/lead/newer.mp3';return Response.json({text:'FRESH SERVER AUDIO'});}
 if(url.endsWith('/responses'))return Response.json({output:[{content:[{type:'output_text',text:JSON.stringify({summary:'Fresh summary',reasons:['Review'],qualifiers:{}})}]}]});
 throw Error(`Unexpected fetch ${url}`);
};
const edge=fs.readFileSync(new URL('../supabase/functions/transcribe-and-qualify/index.ts',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'');
new Function('Deno','createClient','selectRecordingInput','normalizeVerification','verificationInstructions','verificationSchema','inspectorNoteInstructions','fetch',ts.transpileModule(edge,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText)({serve(fn){handler=fn;},env:{get(){return 'server-test';}}},()=>admin,selectRecordingInput,verification.normalizeVerification,verification.verificationInstructions,verification.verificationSchema,verification.inspectorNoteInstructions,fakeFetch);
const reset=url=>{storedUrl=url;transcriptWrite=null;signedPath='';transcriptionCalls=0;changedDuringCall=false;lostAttach=false;};
const request=body=>handler(new Request('https://test.invalid',{method:'POST',headers:{Authorization:'Bearer reviewer'},body:JSON.stringify({lead_id:'lead',recording_url:fresh,transcript:'OLD CLIENT',...body})}));
for(const prior of [old,null,'']){
 reset(prior);const response=await request({});assert.equal(response.status,200,JSON.stringify(await response.clone().json()));
 assert.equal(signedPath,'lead/new.mp3');assert.equal(transcriptionCalls,1);assert.equal(transcriptWrite.transcript,'FRESH SERVER AUDIO');assert.equal(storedUrl,fresh);
}
reset(fresh);assert.equal((await request({force_transcription:true})).status,200);assert.equal(transcriptionCalls,1);
reset(old);changedDuringCall=true;assert.equal((await request({})).status,409);assert.equal(transcriptWrite,null,'Stale results cannot overwrite the newer recording');
reset(old);lostAttach=true;assert.equal((await request({})).status,409);assert.equal(transcriptionCalls,0);
reset(old);assert.equal((await request({recording_url:'storage://qc-recordings/other/new.mp3'})).status,400);assert.equal(transcriptionCalls,0);
console.log('PASS Edge handler new audio download, fresh transcription despite saved text, nullable attachment, race rejection and cross-lead rejection');


