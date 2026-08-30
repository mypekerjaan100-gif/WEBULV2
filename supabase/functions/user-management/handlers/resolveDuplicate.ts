import { createClient } from "jsr:@supabase/supabase-js@2";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function requiredEnv(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`Missing server environment variable: ${name}`);
  return v;
}
function uuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

export async function handleResolveDuplicate(
  targetUserId: string | undefined,
  payload: unknown,
  actorUserId: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const keepId = (payload as Record<string, unknown> | undefined)?.keepMembershipId as string | undefined;
  if (!uuid(targetUserId) || !uuid(keepId)) return { status: 400, body: { error: "invalid_payload" } };
  const adminClient = createClient(
    requiredEnv("SUPABASE_URL"),
    requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const today = new Date().toISOString().slice(0, 10);
  const isActiveByDate = (row: Record<string, unknown>) => {
    const status = row.status as string;
    const from = row.effective_from as string | null;
    const to = row.effective_to as string | null;
    return status === "ACTIVE" && (!from || from <= today) && (!to || to > today);
  };
  const { data: keepContractRaw } = await adminClient.from("contract_memberships").select("id, status, effective_from, effective_to").eq("id", keepId).eq("user_id", targetUserId).maybeSingle();
  const { data: keepOrgRaw } = await adminClient.from("organization_memberships").select("id, status, effective_from, effective_to").eq("id", keepId).eq("user_id", targetUserId).maybeSingle();
  const { data: keepSystemRaw } = await adminClient.from("system_role_memberships").select("id, status, effective_from, effective_to").eq("id", keepId).eq("user_id", targetUserId).maybeSingle();
  const keepContract = keepContractRaw && isActiveByDate(keepContractRaw) ? keepContractRaw : null;
  const keepOrg = keepOrgRaw && isActiveByDate(keepOrgRaw) ? keepOrgRaw : null;
  const keepSystem = keepSystemRaw && isActiveByDate(keepSystemRaw) ? keepSystemRaw : null;
  if (!keepContract && !keepOrg && !keepSystem) return { status: 404, body: { error: "keep_not_found" } };
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  // Only inactivate currently active memberships, respecting effective dates
  const { data: activeContracts } = await adminClient.from("contract_memberships").select("id, effective_from, effective_to, status").eq("user_id", targetUserId).eq("status", "ACTIVE");
  for (const row of activeContracts || []) if (row.id !== keepId && isActiveByDate(row as Record<string, unknown>)) await adminClient.from("contract_memberships").update({ status: "INACTIVE", effective_to: tomorrow, updated_by: actorUserId }).eq("id", row.id as string);
  const { data: activeOrgs } = await adminClient.from("organization_memberships").select("id, effective_from, effective_to, status").eq("user_id", targetUserId).eq("status", "ACTIVE");
  for (const row of activeOrgs || []) if (row.id !== keepId && isActiveByDate(row as Record<string, unknown>)) await adminClient.from("organization_memberships").update({ status: "INACTIVE", effective_to: tomorrow, updated_by: actorUserId }).eq("id", row.id as string);
  const { data: activeSystems } = await adminClient.from("system_role_memberships").select("id, effective_from, effective_to, status").eq("user_id", targetUserId).eq("status", "ACTIVE");
  for (const row of activeSystems || []) if (row.id !== keepId && isActiveByDate(row as Record<string, unknown>)) await adminClient.from("system_role_memberships").update({ status: "INACTIVE", effective_to: tomorrow, updated_by: actorUserId }).eq("id", row.id as string);
  return { status: 200, body: { status: "RESOLVED", kept: keepId } };
}
