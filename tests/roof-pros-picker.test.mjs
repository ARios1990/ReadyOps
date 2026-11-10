import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';

const script=fs.readFileSync(new URL('../public/roof-pros-helper/google-form.js',import.meta.url),'utf8');
const background=fs.readFileSync(new URL('../public/roof-pros-helper/background.js',import.meta.url),'utf8');
const settle=()=>new Promise(resolve=>setImmediate(resolve));
async function until(test){const end=Date.now()+4000;while(!test()){if(Date.now()>end)throw Error('Fixture did not finish');await new Promise(resolve=>setTimeout(resolve,20));}}
const payload={id:'draft-one',filename:'lead.mp3',mime:'audio/mpeg',base64:Buffer.from([73,68,51,0,255]).toString('base64')};
function pickerFixture(respond,{input=true,broken=false}={}) {
  const dom=new JSDOM(input?'<input type="file">':'',{url:'https://docs.google.com/picker',runScripts:'outside-only'});
  const w=dom.window, messages=[],listeners=[],files=[];
  w.chrome={runtime:{sendMessage:async message=>{messages.push(message);return respond(message);},onMessage:{addListener:listener=>listeners.push(listener)}}};
  w.DataTransfer=class {constructor(){this.files=[];this.items={add:file=>this.files.push(file)};}};
  function addInput(){
    let el=w.document.querySelector('input');
    if(!el){el=w.document.createElement('input');el.type='file';w.document.body.append(el);}
    Object.defineProperty(el,'files',{set(value){if(broken)throw Error('Input refused the file');files.push(value);}});
    return el;
  }
  const events=[];
  if(input)addInput();
  w.document.addEventListener('input',()=>events.push('input'));
  w.document.addEventListener('change',()=>events.push('change'));
  w.eval(script);
  return {w,messages,files,events,addInput,wake:()=>listeners.forEach(listener=>listener({type:'roof_picker_upload'})),close:()=>w.close()};
}

// A fresh picker receives the exact file once, including when wake-ups overlap.
{
  const f=pickerFixture(()=>payload);f.wake();f.wake();await until(()=>f.files.length);
  assert.equal(f.files.length,1);assert.deepEqual(f.events,['input','change']);
  const file=f.files[0][0];assert.equal(file.name,payload.filename);assert.equal(file.type,payload.mime);
  const bytes=await new Promise(resolve=>{const reader=new f.w.FileReader();reader.onload=()=>resolve(new Uint8Array(reader.result));reader.readAsArrayBuffer(file);});
  assert.deepEqual([...bytes],[73,68,51,0,255]);
  f.wake();await settle();assert.equal(f.files.length,1);f.close();
}
// A preloaded picker stays available after its first inactive response.
{
  let active=false;const f=pickerFixture(()=>active?payload:{inactive:true});await settle();
  assert.equal(f.files.length,0);active=true;f.wake();await until(()=>f.files.length);assert.equal(f.files.length,1);f.close();
}
// A wake-up during an outstanding inactive response must not be lost.
{
  let resolveInitial,first=true;
  const f=pickerFixture(()=>{if(first){first=false;return new Promise(resolve=>{resolveInitial=resolve;});}return payload;});
  f.wake();resolveInitial({inactive:true});await until(()=>f.files.length);assert.equal(f.files.length,1);f.close();
}
// The input may arrive after the content script; a transfer error is reported with its draft id.
{
  const f=pickerFixture(()=>payload,{input:false});await settle();f.addInput();
  await until(()=>f.files.length);assert.equal(f.files.length,1);f.close();
  const failed=pickerFixture(message=>message.type==='picker'?payload:{success:true},{broken:true});await until(()=>failed.messages.some(m=>m.type==='picker_failed'));
  assert.equal(failed.messages[1].type,'picker_failed');assert.equal(failed.messages[1].id,payload.id);
  assert.match(failed.messages[1].message,/Input refused the file/);failed.wake();await settle();
  assert.equal(failed.messages.filter(m=>m.type==='picker_failed').length,1);failed.close();
}
// Google may replace a file input while mounting its picker. Wait for the replacement.
{
  const f=pickerFixture(()=>payload);await new Promise(resolve=>setTimeout(resolve,750));
  assert.equal(f.files.length,0,'Do not fill an input while the picker is mounting');
  f.w.document.querySelector('input').remove();f.addInput();
  await new Promise(resolve=>setTimeout(resolve,1000));assert.equal(f.files.length,0,'The replacement needs its own stable window');
  await until(()=>f.files.length);assert.equal(f.files.length,1);f.close();
}
// Default AM needs no menu activation; wait for asynchronous contract selection before Add file.
{
  const dom=new JSDOM('<div>mastersreadyservices2025@gmail.com<a href="https://accounts.google.com/AccountChooser">Account</a></div><input aria-label="Hour"><input aria-label="Minute"><div id="time"><div role="listbox"><div role="option" aria-selected="true">AM</div></div></div><div id="contract"><div role="radio" data-value="No" aria-checked="false"></div></div><div id="recording"><button>Add file</button></div>',{url:'https://docs.google.com/forms/d/e/test/viewform',runScripts:'outside-only'});
  const w=dom.window,calls=[],fields={name:'Test lead',telemarketer:'Horacio',hour:'10',minute:'00',ampm:'AM',contract:'No'};
  const radio=w.document.querySelector('[role="radio"]'),recording=w.document.getElementById('recording');
  let menuOpened=false,contractBeforeUpload=false;
  w.document.querySelector('[role="listbox"]').addEventListener('click',()=>{menuOpened=true;});
  radio.addEventListener('mouseup',()=>w.setTimeout(()=>radio.setAttribute('aria-checked','true'),30));
  recording.querySelector('button').addEventListener('click',()=>{contractBeforeUpload=radio.getAttribute('aria-checked')==='true';recording.innerHTML='lead.mp3<button>Remove file</button>';});
  w.RoofProsFormDOM={textFields:()=>[],set:(el,value)=>{el.value=value;},question:name=>w.document.getElementById({'Appointment Time':'time','Roofing Contract':'contract','Customer Recording':'recording'}[name]),selectedOption:()=> 'AM',button:(root,name)=>[...root.querySelectorAll('button')].find(el=>el.textContent===name),hasReceipt:()=>false,verify:()=>true};
  w.chrome={runtime:{sendMessage:async m=>{calls.push(m.type);return m.type==='context'?{fields,filename:'lead.mp3',phase:'prepared'}:{success:true};}}};
  w.eval(script);await until(()=>calls.includes('ready'));
  assert.equal(menuOpened,false);assert.equal(contractBeforeUpload,true);assert.equal(calls.includes('user_submit'),false);dom.window.close();
}

