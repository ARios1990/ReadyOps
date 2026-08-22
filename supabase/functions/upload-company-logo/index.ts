import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};
const BUCKET = "company-logos";
const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS")
    return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const form = await req.formData();
    const companyId = String(form.get("company_id") || "").trim();
    const accessToken = String(form.get("access_token") || "").trim();
    const file = form.get("file");
    if (!isUuid(companyId) || !isUuid(accessToken) || !(file instanceof File)) {
      return json(
        { error: "A valid company link and image file are required" },
        400,
      );
    }
    const extension = ALLOWED_TYPES[file.type];
    if (!extension)
      return json({ error: "Upload a PNG, JPG, or WebP image" }, 415);
    if (file.size <= 0 || file.size > MAX_BYTES)
      return json({ error: "Logo must be 5 MB or smaller" }, 413);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey)
      return json({ error: "Server configuration is incomplete" }, 500);
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    const { data: settings, error: settingsError } = await admin
      .from("company_portal_settings")
      .select("company_id,company_access_enabled")
      .eq("company_id", companyId)
      .eq("company_access_token", accessToken)
      .eq("company_access_enabled", true)
      .maybeSingle();
    if (settingsError || !settings)
      return json(
        { error: "This company management link is invalid or disabled" },
        403,
      );

    const path = `${companyId}/logo-${crypto.randomUUID()}.${extension}`;
    const { error: uploadError } = await admin.storage
      .from(BUCKET)
      .upload(path, file, {
        contentType: file.type,
        cacheControl: "3600",
        upsert: false,
      });
    if (uploadError)
      return json(
        { error: uploadError.message || "Unable to upload the logo" },
        500,
      );

    const { data: publicUrl } = admin.storage.from(BUCKET).getPublicUrl(path);
    const logoPath = publicUrl.publicUrl;
    const { error: updateError } = await admin
      .from("roster_companies")
      .update({ logo_path: logoPath })
      .eq("id", companyId);
    if (updateError)
      return json(
        { error: updateError.message || "Unable to save the company logo" },
        500,
      );

    return json({ logo_path: logoPath });
  } catch (error) {
    return json(
      {
        error:
          error instanceof Error ? error.message : "Unexpected upload error",
      },
      500,
    );
  }
});

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
