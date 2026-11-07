import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import React from 'react';
import TestRenderer,{act} from 'react-test-renderer';
import ts from 'typescript';
const require=createRequire(import.meta.url);
const requests=[];
const periods=[{id:'a',week_start:'2026-10-11',week_end:'2026-10-17',status:'review'},{id:'b',week_start:'2026-10-18',week_end:'2026-10-24',status:'review'}];
const supabase={
 from(table){const result={data:table==='payroll_periods'?periods:[]};return{select(){return{...result,order:async()=>result};}};},
 rpc(name,args){if(name==='readyops_agent_privileged_fields')return Promise.resolve({data:[]});assert.equal(name,'get_readyops_payroll_presentation');return new Promise(resolve=>requests.push({period:args.p_period_id,resolve}));}
};
const code=ts.transpileModule(fs.readFileSync(new URL('../src/AdminPayroll.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const mod={exports:{}};
const wrapper=({children})=>React.createElement('section',null,children);
new Function('exports','require','module',code)(mod.exports,id=>id==='./supabase'?{supabase}:id==='./dateDisplay'?{formatDate:value=>value}:id==='./MastersReady'?{MastersSection:wrapper}:id==='./HorizontalScrollFrame'?{HorizontalScrollFrame:wrapper}:id==='./PayrollPresentation'?{PayrollPresentation:props=>React.createElement('div',{'data-testid':'presentation','data-period':props.period?.id,'data-agents':props.entries.map(entry=>entry.agent_name).join(',')})}:require(id),mod);
const settle=fn=>act(async()=>{fn?.();for(let i=0;i<12;i++)await Promise.resolve();});
let view;await settle(()=>view=TestRenderer.create(React.createElement(mod.exports.AdminPayroll)));
const picker=()=>view.root.findAllByType('select').find(node=>node.props.value==='a'||node.props.value==='b'||node.props.value==='');
const response=name=>({data:{entries:[{id:name,agent_id:name,agent_name:name,status:'pending'}],leads:[]}});
assert.equal(requests.length,1,'Initial period loads once');
await settle(()=>picker().props.onChange({target:{value:'b'}}));
assert.equal(requests[1].period,'b');
await settle(()=>requests[1].resolve(response('Agent B')));
assert.equal(view.root.findByProps({'data-testid':'presentation'}).props['data-agents'],'Agent B');
await settle(()=>requests[0].resolve(response('Agent A')));
assert.equal(view.root.findByProps({'data-testid':'presentation'}).props['data-period'],'b');
assert.equal(view.root.findByProps({'data-testid':'presentation'}).props['data-agents'],'Agent B','Late prior-week response cannot overwrite selected week');
await settle(()=>picker().props.onChange({target:{value:'a'}}));
assert.equal(view.root.findByProps({'data-testid':'presentation'}).parent.parent.props.hidden,true,'Previous-week payment controls hidden during loading');
await settle(()=>requests[2].resolve({error:{message:'Period unavailable'}}));
assert.equal(view.root.findByProps({'data-testid':'presentation'}).props['data-agents'],'','Failed period fetch cannot retain earlier paid records');
await settle(()=>picker().props.onChange({target:{value:''}}));
assert.equal(view.root.findByProps({'data-testid':'presentation'}).props['data-agents'],'');
assert.equal(requests.length,3,'No-period selection does not fetch stale data');
act(()=>view.unmount());
console.log('PASS payroll period loading ignores stale responses and clears prior payment records on changes and failures');
