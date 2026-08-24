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
  const [{ data: profile }, { data: roleRows }, { data: organizationMemberships }, { data: contractMemberships }, { data: contracts }, { data: organizationNames }, { data: internalUnits }] =
    await Promise.all([
      adminClient.from("profiles").select("status").eq("id", user.id).maybeSingle(),
      adminClient.from("system_role_memberships").select("authorization_roles!inner(code)").eq("user_id", user.id).eq("status", "ACTIVE"),
      adminClient.from("organization_memberships").select("id, internal_org_unit_id, organization_role, status").eq("user_id", user.id).eq("status", "ACTIVE"),
      adminClient.from("contract_memberships").select("contract_id, contract_role, operational_up3_id, operational_unit_id").eq("user_id", user.id).eq("status", "ACTIVE"),
      adminClient.from("contracts").select("id, code, title"),
      adminClient.from("organization_name_history").select("organization_unit_id, name, effective_from, effective_to"),
      adminClient.from("internal_organization_units").select("id, code, name, type, parent_id"),
    ]);

  const roles = (roleRows || [])
    .map((row) => (row.authorization_roles as { code: string } | null)?.code)
    .filter((code): code is string => Boolean(code));
  const assigned = roles.length > 0 || (organizationMemberships || []).length > 0 || (contractMemberships || []).length > 0;
  const accountStatus = profile?.status || (user.confirmed_at ? "ACTIVE" : "INVITED");
  const today = new Date().toISOString().slice(0, 10);
  const contractsById = new Map((contracts || []).map((contract) => [contract.id as string, contract]));
  const organizationNamesById = new Map<string, string>();
  for (const name of organizationNames || []) {
    if (name.effective_from <= today && (!name.effective_to || name.effective_to > today)) {
      organizationNamesById.set(name.organization_unit_id as string, name.name as string);
    }
  }
  const contractAccess = (contractMemberships || []).map((membership) => {
    const contract = contractsById.get(membership.contract_id as string) as
      | { code: string; title: string }
      | undefined;
    return {
      contract_id: membership.contract_id,
      contract_code: contract?.code ?? null,
      contract_title: contract?.title ?? "Unknown",
      operational_up3_id: membership.operational_up3_id,
      operational_up3_name: organizationNamesById.get(membership.operational_up3_id as string) ?? "Unknown",
      operational_unit_id: membership.operational_unit_id,
      operational_unit_name: membership.operational_unit_id
        ? organizationNamesById.get(membership.operational_unit_id as string) ?? "Unknown"
        : null,
      role: membership.contract_role,
    };
  });

  const internalUnitsById = new Map((internalUnits || []).map((u) => [u.id as string, u]));
  const organizationAccess = (organizationMemberships || []).map((m) => {
    const unit = internalUnitsById.get(m.internal_org_unit_id as string) as { code: string; name: string; type: string; parent_id: string | null } | undefined;
    return {
      internal_org_unit_id: m.internal_org_unit_id,
      internal_org_unit_code: unit?.code ?? null,
      internal_org_unit_name: unit?.name ?? "Unknown",
      internal_org_unit_type: unit?.type ?? null,
      parent_id: unit?.parent_id ?? null,
      organization_role: m.organization_role,
      status: m.status,
    };
  });

  return {
    status: 200,
    body: {
      actor: {
        authenticated: true,
        account_status: accountStatus,
        is_super_admin: roles.includes("SUPER_ADMIN"),
        roles,
        organization_memberships: (organizationMemberships || []).length,
        organization_access: organizationAccess,
        contract_memberships: (contractMemberships || []).length,
        contract_access: contractAccess,
        permissions: [],
        access_state: assigned ? "ASSIGNED" : "AWAITING_ASSIGNMENT",
      },
    },
  };
}
