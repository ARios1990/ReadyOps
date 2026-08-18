import { useMemo, useState } from 'react';
import { Clipboard, Code2, Link2 } from 'lucide-react';
import { copyText } from './portalUtils';

type Obj = Record<string, any>;
type OutputType = 'url' | 'script';

interface ReadyModeAgentToolsProps {
  agents: Obj[];
  companies: Obj[];
}

/** One ReadyMode URL/script reused across every campaign. */
export function ReadyModeAgentTools({ companies }: ReadyModeAgentToolsProps) {
  const selectableCompanies = useMemo(
    () => companies.filter(company => company.public_slug && (company.plain_agent_link || company.agent_link)),
    [companies],
  );
  const [companyId, setCompanyId] = useState('');
  const [outputType, setOutputType] = useState<OutputType>('script');
  const selectedCompany = selectableCompanies.find(company => company.company_id === companyId) || null;
  const appOrigin = window.location.origin.replace(/\/+$/, '');
  const output = outputType === 'url' ? buildUniversalUrl(appOrigin) : buildUniversalScript(appOrigin);

  return (
    <section className="rounded-2xl border bg-white">
      <div className="border-b p-4">
        <h2 className="font-bold">Universal ReadyMode Generator</h2>
        <p className="mt-1 text-xs text-slate-500">
          Use one URL or one script for every ReadyMode campaign. Agent Name comes from the logged-in ReadyMode User.Name automatically.
        </p>
      </div>

      <div className="space-y-5 p-4">
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <div className="text-sm font-bold text-amber-900">One-time campaign setup</div>
          <p className="mt-1 text-xs text-amber-800">
            In each ReadyMode campaign create one Campaign Variable named <strong>ReadyOpsSlug</strong>. Select the matching company below and copy its value into that campaign.
          </p>
          <div className="mt-3 grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
            <label className="text-xs font-bold text-amber-900">
              Company
              <select
                value={companyId}
                onChange={event => setCompanyId(event.target.value)}
                className="mt-1 w-full rounded-lg border border-amber-200 bg-white px-3 py-2.5 text-sm text-slate-800"
              >
                <option value="">Select company...</option>
                {selectableCompanies.map(company => (
                  <option key={company.company_id} value={company.company_id}>
                    {company.company_name}{company.state ? ` - ${company.state}` : ''}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-xs font-bold text-amber-900">
              ReadyOpsSlug value
              <input
                readOnly
                value={selectedCompany?.public_slug || ''}
                placeholder="Select company"
                className="mt-1 w-full rounded-lg border border-amber-200 bg-white px-3 py-2.5 font-mono text-sm text-slate-700"
              />
            </label>

            <button
              type="button"
              disabled={!selectedCompany?.public_slug}
              onClick={() => selectedCompany?.public_slug && void copyText(String(selectedCompany.public_slug))}
              className="inline-flex items-center justify-center gap-1 rounded-lg bg-amber-900 px-4 py-2.5 text-xs font-bold text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Clipboard size={14} /> Copy Value
            </button>
          </div>
        </div>

        <div className="grid max-w-xl gap-2 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => setOutputType('url')}
            className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-bold ${outputType === 'url' ? 'bg-blue-600 text-white' : 'border border-blue-200 bg-blue-50 text-blue-700'}`}
          >
            <Link2 size={16} /> Universal URL
          </button>
          <button
            type="button"
            onClick={() => setOutputType('script')}
            className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-bold ${outputType === 'script' ? 'bg-blue-600 text-white' : 'border border-blue-200 bg-blue-50 text-blue-700'}`}
          >
            <Code2 size={16} /> Universal Script
          </button>
        </div>

        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
          Company: <strong>Automatically from ReadyOpsSlug</strong><br />
          Agent: <strong>Automatically from ReadyMode User.Name</strong><br />
          Recording: <strong>Automatically from Profile.Recording URL when available</strong>
        </div>

        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-bold text-slate-800">
                {outputType === 'url' ? 'Universal ReadyMode URL' : 'Universal ReadyMode Script'}
              </div>
              <div className="text-[11px] text-slate-500">Copy once and use it in every ReadyMode campaign.</div>
            </div>
            <button
              type="button"
              onClick={() => void copyText(output)}
              className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold text-white"
            >
              <Clipboard size={13} /> Copy
            </button>
          </div>
          <textarea
            readOnly
            value={output}
            rows={outputType === 'script' ? 18 : 7}
            className="w-full resize-y rounded-lg border bg-white p-3 font-mono text-xs leading-5 text-slate-700"
          />
        </div>
      </div>
    </section>
  );
}

function buildUniversalUrl(appOrigin: string): string {
  const params = [
    'source=readymode',
    'agent=(User.Name)',
    'rm_lead_id=(Lead.id)',
    'first_name=(Profile.First Name)',
    'last_name=(Profile.Last Name)',
    'phone=(Profile.Phone Number)',
    'address=(Profile.Address)',
    'city=(Profile.City)',
    'state=(Profile.State)',
    'zip=(Profile.Zip Code)',
    'email=(Profile.Email)',
    'language=(Profile.Language)',
    'service_needed=(Profile.Services Needed)',
    'last_checked_on=(Profile.Last Checked On)',
    'home_type=(Profile.Home Type)',
    'roof_type=(Profile.Roof Type)',
    'roof_age=(Profile.Roof Age)',
    'stories=(Profile.Stories)',
    'insurance=(Profile.Insurance)',
    'insurance_name=(Profile.Insurance Name)',
    'contract=(Profile.Contract)',
    'home_value=(Profile.Home Value)',
    'sq_ft=(Profile.SQ FT)',
    'web_url=(Profile.Web Url)',
    'notes=(Profile.Notes)',
    'hail_size=(Profile.Size of Hail)',
    'claim_filed=(Profile.File Claim)',
    'visible_damage=(Profile.Visible Damage)',
    'damage_type=(Profile.Damage Type)',
    'additional_properties=(Profile.Add. Properties)',
    'second_address=(Profile.2nd Address)',
    'recording_url=(Profile.Recording URL)',
  ];
  return `${appOrigin}/book/(ReadyOpsSlug)?${params.join('&')}`;
}

function buildUniversalScript(appOrigin: string): string {
  return `<iframe id="mastersForm" src="" style="width:100%;height:900px;border:0;background:#fff;"></iframe>\n<script>\nXC.ready(function () {\n  const profile = tmp.vars.profile || {};\n  const user = tmp.vars.user || {};\n  const lead = tmp.vars.lead || {};\n  const params = new URLSearchParams();\n  const readyOpsSlug = '(ReadyOpsSlug)'.trim();\n  const iframe = document.getElementById('mastersForm');\n\n  function add(key, value) {\n    if (value !== undefined && value !== null && String(value).trim() !== '') params.set(key, String(value).trim());\n  }\n\n  if (!readyOpsSlug || readyOpsSlug === '(ReadyOpsSlug)') {\n    console.error('ReadyOpsSlug campaign variable is missing.');\n    if (iframe) iframe.srcdoc = '<div style="font-family:Arial;padding:24px;color:#991b1b"><b>Ready Ops company is not configured for this campaign.</b><br><br>Add the Campaign Variable <b>ReadyOpsSlug</b> in ReadyMode.</div>';\n    return;\n  }\n\n  params.set('source', 'readymode');\n  add('agent', user.Name || user.name);\n  add('rm_lead_id', lead.id || lead.ID || profile['Lead ID'] || profile.lead_id);\n  add('first_name', profile['First Name'] || profile.first_name);\n  add('last_name', profile['Last Name'] || profile.last_name);\n  add('phone', profile['Phone Number'] || profile.Phone || profile.phone);\n  add('address', profile.Address || profile.address);\n  add('city', profile.City || profile.city);\n  add('state', profile.State || profile.state);\n  add('zip', profile['Zip Code'] || profile.ZIP || profile.zip);\n  add('email', profile.Email || profile.email);\n  add('language', profile.Language || profile.language);\n  add('service_needed', profile['Services Needed'] || profile['Services Need']);\n  add('last_checked_on', profile['Last Checked On']);\n  add('home_type', profile['Home Type']);\n  add('roof_type', profile['Roof Type']);\n  add('roof_age', profile['Roof Age']);\n  add('stories', profile.Stories);\n  add('insurance', profile.Insurance);\n  add('insurance_name', profile['Insurance Name']);\n  add('contract', profile.Contract);\n  add('home_value', profile['Home Value']);\n  add('sq_ft', profile['SQ FT']);\n  add('web_url', profile['Web Url'] || profile['Web URL'] || profile['Zillow Url']);\n  add('notes', profile.Notes);\n  add('hail_size', profile['Size of Hail']);\n  add('claim_filed', profile['File Claim'] || profile['Claim Filed']);\n  add('visible_damage', profile['Visible Damage']);\n  add('damage_type', profile['Damage Type']);\n  add('additional_properties', profile['Add. Properties'] || profile['Additional Properties']);\n  add('second_address', profile['2nd Address'] || profile['Second Address']);\n  add('recording_url', profile['Recording URL'] || profile.recording_url || profile.RecordingURL);\n\n  const readyOpsUrl = ${JSON.stringify(appOrigin)} + '/book/' + encodeURIComponent(readyOpsSlug) + '?' + params.toString();\n  console.log('Ready Ops campaign slug:', readyOpsSlug);\n  console.log('Ready Ops agent:', user.Name || user.name);\n  console.log('Ready Ops URL:', readyOpsUrl);\n  if (iframe) iframe.src = readyOpsUrl;\n});\n</script>`;
}
