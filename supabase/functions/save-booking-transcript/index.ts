import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey' };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

// Custom capability authentication: BOTH the existing appointment manage token
// and its originating browser session must match. No caller-supplied lead ID,
// storage URL, or qualification decision is accepted. Tokens are never logged.
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const length = Number(req.headers.get('content-length') || 0);
  if (length > 600_000) return json({ error: 'Transcript is too large' }, 413);
  try {
    const raw = await req.text();
    if (raw.length > 600_000) return json({ error: 'Transcript is too large' }, 413);
    const body = JSON.parse(raw);
    if (!uuid.test(body.manage_token || '') || !uuid.test(body.session_id || '')) return json({ error: 'Booking authorization required' }, 401);
    if (typeof body.transcript !== 'string' || !body.transcript.trim() || body.transcript.length > 500_000 || typeof body.recording_notes !== 'string' || body.recording_notes.length > 50_000) return json({ error: 'Invalid transcript or recording notes' }, 400);
    const url = Deno.env.get('SUPABASE_URL'), key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !key) return json({ error: 'Transcript service unavailable' }, 503);
    const admin = createClient(url, key, { auth: { persistSession: false } });
    const { data: appointment, error: appointmentError } = await admin.from('portal_appointments').select('lead_id,created_at').eq('manage_token', body.manage_token).maybeSingle();
    if (appointmentError || !appointment) return json({ error: 'Booking authorization required' }, 403);
    // Limit this capability to the booking session's recent, pending submission.
    if (Date.now() - Date.parse(appointment.created_at) > 24 * 60 * 60 * 1000) return json({ error: 'Use the QC queue to edit older transcripts' }, 403);
    const { data: lead, error: leadError } = await admin.from('portal_leads').select('id,qc_status').eq('id', appointment.lead_id).eq('session_id', body.session_id).maybeSingle();
    if (leadError || !lead || lead.qc_status !== 'pending') return json({ error: 'Only this session’s pending booking can receive a transcript' }, 403);
    const { data: existing, error: existingError } = await admin.from('qc_lead_transcripts').select('method').eq('lead_id', lead.id).maybeSingle();
    if (existingError) return json({ error: 'Unable to check transcript' }, 500);
    if (existing && existing.method !== 'booking-local-whisper') return json({ error: 'A QC reviewer has already saved a transcript' }, 409);
    const { error } = await admin.from('qc_lead_transcripts').upsert({ lead_id: lead.id, transcript: body.transcript.trim(), summary: body.recording_notes.trim(), method: 'booking-local-whisper', updated_at: new Date().toISOString() }, { onConflict: 'lead_id' });
    if (error) return json({ error: 'Unable to save transcript to QC' }, 500);
    return json({ saved: true });
  } catch { return json({ error: 'Unable to save booking transcript' }, 400); }
});
