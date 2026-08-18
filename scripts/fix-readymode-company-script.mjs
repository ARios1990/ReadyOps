import fs from 'node:fs';

const path = 'src/ReadyModeAgentTools.tsx';
let code = fs.readFileSync(path, 'utf8');

function replaceOnce(from, to, label) {
  if (!code.includes(from)) throw new Error(`Missing ${label}`);
  code = code.replace(from, to);
}

replaceOnce(
  "    () => companies.filter(company => company.agent_link && company.public_slug),",
  "    () => companies.filter(company => (company.plain_agent_link || company.agent_link) && company.public_slug),",
  'selectable companies filter',
);

replaceOnce(
  "  const selectedCompany = selectableCompanies.find(company => company.company_id === companyId) || null;\n  const bookingBase = selectedCompany ? `${location.origin}${selectedCompany.agent_link}` : '';",
  "  const selectedCompany = selectableCompanies.find(company => company.company_id === companyId) || null;\n  const bookingPath = selectedCompany\n    ? String(selectedCompany.plain_agent_link || selectedCompany.agent_link || '').split('?')[0].split('#')[0]\n    : '';\n  const bookingBase = bookingPath ? `${location.origin}${bookingPath}` : '';",
  'plain booking base',
);

replaceOnce(
  "        <div className=\"max-w-xl rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800\">\n          Agent Name: <strong>Automatically populated from ReadyMode User.Name</strong><br />\n          Recording: <strong>Automatically populated from Profile.Recording URL when available</strong>\n        </div>",
  "        <div className=\"max-w-xl rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800\">\n          Agent Name: <strong>Automatically populated from ReadyMode User.Name</strong><br />\n          Recording: <strong>Automatically populated from Profile.Recording URL when available</strong>\n          {selectedCompany && <><br />Target: <strong>{selectedCompany.company_name} → {bookingPath}</strong></>}\n        </div>",
  'target display',
);

replaceOnce(
  "function buildReadyModeUrlTemplate(baseUrl: string): string {\n  const fixed = [",
  "function cleanBookingBase(baseUrl: string): string {\n  return baseUrl.split('?')[0].split('#')[0];\n}\n\nfunction buildReadyModeUrlTemplate(baseUrl: string): string {\n  const cleanBase = cleanBookingBase(baseUrl);\n  const fixed = [",
  'URL clean helper',
);

replaceOnce(
  "  return `${baseUrl}?${[...fixed, ...macros.map(([key, value]) => `${key}=${value}`)].join('&')}`;",
  "  return `${cleanBase}?${[...fixed, ...macros.map(([key, value]) => `${key}=${value}`)].join('&')}`;",
  'URL template clean base',
);

replaceOnce(
  "function buildReadyModeScript(baseUrl: string): string {\n  return `<iframe id=\"mastersForm\"",
  "function buildReadyModeScript(baseUrl: string): string {\n  const cleanBase = cleanBookingBase(baseUrl);\n  return `<iframe id=\"mastersForm\"",
  'script clean base',
);

replaceOnce(
  "  const readyOpsUrl = ${JSON.stringify(baseUrl)} + '?' + params.toString();\\n  console.log('Ready Ops URL:', readyOpsUrl);",
  "  const readyOpsTarget = new URL(${JSON.stringify('__CLEAN_BASE__')});\\n  readyOpsTarget.search = params.toString();\\n  const readyOpsUrl = readyOpsTarget.toString();\\n  console.log('Ready Ops company target:', readyOpsTarget.pathname);\\n  console.log('Ready Ops URL:', readyOpsUrl);",
  'script URL construction',
);

code = code.replace("${JSON.stringify('__CLEAN_BASE__')}", "${JSON.stringify(cleanBase)}");

fs.writeFileSync(path, code);
console.log('ReadyMode company-specific script generation fixed.');
