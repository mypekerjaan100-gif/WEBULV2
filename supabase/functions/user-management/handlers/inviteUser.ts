import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";

interface InviteUserPayload {
  email?: string;
  displayName?: string;
}

function requiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing server environment variable: ${name}`);
  return value;
}

export async function handleInviteUser(
  _callerClient: SupabaseClient,
  payload: unknown,
  actorUserId: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const request = payload as InviteUserPayload | undefined;
  const email = (request?.email ?? "").trim().toLowerCase();
  const displayName = (request?.displayName ?? "").trim();

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { status: 400, body: { error: "invalid_email", message: "Email tidak valid" } };
  }
  if (!displayName) {
    return { status: 400, body: { error: "display_name_required", message: "Nama wajib diisi" } };
  }

  const adminClient = createClient(
    requiredEnv("SUPABASE_URL"),
    requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data: users, error: usersError } = await adminClient.auth.admin.listUsers({
    perPage: 1000,
    page: 1,
  });
  if (usersError) {
    return { status: 500, body: { error: "identity_lookup_failed", message: "Gagal memeriksa pengguna" } };
  }

  const existingUser = users.users.find((user) => user.email?.toLowerCase() === email);
  if (existingUser) {
    const { data: profile } = await adminClient
      .from("profiles")
      .select("status")
      .eq("id", existingUser.id)
      .maybeSingle();
    return {
      status: 409,
      body: {
        error: profile?.status === "INVITED" ? "EXISTING_INVITED" : "EXISTING_ACTIVE",
        message: "Pengguna dengan email ini sudah terdaftar.",
        userId: existingUser.id,
      },
    };
  }

  const { data: invitation, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(email, {
    data: { display_name: displayName },
  });
  if (inviteError || !invitation.user?.id) {
    return {
      status: 500,
      body: {
        error: "invite_failed",
        message: `Gagal mengirim undangan: ${inviteError?.message ?? "identity tidak dibuat"}`,
      },
    };
  }

  const targetUserId = invitation.user.id;
  const { error: profileError } = await adminClient.from("profiles").upsert(
    { id: targetUserId, display_name: displayName, status: "INVITED" },
    { onConflict: "id" },
  );
  const { error: trackingError } = await adminClient.from("user_invitations").insert({
    email,
    display_name: displayName,
    target_user_id: targetUserId,
    status: "PENDING",
    requested_access: {},
    invited_by: actorUserId,
  });
  const { error: auditError } = await adminClient.from("authorization_audit_events").insert({
    event_type: "USER_INVITED",
    actor_user_id: actorUserId,
    target_user_id: targetUserId,
    reason: "New user invitation",
    request_id: crypto.randomUUID(),
    after_state: { status: "INVITED" },
    metadata: { email, display_name: displayName, invitation_status: "PENDING" },
  });

  if (profileError || trackingError || auditError) {
    console.error("Invitation persistence failed");
    return {
      status: 500,
      body: {
        error: "invitation_persistence_failed",
        message: "Undangan telah dibuat, tetapi pencatatan akses belum lengkap.",
        userId: targetUserId,
      },
    };
  }

  return {
    status: 200,
    body: {
      status: "INVITED",
      message: "Undangan telah dikirim",
      userId: targetUserId,
      email,
      displayName,
    },
  };
}
