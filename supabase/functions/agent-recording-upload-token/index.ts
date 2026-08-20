import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const BUCKET = "qc-recordings";
const STORAGE_PREFIX = `storage://${BUCKET}/`;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const body = await req.json();
    const sessionId = String(body?.session_id || "").trim();
    const slug = String(body?.slug || "").trim();
    const filename = safeName(String(body?.filename || "recording.mp3"));

    if (!sessionId || !slug) return json({ error: "session_id and slug are required" }, 400);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) return json({ error: "Server configuration is incomplete" }, 500);

    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

    const { data: settings, error: settingsError } = await admin
      .from("company_portal_settings")
      .select("company_id,public_slug,portal_enabled")
      .eq("public_slug", slug)
      .eq("portal_enabled", true)
      .maybeSingle();
    if (settingsError || !settings) return json({ error: "Company booking portal is unavailable" }, 404);

    const { data: reservations, error: reservationError } = await admin
      .from("appointment_reservations")
      .select("id,company_id,session_id,status,expires_at")
      .eq("session_id", sessionId)
      .eq("company_id", settings.company_id)
      .eq("status", "active")
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(1);

    const reservation = reservations?.[0];
    if (reservationError || !reservation) return json({ error: "Select an appointment time before uploading the recording" }, 409);

    const path = `${reservation.company_id}/agent/${reservation.id}/${Date.now()}-${filename}`;
    const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(path);
    if (error || !data?.token) return json({ error: error?.message || "Unable to authorize recording upload" }, 500);

    return json({ bucket: BUCKET, path, token: data.token, recording_url: `${STORAGE_PREFIX}${path}` });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Unexpected error" }, 500);
  }
});

function safeName(value: string): string {
  const cleaned = value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return cleaned || "recording.mp3";
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
