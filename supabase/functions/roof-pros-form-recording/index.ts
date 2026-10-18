import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import {createClient} from 'npm:@supabase/supabase-js@2.57.4';
const respond=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
// A short-lived, single-job capability minted only by the private worker claim.
// No staff token, Google credential, or service key is sent to the browser worker.
Deno.serve(async req=>{
 if(req.method!=='POST')return respond({error:'POST required'},405);
 try{
  const {id,token,action='recording',message}=await req.json();
  const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if(!uuid.test(id||'')||!uuid.test(token||''))return respond({error:'Invalid claim'},401);
  const admin=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
  const {data:job,error}=await admin.from('roof_pros_form_deliveries').select('lead_id,status,lease_expires_at')
   .eq('id',id).eq('claim_token',token).maybeSingle();
  if(error||!job||!['preparing','submitting'].includes(job.status)||Date.parse(job.lease_expires_at)<=Date.now())return respond({error:'Expired or invalid claim'},401);
  const {data:lead}=await admin.from('portal_leads').select('company_id,qc_status,recording_url').eq('id',job.lead_id).maybeSingle();
  const {data:appointment}=await admin.from('portal_appointments').select('company_visible_at').eq('lead_id',job.lead_id).order('created_at',{ascending:false}).limit(1).maybeSingle();
  if(lead?.company_id!=='d12e8b8c-fd25-45c0-8d43-9b4aecdcda0c'||lead.qc_status!=='approved'||!appointment?.company_visible_at)return respond({error:'Lead is not currently approved and sent to Roof Pros'},409);
  if(['submitting','submitted','needs_info','queued','uncertain'].includes(action)){
   const {data,error:transitionError}=await admin.rpc('roof_pros_form_worker_transition',{
    p_id:id,p_token:token,p_status:action,p_message:typeof message==='string'?message:null,
   });
   return transitionError?respond({error:transitionError.message},409):respond({success:data===true});
  }
  if(action!=='recording')return respond({error:'Invalid action'},400);
  const prefix=`storage://qc-recordings/${job.lead_id}/`;
  if(!lead.recording_url?.startsWith(prefix)||lead.recording_url.includes('..')||lead.recording_url.includes('\\'))return respond({error:'Upload a private recording for this lead first'},422);
  const path=lead.recording_url.slice('storage://qc-recordings/'.length);
  const {data:signed,error:signError}=await admin.storage.from('qc-recordings').createSignedUrl(path,300);
  if(signError||!signed?.signedUrl)return respond({error:'Recording is unavailable'},422);
  return respond({url:signed.signedUrl,filename:path.split('/').pop(),max_bytes:10*1024*1024,expires_in:300});
 }catch{return respond({error:'Unable to prepare recording'},500);}
});
