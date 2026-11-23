export const AI_PROVIDERS = [
  {
    value: 'gemini',
    label: 'Google Gemini',
    shortLabel: 'Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com',
    defaultModel: 'gemini-3.6-flash',
    models: ['gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-3.8-flash', 'gemini-4-hydrogen', 'gemini-2.5-flash'],
    visionNote: 'Model Flash Gemini dapat membaca gambar dan teks. Kuota gratis mengikuti akun Google AI Studio.',
  },
  {
    value: 'deepseek',
    label: 'DeepSeek',
    shortLabel: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    defaultModel: 'deepseek-flash',
    models: ['deepseek-flash', 'deepseek-v4-pro'],
    visionNote: 'Dukungan gambar bergantung pada model DeepSeek yang dipilih. Gunakan model yang mendukung input gambar.',
  },
  {
    value: 'grok',
    label: 'Grok',
    shortLabel: 'Grok',
    baseUrl: 'https://api.x.ai',
    defaultModel: 'grok-4.7',
    models: ['grok-4.7', 'grok-4.6', 'grok-4.5', 'grok-4.3'],
    visionNote: 'Model Grok 4.x mendukung input gambar melalui API xAI.',
  },
]

export const AI_PROVIDER_MAP = Object.fromEntries(AI_PROVIDERS.map((provider) => [provider.value, provider]))

export const aiProvider = (value) => AI_PROVIDER_MAP[value] ?? AI_PROVIDERS[0]

export function aiModelOptions(providerValue, currentModel = '') {
  const provider = aiProvider(providerValue)
  const models = [...provider.models]
  if (currentModel && !models.includes(currentModel)) models.unshift(currentModel)
  return models.map((model) => ({ value: model, label: model }))
}

export function aiProviderDefaults(providerValue) {
  const provider = aiProvider(providerValue)
  return { baseUrl: provider.baseUrl, model: provider.defaultModel }
}

export function validateAiSettings({ provider, model, baseUrl, apiKey = '', hasKey = false, enabled = false }) {
  if (!AI_PROVIDER_MAP[provider]) return 'Pilih penyedia AI.'
  const definition = aiProvider(provider)
  const cleanModel = String(model ?? '').trim()
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(cleanModel)) return 'Nama model AI tidak valid.'
  const cleanUrl = String(baseUrl ?? '').trim().replace(/\/+$/, '')
  if (!/^https:\/\/[a-z0-9.-]+$/i.test(cleanUrl)) return 'Endpoint harus berupa alamat https tanpa path.'
  if (cleanUrl !== definition.baseUrl) return `Endpoint ${definition.shortLabel} harus ${definition.baseUrl}.`
  const cleanKey = String(apiKey ?? '').trim()
  if (cleanKey && (cleanKey.length < 8 || cleanKey.length > 500)) return 'API key harus terdiri dari 8 sampai 500 karakter.'
  if (enabled && !hasKey && !cleanKey) return 'Isi API key terlebih dahulu sebelum mengaktifkan AI.'
  return null
}

export function aiConnectionLabel(settings) {
  const hasKey = settings?.has_key ?? settings?.hasKey
  if (!hasKey) return 'Belum ada API key'
  if (!settings?.enabled) return 'API key tersimpan, AI nonaktif'
  return `Aktif · ${aiProvider(settings.provider).label}`
}
