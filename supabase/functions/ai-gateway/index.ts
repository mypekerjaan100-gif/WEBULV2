import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const PROVIDERS = {
  gemini: {
    label: "Google Gemini",
    baseUrl: "https://generativelanguage.googleapis.com",
    endpoint: (base: string, model: string) =>
      `${base}/v1beta/models/${encodeURIComponent(model)}:generateContent`,
  },
  deepseek: {
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    endpoint: (base: string, _model: string) => `${base}/chat/completions`,
  },
  grok: {
    label: "Grok",
    baseUrl: "https://api.x.ai",
    endpoint: (base: string, _model: string) => `${base}/v1/responses`,
  },
} as const;

type Provider = keyof typeof PROVIDERS;
type AiKeyConfig = {
  id: string | null;
  api_key: string;
  hint?: string;
  status?: string;
  cooldown_until?: string | null;
  position?: number;
};
type AiConfig = {
  provider: Provider;
  model: string;
  base_url: string;
  api_key: string | null;
  enabled: boolean;
  keys?: AiKeyConfig[];
};
type ServiceClient = ReturnType<typeof createClient>;

class ProviderRequestError extends Error {
  status: number;
  retryable: boolean;
  invalidKey: boolean;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ProviderRequestError";
    this.status = status;
    const lower = message.toLowerCase();
    this.invalidKey =
      status === 401 ||
      status === 403 ||
      /api[_ -]?key[^.]{0,40}(invalid|not valid|salah|tidak valid|expired|disabled)|invalid[^.]{0,20}api[_ -]?key|unauthorized|unauthenticated|api_key_invalid/.test(lower);
    this.retryable =
      this.invalidKey ||
      status === 408 ||
      status === 409 ||
      status === 429 ||
      status >= 500 ||
      /quota|rate.?limit|resource.?exhausted|too many requests|overloaded/.test(lower);
  }
}

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function requiredEnv(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing server environment variable: ${name}`);
  return value;
}

function serviceRoleKey() {
  const raw = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (raw) {
    const keys = JSON.parse(raw) as Record<string, string>;
    const key = keys.default ?? Object.values(keys)[0];
    if (key) return key;
  }
  return requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
}

function publishableKey() {
  const legacy = Deno.env.get("SUPABASE_ANON_KEY");
  if (legacy) return legacy;
  const raw = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS");
  if (raw) {
    const keys = JSON.parse(raw) as Record<string, string>;
    const key = keys.default ?? Object.values(keys)[0];
    if (key) return key;
  }
  throw new Error("Missing server environment variable: SUPABASE_ANON_KEY");
}

function normalizeBaseUrl(provider: Provider, value: unknown) {
  const url = String(value ?? "").trim().replace(/\/+$/, "");
  if (!/^https:\/\/[a-z0-9.-]+$/i.test(url)) {
    throw new Error("Endpoint AI harus berupa alamat https tanpa path.");
  }
  const expected = PROVIDERS[provider].baseUrl;
  if (url !== expected) throw new Error("Endpoint AI tidak diizinkan.");
  return url;
}

function normalizeModel(value: unknown) {
  const model = String(value ?? "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(model)) {
    throw new Error("Nama model AI tidak valid.");
  }
  return model;
}

function redact(message: string, secrets: Array<string | null | undefined>) {
  let result = String(message || "Permintaan AI gagal.").slice(0, 800);
  for (const secret of secrets) {
    if (secret && secret.length >= 8) result = result.split(secret).join("[disembunyikan]");
  }
  return result;
}

async function providerError(response: Response) {
  const text = await response.text().catch(() => "");
  let detail = text;
  try {
    const parsed = JSON.parse(text);
    detail =
      parsed?.error?.message ??
      parsed?.error?.status ??
      parsed?.message ??
      text;
  } catch {
    // Gunakan teks mentah.
  }
  return new ProviderRequestError(
    response.status,
    `Penyedia AI menolak permintaan (HTTP ${response.status}): ${String(detail).slice(0, 500)}`,
  );
}

function allKeys(config: AiConfig) {
  const keys = (config.keys ?? [])
    .filter((key) => key.api_key)
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  if (keys.length) return keys;
  return config.api_key
    ? [{ id: null, api_key: config.api_key, status: "active", position: 0 }]
    : [];
}

function usableKeys(config: AiConfig) {
  const now = Date.now();
  const ready = allKeys(config).filter((key) => {
    if (key.status === "invalid") return false;
    if (key.status === "cooldown" && key.cooldown_until && new Date(key.cooldown_until).getTime() > now) return false;
    return true;
  });
  return ready;
}

function noUsableKeyError(config: AiConfig) {
  const keys = config.keys ?? [];
  if (!keys.length) return new Error("API key AI belum disimpan.");
  if (keys.every((key) => key.status === "invalid")) {
    return new Error("Semua API key AI tidak valid. Perbarui API key di Pengaturan AI.");
  }
  if (keys.some((key) => key.status === "cooldown" && key.cooldown_until && new Date(key.cooldown_until).getTime() > Date.now())) {
    return new Error("Layanan pemeriksaan sedang sibuk (HTTP 429): semua API key mencapai batas. Coba lagi beberapa saat lagi.");
  }
  return new Error("Tidak ada API key AI yang aktif. Periksa Pengaturan AI.");
}

async function recordKeyResult(
  service: ServiceClient,
  key: AiKeyConfig,
  result: "ok" | "invalid" | "cooldown" | "error",
  message: string,
  cooldownSeconds = 60,
) {
  if (!key.id) return;
  try {
    await service.rpc("ai_service_key_result", {
      p_key_id: key.id,
      p_result: result,
      p_message: String(message ?? "").slice(0, 500),
      p_cooldown_seconds: cooldownSeconds,
    });
  } catch {
    // Pencatatan status key tidak boleh menggagalkan pemeriksaan.
  }
}

function classifyFailure(error: unknown) {
  if (error instanceof ProviderRequestError) {
    return {
      retryable: error.retryable,
      result: error.invalidKey ? "invalid" as const : error.retryable ? "cooldown" as const : "error" as const,
      cooldown: error.status === 429 ? 120 : 60,
      message: error.message,
    };
  }
  const name = (error as { name?: string })?.name ?? "";
  const message = error instanceof Error ? error.message : String(error);
  return {
    retryable: true,
    result: "cooldown" as const,
    cooldown: /abort|timeout|network|fetch/i.test(`${name} ${message}`) ? 60 : 30,
    message,
  };
}

async function withKeyFailover<T>(
  service: ServiceClient,
  config: AiConfig,
  run: (attempt: AiConfig) => Promise<T>,
) {
  const keys = usableKeys(config);
  if (!keys.length) throw noUsableKeyError(config);
  let lastError: unknown = null;
  const secrets = keys.map((key) => key.api_key);
  for (const key of keys.slice(0, 6)) {
    try {
      const result = await run({ ...config, api_key: key.api_key });
      await recordKeyResult(service, key, "ok", "");
      return result;
    } catch (error) {
      lastError = error;
      const failure = classifyFailure(error);
      await recordKeyResult(service, key, failure.result, redact(failure.message, secrets), failure.cooldown);
      if (!failure.retryable) break;
    }
  }
  const message = lastError instanceof Error ? lastError.message : String(lastError ?? "Permintaan AI gagal.");
  throw new Error(redact(message, secrets));
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = 45000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function geminiRequest(config: AiConfig, parts: Array<Record<string, unknown>>, maxTokens: number) {
  const response = await fetchWithTimeout(
    PROVIDERS.gemini.endpoint(config.base_url, config.model),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": config.api_key ?? "",
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: { temperature: 0, maxOutputTokens: maxTokens },
      }),
    },
  );
  if (!response.ok) throw await providerError(response);
  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts
    ?.map((part: { text?: string }) => part?.text ?? "")
    .join("") ?? "";
  return { text: String(text), raw: data };
}

async function openAiRequest(config: AiConfig, content: unknown, maxTokens: number) {
  const response = await fetchWithTimeout(
    PROVIDERS.deepseek.endpoint(config.base_url, config.model),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.api_key ?? ""}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: [{ role: "user", content }],
        temperature: 0,
        max_tokens: maxTokens,
        response_format: { type: "json_object" },
      }),
    },
  );
  if (!response.ok) throw await providerError(response);
  const data = await response.json();
  return { text: String(data?.choices?.[0]?.message?.content ?? ""), raw: data };
}

async function grokRequest(config: AiConfig, text: string, imageDataUrl?: string, maxTokens = 220) {
  const content: Array<Record<string, unknown>> = [];
  if (imageDataUrl) {
    content.push({ type: "input_image", image_url: imageDataUrl, detail: "high" });
  }
  content.push({ type: "input_text", text });
  const response = await fetchWithTimeout(
    PROVIDERS.grok.endpoint(config.base_url, config.model),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.api_key ?? ""}`,
      },
      body: JSON.stringify({
        model: config.model,
        input: [{ role: "user", content }],
        max_output_tokens: maxTokens,
      }),
    },
  );
  if (!response.ok) throw await providerError(response);
  const data = await response.json();
  let output = String(data?.output_text ?? "");
  if (!output && Array.isArray(data?.output)) {
    output = data.output
      .flatMap((item: { content?: Array<{ type?: string; text?: string }> }) => item?.content ?? [])
      .filter((item: { type?: string; text?: string }) => item?.type === "output_text" && item?.text)
      .map((item: { text?: string }) => item.text)
      .join("");
  }
  return { text: output, raw: data };
}

