import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const BUCKET = "company-payment-receipts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const body = await req.json();
    const companyId = String(body?.company_id || "").trim();
    const accessToken = String(body?.access_token || "").trim();
    const receiptId = String(body?.receipt_id || "").trim();
    if (![companyId, accessToken, receiptId].every(isUuid)) {
      return json({ error: "A valid company link and receipt are required" }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) return json({ error: "Server configuration is incomplete" }, 500);
    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

    const { data: settings } = await admin
      .from("company_portal_settings")
      .select("company_id")
      .eq("company_id", companyId)
      .eq("company_access_token", accessToken)
      .eq("company_access_enabled", true)
      .maybeSingle();
    if (!settings) return json({ error: "This company management link is invalid or disabled" }, 403);

    const { data: receipt } = await admin
      .from("company_payment_receipts")
      .select("storage_path")
      .eq("id", receiptId)
      .eq("company_id", companyId)
      .maybeSingle();
    if (!receipt?.storage_path) return json({ error: "Receipt not found" }, 404);

    const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(receipt.storage_path, 300);
    if (error || !data?.signedUrl) return json({ error: error?.message || "Unable to open the receipt" }, 500);
    return json({ url: data.signedUrl });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Unexpected receipt access error" }, 500);
  }
});

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
