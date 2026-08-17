import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const STORAGE_PREFIX = "storage://qc-recordings/";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const { company_id, access_token, lead_id } = await req.json();
    if (!company_id || !access_token || !lead_id) return json({ error: "company_id, access_token, and lead_id are required" }, 400);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

    const { data: settings, error: settingsError } = await admin
      .from("company_portal_settings")
      .select("company_id,company_access_enabled,company_access_token")
      .eq("company_id", company_id)
      .eq("company_access_enabled", true)
      .eq("company_access_token", access_token)
      .maybeSingle();

    if (settingsError || !settings) return json({ error: "Invalid or disabled company access link" }, 403);

    const { data: lead, error: leadError } = await admin
      .from("portal_leads")
      .select("id,company_id,qc_status,recording_url,share_recording_with_company")
      .eq("id", lead_id)
      .eq("company_id", company_id)
      .eq("qc_status", "approved")
      .maybeSingle();

    if (leadError || !lead) return json({ error: "Lead not found" }, 404);
    if (!lead.share_recording_with_company || !lead.recording_url) return json({ error: "Recording is not shared with this company" }, 403);

    const recordingUrl = String(lead.recording_url);
    if (!recordingUrl.startsWith(STORAGE_PREFIX)) return json({ signed_url: recordingUrl });

    const path = recordingUrl.slice(STORAGE_PREFIX.length);
    if (!path || path.includes("..")) return json({ error: "Invalid recording path" }, 400);

    const { data, error: signedError } = await admin.storage.from("qc-recordings").createSignedUrl(path, 60 * 15);
    if (signedError || !data?.signedUrl) return json({ error: signedError?.message || "Unable to sign recording URL" }, 500);

    return json({ signed_url: data.signedUrl, expires_in: 900 });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Unexpected error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
