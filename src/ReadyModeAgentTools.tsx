import { useMemo, useState } from 'react';
import { Clipboard, Code2, Link2 } from 'lucide-react';
import { copyText } from './portalUtils';

type Obj = Record<string, any>;
type OutputType = 'url' | 'script' | null;

interface ReadyModeAgentToolsProps {
  agents: Obj[];
  companies: Obj[];
}

/** Simple admin generator for a ReadyMode URL or iframe script. */
export function ReadyModeAgentTools({ agents, companies }: ReadyModeAgentToolsProps) {
  const selectableCompanies = useMemo(
    () => companies.filter(company => company.agent_link && company.public_slug),
    [companies],
  );
  const activeAgents = useMemo(
    () => agents.filter(agent => agent.active !== false),
    [agents],
  );

  const [companyId, setCompanyId] = useState('');
  const [agentId, setAgentId] = useState('');
  const [outputType, setOutputType] = useState<OutputType>(null);

  const selectedCompany = selectableCompanies.find(company => company.company_id === companyId) || null;
  const selectedAgent = activeAgents.find(agent => agent.id === agentId) || null;
  const bookingBase = selectedCompany ? `${location.origin}${selectedCompany.agent_link}` : '';

  const output = useMemo(() => {
    if (!bookingBase || !selectedAgent || !outputType) return '';
    if (outputType === 'url') {
      return buildReadyModeUrlTemplate(bookingBase, selectedAgent.name, selectedAgent.access_token);
    }
    return buildReadyModeScript(bookingBase, selectedAgent.name, selectedAgent.access_token);
  }, [bookingBase, selectedAgent, outputType]);

  function resetOutput() {
    setOutputType(null);
  }

  return (
    <section className="rounded-2xl border bg-white">
      <div className="border-b p-4">
        <h2 className="font-bold">ReadyMode Generator</h2>
        <p className="mt-1 text-xs text-slate-500">
          Select the company and agent, then generate exactly what you want to paste into ReadyMode.
        </p>
      </div>

      <div className="space-y-4 p-4">
        <div className="grid gap-3 md:grid-cols-2">
          <label className="text-xs font-bold text-slate-500">
            1. Company
            <select
              value={companyId}
              onChange={event => { setCompanyId(event.target.value); resetOutput(); }}
              className="mt-1 w-full rounded-lg border px-3 py-2.5 text-sm text-slate-800"
            >
              <option value="">Select company...</option>
              {selectableCompanies.map(company => (
                <option key={company.company_id} value={company.company_id}>
                  {company.company_name}{company.state ? ` - ${company.state}` : ''}
                </option>
              ))}
            </select>
          </label>

          <label className="text-xs font-bold text-slate-500">
            2. Agent
            <select
              value={agentId}
              onChange={event => { setAgentId(event.target.value); resetOutput(); }}
              className="mt-1 w-full rounded-lg border px-3 py-2.5 text-sm text-slate-800"
            >
              <option value="">Select agent...</option>
              {activeAgents.map(agent => (
                <option key={agent.id} value={agent.id}>{agent.name}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <button
            type="button"
            disabled={!selectedCompany || !selectedAgent}
            onClick={() => setOutputType('url')}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-bold text-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Link2 size={16} /> 3. Generate URL
          </button>
          <button
            type="button"
            disabled={!selectedCompany || !selectedAgent}
            onClick={() => setOutputType('script')}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Code2 size={16} /> 3. Generate Script
          </button>
        </div>

        {output && (
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <div className="mb-2 flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-bold text-slate-800">
                  {outputType === 'url' ? 'ReadyMode URL' : 'ReadyMode Script'}
                </div>
                <div className="text-[11px] text-slate-500">Copy this and paste it into ReadyMode.</div>
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
              rows={outputType === 'script' ? 16 : 6}
              className="w-full resize-y rounded-lg border bg-white p-3 font-mono text-xs leading-5 text-slate-700"
            />
          </div>
        )}
      </div>
    </section>
  );
}

function buildReadyModeUrlTemplate(baseUrl: string, agentName: string, agentToken: string): string {
  const fixed = [
    'source=readymode',
    `agent=${encodeURIComponent(agentName)}`,
    `agent_token=${encodeURIComponent(agentToken)}`,
  ];
  const macros = [
    ['rm_lead_id', '(Lead.id)'],
    ['first_name', '(Profile.First Name)'],
    ['last_name', '(Profile.Last Name)'],
    ['phone', '(Profile.Phone Number)'],
    ['address', '(Profile.Address)'],
    ['city', '(Profile.City)'],
    ['state', '(Profile.State)'],
    ['zip', '(Profile.Zip Code)'],
    ['email', '(Profile.Email)'],
    ['language', '(Profile.Language)'],
    ['service_needed', '(Profile.Services Needed)'],
    ['last_checked_on', '(Profile.Last Checked On)'],
    ['home_type', '(Profile.Home Type)'],
    ['roof_type', '(Profile.Roof Type)'],
    ['roof_age', '(Profile.Roof Age)'],
    ['stories', '(Profile.Stories)'],
    ['insurance', '(Profile.Insurance)'],
    ['insurance_name', '(Profile.Insurance Name)'],
    ['contract', '(Profile.Contract)'],
    ['home_value', '(Profile.Home Value)'],
    ['sq_ft', '(Profile.SQ FT)'],
    ['web_url', '(Profile.Web Url)'],
    ['notes', '(Profile.Notes)'],
    ['hail_size', '(Profile.Size of Hail)'],
    ['claim_filed', '(Profile.File Claim)'],
    ['visible_damage', '(Profile.Visible Damage)'],
    ['damage_type', '(Profile.Damage Type)'],
    ['additional_properties', '(Profile.Add. Properties)'],
    ['second_address', '(Profile.2nd Address)'],
  ];
  return `${baseUrl}?${[...fixed, ...macros.map(([key, value]) => `${key}=${value}`)].join('&')}`;
}

function buildReadyModeScript(baseUrl: string, agentName: string, agentToken: string): string {
  return `<iframe id="mastersForm" src="" style="width:100%;height:900px;border:0;background:#fff;"></iframe>\n<script>\nXC.ready(function () {\n  const profile = tmp.vars.profile || {};\n  const user = tmp.vars.user || {};\n  const lead = tmp.vars.lead || {};\n  const params = new URLSearchParams();\n\n  function add(key, value) {\n    if (value !== undefined && value !== null && String(value).trim() !== '') {\n      params.set(key, String(value).trim());\n    }\n  }\n\n  params.set('source', 'readymode');\n  params.set('agent_token', ${JSON.stringify(agentToken)});\n  add('agent', user.Name || user.name || ${JSON.stringify(agentName)});\n  add('rm_lead_id', lead.id || lead.ID || profile['Lead ID'] || profile.lead_id);\n  add('first_name', profile['First Name'] || profile.first_name);\n  add('last_name', profile['Last Name'] || profile.last_name);\n  add('phone', profile['Phone Number'] || profile.Phone || profile.phone);\n  add('address', profile.Address || profile.address);\n  add('city', profile.City || profile.city);\n  add('state', profile.State || profile.state);\n  add('zip', profile['Zip Code'] || profile.ZIP || profile.zip);\n  add('email', profile.Email || profile.email);\n  add('language', profile.Language || profile.language);\n  add('service_needed', profile['Services Needed'] || profile['Services Need']);\n  add('last_checked_on', profile['Last Checked On']);\n  add('home_type', profile['Home Type']);\n  add('roof_type', profile['Roof Type']);\n  add('roof_age', profile['Roof Age']);\n  add('stories', profile.Stories);\n  add('insurance', profile.Insurance);\n  add('insurance_name', profile['Insurance Name']);\n  add('contract', profile.Contract);\n  add('home_value', profile['Home Value']);\n  add('sq_ft', profile['SQ FT']);\n  add('web_url', profile['Web Url'] || profile['Web URL'] || profile['Zillow Url']);\n  add('notes', profile.Notes);\n  add('hail_size', profile['Size of Hail']);\n  add('claim_filed', profile['File Claim'] || profile['Claim Filed']);\n  add('visible_damage', profile['Visible Damage']);\n  add('damage_type', profile['Damage Type']);\n  add('additional_properties', profile['Add. Properties'] || profile['Additional Properties']);\n  add('second_address', profile['2nd Address'] || profile['Second Address']);\n\n  const readyOpsUrl = ${JSON.stringify(baseUrl)} + '?' + params.toString();\n  console.log('Ready Ops URL:', readyOpsUrl);\n\n  const iframe = document.getElementById('mastersForm');\n  if (iframe) iframe.src = readyOpsUrl;\n});\n</script>`;
}
