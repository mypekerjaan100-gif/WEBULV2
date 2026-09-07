import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

const GENERIC_LOGIN_ERROR = "Username atau password tidak valid.";
const GENERIC_RECOVERY_MESSAGE = "Jika akun memiliki email pemulihan terverifikasi, tautan reset akan dikirim.";
const USERNAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/;
const MIN_RESPONSE_MS = 450;

function requiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing server environment variable: ${name}`);
  return value;
}

function allowedOrigins(): Set<string> {
  const configured = Deno.env.get("ALLOWED_ORIGINS") ??
    "https://laporanharian-iota.vercel.app,https://laporanharian.vercel.app,http://localhost:5173,http://127.0.0.1:5173";
  return new Set(configured.split(",").map((value) => value.trim()).filter(Boolean));
}

function corsHeaders(request: Request): HeadersInit {
  const origin = request.headers.get("Origin") ?? "";
  return {
    "Access-Control-Allow-Origin": allowedOrigins().has(origin) ? origin : "https://laporanharian.vercel.app",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function jsonResponse(request: Request, status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(request), "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

const normalizeUsername = (value: unknown) => typeof value === "string" ? value.trim().toLowerCase() : "";
const waitForMinimumDuration = async (startedAt: number) => {
  const remaining = MIN_RESPONSE_MS - (Date.now() - startedAt);
  if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
};

async function rateKey(namespace: string, request: Request, username: string): Promise<string> {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = request.headers.get("cf-connecting-ip") ?? forwarded ?? "unknown";
  const bytes = new TextEncoder().encode(`${namespace}:${ip}:${username.slice(0, 64)}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function consumeRateLimit(serviceClient: ReturnType<typeof createClient>, request: Request, username: string, action: string) {
  const consume = async (scope: string, maximum: number) => {
    const keyUsername = scope === "address" ? "*" : username;
    const key = await rateKey(`${action}:${scope}`, request, keyUsername);
    const { data, error } = await serviceClient.rpc("consume_username_auth_rate_limit", {
      p_rate_key: key,
      p_max_attempts: maximum,
      p_window_seconds: 900,
      p_block_seconds: 900,
    });
    return !error && data === true;
  };
  const addressAllowed = await consume("address", action === "login" ? 40 : 20);
  if (!addressAllowed) return false;
  return consume("identity", action === "login" ? 8 : 5);
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(request) });
  if (request.method !== "POST") return jsonResponse(request, 405, { error: "method_not_allowed" });
  const startedAt = Date.now();

  try {
    if (Number(request.headers.get("Content-Length") ?? 0) > 4096) {
      return jsonResponse(request, 413, { error: "request_too_large" });
    }
    const body = await request.json() as Record<string, unknown>;
    const action = body.action;
    const username = normalizeUsername(body.username);
    const usernameValid = USERNAME_PATTERN.test(username);
    const supabaseUrl = requiredEnv("SUPABASE_URL");
    const anonKey = requiredEnv("SUPABASE_ANON_KEY");
    const serviceClient = createClient(supabaseUrl, requiredEnv("SUPABASE_SERVICE_ROLE_KEY"), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const authClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    if (action !== "login" && action !== "request_password_reset") {
      await waitForMinimumDuration(startedAt);
      return jsonResponse(request, 400, { error: "invalid_request" });
    }
    const withinRateLimit = await consumeRateLimit(serviceClient, request, username, action);
    if (!withinRateLimit) {
      await waitForMinimumDuration(startedAt);
      return action === "login"
        ? jsonResponse(request, 429, { error: "invalid_credentials", message: GENERIC_LOGIN_ERROR })
        : jsonResponse(request, 200, { message: GENERIC_RECOVERY_MESSAGE });
    }

    const { data: identity } = usernameValid
      ? await serviceClient.from("auth_usernames").select("user_id").eq("username_normalized", username).maybeSingle()
      : { data: null };
    const userId = identity?.user_id as string | undefined;
    const [{ data: userResult }, { data: profile }] = userId
      ? await Promise.all([
        serviceClient.auth.admin.getUserById(userId),
        serviceClient.from("profiles").select("status").eq("id", userId).maybeSingle(),
      ])
      : [{ data: { user: null } }, { data: null }];
    const authUser = userResult?.user;

    if (action === "login") {
      const password = typeof body.password === "string" ? body.password : "";
      const email = authUser?.email && profile?.status === "ACTIVE" ? authUser.email : "missing-username@login.invalid";
      const { data, error } = await authClient.auth.signInWithPassword({ email, password });
      await waitForMinimumDuration(startedAt);
      if (error || !data.session || profile?.status !== "ACTIVE") {
        return jsonResponse(request, 401, { error: "invalid_credentials", message: GENERIC_LOGIN_ERROR });
      }
      return jsonResponse(request, 200, {
        accessToken: data.session.access_token,
        refreshToken: data.session.refresh_token,
      });
    }

    if (action === "request_password_reset") {
      const email = authUser?.email ?? "";
      const hasVerifiedRecoveryEmail = profile?.status === "ACTIVE" &&
        Boolean(authUser?.email_confirmed_at) &&
        Boolean(email) &&
        !email.endsWith(".invalid");
      if (hasVerifiedRecoveryEmail) {
        const origin = request.headers.get("Origin") ?? "";
        const developmentOrigin = origin === "http://localhost:5173" || origin === "http://127.0.0.1:5173";
        const redirectTo = developmentOrigin ? origin : (Deno.env.get("APP_URL") ?? "https://laporanharian-iota.vercel.app");
        await authClient.auth.resetPasswordForEmail(email, { redirectTo });
      }
      await waitForMinimumDuration(startedAt);
      return jsonResponse(request, 200, { message: GENERIC_RECOVERY_MESSAGE });
    }

  } catch {
    await waitForMinimumDuration(startedAt);
    return jsonResponse(request, 400, { error: "invalid_request" });
  }
});
