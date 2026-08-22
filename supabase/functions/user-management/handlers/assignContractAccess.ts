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

  let existingQuery = adminClient
    .from("contract_memberships")
    .select("id, status, effective_to")
    .eq("user_id", targetUserId)
    .eq("contract_id", request.contractId)
    .eq("contract_role", contractRole)
    .eq("operational_up3_id", request.operationalUp3Id)
    .is("effective_to", null);
  existingQuery = request.operationalUnitId == null
    ? existingQuery.is("operational_unit_id", null)
    : existingQuery.eq("operational_unit_id", request.operationalUnitId);
  const { data: existing } = await existingQuery.maybeSingle();
  if (existing?.status === "ACTIVE") {
    return { status: 200, body: { membershipId: existing.id, idempotent: true } };
  }
  if (existing) return { status: 409, body: { error: "existing_inactive_assignment" } };

  const effectiveFrom = new Date().toISOString().slice(0, 10);
  const assignment = {
    user_id: targetUserId,
    contract_id: request.contractId,
    contract_role: contractRole,
    operational_up3_id: request.operationalUp3Id,
    operational_unit_id: request.operationalUnitId ?? null,
    status: "ACTIVE",
    effective_from: effectiveFrom,
    created_by: actorUserId,
    updated_by: actorUserId,
  };
  const { data: membership, error: membershipError } = await adminClient
    .from("contract_memberships")
    .insert(assignment)
    .select("id")
    .single();
  if (membershipError || !membership) {
    return { status: 500, body: { error: "contract_assignment_failed" } };
  }

  const requestId = crypto.randomUUID();
  const safeScope = {
    contract_id: request.contractId,
    contract_role: contractRole,
    operational_up3_id: request.operationalUp3Id,
    operational_unit_id: request.operationalUnitId ?? null,
  };
  const { error: auditError } = await adminClient.from("authorization_audit_events").insert([
    { event_type: "ROLE_ASSIGNED", actor_user_id: actorUserId, target_user_id: targetUserId, target_role_id: role.id, request_id: requestId, after_state: safeScope, metadata: { assignment: safeScope } },
    { event_type: "MEMBERSHIP_ADDED", actor_user_id: actorUserId, target_user_id: targetUserId, request_id: requestId, after_state: safeScope, metadata: { assignment: safeScope, membership_id: membership.id } },
  ]);
  if (auditError) {
    console.error("Contract assignment audit failed", auditError.message);
    return { status: 500, body: { error: "contract_assignment_audit_failed" } };
  }
  return { status: 200, body: { membershipId: membership.id, idempotent: false } };
}
