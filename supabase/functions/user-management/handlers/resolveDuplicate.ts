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
  const { data: keepContract } = await adminClient.from("contract_memberships").select("id").eq("id", keepId).eq("user_id", targetUserId).eq("status", "ACTIVE").maybeSingle();
  const { data: keepOrg } = await adminClient.from("organization_memberships").select("id").eq("id", keepId).eq("user_id", targetUserId).eq("status", "ACTIVE").maybeSingle();
  if (!keepContract && !keepOrg) return { status: 404, body: { error: "keep_not_found" } };
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  await adminClient.from("contract_memberships").update({ status: "INACTIVE", effective_to: tomorrow, updated_by: actorUserId }).eq("user_id", targetUserId).eq("status", "ACTIVE").neq("id", keepId);
  await adminClient.from("organization_memberships").update({ status: "INACTIVE", effective_to: tomorrow, updated_by: actorUserId }).eq("user_id", targetUserId).eq("status", "ACTIVE").neq("id", keepId);
  await adminClient.from("system_role_memberships").update({ status: "INACTIVE", effective_to: tomorrow, updated_by: actorUserId }).eq("user_id", targetUserId).eq("status", "ACTIVE");
  return { status: 200, body: { status: "RESOLVED", kept: keepId } };
}
