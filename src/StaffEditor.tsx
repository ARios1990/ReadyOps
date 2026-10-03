import { useState, type FormEvent } from "react";
import { Save, X } from "lucide-react";
import { supabase } from "./supabase";
import type { Agent, Profile, Team } from "./types";

type Props = {
  agent?: Agent;
  profile?: Profile;
  teams: Team[];
  onClose: () => void;
  onSaved: () => Promise<void>;
};

export function StaffEditor({
  agent,
  profile,
  teams,
  onClose,
  onSaved,
}: Props) {
  const [name, setName] = useState(profile?.display_name || agent?.name || "");
  const [email, setEmail] = useState(profile?.email || agent?.email || "");
  const [role, setRole] = useState(profile?.role || "agent");
  const [teamId, setTeamId] = useState(
    profile?.team_id || agent?.team_id || "",
  );
  const [active, setActive] = useState(
    profile?.active !== false && agent?.active !== false,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const { data, error: saveError } = await supabase.functions.invoke(
        "update-staff",
        {
          body: {
            profile_id: profile?.id || null,
            agent_id: agent?.id || profile?.agent_id || null,
            display_name: name.trim(),
            email: email.trim(),
            role,
            team_id: teamId || null,
            active,
          },
        },
      );
      if (
        saveError &&
        "context" in saveError &&
        saveError.context instanceof Response
      ) {
        const failure = await saveError.context.json().catch(() => null);
        throw new Error(failure?.error || "Unable to save account");
      }
      if (saveError || data?.error)
        throw new Error(
          data?.error || saveError?.message || "Unable to save account",
        );
      await onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save account");
    } finally {
      setSaving(false);
    }
  }
  const field =
    "mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900";
  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/50 p-4">
      <form
        onSubmit={save}
        role="dialog"
        aria-modal="true"
        aria-label="Edit staff account"
        className="w-full max-w-lg space-y-4 rounded-2xl bg-white p-6 text-slate-900 shadow-xl"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">
            Edit {profile?.role === "manager" ? "Manager" : "Staff Account"}
          </h2>
          <button
            type="button"
            aria-label="Close staff editor"
            onClick={onClose}
            disabled={saving}
          >
            <X size={20} />
          </button>
        </div>
        {error && (
          <p
            role="alert"
            className="rounded-lg bg-red-50 p-3 text-sm text-red-700"
          >
            {error}
          </p>
        )}
        <label className="block text-sm font-semibold">
          Name
          <input
            required
            maxLength={150}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={field}
          />
        </label>
        <label className="block text-sm font-semibold">
          Email
          <input
            type="email"
            required={Boolean(profile)}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={field}
          />
        </label>
        <div className="grid grid-cols-2 gap-4">
          <label className="block text-sm font-semibold">
            Role
            <select
              value={role}
              disabled={!profile}
              onChange={(e) => setRole(e.target.value as Profile["role"])}
              className={field}
            >
              <option value="agent">Agent</option>
              <option value="manager">Manager</option>
              <option value="admin">Admin</option>
              {profile?.role === "qc" && <option value="qc">QC</option>}
              {profile?.role === "company" && (
                <option value="company">Company</option>
              )}
            </select>
          </label>
          <label className="block text-sm font-semibold">
            Status
            <select
              value={active ? "active" : "inactive"}
              onChange={(e) => setActive(e.target.value === "active")}
              className={field}
            >
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </label>
        </div>
        <label className="block text-sm font-semibold">
          Team
          <select
            required={role === "agent" || role === "manager"}
            value={teamId}
            onChange={(e) => setTeamId(e.target.value)}
            className={field}
          >
            <option value="">Select team</option>
            {teams.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name} ({team.abbreviation})
              </option>
            ))}
          </select>
        </label>
        <p className="text-xs text-slate-500">
          {profile
            ? "Email updates the sign-in account and linked agent. Inactive accounts cannot access ReadyOps."
            : "This agent has no linked sign-in account. Create or link a user account before changing their role."}
        </p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-lg border px-4 py-2"
          >
            Cancel
          </button>
          <button
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 font-bold text-white disabled:opacity-50"
          >
            <Save size={16} />
            {saving ? "Saving…" : "Save Changes"}
          </button>
        </div>
      </form>
    </div>
  );
}