function parseJsonText(text: string) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) return null;
  const unfenced = trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(unfenced);
  } catch {
    const start = unfenced.indexOf("{");
    const end = unfenced.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(unfenced.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function parseReading(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (value == null) return null;
  const text = String(value).trim();
  if (!text) return null;
  if (/^\d{1,3}(?:\.\d{3})+(?:,\d+)?$/.test(text)) {
    return Number(text.replace(/\./g, "").replace(",", "."));
  }
  if (/^\d+(?:[.,]\d+)?$/.test(text)) return Number(text.replace(",", "."));
  const digits = text.replace(/[^\d]/g, "");
  return digits ? Number(digits) : null;
}

function formatNumber(value: number) {
  return value.toLocaleString("id-ID", { maximumFractionDigits: 1 });
}

function odometerPrompt() {
  return [
    "Anda memeriksa foto odometer kendaraan operasional.",
    "Baca angka odometer yang benar-benar terlihat pada foto.",
    "Jangan menebak. Jika angka tidak terbaca jelas, isi reading dengan null.",
    "Balas HANYA dengan JSON valid tanpa penjelasan tambahan:",
    '{"reading": number|null, "confidence": number, "note": "ringkasan singkat dalam bahasa Indonesia"}',
    "reading harus berupa angka tanpa pemisah ribuan. confidence antara 0 dan 1.",
  ].join("\n");
}

function toBase64(bytes: Uint8Array) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

async function handleTest(_body: Record<string, unknown>) {
  const service = createClient(requiredEnv("SUPABASE_URL"), serviceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await service.rpc("ai_service_runtime_config");
  if (error) throw new Error("Pengaturan AI belum dapat dibaca.");
  const config = data as AiConfig | null;
  if (!config) throw new Error("API key AI belum disimpan.");
  const keys = allKeys(config);
  if (!keys.length) throw new Error("API key AI belum disimpan.");

  const provider = config.provider;
  if (!PROVIDERS[provider]) throw new Error("Penyedia AI tidak valid.");
  const baseUrl = normalizeBaseUrl(provider, config.base_url);
  const model = normalizeModel(config.model);
  const started = Date.now();
  const results: Array<{ hint: string; ok: boolean }> = [];
  let firstSuccess: AiKeyConfig | null = null;
  let lastError: unknown = null;
  const secrets = keys.map((key) => key.api_key);

  // Uji setiap key yang tersimpan agar status utama dan cadangan terlihat.
  for (const key of keys.slice(0, 6)) {
    const attempt = { ...config, base_url: baseUrl, model, api_key: key.api_key };
    try {
      if (provider === "gemini") {
        await geminiRequest(attempt, [{ text: "Balas hanya dengan kata OK." }], 8);
      } else if (provider === "deepseek") {
        await openAiRequest(attempt, "Balas hanya dengan kata OK.", 8);
      } else {
        await grokRequest(attempt, "Balas hanya dengan kata OK.", undefined, 8);
      }
      await recordKeyResult(service, key, "ok", "");
      results.push({ hint: key.hint || "Key", ok: true });
      if (!firstSuccess) firstSuccess = key;
    } catch (error) {
      lastError = error;
      const failure = classifyFailure(error);
      await recordKeyResult(service, key, failure.result, redact(failure.message, secrets), failure.cooldown);
      results.push({ hint: key.hint || "Key", ok: false });
      if (!failure.retryable) break;
    }
  }

  if (!firstSuccess) {
    const message = redact(
      lastError instanceof Error ? lastError.message : String(lastError ?? "Koneksi AI gagal."),
      secrets,
    );
    await service.rpc("ai_service_record_test", { p_ok: false, p_message: message });
    throw new Error(message);
  }

  const okCount = results.filter((result) => result.ok).length;
  const summary = `Koneksi berhasil melalui ${PROVIDERS[provider].label} (${model}) — ${okCount} dari ${results.length} key siap.`;
  await service.rpc("ai_service_record_test", { p_ok: true, p_message: summary });
  return {
    ok: true,
    provider,
    provider_label: PROVIDERS[provider].label,
    model,
    message: `Koneksi ke ${PROVIDERS[provider].label} berhasil.`,
    tested: results.length,
    ok_count: okCount,
    keys: results,
    latency_ms: Date.now() - started,
  };
}

async function handleOdometer(body: Record<string, unknown>) {
  const vehicleId = String(body.vehicleId ?? "").trim();
  const date = String(body.date ?? "").trim();
  const path = String(body.path ?? "").trim();
  const expectedRaw = Number(body.expected);
  if (!/^[0-9a-f-]{36}$/i.test(vehicleId)) throw new Error("Kendaraan tidak valid.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Tanggal tidak valid.");
  if (!Number.isFinite(expectedRaw) || expectedRaw < 0 || expectedRaw >= 100000000) {
    throw new Error("Stand akhir tidak valid.");
  }
  const prefix = `${vehicleId}/${date}/odometer/`;
  if (!path.startsWith(prefix) || !/^[0-9a-f-]{36}\/\d{4}-\d{2}-\d{2}\/odometer\/[A-Za-z0-9._-]+$/i.test(path)) {
    throw new Error("Berkas foto odometer tidak valid.");
  }

  const service = createClient(requiredEnv("SUPABASE_URL"), serviceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await service.rpc("ai_service_runtime_config");
  if (error) throw new Error("Pengaturan AI belum dapat dibaca.");
  const config = data as AiConfig | null;
  if (!config?.enabled) throw new Error("Validasi AI belum diaktifkan oleh Super Admin.");
  if (!allKeys(config).length) throw new Error("API key AI belum disimpan.");

  const provider = config.provider;
  if (!PROVIDERS[provider]) throw new Error("Penyedia AI tidak valid.");
  const baseUrl = normalizeBaseUrl(provider, config.base_url);
  const model = normalizeModel(config.model);
  const safe = { ...config, base_url: baseUrl, model };

  const { data: file, error: downloadError } = await service.storage
    .from("bbm-evidence")
    .download(path);
  if (downloadError || !file) throw new Error("Foto odometer tidak dapat dibaca.");
  if (file.size > 8000000) throw new Error("Ukuran foto odometer terlalu besar untuk AI.");
  const extension = path.split(".").pop()?.toLowerCase() ?? "";
  const rawMime = file.type || (extension === "png" ? "image/png" : extension === "webp" ? "image/webp" : "image/jpeg");
  const mime = rawMime === "image/jpg" ? "image/jpeg" : rawMime;
  if (!["image/jpeg", "image/png", "image/webp"].includes(mime)) {
    throw new Error("Format foto odometer tidak didukung AI.");
  }
  const base64 = toBase64(new Uint8Array(await file.arrayBuffer()));
  const dataUrl = `data:${mime};base64,${base64}`;
  const prompt = odometerPrompt();

  const result = await withKeyFailover(service, safe, (attempt) => {
    if (provider === "gemini") {
      return geminiRequest(
        attempt,
        [{ text: prompt }, { inline_data: { mime_type: mime, data: base64 } }],
        600,
      );
    }
    if (provider === "deepseek") {
      return openAiRequest(
        attempt,
        [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: dataUrl } },
        ],
        220,
      );
    }
    return grokRequest(attempt, prompt, dataUrl);
  });

  const parsed = parseJsonText(result.text);
  const reading = parseReading(parsed?.reading);
  const note = String(parsed?.note ?? "").slice(0, 300);
  const confidence = Number(parsed?.confidence);
  if (reading == null) {
    return {
      status: "unreadable",
      reading: null,
      expected: expectedRaw,
      confidence: Number.isFinite(confidence) ? confidence : null,
      message: note || "Angka odometer tidak terbaca jelas pada foto.",
    };
  }

  const difference = Math.abs(reading - expectedRaw);
  if (difference <= 0.05) {
    return {
      status: "match",
      reading,
      expected: expectedRaw,
      confidence: Number.isFinite(confidence) ? confidence : null,
      message: `AI membaca ${formatNumber(reading)} dan cocok dengan stand akhir.`,
    };
  }
  return {
    status: "mismatch",
    reading,
    expected: expectedRaw,
    confidence: Number.isFinite(confidence) ? confidence : null,
    message: `AI membaca ${formatNumber(reading)}, berbeda ${formatNumber(difference)} dari stand akhir ${formatNumber(expectedRaw)}.`,
  };
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return jsonResponse(405, { error: "method_not_allowed" });

  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return jsonResponse(401, { error: "authentication_required" });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(400, { error: "invalid_json" });
  }

  const caller = createClient(
    requiredEnv("SUPABASE_URL"),
    publishableKey(),
    {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
  const { data: { user }, error: userError } = await caller.auth.getUser();
  if (userError || !user) return jsonResponse(401, { error: "authentication_required" });

  try {
    if (body.action === "test") {
      const { error } = await caller.rpc("ai_get_settings");
      if (error) return jsonResponse(403, { error: "Hanya Super Admin yang dapat menguji pengaturan AI." });
      const result = await handleTest(body);
      return jsonResponse(200, result);
    }

    if (body.action === "odometer") {
      const vehicleId = String(body.vehicleId ?? "").trim();
      const { data: allowed, error } = await caller.rpc("bbm_ai_can_validate", {
        p_vehicle_id: vehicleId,
      });
      if (error || !allowed) {
        return jsonResponse(403, { error: "Anda tidak memiliki akses ke kendaraan ini." });
      }
      const result = await handleOdometer(body);
      return jsonResponse(200, result);
    }

    return jsonResponse(400, { error: "Aksi AI tidak dikenal." });
  } catch (error) {
    return jsonResponse(502, {
      error: redact(error instanceof Error ? error.message : String(error), []),
    });
  }
});
