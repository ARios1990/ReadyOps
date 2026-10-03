import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { renderLeadEmail } from "./template.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type, x-client-info",
};
const out = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
// Custom worker authentication is verified here; never trust caller role metadata.
function equalSecret(left: string, right: string) {
  if (!left || !right || left.length !== right.length) return false;
  let mismatch = 0;
  for (let i = 0; i < left.length; i++)
    mismatch |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return mismatch === 0;
}
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return out({ error: "Method not allowed" }, 405);
  try {
    const worker = equalSecret(
      req.headers.get("x-readyops-worker-token") || "",
      Deno.env.get("READYOPS_EMAIL_WORKER_TOKEN") || "",
    );
    if (!worker) {
      const authorization = req.headers.get("Authorization");
      if (!authorization) return out({ error: "Unauthorized" }, 401);
      const caller = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        {
          global: { headers: { Authorization: authorization } },
          auth: { persistSession: false },
        },
      );
      const {
        data: { user },
        error,
      } = await caller.auth.getUser();
      if (error || !user) return out({ error: "Unauthorized" }, 401);
      const { data: admin } = await caller.rpc("is_admin");
      // Managers can enqueue their team's resends but cannot run a global worker.
      if (admin !== true)
        return out({ error: "Active administrator required" }, 403);
    }
    const apiKey = Deno.env.get("RESEND_API_KEY");
    const from = Deno.env.get("READY_OPS_FROM_EMAIL");
    if (!apiKey || !from || /@resend\.dev[>\s]*$/i.test(from))
      return out(
        {
          error:
            "Configure RESEND_API_KEY and a verified READY_OPS_FROM_EMAIL sender. Notifications remain Pending.",
        },
        503,
      );
    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );
    const { data: jobs, error: claimError } = await db.rpc(
      "claim_readyops_lead_emails",
      { p_limit: 2 },
    );
    if (claimError) throw claimError;
    let sent = 0;
    let failed = 0;
    for (const job of jobs || []) {
      let providerId: string | null = null;
      let failure: string | null = null;
      let retry = false;
      try {
        const email = renderLeadEmail(job.snapshot);
        const response = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "Idempotency-Key": `readyops-lead/${job.id}`,
          },
          body: JSON.stringify({ from, to: job.recipients, ...email }),
          signal: AbortSignal.timeout(20000),
        });
        const result = await response.json().catch(() => ({}));
        if (response.ok && result.id) {
          providerId = result.id;
          sent++;
        } else {
          failure = `Email provider rejected request (${response.status}): ${String(result.message || result.name || "Unknown error").slice(0, 300)}`;
          retry = response.status === 429 || response.status >= 500;
          failed++;
        }
      } catch {
        failure =
          "Email provider connection interrupted. Delivery may be uncertain; retry uses the same idempotency key.";
        retry = true;
        failed++;
      }
      const { error: finishError } = await db.rpc(
        "finish_readyops_lead_email",
        {
          p_id: job.id,
          p_claim_token: job.claim_token,
          p_provider_id: providerId,
          p_error: failure,
          p_retry: retry,
        },
      );
      if (finishError)
        console.error(
          "Email state persistence failed",
          job.id,
          finishError.message,
        ); // claim timeout safely retries identical payload
      await new Promise((resolve) => setTimeout(resolve, 550));
    }
    return out({ success: true, sent, failed, total: jobs?.length || 0 });
  } catch (error) {
    console.error(
      "send-lead-emails",
      error instanceof Error ? error.message : "Unexpected error",
    );
    return out({ error: "Unable to process client email queue" }, 500);
  }
});
