import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";

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
    unitId: string;
    unitName: string;
    role: string;
    status: string;
    assignedAt: string;
  }[];
  contractMemberships: {
    contractId: string;
    contractName: string;
    role: string;
    up3Ids: string[];
    ulpIds: string[];
  }[];
}

function requiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing server environment variable: ${name}`);
  return value;
}

export async function handleListUsers(
  callerClient: SupabaseClient,
): Promise<{ status: number; body: Record<string, unknown> }> {
  // Create admin client for auth.users access
  const adminClient = createClient(
    requiredEnv("SUPABASE_URL"),
    requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  // 1. Fetch auth users (safe fields only) via admin
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

  // 2. Fetch profiles
  const { data: profiles } = await callerClient
    .from("profiles")
    .select("id, display_name, status")
    .in("id", userIds);

  const profileMap = new Map(
    (profiles || []).map((p: Record<string, unknown>) => [
      p.id as string,
      p as { id: string; display_name: string; status: string },
    ]),
  );

  // 3. Fetch system role memberships with role names
  const { data: memberships, error: membershipsError } = await adminClient
    .from("system_role_memberships")
    .select("user_id, status, authorization_roles!inner(code)")
    .in("user_id", userIds);

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

  // 4. Fetch employee data for contract summaries
  const { data: employees } = await callerClient
    .from("employees")
    .select("user_id, contract_id, id")
    .in("user_id", userIds);

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

  // 5. Fetch organization memberships
  const { data: orgMemberships } = await callerClient
    .from("organization_memberships")
    .select(
      "user_id, unit_id, organization_units!inner(name), role_code, status, assigned_at",
    )
    .in("user_id", userIds);

  const orgMap = new Map<string, UserSummary["organizationMemberships"]>();
  for (const om of orgMemberships || []) {
    const uid = om.user_id as string;
    if (!orgMap.has(uid)) orgMap.set(uid, []);
    orgMap.get(uid)!.push({
      unitId: om.unit_id as string,
      unitName:
        (om.organization_units as { name: string })?.name ?? "Unknown",
      role: om.role_code as string,
      status: om.status as string,
      assignedAt: om.assigned_at as string,
    });
  }

  // 6. Fetch contract memberships
  const { data: contractMemberships } = await callerClient
    .from("contract_memberships")
    .select(
      "user_id, contract_id, contracts!inner(name), role_code, operational_up3_ids, operational_ulp_ids",
    )
    .in("user_id", userIds);

  const contractMap = new Map<string, UserSummary["contractMemberships"]>();
  for (const cm of contractMemberships || []) {
    const uid = cm.user_id as string;
    if (!contractMap.has(uid)) contractMap.set(uid, []);
    contractMap.get(uid)!.push({
      contractId: cm.contract_id as string,
      contractName:
        (cm.contracts as { name: string })?.name ?? "Unknown",
      role: cm.role_code as string,
      up3Ids: (cm.operational_up3_ids as string[]) || [],
      ulpIds: (cm.operational_ulp_ids as string[]) || [],
    });
  }

  // 7. Assemble response
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
