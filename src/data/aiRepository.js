import { supabase } from '../lib/supabaseClient.js'

async function rpc(name, args) {
  const { data, error } = await supabase.rpc(name, args).abortSignal(AbortSignal.timeout(30000))
  if (error) throw new Error(error.message)
  return data
}

async function invokeAi(body) {
  const { data, error } = await supabase.functions.invoke('ai-gateway', { body })
  if (error) {
    let message = error.message
    try {
      const payload = await error.context?.json?.()
      if (payload?.error) message = payload.error
    } catch {
      // Gunakan pesan bawaan bila respons bukan JSON.
    }
    throw new Error(message)
  }
  if (data?.error) throw new Error(data.error)
  return data
}

export const getAiSettings = () => rpc('ai_get_settings')
export const getAiPublicStatus = () => rpc('ai_public_status')
export const clearAiApiKey = () => rpc('ai_clear_api_key')
export const saveAiSettings = ({ provider, model, baseUrl, apiKey = '', enabled = true }) => rpc('ai_save_settings', {
  p_provider: provider,
  p_model: model,
  p_base_url: baseUrl,
  p_api_key: apiKey,
  p_enabled: enabled,
})
export const testAiConnection = () => invokeAi({ action: 'test' })
export const validateBbmOdometer = ({ vehicleId, date, path, expected }) => invokeAi({
  action: 'odometer',
  vehicleId,
  date,
  path,
  expected,
})
