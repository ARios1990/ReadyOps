import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type User } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

type StaffRole = "admin" | "agent" | "manager" | "qc";

type CreateUserRequest = {
  email?: string;
  password?: string;
  display_name?: string;
  role?: StaffRole;
  team_id?: string | null;
  agent_id?: string | null;
  create_agent?: boolean;
  update_existing_password?: boolean;
};

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function cleanEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let createdUserId: string | null = null;

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing authorization header" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!supabaseUrl || !serviceRoleKey || !anonKey) return json({ error: "Server configuration is incomplete" }, 500);

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: { user: caller }, error: authError } = await callerClient.auth.getUser();
    if (authError || !caller) return json({ error: "Unauthorized" }, 401);

    const { data: callerProfile, error: callerProfileError } = await adminClient
      .from("profiles")
      .select("role")
      .eq("id", caller.id)
      .maybeSingle();
    if (callerProfileError) return json({ error: "Unable to verify administrator access" }, 500);
    if (callerProfile?.role !== "admin") return json({ error: "Only admins can create users" }, 403);

    const payload = await req.json() as CreateUserRequest;
    const email = cleanEmail(payload.email);
    const password = cleanText(payload.password);
    const displayName = cleanText(payload.display_name);
    const role = payload.role || "agent";
    const teamId = cleanText(payload.team_id) || null;
    const requestedAgentId = cleanText(payload.agent_id) || null;
    const allowedRoles: StaffRole[] = ["admin", "agent", "manager", "qc"];

    if (!email || !password || !displayName) return json({ error: "email, password, and display_name are required" }, 400);
    if (password.length < 6) return json({ error: "Password must be at least 6 characters" }, 400);
    if (!allowedRoles.includes(role)) return json({ error: "Invalid staff role" }, 400);

    const ensureAgent = role === "agent" || Boolean(payload.create_agent) || Boolean(requestedAgentId);
    if ((role === "agent" || role === "manager" || ensureAgent) && !teamId && !requestedAgentId) {
      return json({ error: "A team is required for agents and managers" }, 400);
    }

    if (teamId) {
      const { data: team, error: teamError } = await adminClient.from("teams").select("id").eq("id", teamId).maybeSingle();
      if (teamError || !team) return json({ error: "The selected team is unavailable" }, 400);
    }

    let authUser: User | null = null;
    for (let page = 1; page <= 100 && !authUser; page += 1) {
      const { data: listedUsers, error: listError } = await adminClient.auth.admin.listUsers({ page, perPage: 1000 });
      if (listError) return json({ error: listError.message }, 500);
      authUser = listedUsers.users.find(user => cleanEmail(user.email) === email) || null;
      if (listedUsers.users.length < 1000) break;
    }
    const userAlreadyExisted = Boolean(authUser);

    if (authUser) {
      const passwordPatch = payload.update_existing_password ? { password } : {};
      const attributes = {
        email_confirm: true,
        user_metadata: { ...authUser.user_metadata, display_name: displayName },
        app_metadata: { ...authUser.app_metadata, role },
        ...passwordPatch,
      };
      const { data, error } = await adminClient.auth.admin.updateUserById(authUser.id, attributes);
      if (error || !data.user) return json({ error: error?.message || "Unable to update existing user" }, 400);
      authUser = data.user;
    } else {
      const { data, error } = await adminClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { display_name: displayName },
        app_metadata: { role },
      });
      if (error || !data.user) return json({ error: error?.message || "Unable to create user" }, 400);
      authUser = data.user;
      createdUserId = authUser.id;
    }

    const { data: existingProfile, error: existingProfileError } = await adminClient
      .from("profiles")
      .select("agent_id, team_id")
      .eq("id", authUser.id)
      .maybeSingle();
    if (existingProfileError) throw existingProfileError;

    let agentId = requestedAgentId || (ensureAgent ? null : existingProfile?.agent_id || null);
    let agentCreated = false;

    if (ensureAgent) {
      if (agentId) {
        const { data: requestedAgent, error } = await adminClient.from("agents").select("id").eq("id", agentId).maybeSingle();
        if (error || !requestedAgent) throw new Error("The selected agent is unavailable");
      } else {
        const { data: emailMatches, error: emailMatchError } = await adminClient
          .from("agents")
          .select("id")
          .ilike("email", email)
          .limit(2);
        if (emailMatchError) throw emailMatchError;
        if ((emailMatches || []).length === 1) agentId = emailMatches![0].id;

        if (!agentId && teamId) {
          const { data: nameMatches, error: nameMatchError } = await adminClient
            .from("agents")
            .select("id")
            .eq("team_id", teamId)
            .ilike("name", displayName)
            .limit(2);
          if (nameMatchError) throw nameMatchError;
          if ((nameMatches || []).length === 1) agentId = nameMatches![0].id;
        }
      }

      if (!agentId) {
        const { data: insertedAgent, error } = await adminClient
          .from("agents")
          .insert({ name: displayName, email, team_id: teamId })
          .select("id")
          .single();
        if (error || !insertedAgent) throw error || new Error("Unable to create the linked agent");
        agentId = insertedAgent.id;
        agentCreated = true;
      } else {
        const agentPatch: Record<string, unknown> = { name: displayName, email };
        if (teamId) agentPatch.team_id = teamId;
        const { error } = await adminClient.from("agents").update(agentPatch).eq("id", agentId);
        if (error) throw error;
      }
    }

    const { error: profileError } = await adminClient.from("profiles").upsert({
      id: authUser.id,
      email,
      display_name: displayName,
      role,
      team_id: teamId || existingProfile?.team_id || null,
      agent_id: agentId,
      updated_at: new Date().toISOString(),
    });
    if (profileError) throw profileError;

    return json({
      success: true,
      user_id: authUser.id,
      created: !userAlreadyExisted,
      agent_id: agentId,
      agent_created: agentCreated,
    });
  } catch (error) {
    if (createdUserId) {
      const supabaseUrl = Deno.env.get("SUPABASE_URL");
      const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (supabaseUrl && serviceRoleKey) {
        const rollbackClient = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
        await rollbackClient.auth.admin.deleteUser(createdUserId);
      }
    }
    return json({ error: error instanceof Error ? error.message : "Unable to create staff login" }, 500);
  }
});
