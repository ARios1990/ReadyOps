import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import ts from 'typescript';
const require=createRequire(import.meta.url), cache=new Map();
function load(name){if(cache.has(name))return cache.get(name);const path=['tsx','ts'].map(ext=>new URL(`../src/${name}.${ext}`,import.meta.url)).find(p=>fs.existsSync(p));const module={exports:{}};const code=ts.transpileModule(fs.readFileSync(path,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;new Function('exports','require','module',code)(module.exports,id=>id.startsWith('./')?load(id.slice(2)):require(id),module);cache.set(name,module.exports);return module.exports;}
const {formatRoofAge,formatStories,normalizeStoriesInput,normalizePropertyUnits}=load('portalUtils');
for(const [input,expected] of [['10','10 Years'],['10 years','10 Years'],['1 year','1 Year'],['10+','10+ Years'],['7-10 Years','7-10 Years'],['','—'],['Unknown','Unknown']])assert.equal(formatRoofAge(input),expected);
for(const [input,expected] of [['2','2 Stories'],['1','1 Story'],['1 story','1 Story'],['2 STORIES','2 Stories'],['1.5','1.5 Stories'],['Unknown','Unknown'],['','—']])assert.equal(formatStories(input),expected);
assert.equal(normalizeStoriesInput('2 Stories'),'2');
assert.deepEqual(normalizePropertyUnits({roof_age:'10 Years',stories:'2 Stories',notes:'Keep notes'}),{roof_age:'10',stories:'2',notes:'Keep notes'});
assert.deepEqual(normalizePropertyUnits({notes:'Only notes'}),{notes:'Only notes'});
const {UnitAnswerInput}=load('UnitAnswerInput');
let saved,renderer;
function Harness({field,initial}){const[value,setValue]=React.useState(initial);return React.createElement(UnitAnswerInput,{field,value,onValueChange:v=>{saved=v;setValue(v);}});}
act(()=>renderer=TestRenderer.create(React.createElement(Harness,{field:'roof_age',initial:'10'})));
assert.equal(renderer.root.findByType('input').props.value,'10 Years');
act(()=>renderer.root.findByType('input').props.onFocus());assert.equal(renderer.root.findByType('input').props.value,'10');
act(()=>renderer.root.findByType('input').props.onChange({target:{value:'12 years'}}));assert.equal(renderer.root.findByType('input').props.value,'12 years');
act(()=>renderer.root.findByType('input').props.onBlur());assert.equal(saved,'12');assert.equal(renderer.root.findByType('input').props.value,'12 Years');
const pattern=renderer.root.findByType('input').props.pattern;assert.ok(new RegExp(`^(?:${pattern})$`).test('12 Years'));
act(()=>renderer.root.findByType('input').props.onFocus());act(()=>renderer.root.findByType('input').props.onChange({target:{value:''}}));act(()=>renderer.root.findByType('input').props.onBlur());assert.equal(saved,'');assert.equal(renderer.root.findByType('input').props.value,'');
act(()=>renderer.unmount());act(()=>renderer=TestRenderer.create(React.createElement(Harness,{field:'stories',initial:'2 Stories'})));assert.equal(renderer.root.findByType('input').props.value,'2 Stories');act(()=>renderer.root.findByType('input').props.onFocus());assert.equal(renderer.root.findByType('input').props.value,'2');act(()=>renderer.root.findByType('input').props.onChange({target:{value:'1 story'}}));act(()=>renderer.root.findByType('input').props.onBlur());assert.equal(saved,'1');assert.equal(renderer.root.findByType('input').props.value,'1 Story');
console.log('PASS year/story units, singular/plural, ranges, existing units, empty/unknown values, edit-on-focus, blur formatting, valid browser pattern, and canonical saved values');
