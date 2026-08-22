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

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function handleInviteUser(
  callerClient: SupabaseClient,
  payload: unknown,
  actorUserId: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const p = payload as InviteUserPayload | undefined;
  const email = normalizeEmail(p?.email ?? "");
  const displayName = (p?.displayName ?? "").trim();

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

  // Check if auth user already exists
  const { data: existingUsers } = await adminClient.auth.admin.listUsers({
    perPage: 1000,
    page: 1,
  });

  const existingUser = (existingUsers?.users || []).find(
    (u) => u.email?.toLowerCase() === email,
  );

  if (existingUser) {
    // Check profile status
    const { data: profile } = await callerClient
      .from("profiles")
      .select("id, status")
      .eq("id", existingUser.id)
      .maybeSingle();

    const profileStatus = (profile as { status: string } | null)?.status ?? "ACTIVE";

    // If ACTIVE, return exists
    if (profileStatus === "ACTIVE") {
      return {
        status: 409,
        body: {
          error: "EXISTS_ACTIVE",
          message: "Email sudah terdaftar dan aktif",
          userId: existingUser.id,
        },
      };
    }

    // If INVITED, try to resend invitation
    if (profileStatus === "INVITED" || !existingUser.confirmed_at) {
      const { error: resendError } = await adminClient.auth.admin.inviteUserByEmail(
        email,
        {
          data: { display_name: displayName },
          redirectTo: `${requiredEnv("SUPABASE_URL").replace("/rest/v1", "")}/auth/v1/verify`,
        },
      );

      if (resendError) {
        return {
          status: 500,
          body: {
            error: "invite_resend_failed",
            message: `Gagal mengirim ulang undangan: ${resendError.message}`,
          },
        };
      }

      // Update profile display_name if changed
      await callerClient
        .from("profiles")
        .update({ display_name: displayName })
        .eq("id", existingUser.id);

      // Audit: USER_INVITED (re-invite)
      await callerClient.rpc("append_authorization_audit", {
        p_event_type: "USER_INVITED",
        p_actor_user_id: actorUserId,
        p_target_user_id: existingUser.id,
        p_target_role_code: null,
        p_reason: "Re-invite existing invited user",
        p_request_id: crypto.randomUUID(),
        p_before_state: JSON.stringify({ status: profileStatus }),
        p_after_state: JSON.stringify({ status: "INVITED" }),
        p_metadata: JSON.stringify({ email, display_name: displayName, re_invite: true }),
      });

      return {
        status: 200,
        body: {
          status: "INVITED_RESENT",
          message: "Undangan telah dikirim ulang",
          userId: existingUser.id,
        },
      };
    }

    // Profile is DISABLED or other state
    return {
      status: 409,
      body: {
        error: "EXISTS_DISABLED",
        message: "Email sudah terdaftar dalam status nonaktif",
        userId: existingUser.id,
      },
    };
  }

  // Create new auth user via invitation
  const { data: inviteData, error: inviteError } =
    await adminClient.auth.admin.inviteUserByEmail(email, {
      data: { display_name: displayName },
      redirectTo: `${requiredEnv("SUPABASE_URL").replace("/rest/v1", "")}/auth/v1/verify`,
    });

  if (inviteError) {
    return {
      status: 500,
      body: {
        error: "invite_failed",
        message: `Gagal mengirim undangan: ${inviteError.message}`,
      },
    };
  }

  const newUserId = inviteData?.id;

  if (!newUserId) {
    return {
      status: 500,
      body: { error: "invite_failed", message: "Undangan dibuat tanpa ID user" },
    };
  }

  // Ensure profile exists with INVITED status
  const { error: profileError } = await callerClient.from("profiles").upsert(
    {
      id: newUserId,
      display_name: displayName,
      status: "INVITED",
    },
    { onConflict: "id" },
  );

  if (profileError) {
    console.error("Profile creation failed after invite:", profileError);
    // Auth user was created but profile failed — still report success with warning
  }

  // Audit: USER_INVITED
  await callerClient.rpc("append_authorization_audit", {
    p_event_type: "USER_INVITED",
    p_actor_user_id: actorUserId,
    p_target_user_id: newUserId,
    p_target_role_code: null,
    p_reason: "New user invitation",
    p_request_id: crypto.randomUUID(),
    p_before_state: null,
    p_after_state: JSON.stringify({ status: "INVITED" }),
    p_metadata: JSON.stringify({ email, display_name: displayName }),
  });

  return {
    status: 200,
    body: {
      status: "INVITED",
      message: "Undangan telah dikirim",
      userId: newUserId,
      email,
      displayName,
    },
  };
}
