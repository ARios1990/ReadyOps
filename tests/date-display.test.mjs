import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const module={exports:{}};
new Function('exports','module',ts.transpileModule(fs.readFileSync(new URL('../src/dateDisplay.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(module.exports,module);
const {formatDate,formatDateTime}=module.exports;
for(const timezone of ['America/Los_Angeles','America/Mexico_City','Pacific/Auckland']) {
 process.env.TZ=timezone;
 assert.equal(formatDate('2026-01-02'),'01/02/2026');
 assert.equal(formatDate('2024-02-29'),'02/29/2024');
 assert.equal(formatDate('2026-12-31'),'12/31/2026');
 assert.equal(formatDate('2026-02-30'),'2026-02-30');
 assert.equal(formatDate(null),'');
 assert.match(formatDateTime(new Date(2026,0,2,15,4)),/^01\/02\/2026 3:04 PM$/);
}
console.log('PASS padded US dates, leap dates, timestamp display and calendar-date stability across timezones');
