import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.57.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type, x-client-info",
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return reply({ error: "Method not allowed" }, 405);
  try {
    const authorization = req.headers.get("Authorization");
    if (!authorization) return reply({ error: "Sign in required" }, 401);
    const url = Deno.env.get("SUPABASE_URL")!;
    const caller = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false },
    });
    const {
      data: { user },
      error,
    } = await caller.auth.getUser();
    if (error || !user) return reply({ error: "Invalid session" }, 401);
    const { data: allowed, error: roleError } = await caller.rpc("is_admin");
    if (roleError || allowed !== true)
      return reply({ error: "Active admin access required" }, 403);
    const body = await req.json();
    if (typeof body.active !== "boolean")
      return reply({ error: "Active status required" }, 400);
    const params = {
      p_actor_id: user.id,
      p_profile_id: body.profile_id || null,
      p_agent_id: body.agent_id || null,
      p_display_name: body.display_name,
      p_email: body.email,
      p_role: body.role,
      p_team_id: body.team_id || null,
      p_active: body.active,
    };
    const service = createClient(
      url,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );
    if (body.mode === "agent_row")
      return await saveAgentRow(service, user.id, body);
    const { data: previous, error: validationError } = await service.rpc(
      "save_readyops_staff_account",
      { ...params, p_apply: false },
    );
    if (validationError)
      return reply(
        {
          error:
            validationError.code === "P0001"
              ? validationError.message
              : "Unable to validate this account",
        },
        400,
      );
    let previousAuthEmail: string | undefined;
    // Update the login, not just the profile displayed in the dashboard.
    if (previous.profile_id) {
      const { data: oldLogin, error: lookupError } =
        await service.auth.admin.getUserById(previous.profile_id);
      if (lookupError || !oldLogin.user?.email)
        return reply({ error: "Unable to locate the existing login" }, 400);
      previousAuthEmail = oldLogin.user.email;
      const { error: authUpdateError } =
        await service.auth.admin.updateUserById(previous.profile_id, {
          email: String(body.email).trim().toLowerCase(),
          email_confirm: true,
          ban_duration: body.active ? "none" : "876000h",
        });
      if (authUpdateError)
        return reply(
          {
            error:
              "Unable to update the login email or status. Check that the email is not already in use.",
          },
          400,
        );
    }
    const { error: saveError } = await service.rpc(
      "save_readyops_staff_account",
      {
        ...params,
        p_apply: true,
        p_expected_updated_at: previous.updated_at,
      },
    );
    if (saveError) {
      if (previous.profile_id) {
        const { error: restoreError } = await service.auth.admin.updateUserById(
          previous.profile_id,
          {
            email: previousAuthEmail,
            email_confirm: true,
            ban_duration: previous.active ? "none" : "876000h",
          },
        );
        if (restoreError) {
          console.error(
            "Staff Auth rollback failed",
            previous.profile_id,
            restoreError.message,
          );
          return reply(
            {
              error:
                "Profile save failed and login needs administrator reconciliation. Refresh before retrying.",
            },
            500,
          );
        }
      }
      return reply(
        {
          error:
            saveError.code === "P0001"
              ? saveError.message
              : "Unable to save this account. Refresh before retrying.",
        },
        409,
      );
    }
    return reply({ success: true });
  } catch (error) {
    console.error(
      "update-staff",
      error instanceof Error ? error.message : "Unexpected error",
    );
    return reply({ error: "Unable to save this account" }, 500);
  }
});

async function saveAgentRow(
  service: SupabaseClient,
  actorId: string,
  body: Record<string, unknown>,
) {
  const params = {
    p_actor_id: actorId,
    p_agent_id: body.agent_id,
    p_name: body.name,
    p_team_id: body.team_id || null,
    p_active: body.active,
    p_linked_profile_id: body.linked_profile_id || null,
    p_expected: body.expected,
  };
  const { data: plan, error: validationError } = await service.rpc(
    "save_readyops_agent_row",
    { ...params, p_apply: false },
  );
  if (validationError)
    return reply(
      {
        error:
          validationError.code === "P0001"
            ? validationError.message
            : "Unable to validate this row. Check deployment and refresh the table.",
      },
      400,
    );
  const rollbacks: { id: string; ban: string }[] = [];
  async function restoreLogins() {
    let restored = true;
    for (const previous of rollbacks.reverse()) {
      const { error } = await service.auth.admin.updateUserById(previous.id, {
        ban_duration: previous.ban,
      });
      if (error) {
        restored = false;
        console.error("Agent row Auth rollback failed", previous.id);
      }
    }
    return restored;
  }
  try {
    for (const change of plan.profile_changes as {
      id: string;
      active: boolean;
      next_active: boolean;
    }[]) {
      if (change.active === change.next_active) continue;
      const { data: login, error: lookupError } =
        await service.auth.admin.getUserById(change.id);
      if (lookupError || !login.user)
        throw new Error(
          "Unable to locate a linked login. No row changes were saved.",
        );
      const until = (login.user as { banned_until?: string }).banned_until;
      const remaining = until ? new Date(until).getTime() - Date.now() : 0;
      const previousBan =
        remaining > 0 ? `${Math.ceil(remaining / 1000)}s` : "none";
      const { error } = await service.auth.admin.updateUserById(change.id, {
        ban_duration: change.next_active ? "none" : "876000h",
      });
      if (error)
        throw new Error(
          "Unable to update linked login access. No row changes were saved.",
        );
      rollbacks.push({ id: change.id, ban: previousBan });
    }
    const { error: saveError } = await service.rpc("save_readyops_agent_row", {
      ...params,
      p_apply: true,
    });
    if (saveError)
      throw new Error(
        saveError.code === "P0001"
          ? saveError.message
          : "Unable to save this row. Refresh before retrying.",
      );
    return reply({ success: true });
  } catch (error) {
    const restored = await restoreLogins();
    return reply(
      {
        error: restored
          ? error instanceof Error
            ? error.message
            : "Unable to save this row"
          : "Row save failed and login access needs Admin reconciliation. Refresh before retrying.",
      },
      restored ? 409 : 500,
    );
  }
}
