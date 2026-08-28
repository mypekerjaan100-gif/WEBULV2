import { createClient } from "jsr:@supabase/supabase-js@2";

interface UserSummary {
  id: string;
  email: string;
  displayName: string;
  status: string;
  createdAt: string;
  lastSignInAt: string | null;
  isSuperAdmin: boolean;
  roles: string[];
  employeeCount: number;
  contracts: string[];
  organizationMemberships: {
    membershipId: string;
    unitId: string;
    unitName: string;
    role: string;
    status: string;
    assignedAt: string;
  }[];
  contractMemberships: {
    membershipId: string;
    contractId: string;
    contractName: string;
    role: string;
    up3Id: string;
    up3Name: string;
    ulpId: string | null;
    ulpName: string | null;
  }[];
}

function requiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing server environment variable: ${name}`);
  return value;
}

export async function handleListUsers(): Promise<{
  status: number;
  body: Record<string, unknown>;
}> {
  const adminClient = createClient(
    requiredEnv("SUPABASE_URL"),
    requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const { data: authUsers, error: authError } =
    await adminClient.auth.admin.listUsers({
      perPage: 1000,
      page: 1,
    });

  if (authError) {
    return {
      status: 500,
      body: { error: "auth_query_failed", message: authError.message },
    };
  }

  const userIds = (authUsers.users || []).map((u) => u.id);

  if (userIds.length === 0) {
    return {
      status: 200,
      body: { users: [], total: 0 },
    };
  }

  const [{ data: profiles }, { data: memberships, error: membershipsError }, { data: employees }, { data: orgMemberships }, { data: contractMemberships }, { data: contracts }, { data: organizationNames }, { data: internalUnits }] = await Promise.all([
    adminClient
      .from("profiles")
      .select("id, display_name, status")
      .in("id", userIds),
    adminClient
      .from("system_role_memberships")
      .select("user_id, status, authorization_roles!inner(code)")
      .in("user_id", userIds)
      .eq("status", "ACTIVE"),
    adminClient.from("employees").select("user_id, contract_id, id").in("user_id", userIds),
    adminClient
      .from("organization_memberships")
      .select("user_id, id, internal_org_unit_id, organization_role, status, effective_from")
      .in("user_id", userIds),
    adminClient
      .from("contract_memberships")
      .select("user_id, id, contract_id, contract_role, operational_up3_id, operational_unit_id, status")
      .in("user_id", userIds)
      .eq("status", "ACTIVE"),
    adminClient.from("contracts").select("id, title"),
    adminClient
      .from("organization_name_history")
      .select("organization_unit_id, name, effective_from, effective_to"),
    adminClient
      .from("internal_organization_units")
      .select("id, name"),
  ]);

  const profileMap = new Map(
    (profiles || []).map((p: Record<string, unknown>) => [
      p.id as string,
      p as { id: string; display_name: string; status: string },
    ]),
  );

  if (membershipsError) {
    console.error("System role membership query failed");
    return {
      status: 500,
      body: { error: "system_role_query_failed", message: "Unable to load system roles" },
    };
  }

  const roleMap = new Map<string, string[]>();
  for (const m of memberships || []) {
    const uid = m.user_id as string;
    const code = (m.authorization_roles as { code: string })?.code;
    if (!code) continue;
    if (!roleMap.has(uid)) roleMap.set(uid, []);
    roleMap.get(uid)!.push(code);
  }

  const employeeMap = new Map<
    string,
    { contractIds: Set<string>; employeeId: string }[]
  >();
  for (const e of employees || []) {
    const uid = e.user_id as string;
    if (!uid) continue;
    if (!employeeMap.has(uid)) employeeMap.set(uid, []);
    const existing = employeeMap.get(uid)!;
    const contractId = e.contract_id as string;
    const existingEntry = existing.find(
      (x) => x.employeeId === (e.id as string),
    );
    if (existingEntry && contractId) {
      existingEntry.contractIds.add(contractId);
    } else if (contractId) {
      existing.push({
        contractIds: new Set([contractId]),
        employeeId: e.id as string,
      });
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  const nameMap = new Map<string, string>();
  for (const name of organizationNames || []) {
    if (name.effective_from <= today && (!name.effective_to || name.effective_to > today)) {
      nameMap.set(name.organization_unit_id as string, name.name as string);
    }
  }
  const internalNameMap = new Map((internalUnits || []).map((u) => [u.id as string, u.name as string]));
  const contractNameMap = new Map((contracts || []).map((contract) => [contract.id as string, contract.title as string]));

  const orgMap = new Map<string, UserSummary["organizationMemberships"]>();
  for (const om of orgMemberships || []) {
    const uid = om.user_id as string;
    if (!orgMap.has(uid)) orgMap.set(uid, []);
    orgMap.get(uid)!.push({
      membershipId: om.id as string,
      unitId: om.internal_org_unit_id as string,
      unitName: internalNameMap.get(om.internal_org_unit_id as string) ?? nameMap.get(om.internal_org_unit_id as string) ?? "Unknown",
      role: om.organization_role as string,
      status: om.status as string,
      assignedAt: om.effective_from as string,
    });
  }

  const contractMap = new Map<string, UserSummary["contractMemberships"]>();
  for (const cm of contractMemberships || []) {
    const uid = cm.user_id as string;
    if (!contractMap.has(uid)) contractMap.set(uid, []);
    contractMap.get(uid)!.push({
      membershipId: cm.id as string,
      contractId: cm.contract_id as string,
      contractName: contractNameMap.get(cm.contract_id as string) ?? "Unknown",
      role: cm.contract_role as string,
      up3Id: cm.operational_up3_id as string,
      up3Name: nameMap.get(cm.operational_up3_id as string) ?? "Unknown",
      ulpId: cm.operational_unit_id as string | null,
      ulpName: cm.operational_unit_id
        ? nameMap.get(cm.operational_unit_id as string) ?? "Unknown"
        : null,
    });
  }

  const users: UserSummary[] = (authUsers.users || []).map((authUser) => {
    const profile = profileMap.get(authUser.id);
    const roles = roleMap.get(authUser.id) || [];
    const employeeEntries = employeeMap.get(authUser.id) || [];
    const orgMembers = orgMap.get(authUser.id) || [];
    const contractMembers = contractMap.get(authUser.id) || [];

    const contracts = [
      ...new Set(
        employeeEntries.flatMap((e) => [...e.contractIds]),
      ),
    ];

    return {
      id: authUser.id,
      email: authUser.email || "",
      displayName: profile?.display_name || authUser.email || "Unknown",
      status: profile?.status || "ACTIVE",
      createdAt: authUser.created_at,
      lastSignInAt: authUser.last_sign_in_at || null,
      isSuperAdmin: roles.includes("SUPER_ADMIN"),
      roles,
      employeeCount: employeeEntries.length,
      contracts,
      organizationMemberships: orgMembers,
      contractMemberships: contractMembers,
    };
  });

  return {
    status: 200,
    body: { users, total: users.length },
  };
}
