import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.49.1";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"POST,OPTIONS","Access-Control-Allow-Headers":"Content-Type,Authorization,X-ReadyMode-Secret,Apikey"};
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS") return new Response(null,{status:200,headers:cors});
 if(req.method!=="POST") return out({error:"POST required"},405);
 try{
  const body=await req.json();
  const secret=req.headers.get("X-ReadyMode-Secret")||body.secret;
  if(!secret||!body.source_lead_id) return out({error:"secret and source_lead_id are required"},400);
  const client=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const {data,error}=await client.rpc("sync_readymode_lead",{p_secret:secret,p_source_lead_id:String(body.source_lead_id),p_disposition:String(body.disposition||""),p_payload:body.payload||{}});
  if(error) return out({error:error.message},400);
  return out({success:true,data});
 }catch(e){return out({error:(e as Error).message},500)}
});
function out(body:unknown,status=200){return new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json"}})}
