import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";

function requiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing server environment variable: ${name}`);
  return value;
}

export async function handleSessionContext(
  callerClient: SupabaseClient,
  callerUserId: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const { data: { user } } = await callerClient.auth.getUser();
  if (!user || user.id !== callerUserId) return { status: 401, body: { error: "authentication_required" } };

  const adminClient = createClient(
    requiredEnv("SUPABASE_URL"),
    requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const [{ data: profile }, { data: roleRows }, { data: organizationMemberships }, { data: contractMemberships }, { data: contracts }, { data: organizationNames }] =
    await Promise.all([
      adminClient.from("profiles").select("status").eq("id", user.id).maybeSingle(),
      adminClient.from("system_role_memberships").select("authorization_roles!inner(code)").eq("user_id", user.id).eq("status", "ACTIVE"),
      adminClient.from("organization_memberships").select("id").eq("user_id", user.id).eq("status", "ACTIVE"),
      adminClient.from("contract_memberships").select("contract_id, contract_role, operational_up3_id, operational_unit_id").eq("user_id", user.id).eq("status", "ACTIVE"),
      adminClient.from("contracts").select("id, title"),
      adminClient.from("organization_name_history").select("organization_unit_id, name, effective_from, effective_to"),
    ]);

  const roles = (roleRows || [])
    .map((row) => (row.authorization_roles as { code: string } | null)?.code)
    .filter((code): code is string => Boolean(code));
  const assigned = roles.length > 0 || (organizationMemberships || []).length > 0 || (contractMemberships || []).length > 0;
  const accountStatus = profile?.status || (user.confirmed_at ? "ACTIVE" : "INVITED");
  const today = new Date().toISOString().slice(0, 10);
  const contractNames = new Map((contracts || []).map((contract) => [contract.id as string, contract.title as string]));
  const organizationNamesById = new Map<string, string>();
  for (const name of organizationNames || []) {
    if (name.effective_from <= today && (!name.effective_to || name.effective_to > today)) {
      organizationNamesById.set(name.organization_unit_id as string, name.name as string);
    }
  }
  const contractAccess = (contractMemberships || []).map((membership) => ({
    contract_id: membership.contract_id,
    contract_name: contractNames.get(membership.contract_id as string) ?? "Unknown",
    role: membership.contract_role,
    up3: organizationNamesById.get(membership.operational_up3_id as string) ?? "Unknown",
    ulp: membership.operational_unit_id
      ? organizationNamesById.get(membership.operational_unit_id as string) ?? "Unknown"
      : null,
  }));

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
        contract_access: contractAccess,
        permissions: [],
        access_state: assigned ? "ASSIGNED" : "AWAITING_ASSIGNMENT",
      },
    },
  };
}
