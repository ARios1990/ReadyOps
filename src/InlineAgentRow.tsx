import { useRef, useState, type ReactNode } from "react";
import { Check, Loader2, Pencil, Settings, X } from "lucide-react";
import { supabase } from "./supabase";
import type { Agent, Profile, Team } from "./types";
import {
  agentRowDraft,
  agentRowRequest,
  linkedAgentProfile,
  linkableAgentProfiles,
  type AgentRowDraft,
} from "./staffRowModel";

type Props = {
  agent: Agent;
  profiles: Profile[];
  teams: Team[];
  actions?: ReactNode;
  onSaved: () => Promise<void>;
  onAccountSettings: () => void;
};
type Field = "name" | "team" | "user" | "status";

export function InlineAgentRow({
  agent,
  profiles,
  teams,
  actions,
  onSaved,
  onAccountSettings,
}: Props) {
  const linked = linkedAgentProfile(agent, profiles);
  const [editing, setEditing] = useState(false);
  const [focus, setFocus] = useState<Field>("name");
  const [draft, setDraft] = useState<AgentRowDraft>(() =>
    agentRowDraft(agent, linked),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saved, setSaved] = useState(false);
  const savingRef = useRef(false);
  const baseline = useRef(agentRowRequest(agent, profiles, draft).expected);
  const team = teams.find((team) => team.id === agent.team_id);
  const linkChanged = draft.profileId !== (linked?.id || "");
  const restrictedLink = Boolean(linked && linked.role !== "agent");
  function edit(field: Field) {
    const next = agentRowDraft(agent, linked);
    baseline.current = agentRowRequest(agent, profiles, next).expected;
    setDraft(next);
    setFocus(field);
    setError("");
    setNotice("");
    setSaved(false);
    setEditing(true);
  }
  function change(patch: Partial<AgentRowDraft>) {
    if (patch.profileId !== undefined)
      baseline.current.target_updated_at =
        profiles.find((profile) => profile.id === patch.profileId)
          ?.updated_at || null;
    setDraft((current) => ({ ...current, ...patch }));
  }
  async function save() {
    if (savingRef.current) return;
    if (!draft.name.trim() || !draft.teamId) {
      setError("Agent name and team are required.");
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setError("");
    setNotice("");
    let committed = false;
    try {
      const request = agentRowRequest(agent, profiles, draft);
      // Keep the original row version even if the dashboard refreshes during editing.
      request.expected = baseline.current;
      const { data, error: saveError } = await supabase.functions.invoke(
        "update-staff",
        { body: request },
      );
      if (
        saveError &&
        "context" in saveError &&
        saveError.context instanceof Response
      ) {
        const failure = await saveError.context.json().catch(() => null);
        throw new Error(failure?.error || "Unable to save this agent.");
      }
      if (saveError || data?.error || data?.success !== true)
        throw new Error(
          data?.error || saveError?.message || "Unable to confirm the save.",
        );
      committed = true;
      setEditing(false);
      setSaved(true);
      await onSaved();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unable to save this agent.";
      if (committed)
        setNotice(
          "Changes were saved, but the table could not refresh. Refresh the page to see the saved values.",
        );
      else setError(message);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }
  const input = "readyops-inline-input";
  const cell = (label: string, field: Field, children: ReactNode) => (
    <button
      type="button"
      className="readyops-inline-cell"
      aria-label={`Edit ${label} for ${agent.name}`}
      title={`Click to edit ${label}`}
      onClick={() => edit(field)}
    >
      {children}
      <Pencil size={11} aria-hidden="true" />
    </button>
  );
  return (
    <>
      <tr className={editing ? "readyops-inline-editing" : ""}>
        <td>
          {editing ? (
            <input
              aria-label={`Agent name for ${agent.name}`}
              autoFocus={focus === "name"}
              maxLength={150}
              required
              disabled={saving}
              className={input}
              value={draft.name}
              onChange={(event) => change({ name: event.target.value })}
            />
          ) : (
            cell("agent name", "name", agent.name)
          )}
        </td>
        <td>
          {editing ? (
            <select
              aria-label={`Team for ${agent.name}`}
              autoFocus={focus === "team"}
              required
              disabled={saving}
              className={input}
              value={draft.teamId}
              onChange={(event) => change({ teamId: event.target.value })}
            >
              <option value="">Select team</option>
              {teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name} ({team.abbreviation})
                </option>
              ))}
            </select>
          ) : (
            cell(
              "team",
              "team",
              <span
                className={`readyops-ref-team team-${team?.abbreviation?.toLowerCase() || "none"}`}
              >
                {team?.abbreviation || "—"}
              </span>,
            )
          )}
        </td>
        <td>
          {editing ? (
            <select
              aria-label={`Linked user for ${agent.name}`}
              autoFocus={focus === "user"}
              disabled={saving || restrictedLink}
              className={input}
              value={draft.profileId}
              onChange={(event) => change({ profileId: event.target.value })}
            >
              <option value="">Unlinked</option>
              {linkableAgentProfiles(agent, profiles).map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.display_name}
                  {profile.email ? ` (${profile.email})` : ""}
                  {profile.active === false ? " — Inactive" : ""}
                </option>
              ))}
            </select>
          ) : (
            cell("linked user", "user", linked?.display_name || "Unlinked")
          )}
        </td>
        <td>
          {editing ? (
            <select
              aria-label={`Status for ${agent.name}`}
              autoFocus={focus === "status"}
              disabled={saving}
              className={input}
              value={draft.active ? "active" : "inactive"}
              onChange={(event) =>
                change({ active: event.target.value === "active" })
              }
            >
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          ) : (
            cell(
              "status",
              "status",
              <span
                className={`readyops-ref-status${agent.active === false || linked?.active === false ? " inactive" : ""}`}
              >
                {agent.active === false || linked?.active === false
                  ? "Inactive"
                  : "Active"}
              </span>,
            )
          )}
        </td>
        <td>
          {editing ? (
            <div className="readyops-inline-buttons">
              <button
                type="button"
                disabled={saving}
                className="readyops-inline-save"
                onClick={() => void save()}
                aria-label={`Save ${agent.name}`}
              >
                {saving ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <Check size={13} />
                )}{" "}
                {saving ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                disabled={saving}
                className="readyops-inline-cancel"
                onClick={() => {
                  setEditing(false);
                  setError("");
                }}
                aria-label={`Cancel editing ${agent.name}`}
              >
                <X size={13} /> Cancel
              </button>
            </div>
          ) : (
            <div className="readyops-ref-actions">
              {actions}
              <button
                type="button"
                title="Edit Agent inline"
                aria-label={`Edit row for ${agent.name}`}
                onClick={() => edit("name")}
              >
                <Pencil size={14} />
              </button>
              <button
                type="button"
                title="Account settings: email and role"
                aria-label={`Account settings for ${agent.name}`}
                onClick={onAccountSettings}
              >
                <Settings size={14} />
              </button>
            </div>
          )}
        </td>
      </tr>
      {editing && (
        <tr className="readyops-inline-help">
          <td colSpan={5}>
            Edit the four fields above, then Save or Cancel. The selected login
            receives this agent's team and status.{" "}
            {linkChanged && linked && (
              <strong>
                Replacing or removing the link disables the previous Agent login
                and revokes its agent access.{" "}
              </strong>
            )}
            {restrictedLink && (
              <span>
                This login has a {linked?.role} role; link replacement is
                restricted to Agent logins.{" "}
              </span>
            )}
            Email and role remain available in Account Settings.
          </td>
        </tr>
      )}
      {error && (
        <tr>
          <td colSpan={5}>
            <p role="alert" className="text-red-700">
              {error}
            </p>
          </td>
        </tr>
      )}
      {notice && (
        <tr>
          <td colSpan={5}>
            <p role="status" className="text-amber-700">
              {notice}
            </p>
          </td>
        </tr>
      )}
      {saved && !notice && (
        <tr>
          <td colSpan={5}>
            <p role="status" className="text-emerald-700">
              Changes saved for {agent.name}.
            </p>
          </td>
        </tr>
      )}
    </>
  );
}
