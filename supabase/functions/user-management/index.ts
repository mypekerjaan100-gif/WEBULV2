import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  ACTION_TO_OPERATION,
  parseRequest,
  type UserManagementAction,
} from "./contracts.ts";
import { handleListUsers } from "./handlers/listUsers.ts";
import { handleInviteUser } from "./handlers/inviteUser.ts";
import { handleSessionContext } from "./handlers/sessionContext.ts";
import { handleAccessOptions } from "./handlers/accessOptions.ts";
import { handleAssignContractAccess } from "./handlers/assignContractAccess.ts";
import { handleAssignOrganizationMembership } from "./handlers/assignOrganizationMembership.ts";
import { handleRevokeAccess } from "./handlers/revokeAccess.ts";
import { handleDeactivateAccount } from "./handlers/deactivateAccount.ts";
import { handleResolveDuplicate } from "./handlers/resolveDuplicate.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function requiredEnv(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing server environment variable: ${name}`);
  return value;
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return jsonResponse(405, { error: "method_not_allowed" });
  }

  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return jsonResponse(401, { error: "authentication_required" });
  }

  try {
    const body = parseRequest(await request.json());
    const callerClient = createClient(
      requiredEnv("SUPABASE_URL"),
      requiredEnv("SUPABASE_ANON_KEY"),
      {
        global: { headers: { Authorization: authorization } },
        auth: { persistSession: false, autoRefreshToken: false },
      },
    );
    const { data: { user }, error: userError } = await callerClient.auth.getUser();
    if (userError || !user) {
      return jsonResponse(401, { error: "authentication_required" });
    }

    if (body.action === "capabilities") {
      const { data, error } = await callerClient.rpc(
        "user_management_actor_context",
      );
      if (error) return jsonResponse(403, { error: "forbidden" });
      return jsonResponse(200, { actor: data?.[0] ?? null });
    }

    if (body.action === "session_context") {
      const result = await handleSessionContext(callerClient, user.id);
      return jsonResponse(result.status, result.body);
    }

    const operation = ACTION_TO_OPERATION[body.action as UserManagementAction];
    const { data: authorizationResult, error: authorizationError } =
      await callerClient.rpc("user_management_authorize_operation", {
        p_operation: operation,
        p_target_user_id: body.targetUserId ?? null,
        p_target_role_code: body.targetRoleCode ?? null,
        p_reason: body.reason ?? null,
      });
    if (authorizationError) {
      return jsonResponse(403, { error: "forbidden" });
    }

    if (body.action === "list_users") {
      const result = await handleListUsers();
      return jsonResponse(result.status, result.body);
    }

    if (body.action === "access_options") {
      const result = await handleAccessOptions();
      return jsonResponse(result.status, result.body);
    }

    if (body.action === "invite_user") {
      const result = await handleInviteUser(callerClient, body.payload, user.id);
      return jsonResponse(result.status, result.body);
    }

    if (body.action === "assign_contract_access") {
      const result = await handleAssignContractAccess(
        body.targetUserId,
        body.targetRoleCode,
        body.payload,
        user.id,
      );
      return jsonResponse(result.status, result.body);
    }

    if (body.action === "assign_organization_access") {
      const result = await handleAssignOrganizationMembership(
        body.targetUserId,
        body.targetRoleCode,
        body.payload,
        user.id,
      );
      return jsonResponse(result.status, result.body);
    }

    if (body.action === "revoke_access") {
      const result = await handleRevokeAccess(body.targetUserId, user.id);
      return jsonResponse(result.status, result.body);
    }

    if (body.action === "deactivate_account") {
      const result = await handleDeactivateAccount(body.targetUserId, user.id);
      return jsonResponse(result.status, result.body);
    }

    if (body.action === "resolve_duplicate") {
      const result = await handleResolveDuplicate(body.targetUserId, body.payload, user.id);
      return jsonResponse(result.status, result.body);
    }

    return jsonResponse(501, {
      error: "operation_not_implemented",
      operation,
      authorization: authorizationResult,
    });
  } catch (error) {
    return jsonResponse(400, {
      error: "invalid_request",
      message: error instanceof Error ? error.message : "Invalid request",
    });
  }
});
