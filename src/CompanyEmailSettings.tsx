import { useEffect, useState } from "react";
import { supabase } from "./supabase";
export function CompanyEmailSettings({ companyId }: { companyId: string }) {
  const [emails, setEmails] = useState("");
  const [useProfile, setUseProfile] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    let cancelled = false;
    supabase
      .from("roster_companies")
      .select("notification_emails,email,owner_email,secondary_emails")
      .eq("id", companyId)
      .single()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) setMessage(error.message);
        else {
          setUseProfile(data.notification_emails === null);
          setEmails(
            (
              data.notification_emails || [
                data.email || data.owner_email,
                ...(data.secondary_emails || []),
              ]
            )
              .filter(Boolean)
              .join(", "),
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [companyId]);
  async function save() {
    const recipients = [
      ...new Set(
        emails
          .split(/[;,\n]/)
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean),
      ),
    ];
    if (
      !useProfile &&
      (!recipients.length ||
        recipients.length > 50 ||
        recipients.some((e) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)))
    ) {
      setMessage("Enter 1–50 valid notification email addresses.");
      return;
    }
    setBusy(true);
    setMessage("");
    const { error } = await supabase
      .from("roster_companies")
      .update({ notification_emails: useProfile ? null : recipients })
      .eq("id", companyId);
    setMessage(error?.message || "Client notification recipients saved.");
    setBusy(false);
  }
  return (
    <section className="space-y-3 rounded-xl border bg-white p-4">
      <h3 className="font-bold">Client Lead Email Notifications</h3>
      <label className="flex gap-2 text-sm">
        <input
          type="checkbox"
          checked={useProfile}
          onChange={(e) => setUseProfile(e.target.checked)}
        />
        Use primary company/owner email and secondary profile emails
      </label>
      <label className="block text-xs font-bold">
        Notification emails (comma-separated)
        <textarea
          aria-label="Company notification emails"
          disabled={useProfile}
          value={emails}
          onChange={(e) => setEmails(e.target.value)}
          className="mt-1 w-full rounded-lg border p-3 text-sm disabled:bg-slate-100"
        />
      </label>
      <p className="text-xs text-slate-500">
        Billing emails are not included automatically. Add them explicitly if
        they should receive customer lead details.
      </p>
      {message && (
        <p role="status" className="text-sm">
          {message}
        </p>
      )}
      <button
        disabled={busy}
        onClick={() => void save()}
        className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white"
      >
        {busy ? "Saving…" : "Save Notification Emails"}
      </button>
    </section>
  );
}
