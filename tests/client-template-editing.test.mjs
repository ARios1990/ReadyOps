import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const cache = new Map();
function load(name) {
  if (cache.has(name)) return cache.get(name);
  const source = ['tsx','ts'].map(extension => new URL(`../src/${name}.${extension}`, import.meta.url)).find(path => fs.existsSync(path));
  const module = { exports: {} };
  cache.set(name, module.exports);
  const code = ts.transpileModule(fs.readFileSync(source, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  new Function('exports','require','module',code)(module.exports, id => id.startsWith('./') ? load(id.slice(2)) : require(id), module);
  return module.exports;
}
const { ClientLeadTemplate } = load('ClientLeadTemplate');
const { DEFAULT_SERVICE_TEMPLATES } = load('serviceTemplates');
const template = DEFAULT_SERVICE_TEMPLATES.find(item => item.id === 'roofing');
function Harness() {
  const [values,setValues] = React.useState({ full_name: 'Test Contact', meeting_name: 'Vincent', _service_template: template });
  return React.createElement(ClientLeadTemplate, { lead: { form_data: values }, appointment: { appointment_date: '2026-10-08', start_time: '13:00' }, editValues: values, onChange: (key,value) => setValues(previous => ({ ...previous,[key]:value })) });
}
let renderer;
act(() => { renderer = TestRenderer.create(React.createElement(Harness)); });
const meeting = () => renderer.root.findAllByType('input').find(input => input.props['aria-label']?.startsWith('Who will meet'));
act(() => meeting().props.onChange({ target: { value: 'Vincent ' } }));
assert.equal(meeting().props.value,'Vincent ');
act(() => meeting().props.onChange({ target: { value: 'Vincent De La Cruz' } }));
assert.equal(meeting().props.value,'Vincent De La Cruz');
const labelNodes = renderer.root.findAllByType('strong').map(node => node.children.join(''));
assert.ok(labelNodes.includes('Services Need:'));
assert.ok(labelNodes.includes('Claim Filed:'));
assert.ok(labelNodes.includes('Size of Hail:'));
assert.ok(labelNodes.includes('Add. Properties:'));
const notes = renderer.root.findAllByType('textarea').filter(node => node.props['aria-label'] === 'Notes');
assert.equal(notes.length, 1);
act(() => notes[0].props.onChange({ target: { value: 'Spoke with Test Contact. Call before arrival.' } }));
assert.equal(renderer.root.findAllByType('textarea').find(node => node.props['aria-label'] === 'Notes').props.value, 'Spoke with Test Contact. Call before arrival.');
act(() => renderer.unmount());
console.log('PASS ReadyMode roofing labels, editable notes, and multiword QC names');
