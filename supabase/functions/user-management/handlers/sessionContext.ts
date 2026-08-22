import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";

function requiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing server environment variable: ${name}`);
  return value;
}

export async function handleSessionContext(
  callerClient: SupabaseClient,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const { data: { user } } = await callerClient.auth.getUser();
  if (!user) return { status: 401, body: { error: "authentication_required" } };

  const adminClient = createClient(
    requiredEnv("SUPABASE_URL"),
    requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const [{ data: profile }, { data: roleRows }, { data: organizationMemberships }, { data: contractMemberships }] =
    await Promise.all([
      adminClient.from("profiles").select("status").eq("id", user.id).maybeSingle(),
      adminClient.from("system_role_memberships").select("authorization_roles!inner(code)").eq("user_id", user.id).eq("status", "ACTIVE"),
      adminClient.from("organization_memberships").select("id").eq("user_id", user.id).eq("status", "ACTIVE"),
      adminClient.from("contract_memberships").select("id").eq("user_id", user.id).eq("status", "ACTIVE"),
    ]);

  const roles = (roleRows || [])
    .map((row) => (row.authorization_roles as { code: string } | null)?.code)
    .filter((code): code is string => Boolean(code));
  const assigned = roles.length > 0 || (organizationMemberships || []).length > 0 || (contractMemberships || []).length > 0;
  const accountStatus = profile?.status || (user.confirmed_at ? "ACTIVE" : "INVITED");

  return {
    status: 200,
    body: {
      actor: {
        authenticated: true,
        account_status: accountStatus,
        is_super_admin: roles.includes("SUPER_ADMIN"),
        roles,
        organization_memberships: (organizationMemberships || []).length,
        contract_memberships: (contractMemberships || []).length,
        permissions: [],
        access_state: assigned ? "ASSIGNED" : "AWAITING_ASSIGNMENT",
      },
    },
  };
}