// Exercise the actual background handler with an in-memory IndexedDB boundary.
let records=[{id:payload.id,tabId:42,phase:'prepared',expires:Date.now()+60000,bytes:new Uint8Array([73,68,51]),filename:payload.filename,mime:payload.mime}],notices=[];
const db={transaction(){const tx={objectStore(){return {
  getAll(){const request={};queueMicrotask(()=>{request.result=structuredClone(records);request.onsuccess();});return request;},
  put(job){records=records.filter(j=>j.id!==job.id).concat(structuredClone(job));queueMicrotask(()=>tx.oncomplete());},
  delete(id){records=records.filter(j=>j.id!==id);queueMicrotask(()=>tx.oncomplete());}
};}};return tx;}};
const context=vm.createContext({URL,Uint8Array,Date,Map,Set,Promise,btoa,structuredClone,
  indexedDB:{open(){const request={};queueMicrotask(()=>{request.result=db;request.onsuccess();});return request;}},
  chrome:{runtime:{getManifest:()=>({version:'1.0.4'}),onMessage:{addListener(){}}},alarms:{create(){},onAlarm:{addListener(){}}},tabs:{sendMessage:async(tabId,message)=>{assert.equal(records[0].phase,'uploading');notices.push({tabId,message});}}}
});
vm.runInContext(background.replace(/^import .*?;\r?\n/,''),context);
const form={tab:{id:42},frameId:0,url:'https://docs.google.com/forms/d/e/1FAIpQLSeE-iKeKo_4zWEO3MOnKIBDSitr4eBMc-FC7f0eGSzXujCP1A/viewform'};
const picker={tab:{id:42},frameId:3,url:'https://docs.google.com/picker?hostId=forms'};
assert.equal((await context.handle({type:'picker'},picker)).inactive,true);
await context.handle({type:'uploading'},form);assert.equal(notices.length,1);assert.equal(notices[0].tabId,42);assert.equal(notices[0].message.type,'roof_picker_upload');
const recording=await context.handle({type:'picker'},picker);assert.equal(recording.id,payload.id);assert.equal(recording.base64,'SUQz');assert.equal(recording.token,undefined);
for(const sender of [{...picker,frameId:0},{...picker,tab:{id:99}},{...picker,url:'https://example.com/picker'},{...picker,url:'https://docs.google.com/other'}]){
  assert.equal((await context.handle({type:'picker'},sender)).inactive,true);
  assert.equal((await context.handle({type:'picker_failed',id:payload.id,message:'bad'},sender)).inactive,true);
}
assert.equal((await context.handle({type:'picker_failed',id:'different-draft',message:'bad'},picker)).inactive,true);
assert.equal((await context.handle({type:'upload_status'},form)).success,true);
await context.handle({type:'picker_failed',id:payload.id,message:'Google recording upload failed: input missing'},picker);
await assert.rejects(context.handle({type:'upload_status'},form),/input missing/);
await assert.rejects(context.handle({type:'ready'},form),/input missing/);
await assert.rejects(context.handle({type:'upload_status'},picker),/Original Roof Pros tab required/);
await assert.rejects(context.handle({type:'uploading'},form),/already been prepared/);
records[0].phase='ready';assert.equal((await context.handle({type:'picker'},picker)).inactive,true);
records[0].expires=0;await assert.rejects(context.handle({type:'picker'},picker),/expired/);
console.log('Roof Pros picker: fresh, preloaded, reused, overlapping wake-up, delayed input, exact file, error reporting and sender guards passed.');
