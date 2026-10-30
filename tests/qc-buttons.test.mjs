import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import React from 'react';
import TestRenderer,{act} from 'react-test-renderer';
import ts from 'typescript';

// Click the real components with a simulated clipboard and database. No live leads are written.
const require=createRequire(import.meta.url),root=fileURLToPath(new URL('../',import.meta.url)),cache=new Map();
let savedRow,writeError,authError,authWait,writeWait,writes=[],invocations=[],clipboard=[],notes=[];
const supabase={auth:{getUser:async()=>{if(authWait)await authWait;return {data:{user:authError?null:{id:'reviewer'}},error:authError};},getSession:async()=>({data:{session:{access_token:'fixture'}}})},
 storage:{from:()=>({createSignedUrl:async()=>({data:{signedUrl:'https://audio.invalid/current.mp3'}})})},
 from:()=>({select(){return this;},eq(){return this;},maybeSingle:async()=>({data:savedRow}),upsert:async(row,options)=>{writes.push({row,options});if(writeWait)await writeWait;if(writeError instanceof Error)throw writeError;return {error:writeError};}}),
 functions:{invoke:async(name,options)=>{invocations.push({name,...options});return {data:{transcript:savedRow.transcript,assessment:savedRow.assessment,qualification_status:'needs_review',reasons:[]}};}}};
