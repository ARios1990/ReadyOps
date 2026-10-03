import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user: caller }, error: authError } = await callerClient.auth.getUser();
    if (authError || !caller) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: callerProfile } = await callerClient
      .from("profiles")
      .select("role,active")
      .eq("id", caller.id)
      .maybeSingle();

    if (!callerProfile || callerProfile.role !== "admin" || !callerProfile.active) {
      return new Response(
        JSON.stringify({ error: "Only admins can create users" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { email, password, display_name, role, agent_id, team_id, create_agent } = await req.json();

    if (!email || !password || !display_name) {
      return new Response(
        JSON.stringify({ error: "email, password, and display_name are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    if (!['admin','agent','manager','qc'].includes(role || 'agent')) return new Response(JSON.stringify({error:'Invalid account role'}),{status:400,headers:{...corsHeaders,'Content-Type':'application/json'}});
    let linkedAgent = agent_id || null;
    let assignedTeam = team_id || null;
    if (linkedAgent) {
      const {data:agent,error:agentError}=await adminClient.from('agents').select('id,team_id').eq('id',linkedAgent).single();
      const {data:existing}=await adminClient.from('profiles').select('id').eq('agent_id',linkedAgent).limit(1);
      if(agentError || existing?.length || (assignedTeam && assignedTeam!==agent.team_id)) return new Response(JSON.stringify({error:'Agent is unavailable, already linked, or assigned to another team'}),{status:400,headers:{...corsHeaders,'Content-Type':'application/json'}});
      assignedTeam=agent.team_id;
    }
    if (['agent','manager'].includes(role || 'agent') && !assignedTeam) return new Response(JSON.stringify({error:'Assign a team for this account'}),{status:400,headers:{...corsHeaders,'Content-Type':'application/json'}});
    if (assignedTeam) {
      const {data:team}=await adminClient.from('teams').select('id').eq('id',assignedTeam).maybeSingle();
      if(!team)return new Response(JSON.stringify({error:'Team not found'}),{status:400,headers:{...corsHeaders,'Content-Type':'application/json'}});
    }

    const { data: newUser, error: createError } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name },
    });

    if (createError) {
      console.error("createUser failed", createError);
      return new Response(
        JSON.stringify({ error: "Unable to create this user." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (newUser?.user) {
      let createdAgent: string | null=null;
      if(!linkedAgent && (create_agent || (role || 'agent')==='agent')) {
        const {data:agent,error:agentError}=await adminClient.from('agents').insert({name:display_name,email:String(email).trim().toLowerCase(),team_id:assignedTeam,active:true}).select('id').single();
        if(agentError) {await adminClient.auth.admin.deleteUser(newUser.user.id);return new Response(JSON.stringify({error:'Unable to create linked agent; account was rolled back'}),{status:400,headers:{...corsHeaders,'Content-Type':'application/json'}});}
        linkedAgent=agent.id;createdAgent=agent.id;
      }
      const {error:profileError}=await adminClient
        .from("profiles")
        .upsert({
          id: newUser.user.id,
          display_name: display_name,
          role: role || "agent",
          agent_id: linkedAgent,
          email: String(email).trim().toLowerCase(),team_id:assignedTeam,active:true,
        });
      if(profileError) {
        await adminClient.auth.admin.deleteUser(newUser.user.id);
        if(createdAgent)await adminClient.from('agents').delete().eq('id',createdAgent);
        return new Response(JSON.stringify({error:'Unable to save profile; newly created account was rolled back'}),{status:400,headers:{...corsHeaders,'Content-Type':'application/json'}});
      }
    }

    return new Response(
      JSON.stringify({ success: true, user_id: newUser?.user?.id }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("create-user failed", err);
    return new Response(
      JSON.stringify({ error: "Unexpected error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
