import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const source=fs.readFileSync(new URL('../supabase/functions/agent-recording-upload-token/index.ts',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'');
const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
let handler, signed=[], filters;
const reservations=[
 {id:'newer-tab',reservation_token:'other-token',session_id:'session',company_id:'company',status:'active'},
 {id:'selected-tab',reservation_token:'selected-token',session_id:'session',company_id:'company',status:'active'},
];
const admin={from(table){
 const query={constraints:{},select(){return this;},eq(key,value){this.constraints[key]=value;return this;},gt(){return this;},order(){return this;},limit(){return this;},
   async maybeSingle(){return {data:{company_id:'company',public_slug:'test',portal_enabled:true}};},
   then(resolve){filters=this.constraints;return Promise.resolve({data:reservations.filter(row=>Object.entries(this.constraints).every(([k,v])=>row[k]===v)).slice(0,1)}).then(resolve);},
 };return query;
},storage:{from:()=>({async createSignedUploadUrl(path){signed.push(path);return {data:{token:'signed-token'}};}})}};
new Function('Deno','createClient',code)({serve(fn){handler=fn;},env:{get:()=> 'server-test'}},()=>admin);
const request=body=>handler(new Request('https://test.invalid',{method:'POST',body:JSON.stringify({session_id:'session',slug:'test',filename:'audio.mp3',...body})}));
let response=await request({reservation_token:'selected-token'});
assert.equal(response.status,200);
assert.ok((await response.json()).path.startsWith('company/agent/selected-tab/'));
assert.equal(filters.reservation_token,'selected-token');
response=await request({reservation_token:'unrelated-token'});
assert.equal(response.status,409);assert.equal(signed.length,1,'An invalid token must not fall back to another tab');
response=await request({reservation_token:'selected-token',session_id:'other-session'});
assert.equal(response.status,409);assert.equal(signed.length,1);
response=await request({});assert.equal(response.status,200,'Older open forms remain compatible');
console.log('PASS selected reservation binding, invalid token rejection, session ownership and older-form compatibility');
