import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import ts from 'typescript';
const require=createRequire(import.meta.url);
const localCache = {};
function loadLocal(name) {
  if (localCache[name]) return localCache[name];
  const result = { exports: {} };
  const source = fs.readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  new Function('exports','require','module',code)(result.exports,id => id === './leadStatusPresentation' ? loadLocal('leadStatusPresentation.ts') : require(id),result);
  return localCache[name] = result.exports;
}
const { AgentStatusLabel, agentStatusStyle } = loadLocal('AgentStatusLabel.tsx');
for (const [status, kind, label, color] of [
  ['approved','qc','QC Approved','#15803D'], ['QC_DENIED','qc','QC Denied','#DC2626'],
  ['No Show','inspector','No Show','#1F2937'], ['pending','inspector','Pending','#0284C7'],
  ['good_inspected','inspector','Good','#15803D'], ['cancelled','inspector','Bad','#DC2626'],
  ['reschedule','inspector','Rescheduled','#EA580C'],
]) {
  assert.deepEqual(agentStatusStyle(status, kind), {label,color});
  const rendered = TestRenderer.create(React.createElement(AgentStatusLabel,{status,kind}));
  assert.equal(rendered.root.findByType('span').props.style.fontWeight,700);
  assert.equal(rendered.root.findByType('span').props.style.color,color);
  assert.deepEqual(rendered.root.findByType('span').children,[label]);
}
global.window={scrollTo(){},location:{origin:'https://readyops.bolt.host',pathname:'/agent/joey/test-token'}};
const module={exports:{}};
const source=fs.readFileSync(new URL('../src/AgentWorkspace.tsx',import.meta.url),'utf8');
const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
new Function('exports','require','module',code)(module.exports,id=>id.endsWith('.css')?{}:id==='./ThemeContext'?{ThemeToggle:()=>React.createElement('button',null,'Light / Dark')}:id==='./brand'?{READYOPS_LOGO_DATA_URI:'logo'}:id==='./dateDisplay'?loadLocal('dateDisplay.ts'):id==='./portalUtils'?{formatDateLong:v=>v,formatTime:v=>v}:id==='./AgentStatusLabel'?{AgentStatusLabel}:id==='./PersonalPortalLink'?loadLocal('PersonalPortalLink.tsx'):require(id),module);
const {AgentWorkspace,isUnsuccessful}=module.exports;
const base={company_name:'Roofing Co',phone:'5551234567',address:'123 Very Long Address, Example City, TX 12345',appointment_date:'2026-10-13',start_time:'12:00',payroll_week_start:'2026-10-11',payroll_week_end:'2026-10-17',pay_date:'2026-10-24',qc_status:'approved'};
const rows=[['good','approved','good'],['bad','approved','Bad'],['no-show','approved','No Show'],['cancelled','approved','cancelled'],['denied','denied','no_show'],['correction','needs_correction','pending']].map(([name,qc_status,client_status])=>({...base,name,lead_id:name,qc_status,client_status}));
assert.equal(rows.filter(isUnsuccessful).length,4,'Bad, canceled, No Show, and QC Denied are included without counting denied/no-show twice');
assert.equal(isUnsuccessful({...base,client_status:'no-show'}),true);
let corrected;let renderer;
act(()=>{renderer=TestRenderer.create(React.createElement(AgentWorkspace,{name:'Joey',token:'test-token',rows,companies:[{id:'company',name:'Roofing Co',public_slug:'roofing',state:'TX'}],mode:'this',setMode(){},payDate:'',setPayDate(){},payDates:['2026-10-24'],range:{start:'2026-10-11',end:'2026-10-17'},loading:false,message:'',error:'',reload(){},correct:row=>corrected=row.lead_id}));});
const text=node=>node.children.map(c=>typeof c==='string'?c:text(c)).join('');
const click=label=>act(()=>renderer.root.findAllByType('button').find(n=>text(n)===label).props.onClick());
click('View unsuccessful leads');
assert.equal(renderer.root.findAllByProps({className:'aw-lead'}).length,4);
act(()=>renderer.root.findByProps({'aria-label':'Lead status'}).props.onChange({target:{value:'no_show'}}));
assert.equal(renderer.root.findAllByProps({className:'aw-lead'}).length,1);
act(()=>renderer.root.findByProps({'aria-label':'Lead status'}).props.onChange({target:{value:'needs_correction'}}));
click('Open & Correct');assert.equal(corrected,'correction');
click('Book');
const link=renderer.root.findAllByType('a')[0];assert.ok(link.props.href.includes('agent_token=test-token&agent=Joey'));
act(()=>renderer.root.findByProps({'aria-label':'Find a company'}).props.onChange({target:{value:'missing'}}));assert.equal(renderer.root.findAllByType('a').length,0);
assert.ok(renderer.root.findAllByType('button').some(n=>text(n)==='Light / Dark'));
console.log('PASS agent unsuccessful categories, filters, original correction callback, booking attribution, search, and theme control');

const {PersonalPortalLink}=loadLocal('PersonalPortalLink.tsx');
let copied='';
Object.defineProperty(globalThis,'navigator',{value:{clipboard:{writeText:async value=>{copied=value;}}},configurable:true});
let linkView;
act(()=>{linkView=TestRenderer.create(React.createElement(PersonalPortalLink,{name:'Joey'}));});
assert.equal(linkView.root.findByType('input').props.value,'https://readyops.bolt.host/agent/joey/test-token');
assert.equal(linkView.root.findByType('input').props.readOnly,true);
await act(async()=>{await linkView.root.findByType('button').props.onClick();});
await act(async()=>{});
assert.equal(copied,'https://readyops.bolt.host/agent/joey/test-token');
assert.ok(renderer.root.findAllByType('option').some(n=>text(n)==='All Leads'));
console.log('PASS personal portal link visibility, exact copying, and All Leads choice');