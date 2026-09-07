import { createClient } from "jsr:@supabase/supabase-js@2";

interface CreateUserPayload {
  username?: unknown;
  password?: unknown;
  email?: unknown;
  displayName?: unknown;
  role?: unknown;
  internalOrgUnitId?: unknown;
  contractId?: unknown;
  operationalUp3Id?: unknown;
  operationalUnitId?: unknown;
}

const USERNAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{2,31}$/;
const ROLES = new Set(["SUPER_ADMIN", "ADMIN_UP3", "ADMIN_ULP", "TEAM_LEADER", "MANAGER_UNIT", "MANAGER_UP", "ASMAN_OPERASI", "ASMAN_KEUANGAN"]);

function requiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing server environment variable: ${name}`);
  return value;
}

export async function handleCreateUser(
  payload: unknown,
  actorUserId: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const request = payload as CreateUserPayload | undefined;
  const username = typeof request?.username === "string" ? request.username.trim() : "";
  const normalizedUsername = username.toLowerCase();
  const password = typeof request?.password === "string" ? request.password : "";
  const recoveryEmail = typeof request?.email === "string" ? request.email.trim().toLowerCase() : "";
  const displayName = typeof request?.displayName === "string" ? request.displayName.trim() : username;
  const role = typeof request?.role === "string" ? request.role : "";

  if (!USERNAME_PATTERN.test(username)) return { status: 400, body: { error: "invalid_username", message: "Username harus 3-32 karakter dan hanya menggunakan huruf, angka, titik, underscore, atau tanda minus." } };
  if (password.length < 8) return { status: 400, body: { error: "invalid_password", message: "Password minimal 8 karakter." } };
  if (recoveryEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recoveryEmail)) return { status: 400, body: { error: "invalid_email", message: "Email pemulihan tidak valid." } };
  if (!displayName) return { status: 400, body: { error: "display_name_required", message: "Nama wajib diisi." } };
  if (!ROLES.has(role)) return { status: 400, body: { error: "invalid_role", message: "Role tidak valid." } };

  const adminClient = createClient(requiredEnv("SUPABASE_URL"), requiredEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: existingUsername } = await adminClient.from("auth_usernames").select("user_id").eq("username_normalized", normalizedUsername).maybeSingle();
  if (existingUsername) return { status: 409, body: { error: "username_exists", message: "Username sudah digunakan." } };

  const authEmail = recoveryEmail || `login-${crypto.randomUUID()}@users.invalid`;
  const { data: created, error: createError } = await adminClient.auth.admin.createUser({
    email: authEmail,
    password,
    email_confirm: !recoveryEmail,
    user_metadata: { display_name: displayName, username },
  });
  if (createError || !created.user) {
    return { status: 400, body: { error: "account_creation_failed", message: recoveryEmail && createError?.message?.toLowerCase().includes("email") ? "Email pemulihan sudah digunakan atau tidak valid." : "Akun tidak dapat dibuat." } };
  }

  const userId = created.user.id;
  const cleanup = async () => { await adminClient.auth.admin.deleteUser(userId); };
  const { error: profileError } = await adminClient.from("profiles").upsert({ id: userId, display_name: displayName, status: "ACTIVE" }, { onConflict: "id" });
  const { error: usernameError } = await adminClient.from("auth_usernames").insert({ user_id: userId, username });
  if (profileError || usernameError) {
    await cleanup();
    return { status: usernameError?.code === "23505" ? 409 : 500, body: { error: usernameError?.code === "23505" ? "username_exists" : "account_persistence_failed", message: usernameError?.code === "23505" ? "Username sudah digunakan." : "Akun tidak dapat disimpan." } };
  }

  if (recoveryEmail) {
    const anonClient = createClient(requiredEnv("SUPABASE_URL"), requiredEnv("SUPABASE_ANON_KEY"), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error: verificationError } = await anonClient.auth.resend({
      type: "signup",
      email: recoveryEmail,
      options: { emailRedirectTo: Deno.env.get("APP_URL") ?? "https://laporanharian.vercel.app" },
    });
    if (verificationError) {
      await cleanup();
      return { status: 500, body: { error: "verification_email_failed", message: "Email verifikasi tidak dapat dikirim." } };
    }
  }

  const { error: accessError } = await adminClient.rpc("admin_set_user_access", {
    p_target_user_id: userId,
    p_role: role,
    p_internal_unit_id: request?.internalOrgUnitId ?? null,
    p_contract_id: request?.contractId ?? null,
    p_up3_id: request?.operationalUp3Id ?? null,
    p_unit_id: role === "ADMIN_ULP" ? request?.operationalUnitId ?? null : null,
    p_actor_id: actorUserId,
  });
  if (accessError) {
    await cleanup();
    return { status: 400, body: { error: "access_assignment_failed", message: "Role atau scope tidak valid." } };
  }

  return {
    status: 200,
    body: {
      status: "ACTIVE",
      userId,
      username,
      displayName,
      recoveryEmailStatus: recoveryEmail ? "PENDING_VERIFICATION" : "NOT_CONFIGURED",
    },
  };
}
