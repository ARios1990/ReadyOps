import { Clipboard, Code2 } from 'lucide-react';
import { copyText } from './portalUtils';

type Obj = Record<string, any>;

interface ReadyModeAgentToolsProps {
  agents: Obj[];
  companies: Obj[];
}

/** One ReadyMode script reused across every campaign with no campaign variables. */
export function ReadyModeAgentTools(_: ReadyModeAgentToolsProps) {
  const appOrigin = window.location.origin.replace(/\/+$/, '');
  const output = buildUniversalScript(appOrigin);

  return (
    <section className="rounded-2xl border bg-white">
      <div className="border-b p-4">
        <h2 className="font-bold">Universal ReadyMode Script</h2>
        <p className="mt-1 text-xs text-slate-500">
          One script for every ReadyMode campaign. No ReadyOpsSlug variable is required.
        </p>
      </div>

      <div className="space-y-4 p-4">
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-3 text-xs text-emerald-800">
          <strong>Company:</strong> automatically detected from the current ReadyMode campaign name.<br />
          <strong>Agent:</strong> automatically from ReadyMode User.Name.<br />
          <strong>Lead fields:</strong> automatically passed from the current ReadyMode profile.
        </div>

        <div className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-3 text-xs text-blue-800">
          <Code2 size={14} className="mr-1 inline" />
          Paste this same script into the single <strong>Ready Ops Universal</strong> script in ReadyMode. You can remove the old ReadyOpsSlug campaign variables later; they are no longer used.
        </div>

        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-bold text-slate-800">Universal ReadyMode Script</div>
              <div className="text-[11px] text-slate-500">Copy once and use it across all campaigns.</div>
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
            rows={22}
            className="w-full resize-y rounded-lg border bg-white p-3 font-mono text-xs leading-5 text-slate-700"
          />
        </div>
      </div>
    </section>
  );
}

function buildUniversalScript(appOrigin: string): string {
  return `<iframe id="mastersForm" src="" style="width:100%;height:900px;border:0;background:#fff;"></iframe>\n<script>\nXC.ready(function () {\n  const profile = tmp.vars.profile || {};\n  const user = tmp.vars.user || {};\n  const lead = tmp.vars.lead || {};\n  const campaign = tmp.vars.campaign || {};\n  const params = new URLSearchParams();\n  const iframe = document.getElementById('mastersForm');\n\n  function add(key, value) {\n    if (value !== undefined && value !== null && String(value).trim() !== '') {\n      params.set(key, String(value).trim());\n    }\n  }\n\n  function firstValue(values) {\n    for (const value of values) {\n      if (value !== undefined && value !== null && String(value).trim() !== '') {\n        return String(value).trim();\n      }\n    }\n    return '';\n  }\n\n  function detectCampaignName() {\n    const direct = firstValue([\n      campaign.Name, campaign.name, campaign.Campaign, campaign.campaign,\n      profile.Campaign, profile['Campaign Name'], profile.campaign, profile.campaign_name,\n      lead.Campaign, lead['Campaign Name'], lead.campaign, lead.campaign_name\n    ]);\n    if (direct) return direct;\n\n    const bodyText = String(document.body && document.body.innerText ? document.body.innerText : '');\n    const match = bodyText.match(/Campaign:\\s*([^\\n\\r]+)/i);\n    if (match && match[1]) return match[1].trim();\n\n    const selects = Array.from(document.querySelectorAll('select'));\n    for (const select of selects) {\n      const selected = select.options && select.selectedIndex >= 0 ? select.options[select.selectedIndex] : null;\n      const selectedText = selected ? String(selected.text || '').trim() : '';\n      const nearby = String((select.parentElement && select.parentElement.innerText) || '');\n      if (selectedText && /campaign/i.test(nearby)) return selectedText;\n    }\n\n    return '';\n  }\n\n  const campaignName = detectCampaignName();\n\n  if (!campaignName) {\n    console.error('Ready Ops could not detect the current ReadyMode campaign.');\n    if (iframe) iframe.srcdoc = '<div style="font-family:Arial;padding:24px;color:#991b1b"><b>Ready Ops could not detect the ReadyMode campaign.</b><br><br>Close and reopen the lead profile, then open Ready Ops Universal again.</div>';\n    return;\n  }\n\n  params.set('source', 'readymode');\n  params.set('campaign', campaignName);\n  add('agent', user.Name || user.name);\n  add('rm_lead_id', lead.id || lead.ID || profile['Lead ID'] || profile.lead_id);\n  add('first_name', profile['First Name'] || profile.first_name);\n  add('last_name', profile['Last Name'] || profile.last_name);\n  add('phone', profile['Phone Number'] || profile.Phone || profile.phone);\n  add('address', profile.Address || profile.address);\n  add('city', profile.City || profile.city);\n  add('state', profile.State || profile.state);\n  add('zip', profile['Zip Code'] || profile.ZIP || profile.zip);\n  add('email', profile.Email || profile.email);\n  add('language', profile.Language || profile.language);\n  add('service_needed', profile['Services Needed'] || profile['Services Need']);\n  add('last_checked_on', profile['Last Checked On']);\n  add('home_type', profile['Home Type']);\n  add('roof_type', profile['Roof Type']);\n  add('roof_age', profile['Roof Age']);\n  add('stories', profile.Stories);\n  add('insurance', profile.Insurance);\n  add('insurance_name', profile['Insurance Name']);\n  add('contract', profile.Contract);\n  add('home_value', profile['Home Value']);\n  add('sq_ft', profile['SQ FT']);\n  add('web_url', profile['Web Url'] || profile['Web URL'] || profile['Zillow Url']);\n  add('notes', profile.Notes);\n  add('hail_size', profile['Size of Hail']);\n  add('claim_filed', profile['File Claim'] || profile['Claim Filed']);\n  add('visible_damage', profile['Visible Damage']);\n  add('damage_type', profile['Damage Type']);\n  add('additional_properties', profile['Add. Properties'] || profile['Additional Properties']);\n  add('second_address', profile['2nd Address'] || profile['Second Address']);\n  add('recording_url', profile['Recording URL'] || profile.recording_url || profile.RecordingURL);\n\n  const readyOpsUrl = ${JSON.stringify(appOrigin)} + '/readymode?' + params.toString();\n  console.log('Ready Ops detected campaign:', campaignName);\n  console.log('Ready Ops agent:', user.Name || user.name);\n  console.log('Ready Ops URL:', readyOpsUrl);\n  if (iframe) iframe.src = readyOpsUrl;\n});\n</script>`;
}
