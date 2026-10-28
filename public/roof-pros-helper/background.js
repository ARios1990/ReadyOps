import {audioType,recordingBytes} from './audio.js';
const ORIGIN = 'https://readyops.bolt.host';
const API = 'https://vzaraqexdsimmasxsano.supabase.co/functions/v1/roof-pros-manual-review';
const FORM = 'https://docs.google.com/forms/d/e/1FAIpQLSeE-iKeKo_4zWEO3MOnKIBDSitr4eBMc-FC7f0eGSzXujCP1A/viewform?pli=1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EXCLUDED = new Set(['44f9d82b-2247-4185-bae6-44ca6a2aa013','c1fc6f84-4c9f-469e-a036-8d08e7c4b53d','52123081-6cc7-48d0-bad8-8fc96ebf0141','9f158006-8bce-4928-aa13-8c686d00d91a']);
const database = new Promise((resolve,reject) => {
  const r = indexedDB.open('readyops-roof-manual', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('jobs', {keyPath:'id'});
  r.onsuccess = () => resolve(r.result); r.onerror = () => reject(Error('Helper storage unavailable.'));
});
async function jobs() {const db=await database; return new Promise((resolve,reject)=>{const r=db.transaction('jobs').objectStore('jobs').getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
async function save(job) {const db=await database; return new Promise((resolve,reject)=>{const t=db.transaction('jobs','readwrite');t.objectStore('jobs').put(job);t.oncomplete=resolve;t.onerror=()=>reject(t.error);});}
async function remove(id) {const db=await database; return new Promise((resolve,reject)=>{const t=db.transaction('jobs','readwrite');t.objectStore('jobs').delete(id);t.oncomplete=resolve;t.onerror=()=>reject(t.error);});}
async function exchange(job, action, evidence={}) {
  const response=await fetch(API,{method:'POST',headers:{'Content-Type':'application/json'},credentials:'omit',cache:'no-store',body:JSON.stringify({id:job.id,token:job.token,action,evidence})});
  const data=await response.json(); if(!response.ok)throw Error(data.error || 'Manual review could not be confirmed.'); return data;
}
const encoded = bytes => {let raw='';for(let i=0;i<bytes.length;i+=32768)raw+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(raw);};
const isForm = url => {try {const u=new URL(url);return u.origin==='https://docs.google.com'&&/^\/forms\/(?:u\/\d+\/)?d\/e\/1FAIpQLSeE-iKeKo_4zWEO3MOnKIBDSitr4eBMc-FC7f0eGSzXujCP1A\//.test(u.pathname);} catch{return false;}};
const pending = new Map();
async function handle(m,sender) {
  const u=new URL(sender.url || 'https://invalid.local');
  if(['ping','prepare','resume'].includes(m.type)) {
    if(u.origin!==ORIGIN || sender.frameId!==0)throw Error('ReadyOps access required.');
    if(m.type==='ping')return {success:true,version:'1.0.0'};
    const existing=(await jobs()).find(j=>j.delivery_id===(m.deliveryId || m.ticket?.delivery_id)&&j.phase!=='failed');
    if(existing) {await chrome.tabs.update(existing.tabId,{active:true});return {success:true};}
    if(m.type==='resume')throw Error('The original prepared tab is unavailable in this Chrome profile. Review its outcome before preparing another form.');
    const ticket=m.ticket;
    if(!ticket || !['id','token','delivery_id','lead_id'].every(k=>UUID.test(ticket[k]||'')) || EXCLUDED.has(ticket.lead_id))throw Error('Invalid or protected lead.');
    const job={...ticket,expires:Date.now()+2*60*60*1000,phase:'loading',tabId:null};
    try {
      const data=await exchange(job,'context');
      if(data.lead_id!==ticket.lead_id || data.fields.telemarketer!=='Horacio' || data.form_url!==FORM)throw Error('Lead mismatch.');
      const audioURL=new URL(data.recording_url);
      if(audioURL.origin!=='https://vzaraqexdsimmasxsano.supabase.co'||!audioURL.pathname.includes('/qc-recordings/'+ticket.lead_id+'/'))throw Error('Recording belongs to a different lead.');
      const response=await fetch(audioURL,{credentials:'omit',cache:'no-store'});
      const bytes=await recordingBytes(response,Math.min(data.max_bytes,10*1024*1024));
      const kind=audioType(bytes,response.headers.get('Content-Type'));
      const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
      Object.assign(job,{fields:data.fields,bytes,mime:kind.mime,filename:ticket.lead_id+'.'+kind.ext,sha256:hash,phase:'prepared'});
      const tab=await chrome.tabs.create({url:FORM,active:true});job.tabId=tab.id;await save(job);
      return {success:true};
    } catch(error) {await exchange(job,'failed',{message:error.message}).catch(()=>{});throw error;}
  }
  const job=(await jobs()).find(j=>j.tabId===sender.tab?.id);
  if(!job)return {inactive:true};
  if(job.expires<Date.now())throw Error('Manual review expired. Keep this tab and review its outcome before retrying.');
  if(m.type==='picker') {
    if(sender.frameId===0 || u.origin!=='https://docs.google.com'||u.pathname!=='/picker'||job.phase!=='uploading')return {inactive:true};
    return {filename:job.filename,mime:job.mime,base64:encoded(job.bytes)};
  }
  if(!isForm(sender.url)||sender.frameId!==0)throw Error('Original Roof Pros tab required.');
  if(m.type==='context')return {fields:job.fields,filename:job.filename,phase:job.phase,expires:job.expires};
  if(m.type==='uploading') {if(job.phase!=='prepared')throw Error('This draft has already been prepared.');job.phase='uploading';await save(job);return {success:true};}
  if(m.type==='ready') {
    if(!['uploading','ready'].includes(job.phase))throw Error('Recording preparation is incomplete.');
    if(job.phase!=='ready')await exchange(job,'ready',{filename:job.filename,sha256:job.sha256,bytes:job.bytes.length});
    job.phase='ready';await save(job);return {success:true};
  }
  if(m.type==='user_submit') {
    if(job.phase!=='ready'&&job.phase!=='submit_requested')throw Error('Verify the completed form first.');
    job.phase='submit_requested';await save(job);
    const request=exchange(job,'user_submit');pending.set(job.id,request);try{await request;}finally{pending.delete(job.id);}return {success:true};
  }
  if(m.type==='receipt') {
    if(job.phase!=='submit_requested')throw Error('No user Submit was observed.');
    if(pending.has(job.id))await pending.get(job.id);
    try {await exchange(job,'receipt',{receipt:'Your response has been recorded.'});}
    catch(error) {await exchange(job,'uncertain',{message:'Google receipt appeared, but ReadyOps confirmation needs review. Do not submit again.'}).catch(()=>{});throw error;}
    // Remove the capability, customer fields and audio immediately after confirmation.
    await remove(job.id);return {success:true};
  }
  if(m.type==='failed') {await exchange(job,'failed',{message:String(m.message||'Preparation needs review').slice(0,500)});job.phase='failed';delete job.bytes;delete job.fields;await save(job);return {success:true};}
  throw Error('Unsupported manual review action.');
}
chrome.runtime.onMessage.addListener((m,sender,reply)=>{handle(m,sender).then(reply).catch(e=>reply({error:e.message}));return true;});
chrome.alarms.create('manual-data-cleanup',{periodInMinutes:10});
chrome.alarms.onAlarm.addListener(async alarm=>{if(alarm.name==='manual-data-cleanup')for(const j of await jobs())if(j.expires<Date.now())await remove(j.id);});
