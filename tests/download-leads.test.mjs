import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const source = fs.readFileSync(new URL('../src/downloadLeadRows.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { downloadLeadRows } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const leads = Array.from({ length: 534 }, (_, id) => ({ id }));
const requests = [];
const result = await downloadLeadRows(async (offset, limit) => {
  requests.push([offset, limit]);
  return { rows: leads.slice(offset, offset + limit), total: leads.length };
});
assert.deepEqual(result, leads);
assert.deepEqual(requests, [[0, 200], [200, 200], [400, 200]]);
assert.deepEqual(await downloadLeadRows(async () => ({ rows: [], total: 0 })), []);
await assert.rejects(downloadLeadRows(async (offset) => {
  if (offset) throw new Error('Request failed');
  return { rows: leads.slice(0, 200), total: 534 };
}), /Request failed/);
await assert.rejects(downloadLeadRows(async (offset) => ({ rows: offset ? [] : leads.slice(0, 200), total: 534 })), /Refresh and try again/);
console.log('PASS downloads every page, handles an empty result, and rejects failed or incomplete exports');
