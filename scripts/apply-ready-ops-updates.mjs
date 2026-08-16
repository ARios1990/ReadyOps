import fs from 'node:fs';

const path = 'src/AgentBookingPortal.tsx';
let source = fs.readFileSync(path, 'utf8');

function replaceRequired(from, to) {
  if (!source.includes(from)) throw new Error(`Expected source not found: ${from}`);
  source = source.replace(from, to);
}

replaceRequired(
  "  const weekLabel = `${formatDateShort(startDate)} – ${formatDateShort(endDate)}`;",
  "  const weekLabel = `${formatDateShort(startDate)} – ${formatDateShort(endDate)}`;\n  const leadTemplate = typeof confirmation?.form_data?.lead_template === 'string'\n    ? confirmation.form_data.lead_template\n    : '';",
);

replaceRequired(
  '{confirmation.form_data?.lead_template && (',
  '{leadTemplate && (',
);

replaceRequired(
  'onClick={() => void copyText(String(confirmation.form_data.lead_template))}',
  'onClick={() => void copyText(leadTemplate)}',
);

replaceRequired(
  '{String(confirmation.form_data.lead_template)}',
  '{leadTemplate}',
);

fs.writeFileSync(path, source);
console.log('Ready Ops lead template typing fixed.');
