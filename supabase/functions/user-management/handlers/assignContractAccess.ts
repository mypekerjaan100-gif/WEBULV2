import { createClient } from "jsr:@supabase/supabase-js@2";

interface AssignmentPayload {
  contractId?: unknown;
  contractRole?: unknown;
  operationalUp3Id?: unknown;
  operationalUnitId?: unknown;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing server environment variable: ${name}`);
  return value;
}

function uuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

export async function handleAssignContractAccess(
  targetUserId: string | undefined,
  targetRoleCode: string | undefined,
  payload: unknown,
  actorUserId: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const request = payload as AssignmentPayload | undefined;
  const contractRole = request?.contractRole;
  if (!uuid(targetUserId) || !uuid(request?.contractId) || !uuid(request?.operationalUp3Id) ||
    (request?.operationalUnitId != null && !uuid(request.operationalUnitId)) ||
    (contractRole !== "ADMIN_UP3" && contractRole !== "ADMIN_ULP") || targetRoleCode !== contractRole) {
    return { status: 400, body: { error: "invalid_contract_assignment" } };
  }
  if ((contractRole === "ADMIN_UP3" && request.operationalUnitId != null) ||
    (contractRole === "ADMIN_ULP" && !uuid(request.operationalUnitId))) {
    return { status: 400, body: { error: "invalid_role_scope" } };
  }

  const adminClient = createClient(
    requiredEnv("SUPABASE_URL"),
    requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const [{ data: targetProfile }, { data: contract }, { data: contractScope }, { data: up3 }, { data: role }] = await Promise.all([
    adminClient.from("profiles").select("id").eq("id", targetUserId).eq("status", "ACTIVE").maybeSingle(),
    adminClient.from("contracts").select("id").eq("id", request.contractId).eq("status", "active").maybeSingle(),
    adminClient.from("contract_up3_scopes").select("id").eq("contract_id", request.contractId).eq("up3_id", request.operationalUp3Id).eq("status", "Aktif").maybeSingle(),
    adminClient.from("organization_units").select("id, type").eq("id", request.operationalUp3Id).eq("type", "UP3").eq("own_status", "Aktif").maybeSingle(),
    adminClient.from("authorization_roles").select("id").eq("role_namespace", "CONTRACT").eq("code", contractRole).maybeSingle(),
  ]);
  if (!targetProfile || !contract || !contractScope || !up3 || !role) {
    return { status: 400, body: { error: "invalid_contract_assignment" } };
  }
  if (contractRole === "ADMIN_ULP") {
    const { data: ulp } = await adminClient
      .from("organization_units")
      .select("id")
      .eq("id", request.operationalUnitId)
      .eq("type", "ULP")
      .eq("parent_id", request.operationalUp3Id)
      .eq("own_status", "Aktif")
      .maybeSingle();
    if (!ulp) return { status: 400, body: { error: "invalid_role_scope" } };
  }

  // Single-role: use atomic replace function that revokes previous active role
  const { data: newId, error: replaceError } = await adminClient.rpc("admin_replace_contract_access", {
    p_target_user_id: targetUserId,
    p_contract_id: request.contractId,
    p_contract_role: contractRole,
    p_up3_id: request.operationalUp3Id,
    p_unit_id: request.operationalUnitId ?? null,
    p_actor_id: actorUserId,
  });
  if (replaceError) {
    if (replaceError.message?.includes("single-role violation")) {
      return { status: 409, body: { error: "single_role_violation", message: "Pengguna sudah memiliki akses aktif lain." } };
    }
    return { status: 500, body: { error: "contract_assignment_failed", message: replaceError.message } };
  }
  return { status: 200, body: { membershipId: newId, idempotent: false } };
}
