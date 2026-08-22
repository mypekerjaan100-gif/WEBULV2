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
  const [{ data: contracts, error: contractsError }, { data: scopes, error: scopesError }, { data: units, error: unitsError }, { data: names, error: namesError }] = await Promise.all([
    adminClient.from("contracts").select("id, title").eq("status", "active"),
    adminClient.from("contract_up3_scopes").select("contract_id, up3_id").eq("status", "Aktif"),
    adminClient.from("organization_units").select("id, type, parent_id").eq("own_status", "Aktif"),
    adminClient.from("organization_name_history").select("organization_unit_id, name, effective_from, effective_to"),
  ]);
  if (contractsError || scopesError || unitsError || namesError) {
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

  return {
    status: 200,
    body: {
      contracts: (contracts || []).map((contract) => ({ id: contract.id, title: contract.title })),
      scopes: allowedScopes,
    },
  };
}
