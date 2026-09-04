import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const BUCKET = "company-payment-receipts";
const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES: Record<string, string> = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let uploadedPath = "";
  try {
    const form = await req.formData();
    const companyId = String(form.get("company_id") || "").trim();
    const accessToken = String(form.get("access_token") || "").trim();
    const packageId = String(form.get("package_id") || "").trim();
    const amount = Number(form.get("amount"));
    const paymentMethod = clean(String(form.get("payment_method") || ""), 80);
    const reference = clean(String(form.get("reference") || ""), 160) || null;
    const notes = clean(String(form.get("notes") || ""), 1000) || null;
    const file = form.get("file");

    if (!isUuid(companyId) || !isUuid(accessToken) || !(file instanceof File)) {
      return json({ error: "A valid company link and receipt file are required" }, 400);
    }
    if (!Number.isFinite(amount) || amount <= 0 || amount > 9999999999.99) {
      return json({ error: "Enter a valid payment amount" }, 400);
    }
    if (!paymentMethod) return json({ error: "Select a payment method" }, 400);
    if (packageId && !isUuid(packageId)) return json({ error: "Invalid package reference" }, 400);

    const extension = ALLOWED_TYPES[file.type];
    if (!extension) return json({ error: "Upload a PDF, PNG, JPG, or WebP receipt" }, 415);
    if (file.size <= 0 || file.size > MAX_BYTES) {
      return json({ error: "Receipt must be 10 MB or smaller" }, 413);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) return json({ error: "Server configuration is incomplete" }, 500);
    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

    const { data: settings, error: settingsError } = await admin
      .from("company_portal_settings")
      .select("company_id,company_access_enabled")
      .eq("company_id", companyId)
      .eq("company_access_token", accessToken)
      .eq("company_access_enabled", true)
      .maybeSingle();
    if (settingsError || !settings) {
      return json({ error: "This company management link is invalid or disabled" }, 403);
    }

    if (packageId) {
      const { data: packageRow } = await admin
        .from("company_packages")
        .select("id")
        .eq("id", packageId)
        .eq("company_id", companyId)
        .maybeSingle();
      if (!packageRow) return json({ error: "The selected package does not belong to this company" }, 400);
    }

    const safeFileName = safeName(file.name || `receipt.${extension}`);
    uploadedPath = `${companyId}/${new Date().getUTCFullYear()}/${crypto.randomUUID()}-${safeFileName}`;
    const { error: uploadError } = await admin.storage.from(BUCKET).upload(uploadedPath, file, {
      contentType: file.type,
      cacheControl: "3600",
      upsert: false,
    });
    if (uploadError) return json({ error: uploadError.message || "Unable to upload the receipt" }, 500);

    const { data: receipt, error: insertError } = await admin
      .from("company_payment_receipts")
      .insert({
        company_id: companyId,
        package_id: packageId || null,
        amount,
        payment_method: paymentMethod,
        reference,
        notes,
        storage_path: uploadedPath,
        file_name: safeFileName,
        mime_type: file.type,
        file_size: file.size,
      })
      .select("id,package_id,amount,payment_method,reference,notes,file_name,mime_type,file_size,status,uploaded_by,created_at,reviewed_at")
      .single();

    if (insertError || !receipt) {
      await admin.storage.from(BUCKET).remove([uploadedPath]);
      uploadedPath = "";
      return json({ error: insertError?.message || "Unable to save the receipt record" }, 500);
    }

    return json({ receipt });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Unexpected receipt upload error" }, 500);
  }
});

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function clean(value: string, maxLength: number): string {
  return Array.from(value.trim())
    .map((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127 ? " " : character;
    })
    .join("")
    .slice(0, maxLength);
}

function safeName(value: string): string {
  const cleaned = value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return (cleaned || "receipt").slice(-140);
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
