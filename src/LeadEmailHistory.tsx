import { useEffect, useRef, useState } from "react";
import { supabase } from "./supabase";
import { useAuth } from "./AuthContext";
type Attempt = {
  id: string;
  started_at: string;
  completed_at: string | null;
  status: string;
  error_message: string | null;
};
type Notification = {
  id: string;
  recipients: string[];
  status: string;
  sent_at: string | null;
  created_at: string;
  error_message: string | null;
  request_key: string;
  lead_email_attempts: Attempt[];
};
export function LeadEmailHistory({ leadId }: { leadId: string }) {
  const { profile } = useAuth();
  const [rows, setRows] = useState<Notification[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const requestId = useRef(crypto.randomUUID());
  const allowed =
    profile?.active !== false &&
    (profile?.role === "admin" || profile?.role === "manager");
  async function load() {
    const { data, error } = await supabase
      .from("lead_email_notifications")
      .select(
        "id,recipients,status,sent_at,created_at,error_message,request_key,lead_email_attempts(id,started_at,completed_at,status,error_message)",
      )
      .eq("lead_id", leadId)
      .order("created_at", { ascending: false });
    if (error) setMessage(error.message);
    else setRows((data || []) as Notification[]);
  }
  useEffect(() => {
    if (!allowed) return;
    void load();
    const timer = window.setInterval(() => void load(), 15000);
    return () => window.clearInterval(timer);
  }, [leadId, allowed]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!allowed) return null;
  async function resend() {
    setBusy(true);
    setMessage("");
    const { error } = await supabase.rpc("request_lead_email_resend", {
      p_lead_id: leadId,
      p_request_id: requestId.current,
    });
    if (error) setMessage(error.message);
    else {
      requestId.current = crypto.randomUUID();
      setMessage("Resend queued. Delivery status will update below.");
      await load();
    }
    setBusy(false);
  }
  return (
    <section className="space-y-3 rounded-xl border bg-white p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-bold">Client Email Notifications</h3>
        <div className="flex gap-2">
          <button
            onClick={() => void load()}
            className="rounded-lg border px-3 py-2 text-xs"
          >
            Refresh
          </button>
          <button
            disabled={busy}
            onClick={() => void resend()}
            className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
          >
            {busy ? "Queuing…" : "Resend Email"}
          </button>
        </div>
      </div>
      <p className="text-xs text-slate-500">
        Sent means the email provider accepted the message; it does not confirm
        inbox delivery. Resends use the company's current notification
        recipients.
      </p>
      {message && (
        <p role="status" className="rounded-lg bg-slate-50 p-2 text-sm">
          {message}
        </p>
      )}
      {rows.length === 0 && (
        <p className="text-sm text-slate-500">
          No email history. Automatic notifications begin when a lead is
          QC-approved and sent to the client.
        </p>
      )}
      {rows.map((row) => (
        <details key={row.id} className="rounded-lg border p-3">
          <summary className="cursor-pointer text-sm">
            <strong
              className={
                row.status === "sent"
                  ? "text-emerald-700"
                  : row.status === "failed"
                    ? "text-red-700"
                    : "text-amber-700"
              }
            >
              {row.status.toUpperCase()}
            </strong>{" "}
            • {row.request_key === "initial" ? "Automatic" : "Resend"} •{" "}
            {new Date(row.created_at).toLocaleString()}
          </summary>
          <p className="mt-2 break-all text-xs">
            Recipients: {row.recipients.join(", ") || "None configured"}
          </p>
          <p className="text-xs">
            Sent at:{" "}
            {row.sent_at ? new Date(row.sent_at).toLocaleString() : "Not sent"}
          </p>
          {row.error_message && (
            <p className="mt-1 text-xs text-red-700">{row.error_message}</p>
          )}
          <ul className="mt-2 space-y-1 text-xs">
            {row.lead_email_attempts.map((attempt) => (
              <li key={attempt.id}>
                {new Date(attempt.started_at).toLocaleString()} —{" "}
                {attempt.status}
                {attempt.error_message ? `: ${attempt.error_message}` : ""}
              </li>
            ))}
          </ul>
        </details>
      ))}
    </section>
  );
}
