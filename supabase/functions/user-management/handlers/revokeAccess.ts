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

export async function handleRevokeAccess(
  targetUserId: string | undefined,
  actorUserId: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  if (!uuid(targetUserId)) return { status: 400, body: { error: "invalid_target" } };
  const adminClient = createClient(
    requiredEnv("SUPABASE_URL"),
    requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data: profile } = await adminClient.from("profiles").select("id, status").eq("id", targetUserId).maybeSingle();
  if (!profile) return { status: 404, body: { error: "user_not_found" } };
  const { error } = await adminClient.rpc("admin_revoke_user_access", {
    p_target_user_id: targetUserId,
    p_actor_id: actorUserId,
  });
  if (error) return { status: 500, body: { error: "revoke_failed", message: error.message } };
  return { status: 200, body: { status: "REVOKED" } };
}
