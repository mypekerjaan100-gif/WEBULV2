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
  const [{ data: profile }, { data: roleRowsRaw }, { data: organizationMembershipsRaw }, { data: contractMembershipsRaw }, { data: contracts }, { data: organizationNames }, { data: internalUnits }] =
    await Promise.all([
      adminClient.from("profiles").select("status").eq("id", user.id).maybeSingle(),
      adminClient.from("system_role_memberships").select("authorization_roles!inner(code), status, effective_from, effective_to").eq("user_id", user.id).eq("status", "ACTIVE"),
      adminClient.from("organization_memberships").select("id, internal_org_unit_id, organization_role, status, effective_from, effective_to").eq("user_id", user.id).eq("status", "ACTIVE"),
      adminClient.from("contract_memberships").select("id, contract_id, contract_role, operational_up3_id, operational_unit_id, status, effective_from, effective_to").eq("user_id", user.id).eq("status", "ACTIVE"),
      adminClient.from("contracts").select("id, code, title"),
      adminClient.from("organization_name_history").select("organization_unit_id, name, effective_from, effective_to"),
      adminClient.from("internal_organization_units").select("id, code, name, type, parent_id"),
    ]);

  const today = new Date().toISOString().slice(0, 10);
  const isActiveRow = (row: Record<string, unknown>) => {
    const status = row.status as string;
    const from = row.effective_from as string | null;
    const to = row.effective_to as string | null;
    return status === "ACTIVE" && (!from || from <= today) && (!to || to > today);
  };
  const roleRows = (roleRowsRaw || []).filter(isActiveRow);
  const organizationMemberships = (organizationMembershipsRaw || []).filter(isActiveRow);
  const contractMemberships = (contractMembershipsRaw || []).filter(isActiveRow);

  const roles = (roleRows || [])
    .map((row) => (row.authorization_roles as { code: string } | null)?.code)
    .filter((code): code is string => Boolean(code));

  const customCodes = [...new Set(
    contractMemberships
      .map((membership) => membership.contract_role as string)
      .filter((code) => code?.startsWith("CUSTOM_")),
  )];
  const customRoles = new Map<string, { display_name: string; role_level: string; menu_access: unknown; is_active: boolean; permissions: string[] }>();
  if (customCodes.length > 0) {
    const { data: roleDefs } = await adminClient
      .from("authorization_roles")
      .select("id, code, display_name, role_level, menu_access, is_active")
      .in("code", customCodes)
      .eq("role_namespace", "CONTRACT");
    const roleIds = (roleDefs || []).map((role) => role.id as string);
    const { data: permissionRows } = roleIds.length
      ? await adminClient
        .from("authorization_role_permissions")
        .select("role_id, authorization_permissions!inner(code)")
        .in("role_id", roleIds)
      : { data: [] };
    const permissionsByRole = new Map<string, string[]>();
    for (const row of permissionRows || []) {
      const roleId = row.role_id as string;
      const code = (row.authorization_permissions as { code: string } | null)?.code;
      if (!code) continue;
      if (!permissionsByRole.has(roleId)) permissionsByRole.set(roleId, []);
      permissionsByRole.get(roleId)!.push(code);
    }
    for (const role of roleDefs || []) {
      customRoles.set(role.code as string, {
        display_name: role.display_name as string,
        role_level: role.role_level as string,
        menu_access: role.menu_access ?? {},
        is_active: role.is_active !== false,
        permissions: permissionsByRole.get(role.id as string) || [],
      });
    }
  }

  const contractsById = new Map((contracts || []).map((contract) => [contract.id as string, contract]));
  const organizationNamesById = new Map<string, string>();
  for (const name of organizationNames || []) {
    if (name.effective_from <= today && (!name.effective_to || name.effective_to > today)) {
      organizationNamesById.set(name.organization_unit_id as string, name.name as string);
    }
  }
  const contractAccess = (contractMemberships || []).map((membership) => {
    const contract = contractsById.get(membership.contract_id as string) as { code: string; title: string } | undefined;
    const custom = customRoles.get(membership.contract_role as string);
    return {
      membership_id: membership.id,
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
      is_custom: Boolean(custom),
      role_display_name: custom?.display_name ?? membership.contract_role,
      role_level: custom?.role_level ?? null,
      menu_access: custom?.menu_access ?? null,
      permissions: custom?.permissions ?? [],
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

  const customAccess = contractAccess.find((access) => access.is_custom) ?? null;
  const permissions = [...new Set(contractAccess.flatMap((access) => access.permissions as string[]))];

  return {
    status: 200,
    body: {
      actor: {
        authenticated: true,
        account_status: profile?.status || (user.confirmed_at ? "ACTIVE" : "INVITED"),
        is_super_admin: roles.includes("SUPER_ADMIN"),
        roles,
        organization_memberships: (organizationMemberships || []).length,
        organization_access: organizationAccess,
        contract_memberships: (contractMemberships || []).length,
        contract_access: contractAccess,
        permissions,
        custom_menu_access: customAccess?.menu_access ?? null,
        custom_role: customAccess
          ? {
            code: customAccess.role,
            display_name: customAccess.role_display_name,
            level: customAccess.role_level,
          }
          : null,
        access_state: roles.length > 0 || organizationMemberships.length > 0 || contractMemberships.length > 0
          ? "ASSIGNED"
          : "AWAITING_ASSIGNMENT",
      },
    },
  };
}
