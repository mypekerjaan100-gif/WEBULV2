import { createClient } from "jsr:@supabase/supabase-js@2";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const MANAGEMENT_ROLES = new Set([
  "TEAM_LEADER",
  "MANAGER_UNIT",
  "MANAGER_UP",
  "ASMAN_OPERASI",
  "ASMAN_KEUANGAN",
]);

const ROLE_TO_LEVEL: Record<string, "UL" | "UP"> = {
  TEAM_LEADER: "UL",
  MANAGER_UNIT: "UL",
  MANAGER_UP: "UP",
  ASMAN_OPERASI: "UP",
  ASMAN_KEUANGAN: "UP",
};

function requiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing server environment variable: ${name}`);
  return value;
}

function uuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

export async function handleAssignOrganizationMembership(
  targetUserId: string | undefined,
  targetRoleCode: string | undefined,
  payload: unknown,
  actorUserId: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const request = payload as { internalOrgUnitId?: unknown; organizationRole?: unknown } | undefined;
  const organizationRole = request?.organizationRole as string | undefined;
  const internalOrgUnitId = request?.internalOrgUnitId as string | undefined;

  if (
    !uuid(targetUserId) ||
    !uuid(internalOrgUnitId) ||
    typeof organizationRole !== "string" ||
    !MANAGEMENT_ROLES.has(organizationRole) ||
    targetRoleCode !== organizationRole
  ) {
    return { status: 400, body: { error: "invalid_organization_assignment" } };
  }

  const expectedType = ROLE_TO_LEVEL[organizationRole];
  if (!expectedType) {
    return { status: 400, body: { error: "invalid_organization_assignment" } };
  }

  const adminClient = createClient(
    requiredEnv("SUPABASE_URL"),
    requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const [{ data: targetProfile }, { data: internalUnit }, { data: role }] = await Promise.all([
    adminClient.from("profiles").select("id").eq("id", targetUserId).eq("status", "ACTIVE").maybeSingle(),
    adminClient.from("internal_organization_units").select("id, type, status").eq("id", internalOrgUnitId).maybeSingle(),
    adminClient.from("authorization_roles").select("id").eq("role_namespace", "ORGANIZATION").eq("code", organizationRole).maybeSingle(),
  ]);

  if (!targetProfile || !internalUnit || !role) {
    return { status: 400, body: { error: "invalid_organization_assignment" } };
  }

  if (internalUnit.status !== "ACTIVE" || internalUnit.type !== expectedType) {
    return { status: 400, body: { error: "invalid_role_scope" } };
  }

  const { data: newId, error: replaceError } = await adminClient.rpc("admin_replace_organization_access", {
    p_target_user_id: targetUserId,
    p_internal_unit_id: internalOrgUnitId,
    p_org_role: organizationRole,
    p_actor_id: actorUserId,
  });
  if (replaceError) {
    return { status: 500, body: { error: "organization_assignment_failed", message: replaceError.message } };
  }
  return { status: 200, body: { membershipId: newId, idempotent: false } };
}
