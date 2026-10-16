import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
import {PDFDocument} from 'pdf-lib';
const require=createRequire(import.meta.url),module={exports:{}},dates={exports:{}};
new Function('exports','module',ts.transpileModule(fs.readFileSync(new URL('../src/dateDisplay.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(dates.exports,dates);
new Function('exports','require','module',ts.transpileModule(fs.readFileSync(new URL('../src/paystub.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText)(module.exports,id=>id==='./dateDisplay'?dates.exports:require(id),module);
const {payrollTotals,buildPaystubPdf}=module.exports;
assert.deepEqual(payrollTotals([{pay_structure:'base_only',base_pay:3200,bonus:100,deductions:150,total_pay:3150}]),{base:3200,commission:0,bonus:100,deductions:150,gross:3300,net:3150});
assert.equal(payrollTotals([{pay_structure:'hourly',hours:40,hourly_rate:20,bonus:50,deductions:25}]).net,825);
assert.equal(payrollTotals([{pay_structure:'commission_only',qualified_leads:8,lead_rate:50,signed_contracts:2,signed_contract_rate:100}]).net,600);
assert.equal(payrollTotals([{pay_structure:'base_only',base_pay:100,deductions:200}]).gross,100);
assert.equal(payrollTotals([{pay_structure:'base_only',base_pay:100,deductions:200}]).net,0);
const entries=Array.from({length:18},(_,index)=>({agent_name:`Sample Agent ${index+1} With A Longer Name For Layout Review`,team_name:'QA Sample Team',pay_structure:'base_only',base_pay:3200,bonus:100,deductions:150,total_pay:3150,status:'paid',payment_date:'2026-10-12',payment_method:'Bank transfer',payment_recorded_by_name:'Test Administrator'}));
const bytes=await buildPaystubPdf({title:'QA sample - not an actual payroll record',period:{week_start:'2026-10-12',week_end:'2026-10-18'},entries});
const pdf=await PDFDocument.load(bytes);assert.ok(pdf.getPageCount()>1);assert.equal(pdf.getTitle(),'QA sample - not an actual payroll record - Masters Ready Paystub');
if(process.env.PAYSTUB_QA_PATH){fs.mkdirSync(new URL('../tmp/pdfs/',import.meta.url),{recursive:true});fs.writeFileSync(process.env.PAYSTUB_QA_PATH,bytes);}
console.log('PASS authoritative saved totals, base/hourly/commission earnings, net-pay floor, and multipage PDF export');
