import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import React from 'react';
import TestRenderer, {act} from 'react-test-renderer';
import ts from 'typescript';

const require=createRequire(import.meta.url), cache=new Map();
let release, fail=false, uploads=[], applied=[], submits=0;
global.window={location:{pathname:'/book/test'},localStorage:{getItem:()=> 'test-session',setItem(){}}};
const supabase={
 functions:{async invoke(){return {data:{path:'company/agent/reservation/audio.mp3',token:'test',recording_url:'storage://qc-recordings/company/agent/reservation/audio.mp3'}};}},
 storage:{from:()=>({
   async uploadToSignedUrl(path,token,file){uploads.push(file);await new Promise(resolve=>{release=resolve;});return {error:fail?new Error('Test upload failed'):null};},
   async upload(path,file){uploads.push({path,file});return {error:fail?new Error('Test upload failed'):null};},
 })},
};
function load(name){
 if(cache.has(name))return cache.get(name);
 const file=['tsx','ts'].map(ext=>new URL(`../src/${name}.${ext}`,import.meta.url)).find(file=>fs.existsSync(file));
 const module={exports:{}};cache.set(name,module.exports);
 const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 new Function('exports','module','require',code)(module.exports,module,id=>{
   if(id==='./supabase')return {supabase};
   if(id==='./localWhisperClient')return {transcribeWithLocalWhisper:async()=> 'Recorded words from the selected audio.'};
   return id.startsWith('./')?load(id.slice(2)):require(id);
 });
 return module.exports;
}
const settle=async action=>act(async()=>{await action?.();for(let n=0;n<12;n++)await Promise.resolve();});
const {DynamicLeadForm}=load('DynamicLeadForm');
const schema=[{id:'additional',title:'Additional',fields:[{key:'recording_url',type:'recording',label:'Recording'}]}];
function Form(){
 const [values,setValues]=React.useState({});
 return React.createElement(DynamicLeadForm,{schema,values,recordingUploadSlug:'test',onChange:(key,value)=>setValues(v=>({...v,[key]:value})),onSubmit:()=>submits++});
}
let renderer;
await settle(()=>{renderer=TestRenderer.create(React.createElement(Form));});
const input=()=>renderer.root.findAllByType('input').find(node=>node.props.type==='file');
const submit=()=>renderer.root.findAllByType('button').find(node=>node.props.type==='submit');
const trigger=()=>renderer.root.findByType('form').props.onSubmit({preventDefault(){}});
const audio=new File(['sample audio'],'call.mp3',{type:'audio/mpeg'});
await settle(()=>input().props.onChange({target:{files:[audio]},currentTarget:{value:''}}));
assert.equal(submit().props.disabled,true);
await settle(trigger);
assert.equal(submits,0,'Enter/programmatic form submission is blocked during upload');
await settle(()=>release());
assert.equal(submit().props.disabled,false);
await settle(trigger);assert.equal(submits,1);
fail=true;
await settle(()=>input().props.onChange({target:{files:[audio]},currentTarget:{value:''}}));
await settle(()=>release());
assert.equal(submit().props.disabled,true,'Failure cannot silently submit the previous recording');
await settle(trigger);assert.equal(submits,1);
await settle(()=>renderer.root.findAllByType('button').find(node=>node.children.join('')==='Keep the previously attached recording').props.onClick());
assert.equal(submit().props.disabled,false);
await settle(()=>renderer.unmount());

// The importer must retain the exact selected File, including when transcription
// fails; a text transcript must never masquerade as an audio attachment.
const {RecordingCallLogImport}=load('RecordingCallLogImport');
await settle(()=>{renderer=TestRenderer.create(React.createElement(RecordingCallLogImport,{disabled:false,onApply:draft=>applied.push(draft)}));});
const csv=new File(['First Name,Last Name,Phone,Address,City,State,Zip Code\nTest,Customer,2105550123,12 Oak St,Converse,TX,78109'],'calls.csv');
await settle(()=>renderer.root.findByProps({'aria-label':'Upload call log CSV'}).props.onChange({target:{files:[csv]}}));
// File.arrayBuffer() resolves asynchronously outside React's microtask queue.
await act(async()=>{await new Promise(resolve=>setImmediate(resolve));});
const matchedAudio=new File(['sample audio'],'2105550123.mp3',{type:'audio/mpeg'});
await settle(()=>renderer.root.findByProps({'aria-label':'Upload call recordings'}).props.onChange({target:{files:[matchedAudio]}}));
await settle(()=>renderer.root.findByProps({'aria-label':'Recording language'}).props.onChange({target:{value:'en'}}));
await settle(()=>renderer.root.findAllByType('button').find(node=>node.children.some(child=>typeof child==='string'&&child.includes('Prepare forms automatically'))).props.onClick());
let fill=renderer.root.findAllByType('button').find(node=>node.children.join('')==='Fill booking form');
assert.ok(fill,'The audio should produce a prepared draft');
await settle(()=>fill.props.onClick());
assert.equal(applied[0].recordingFile,matchedAudio);
assert.equal(applied[0].values.recordingFile,undefined);
const transcript=new File(['Written transcript'],'2105550123.txt',{type:'text/plain'});
await settle(()=>renderer.root.findByProps({'aria-label':'Upload call recordings'}).props.onChange({target:{files:[transcript]}}));
await settle(()=>renderer.root.findAllByType('button').find(node=>node.children.some(child=>typeof child==='string'&&child.includes('Prepare forms automatically'))).props.onClick());
fill=renderer.root.findAllByType('button').find(node=>node.children.join('')==='Fill booking form');
await settle(()=>fill.props.onClick());
assert.equal(applied[1].recordingFile,undefined);
await settle(()=>renderer.unmount());

const {uploadQCRecording,validateRecordingFile}=load('recordingUpload');
fail=false;
const url=await uploadQCRecording(audio,'selected-lead');
assert.ok(url.startsWith('storage://qc-recordings/selected-lead/'));
assert.equal(uploads.at(-1).file,audio);
fail=true;await assert.rejects(()=>uploadQCRecording(audio,'selected-lead'),/upload failed/);
assert.throws(()=>validateRecordingFile(new File([],'empty.mp3')),/empty/);
assert.throws(()=>validateRecordingFile({size:104857601}),/100 MB/);
console.log('PASS slow uploads, failed replacements, explicit cancellation, original audio retention, transcript-only imports, QC upload and size checks');
