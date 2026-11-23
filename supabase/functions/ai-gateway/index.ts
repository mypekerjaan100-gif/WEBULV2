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
type AiConfig = {
  provider: Provider;
  model: string;
  base_url: string;
  api_key: string | null;
  enabled: boolean;
};

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
  return `Penyedia AI menolak permintaan (HTTP ${response.status}): ${String(detail).slice(0, 500)}`;
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
  if (!response.ok) throw new Error(redact(await providerError(response), [config.api_key]));
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
  if (!response.ok) throw new Error(redact(await providerError(response), [config.api_key]));
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
  if (!response.ok) throw new Error(redact(await providerError(response), [config.api_key]));
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

async function handleTest(body: Record<string, unknown>) {
  const service = createClient(requiredEnv("SUPABASE_URL"), serviceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await service.rpc("ai_service_runtime_config");
  if (error) throw new Error("Pengaturan AI belum dapat dibaca.");
  const config = data as AiConfig | null;
  if (!config?.api_key) throw new Error("API key AI belum disimpan.");

  const provider = config.provider;
  if (!PROVIDERS[provider]) throw new Error("Penyedia AI tidak valid.");
  const baseUrl = normalizeBaseUrl(provider, config.base_url);
  const model = normalizeModel(config.model);
  const started = Date.now();
  const safe = { ...config, base_url: baseUrl, model, api_key: config.api_key };

  try {
    if (provider === "gemini") {
      await geminiRequest(safe, [{ text: "Balas hanya dengan kata OK." }], 8);
    } else if (provider === "deepseek") {
      await openAiRequest(safe, "Balas hanya dengan kata OK.", 8);
    } else {
      await grokRequest(safe, "Balas hanya dengan kata OK.", undefined, 8);
    }
  } catch (error) {
    const message = redact(error instanceof Error ? error.message : String(error), [config.api_key]);
    await service.rpc("ai_service_record_test", { p_ok: false, p_message: message });
    throw new Error(message);
  }

  await service.rpc("ai_service_record_test", {
    p_ok: true,
    p_message: `Koneksi berhasil melalui ${PROVIDERS[provider].label} (${model}).`,
  });
  return {
    ok: true,
    provider,
    provider_label: PROVIDERS[provider].label,
    model,
    message: `Koneksi ke ${PROVIDERS[provider].label} berhasil.`,
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
  if (!config?.enabled || !config.api_key) throw new Error("Validasi AI belum diaktifkan oleh Super Admin.");

  const provider = config.provider;
  if (!PROVIDERS[provider]) throw new Error("Penyedia AI tidak valid.");
  const baseUrl = normalizeBaseUrl(provider, config.base_url);
  const model = normalizeModel(config.model);
  const safe = { ...config, base_url: baseUrl, model, api_key: config.api_key };

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

  let result;
  if (provider === "gemini") {
    result = await geminiRequest(
      safe,
      [{ text: prompt }, { inline_data: { mime_type: mime, data: base64 } }],
      600,
    );
  } else if (provider === "deepseek") {
    result = await openAiRequest(
      safe,
      [
        { type: "text", text: prompt },
        { type: "image_url", image_url: { url: dataUrl } },
      ],
      220,
    );
  } else {
    result = await grokRequest(safe, prompt, dataUrl);
  }

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
