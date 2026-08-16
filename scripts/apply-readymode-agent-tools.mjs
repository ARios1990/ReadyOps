import fs from 'node:fs';
const path='src/PortalAdmin.tsx';
let c=fs.readFileSync(path,'utf8');
const importNeedle="import { copyText, formatTime, localDate, rpcError } from './portalUtils';\n";
if(!c.includes("import { ReadyModeAgentTools } from './ReadyModeAgentTools';")){
  if(!c.includes(importNeedle)) throw new Error('PortalAdmin import target not found');
  c=c.replace(importNeedle, importNeedle+"import { ReadyModeAgentTools } from './ReadyModeAgentTools';\n");
}
const startNeedle='<section className="rounded-2xl border bg-white"><div className="border-b p-4"><h2 className="font-bold">Agent Personal Links</h2>';
const start=c.indexOf(startNeedle);
if(start<0) throw new Error('Agent Personal Links section not found');
const endNeedle='</section>\n </main></div>';
const end=c.indexOf(endNeedle,start);
if(end<0) throw new Error('Agent Personal Links section end not found');
const replacement='<ReadyModeAgentTools agents={agents} companies={companies} />\n ';
c=c.slice(0,start)+replacement+c.slice(end+'</section>\n '.length);
fs.writeFileSync(path,c);
console.log('ReadyMode agent tools integrated');
