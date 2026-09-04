import { useState } from 'react';
import { ChevronDown, ChevronRight, ClipboardCopy, ShieldAlert, XOctagon } from 'lucide-react';
import { getLane, LEAD_TYPE_OPTIONS, normalizeLeadType, renderScriptLine, type LeadType, type ScriptBlock } from './leadTypes';
import type { CompanyCallScript } from './companyCallScripts';

/**
 * The live cold-call script an agent works from, matched to the lane.
 *
 * Agents dial one lane at a time, so the lane selector sits at the top and
 * everything below it — opener, qualifying order, objections, disqualifiers —
 * swaps with it. Tokens like {{homeowner_name}} fill in from whatever the
 * dialer already handed over.
 */
export function ColdCallScript({
  leadType,
  onLeadTypeChange,
  context = {},
  editable = true,
  defaultOpen = true,
  customScript = null,
}: {
  leadType?: string | null;
  onLeadTypeChange?: (value: LeadType) => void;
  context?: Record<string, unknown>;
  editable?: boolean;
  defaultOpen?: boolean;
  customScript?: CompanyCallScript | null;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const lane = getLane(leadType);
  const active = normalizeLeadType(leadType);
  const activeScript = customScript || lane;

  const fill = (line: string) => renderScriptLine(line, context);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <header className="flex flex-wrap items-center gap-3 border-b border-slate-100 p-4">
        <button
          type="button"
          onClick={() => setOpen(value => !value)}
          className="flex items-center gap-1.5 text-sm font-bold text-slate-900"
        >
          {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          Call Script
        </button>
        <span className={`rounded-full border px-2.5 py-1 text-[11px] font-bold ${activeScript.badgeTone}`}>
          {activeScript.shortLabel}
        </span>
        {editable && !customScript && (
          <select
            value={active}
            onChange={event => onLeadTypeChange?.(event.target.value as LeadType)}
            className="ml-auto rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 outline-none focus:border-blue-400"
          >
            {LEAD_TYPE_OPTIONS.map(option => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        )}
      </header>

      {open && (
        <div className="space-y-4 p-4">
          <p className="rounded-xl bg-slate-50 p-3 text-xs leading-5 text-slate-600">
            <span className="font-bold text-slate-800">{activeScript.label}.</span> {activeScript.tagline}
            <br />
            <span className="text-slate-500">List: {activeScript.listSource}</span>
          </p>

          <Block block={activeScript.script.opener} fill={fill} copyable />
          <Block block={activeScript.script.qualify} fill={fill} copyable />
          <Block block={activeScript.script.objections} fill={fill} />
          <Block block={activeScript.script.close} fill={fill} copyable />

          <div className="rounded-xl border border-red-200 bg-red-50 p-3">
            <h4 className="flex items-center gap-1.5 text-xs font-black uppercase tracking-wide text-red-800">
              <XOctagon size={13} /> Disqualifiers
            </h4>
            <ul className="mt-2 space-y-1">
              {activeScript.disqualifiers.map(item => (
                <li key={item} className="text-xs leading-5 text-red-900">• {fill(item)}</li>
              ))}
            </ul>
          </div>

          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
            <h4 className="flex items-center gap-1.5 text-xs font-black uppercase tracking-wide text-amber-800">
              <ShieldAlert size={13} /> Do not say
            </h4>
            <ul className="mt-2 space-y-1">
              {activeScript.complianceNotes.map(item => (
                <li key={item} className="text-xs leading-5 text-amber-900">• {item}</li>
              ))}
            </ul>
            <p className="mt-2 text-[11px] italic leading-4 text-amber-700">
              General guidance only — confirm wording against the client's own approved script and your state's rules.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}

function Block({ block, fill, copyable = false }: { block: ScriptBlock; fill: (line: string) => string; copyable?: boolean }) {
  const filled = block.lines.map(fill);
  return (
    <div className="rounded-xl border border-slate-200 p-3">
      <div className="flex items-center gap-2">
        <h4 className="text-xs font-black uppercase tracking-wide text-slate-500">{block.heading}</h4>
        {copyable && (
          <button
            type="button"
            onClick={() => void navigator.clipboard.writeText(filled.join('\n'))}
            className="ml-auto inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-[11px] font-bold text-slate-600 hover:bg-slate-50"
          >
            <ClipboardCopy size={11} /> Copy
          </button>
        )}
      </div>
      <div className="mt-2 space-y-1.5">
        {filled.map((line, index) => (
          <p key={index} className="text-xs leading-5 text-slate-800">{line}</p>
        ))}
      </div>
    </div>
  );
}

