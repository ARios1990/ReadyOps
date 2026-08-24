import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, Clipboard, Eye, EyeOff } from "lucide-react";
import { copyText } from "./portalUtils";

type Obj = Record<string, unknown>;

interface ReadyModeAgentToolsProps {
  agents: Obj[];
  companies: Obj[];
}

const STORAGE_KEY = "readyops.safe-embed.collapsed";

function readInitialCollapsed(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "true") return true;
    if (stored === "false") return false;
  } catch {
    // ignore storage errors (private mode, quota, etc.)
  }
  return true;
}

/** ReadyMode-safe HTML embed with no JavaScript. */
export function ReadyModeAgentTools(props: ReadyModeAgentToolsProps) {
  void props;
  const [collapsed, setCollapsed] = useState<boolean>(readInitialCollapsed);
  const appOrigin = window.location.origin.replace(/\/+$/, "");
  const output = buildSafeEmbed(appOrigin);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, collapsed ? "true" : "false");
    } catch {
      // ignore storage errors
    }
  }, [collapsed]);

  const panelId = "readymode-safe-embed-panel";

  return (
    <section className="rounded-2xl border bg-white">
      <div className="flex items-center justify-between gap-3 border-b p-4">
        <div>
          <h2 className="font-bold">ReadyMode Safe Embed</h2>
          <p className="mt-1 text-xs text-slate-500">
            Recommended for ReadyMode. This version contains HTML only — no
            JavaScript or script tags.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCollapsed((value) => !value)}
          aria-expanded={!collapsed}
          aria-controls={panelId}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
        >
          {collapsed ? <Eye size={13} /> : <EyeOff size={13} />}
          {collapsed ? "Show" : "Hide"}
          {collapsed ? (
            <ChevronDown size={13} className="opacity-60" />
          ) : (
            <ChevronUp size={13} className="opacity-60" />
          )}
        </button>
      </div>

      <div
        id={panelId}
        hidden={collapsed}
        aria-hidden={collapsed}
        className="space-y-4 p-4"
      >
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-xs text-amber-900">
          Each ReadyMode campaign keeps one Campaign Variable named{" "}
          <strong>ReadyOpsSlug</strong>. Example: Battle-Axe Roofing - Colorado
          uses <strong>battle-axe-roofing</strong>.
        </div>

        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-3 text-xs text-emerald-800">
          <strong>Company:</strong> from ReadyOpsSlug.
          <br />
          <strong>Agent:</strong> from ReadyMode User.Name.
          <br />
          <strong>Homeowner:</strong> common ReadyMode profile fields are passed
          directly into Ready Ops.
        </div>

        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-bold text-slate-800">
                Universal HTML Embed
              </div>
              <div className="text-[11px] text-slate-500">
                Copy this into ReadyMode Source. There is no &lt;script&gt;
                block for ReadyMode to strip.
              </div>
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
            rows={12}
            className="w-full resize-y rounded-lg border bg-white p-3 font-mono text-xs leading-5 text-slate-700"
          />
        </div>
      </div>
    </section>
  );
}

function buildSafeEmbed(appOrigin: string): string {
  const src = [
    `${appOrigin}/book/(ReadyOpsSlug)?source=readymode`,
    "agent=(User.Name)",
    "rm_lead_id=(Lead.id)",
    "first_name=(Profile.First Name)",
    "last_name=(Profile.Last Name)",
    "phone=(Profile.Phone Number)",
    "address=(Profile.Address)",
    "city=(Profile.City)",
    "state=(Profile.State)",
    "zip=(Profile.Zip Code)",
    "email=(Profile.Email)",
    "language=(Profile.Language)",
    "service_needed=(Profile.Services Needed)",
    "last_checked_on=(Profile.Last Checked On)",
    "home_type=(Profile.Home Type)",
    "roof_type=(Profile.Roof Type)",
    "roof_age=(Profile.Roof Age)",
    "stories=(Profile.Stories)",
    "insurance=(Profile.Insurance)",
    "insurance_name=(Profile.Insurance Name)",
    "contract=(Profile.Contract)",
    "home_value=(Profile.Home Value)",
    "sq_ft=(Profile.SQ FT)",
    "web_url=(Profile.Web Url)",
    "notes=(Profile.Notes)",
    "hail_size=(Profile.Size of Hail)",
    "claim_filed=(Profile.File Claim)",
    "visible_damage=(Profile.Visible Damage)",
    "damage_type=(Profile.Damage Type)",
    "additional_properties=(Profile.Add. Properties)",
    "second_address=(Profile.2nd Address)",
    "recording_url=(Profile.Recording URL)",
  ].join("&amp;");

  return `<iframe id="mastersForm" src="${src}" style="width:100%;height:900px;border:0;background:#fff;"></iframe>`;
}
