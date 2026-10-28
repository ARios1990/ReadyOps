import {createClient} from 'npm:@supabase/supabase-js@2.57.4';
import {manualFields, ROOF_PROS_FORM} from '../_shared/roofProsManual.ts';

// A capability grants access to one admin-requested manual draft, never to a staff session.
const headers = {'Content-Type':'application/json', 'Cache-Control':'no-store', 'Access-Control-Allow-Origin':'https://readyops.bolt.host', 'Access-Control-Allow-Headers':'content-type', 'Access-Control-Allow-Methods':'POST, OPTIONS'};
const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), {status, headers});
Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response(null, {status:204, headers});
  if (req.method !== 'POST') return respond({error:'POST required'}, 405);
  try {
    const body = await req.json();
    const {id, token, action = 'context'} = body;
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuid.test(id || '') || !uuid.test(token || '')) return respond({error:'Invalid manual preparation ticket'}, 401);
    if (!['context','ready','user_submit','receipt','failed','uncertain'].includes(action)) return respond({error:'Invalid action'}, 400);
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {auth:{persistSession:false}});
    const {data, error} = await admin.rpc('roof_pros_manual_exchange', {
      p_id:id, p_token:token, p_action:action, p_evidence:body.evidence || {},
    });
    if (error) return respond({error:error.message}, 409);
    if (action !== 'context') return respond(data);
    const fields = manualFields(data.payload);
    const path = String(data.payload.recording_url).slice('storage://qc-recordings/'.length);
    const {data:signed, error:signError} = await admin.storage.from('qc-recordings').createSignedUrl(path, 300);
    if (signError || !signed?.signedUrl) return respond({error:'The current recording is unavailable.'}, 422);
    return respond({lead_id:data.payload.lead_id, fields, form_url:ROOF_PROS_FORM, recording_url:signed.signedUrl, max_bytes:10*1024*1024, source_updated_at:data.payload.source_updated_at});
  } catch (error) {
    return respond({error:error instanceof Error ? error.message : 'Unable to prepare the manual form.'}, 422);
  }
});
