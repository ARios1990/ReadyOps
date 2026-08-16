import fs from 'node:fs';
const p='src/CompanyPortal.tsx';
const c=fs.readFileSync(p,'utf8');
const from="const note = window.prompt('Inspector / company notes (optional)', appointment.inspector_notes || '') ?? appointment.inspector_notes || '';";
const to="const note = window.prompt('Inspector / company notes (optional)', appointment.inspector_notes || '') ?? (appointment.inspector_notes || '');";
if(!c.includes(from)) throw new Error('QC CI target not found');
fs.writeFileSync(p,c.replace(from,to));
// trigger
