import { createClient } from "jsr:@supabase/supabase-js@2";

function requiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing server environment variable: ${name}`);
  return value;
}

export async function handleAccessOptions(): Promise<{ status: number; body: Record<string, unknown> }> {
  const adminClient = createClient(
    requiredEnv("SUPABASE_URL"),
    requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const [{ data: contracts, error: contractsError }, { data: scopes, error: scopesError }, { data: units, error: unitsError }, { data: names, error: namesError }, { data: internalUnits, error: internalUnitsError }, { data: orgAccess, error: orgAccessError }] = await Promise.all([
    adminClient.from("contracts").select("id, title").eq("status", "active"),
    adminClient.from("contract_up3_scopes").select("contract_id, up3_id").eq("status", "Aktif"),
    adminClient.from("organization_units").select("id, type, parent_id").eq("own_status", "Aktif"),
    adminClient.from("organization_name_history").select("organization_unit_id, name, effective_from, effective_to"),
    adminClient.from("internal_organization_units").select("id, code, name, type, parent_id, status").eq("status", "ACTIVE").order("name"),
    adminClient.from("organization_contract_access").select("internal_org_unit_id, contract_id, operational_up3_id, status, effective_from, effective_to").eq("status", "ACTIVE").is("effective_to", null),
  ]);
  if (contractsError || scopesError || unitsError || namesError || internalUnitsError || orgAccessError) {
    return { status: 500, body: { error: "access_options_query_failed", message: "Gagal memuat opsi akses." } };
  }

  const today = new Date().toISOString().slice(0, 10);
  const namesByUnit = new Map<string, string>();
  for (const name of names || []) {
    if (name.effective_from <= today && (!name.effective_to || name.effective_to > today)) {
      namesByUnit.set(name.organization_unit_id as string, name.name as string);
    }
  }
  const activeUnits = new Map((units || []).map((unit) => [unit.id as string, unit]));
  const allowedScopes = (scopes || []).flatMap((scope) => {
    const up3 = activeUnits.get(scope.up3_id as string);
    if (!up3 || up3.type !== "UP3") return [];
    const ulps = (units || [])
      .filter((unit) => unit.type === "ULP" && unit.parent_id === scope.up3_id)
      .map((unit) => ({ id: unit.id, name: namesByUnit.get(unit.id as string) ?? "Unknown" }));
    return [{
      contractId: scope.contract_id,
      up3Id: scope.up3_id,
      up3Name: namesByUnit.get(scope.up3_id as string) ?? "Unknown",
      ulps,
    }];
  });

  // Build internal organization options for management role assignment.
  // Organizational mapping status is derived from organization_contract_access
  // to inform the UI without fabricating scope.
  const activeAccessSet = new Set(
    (orgAccess || [])
      .filter((a) => a.effective_from <= today && (!a.effective_to || a.effective_to > today))
      .map((a) => a.internal_org_unit_id as string),
  );
  const internalOrganizationUnits = (internalUnits || []).map((unit) => ({
    id: unit.id as string,
    code: unit.code as string,
    name: unit.name as string,
    type: unit.type as string,
    parentId: unit.parent_id as string | null,
    hasOperationalMapping: activeAccessSet.has(unit.id as string),
  }));

  return {
    status: 200,
    body: {
      contracts: (contracts || []).map((contract) => ({ id: contract.id, title: contract.title })),
      scopes: allowedScopes,
      internalOrganizationUnits,
    },
  };
}