function load(file){
 const full=['','.ts','.tsx'].map(ext=>path.resolve(root,file+ext)).find(p=>fs.existsSync(p)&&fs.statSync(p).isFile());
 if(full.endsWith(`${path.sep}supabase.ts`))return {supabase};
 if(full.endsWith(`${path.sep}localWhisperClient.ts`))return {transcribeWithLocalWhisper:async()=>{throw Error('Not part of this test');}};
 if(cache.has(full))return cache.get(full);
 const mod={exports:{}};cache.set(full,mod.exports);
 const code=ts.transpileModule(fs.readFileSync(full,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 new Function('exports','require','module',code)(mod.exports,id=>id.startsWith('.')?load(path.relative(root,path.resolve(path.dirname(full),id))):require(id),mod);
 return mod.exports;
}
const previousNavigator=Object.getOwnPropertyDescriptor(globalThis,'navigator'),previousWindow=globalThis.window;
Object.defineProperty(globalThis,'navigator',{configurable:true,value:{clipboard:{writeText:async text=>clipboard.push(text)}}});
globalThis.window={setTimeout:()=>1,clearTimeout(){}}; // Only explicit button actions run here.
const {normalizeVerification,applyVerifiedFields}=load('supabase/functions/_shared/recordingVerification.ts');
const {recordingNotes}=load('src/recordingImport.ts');
const {QCRecordingUpload}=load('src/QCRecordingUpload.tsx');
const transcript='Customer: My roof is 20 years old. Yes, I have insurance. Tomorrow at 5 PM works.';
const value='storage://qc-recordings/fixture/current.mp3';
const verification=normalizeVerification({notes:'Generated inspector handoff.',observations:[]},{leadId:'fixture',recordingUrl:value,transcript,originalSpeech:true});
const values={full_name:'Test Homeowner',address:'123 Example Street',language:'English',notes:'Original lead notes'};
const review=applyVerifiedFields(values,verification).draft;
savedRow={transcript,summary:'Previously saved passages',method:'manual',assessment:{recording_verification:verification}};
let draft,view;
const props={leadId:'fixture',value,shared:false,onChange(){},onShareChange(){},onVerification(){},onRecordingNotesChange:n=>notes.push(n),onSummaryDraftChange:n=>{draft=n;},leadForm:{...values,_qc_recording_review:review}};
const label=node=>node.children.map(c=>typeof c==='string'?c:label(c)).join('').trim();
const button=caption=>view.root.findAllByType('button').find(n=>label(n)===caption);
const field=aria=>view.root.findAllByType('textarea').find(n=>n.props['aria-label']===aria);
const transcriptField=()=>view.root.findAllByType('textarea').find(n=>n.props.placeholder?.startsWith('Transcript will appear'));
const rendered=()=>JSON.stringify(view.toJSON());
const click=async caption=>{const b=button(caption);assert(b,caption);assert(!b.props.disabled,`${caption} must be enabled`);await act(async()=>{await b.props.onClick();});};
try {
 await act(async()=>{view=TestRenderer.create(React.createElement(QCRecordingUpload,props));});
 act(()=>field('Professional appointment Notes').props.onChange({target:{value:'Edited inspector note.'}}));
 act(()=>field('Appointment QC Note').props.onChange({target:{value:'Internal QC observation.'}}));
 await click('Copy Notes Only');assert.equal(clipboard.at(-1),'Edited inspector note.');
 await click('Copy QC Note');assert.equal(clipboard.at(-1),'Internal QC observation.');
 await click('Copy Full Summary');assert(clipboard.at(-1).includes('Name: Test Homeowner'));assert(clipboard.at(-1).includes('Notes: Edited inspector note.'));assert(clipboard.at(-1).includes('QC Note: Internal QC observation.'));
 assert(rendered().includes('Copied to clipboard.'));
 await click('Copy Transcript');assert.equal(clipboard.at(-1),transcript);assert(rendered().includes('Transcript copied to clipboard.'));
 navigator.clipboard.writeText=async()=>{throw Error('Clipboard permission denied');};
 await click('Copy Full Summary');assert(field('Summary text to copy manually').props.value.includes('Notes: Edited inspector note.'));
 await click('Copy Transcript');assert.equal(field('Transcript text to copy manually').props.value,transcript);assert(rendered().includes('Clipboard access is unavailable'));
 // Regenerate uses the currently displayed transcript without re-transcribing the audio.
 await click('Regenerate Summary');assert.equal(invocations.length,1);assert.equal(invocations[0].body.verify_only,true);assert.equal(invocations[0].body.force_transcription,false);assert.equal(invocations[0].body.transcript,transcript);assert.equal(invocations[0].body.recording_url,value);
 assert.equal(field('Professional appointment Notes').props.value,'Edited inspector note.');
 const nextReview={...review,verification:{...verification,notes:'Latest generated handoff.'}};
 await act(async()=>view.update(React.createElement(QCRecordingUpload,{...props,leadForm:{...props.leadForm,_qc_recording_review:nextReview}})));
 assert.equal(field('Professional appointment Notes').props.value,'Edited inspector note.');
 await click('Reset to Generated');assert.equal(draft.notes,'Latest generated handoff.');assert.equal(draft.qc_note,review.warnings.map(w=>`${w.title}: ${w.detail}`).join('\n'));assert.equal(values.notes,'Original lead notes');
 await click('Use recording passages');assert(rendered().includes('Recording passages selected. Click Save Transcript.'));
 await click('Save Transcript');assert.equal(writes.at(-1).row.transcript,transcript);assert.equal(writes.at(-1).row.summary,recordingNotes(transcript));assert.equal(writes.at(-1).row.lead_id,'fixture');assert.equal(writes.at(-1).row.updated_by,'reviewer');assert.deepEqual(writes.at(-1).options,{onConflict:'lead_id'});assert.equal(notes.at(-1),recordingNotes(transcript));assert(rendered().includes('saved to QC.'));
 for(const failure of [{message:'Storage rejected the save'},new Error('Network disconnected')]){
  writeError=failure;const callbacks=notes.length;await click('Save Transcript');assert(rendered().includes(failure.message));assert(!button('Save Transcript').props.disabled);assert.equal(notes.length,callbacks,'Failures never report notes as saved');
 }
 writeError=null;authError={message:'Expired'};const beforeAuth=writes.length;await click('Save Transcript');assert(rendered().includes('session expired'));assert.equal(writes.length,beforeAuth);authError=null;
 // A slow save cannot write through to a different lead after auth resolves.
 let releaseAuth;authWait=new Promise(resolve=>{releaseAuth=resolve;});
 await click('Save Transcript');assert(button('Save Transcript').props.disabled);
 const beforeStale=writes.length;
 await act(async()=>view.update(React.createElement(QCRecordingUpload,{...props,leadId:'another-lead',value:'storage://qc-recordings/another-lead/current.mp3',onVerification:undefined,leadForm:{}})));
 await act(async()=>{releaseAuth();await Promise.resolve();});authWait=null;
 assert.equal(writes.length,beforeStale);assert(!button('Save Transcript').props.disabled);assert(!rendered().includes('Saving transcript...'));
 // A completed old request must not apply its notes or success message to the replacement source.
 let releaseWrite;writeWait=new Promise(resolve=>{releaseWrite=resolve;});const beforeLate=notes.length;
 await click('Save Transcript');await act(async()=>view.update(React.createElement(QCRecordingUpload,{...props,leadId:'third-lead',value:'storage://qc-recordings/third-lead/current.mp3',onVerification:undefined,leadForm:{}})));
 await act(async()=>{releaseWrite();await Promise.resolve();});writeWait=null;assert.equal(notes.length,beforeLate);assert(!rendered().includes('saved to QC.'));
 // Current edits are saved rather than an old transcript/summary pair; blank saves are disabled.
 const edited='Customer: The roof is seven years old. The gate code is 1234.';
 act(()=>transcriptField().props.onChange({target:{value:edited}}));await click('Save Transcript');assert.equal(writes.at(-1).row.transcript,edited);assert.equal(writes.at(-1).row.summary,recordingNotes(edited));
 act(()=>transcriptField().props.onChange({target:{value:'  '}}));assert(button('Save Transcript').props.disabled);assert(button('Copy Transcript').props.disabled);
 console.log('PASS all eight QC buttons: exact copies, clipboard fallback, regenerate/reset, selected passages, save payload, failures, auth and stale source protection');
} finally {
 if(view)act(()=>view.unmount());
 if(previousNavigator)Object.defineProperty(globalThis,'navigator',previousNavigator);else delete globalThis.navigator;
 if(previousWindow===undefined)delete globalThis.window;else globalThis.window=previousWindow;
}
