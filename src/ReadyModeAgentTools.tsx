import { useMemo, useState } from 'react';
import { Clipboard, Code2, ExternalLink, Link2 } from 'lucide-react';
import { copyText } from './portalUtils';

type Obj = Record<string, any>;

interface ReadyModeAgentToolsProps {
  agents: Obj[];
  companies: Obj[];
}

/**
 * Admin-only generator for ReadyMode booking links and iframe scripts.
 * The selected company controls the Ready Ops booking slug, while each agent's
 * private token controls attribution to that exact Ready Ops agent record.
 */
export function ReadyModeAgentTools({ agents, companies }: ReadyModeAgentToolsProps) {
  const selectableCompanies = useMemo(
    () => companies.filter(company => company.agent_link && company.public_slug),
    [companies],
  );
  const [companyId, setCompanyId] = useState(() => selectableCompanies[0]?.company_id || '');
  const selectedCompany = selectableCompanies.find(company => company.company_id === companyId) || null;

  return (
    <section className="rounded-2xl border bg-white">
      <div className="border-b p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="font-bold">Agents & ReadyMode Setup</h2>
            <p className="text-xs text-slate-500">
              Pick the company being dialed, then copy the agent's personal portal link, ReadyMode URL template, or complete iframe script.
            </p>
          </div>
          <label className="text-xs font-bold text-slate-500">
            ReadyMode Company
            <select
              value={companyId}
              onChange={event => setCompanyId(event.target.value)}
              className="mt-1 min-w-[280px] rounded-lg border px-3 py-2 text-sm text-slate-800"
            >
              <option value="">Select company...</option>
              {selectableCompanies.map(company => (
                <option key={company.company_id} value={company.company_id}>
                  {company.company_name}{company.state ? ` - ${company.state}` : ''}
                </option>
              ))}
            </select>
          </label>
        </div>
        {selectedCompany && (
          <div className="mt-3 rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-800">
            ReadyMode booking target: <strong>{selectedCompany.company_name}</strong> · {location.origin}{selectedCompany.agent_link}
          </div>
        )}
      </div>

      <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
        {agents.filter(agent => agent.active !== false).map(agent => {
          const personalLink = `${location.origin}/agent/${agent.portal_slug}/${agent.access_token}`;
          const bookingBase = selectedCompany ? `${location.origin}${selectedCompany.agent_link}` : '';
          const readyModeUrl = bookingBase ? buildReadyModeUrlTemplate(bookingBase, agent.name, agent.access_token) : '';
          const readyModeScript = bookingBase ? buildReadyModeScript(bookingBase, agent.name, agent.access_token) : '';

          return (
            <div key={agent.id} className="rounded-xl border p-4">
              <div className="font-bold">{agent.name}</div>
              {agent.email && <div className="mt-0.5 text-[11px] text-slate-400">{agent.email}</div>}
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => void copyText(personalLink)}
                  className="inline-flex items-center justify-center gap-1 rounded-lg border px-3 py-2 text-xs font-bold"
                >
                  <Clipboard size={13} /> Agent Link
                </button>
                <button
                  type="button"
                  onClick={() => window.open(personalLink, '_blank', 'noopener,noreferrer')}
                  className="inline-flex items-center justify-center gap-1 rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold text-white"
                >
                  <ExternalLink size={13} /> Open
                </button>
                <button
                  type="button"
                  disabled={!readyModeUrl}
                  onClick={() => void copyText(readyModeUrl)}
                  className="inline-flex items-center justify-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Link2 size={13} /> ReadyMode URL
                </button>
                <button
                  type="button"
                  disabled={!readyModeScript}
                  onClick={() => void copyText(readyModeScript)}
                  className="inline-flex items-center justify-center gap-1 rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Code2 size={13} /> ReadyMode Script
                </button>
              </div>
              {!selectedCompany && <p className="mt-2 text-[11px] text-amber-600">Select a company above to generate ReadyMode setup.</p>}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function buildReadyModeUrlTemplate(baseUrl: string, agentName: string, agentToken: string): string {
  const fixed = [
    `source=readymode`,
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
  return `<iframe id="mastersForm" src="" style="width:100%;height:900px;border:0;background:#fff;"></iframe>\n<script>\nXC.ready(function () {\n  const profile = tmp.vars.profile || {};\n  const user = tmp.vars.user || {};\n  const lead = tmp.vars.lead || {};\n  const params = new URLSearchParams();\n\n  function add(key, value) {\n    if (value !== undefined && value !== null && String(value).trim() !== '') {\n      params.set(key, String(value).trim());\n    }\n  }\n\n  params.set('source', 'readymode');\n  params.set('agent_token', ${JSON.stringify(agentToken)});\n  add('agent', user.Name || user.name || ${JSON.stringify(agentName)});\n  add('rm_lead_id', lead.id || lead.ID || profile['Lead ID'] || profile.lead_id);\n\n  add('first_name', profile['First Name'] || profile.first_name);\n  add('last_name', profile['Last Name'] || profile.last_name);\n  add('phone', profile['Phone Number'] || profile.Phone || profile.phone);\n  add('address', profile.Address || profile.address);\n  add('city', profile.City || profile.city);\n  add('state', profile.State || profile.state);\n  add('zip', profile['Zip Code'] || profile.ZIP || profile.zip);\n  add('email', profile.Email || profile.email);\n  add('language', profile.Language || profile.language);\n\n  add('service_needed', profile['Services Needed'] || profile['Services Need']);\n  add('last_checked_on', profile['Last Checked On']);\n  add('home_type', profile['Home Type']);\n  add('roof_type', profile['Roof Type']);\n  add('roof_age', profile['Roof Age']);\n  add('stories', profile.Stories);\n  add('insurance', profile.Insurance);\n  add('insurance_name', profile['Insurance Name']);\n  add('contract', profile.Contract);\n  add('home_value', profile['Home Value']);\n  add('sq_ft', profile['SQ FT']);\n  add('web_url', profile['Web Url'] || profile['Web URL'] || profile['Zillow Url']);\n\n  add('notes', profile.Notes);\n  add('hail_size', profile['Size of Hail']);\n  add('claim_filed', profile['File Claim'] || profile['Claim Filed']);\n  add('visible_damage', profile['Visible Damage']);\n  add('damage_type', profile['Damage Type']);\n  add('additional_properties', profile['Add. Properties'] || profile['Additional Properties']);\n  add('second_address', profile['2nd Address'] || profile['Second Address']);\n\n  const readyOpsUrl = ${JSON.stringify(baseUrl)} + '?' + params.toString();\n  console.log('Ready Ops URL:', readyOpsUrl);\n  console.log('ReadyMode Profile:', profile);\n  console.log('ReadyMode User:', user);\n  console.log('ReadyMode Lead:', lead);\n\n  const iframe = document.getElementById('mastersForm');\n  if (iframe) {\n    iframe.src = readyOpsUrl;\n  } else {\n    console.error('Ready Ops iframe "mastersForm" was not found.');\n  }\n});\n</script>`;
}
