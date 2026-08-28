import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.49.1";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: cors });
  try {
    const auth = req.headers.get("Authorization") || "";
    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const caller = createClient(url, anon, { global: { headers: { Authorization: auth } } });
    const { data: { user } } = await caller.auth.getUser();
    if (!user) return out({ error: "Unauthorized" }, 401);

    const { data: profile } = await caller.from("profiles").select("role").eq("id", user.id).maybeSingle();
    if (!profile || !["admin", "qc"].includes(profile.role)) return out({ error: "QC or admin access required" }, 403);

    const body = await req.json().catch(() => ({}));
    const admin = createClient(url, service);
    let q = admin.from("company_notification_batches")
      .select("*, roster_companies(name,email), company_portal_settings(public_slug,company_access_token)")
      .eq("status", "queued");
    if (body.batch_id) q = q.eq("id", body.batch_id);
    if (body.company_id) q = q.eq("company_id", body.company_id);
    if (body.notification_type) q = q.eq("notification_type", body.notification_type);

    const { data: batches, error } = await q;
    if (error) return out({ error: error.message }, 400);
    if (!batches?.length) return out({ success: true, sent: 0, message: "No queued notifications" });

    const apiKey = Deno.env.get("RESEND_API_KEY");
    const from = Deno.env.get("READY_OPS_FROM_EMAIL") || "Ready Ops <onboarding@resend.dev>";
    if (!apiKey) return out({ error: "Email provider is not configured yet. Set RESEND_API_KEY in Supabase Edge Function secrets.", queued: batches.length }, 503);

    let sent = 0;
    for (const batch of batches) {
      const email = batch.recipient_email || batch.roster_companies?.email;
      if (!email) {
        await admin.from("company_notification_batches")
          .update({ status: "failed", error_message: "Company email is blank" })
          .eq("id", batch.id);
        continue;
      }

      const manage = `${Deno.env.get("READY_OPS_APP_URL") || "https://readyops.bolt.host"}/company/${batch.company_portal_settings?.public_slug}/manage/${batch.company_portal_settings?.company_access_token}`;
      const same = batch.notification_type === "same_day";
      const subject = same
        ? "Ready Ops: Same-day appointment approved"
        : `Ready Ops: ${batch.lead_count} lead${batch.lead_count === 1 ? "" : "s"} ready`;
      const text = same
        ? `A same-day appointment has been QC approved and is available in your Ready Ops company portal.\n\nOpen your portal: ${manage}`
        : `Today's QC-approved leads are ready in your Ready Ops company portal. Total approved in this notification: ${batch.lead_count}.\n\nOpen your portal: ${manage}`;

      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from, to: [email], subject, text }),
      });

      if (r.ok) {
        await admin.from("company_notification_batches")
          .update({ status: "sent", sent_at: new Date().toISOString(), error_message: null })
          .eq("id", batch.id);
        sent++;
      } else {
        const msg = await r.text();
        await admin.from("company_notification_batches")
          .update({ status: "failed", error_message: msg.slice(0, 500) })
          .eq("id", batch.id);
      }
    }

    return out({ success: true, sent, total: batches.length });
  } catch (e) {
    return out({ error: (e as Error).message }, 500);
  }
});

function out(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

