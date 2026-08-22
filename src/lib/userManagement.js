import { supabase } from './supabaseClient.js'

const FUNCTION_NAME = 'user-management'

/**
 * Call the user-management Edge Function.
 * @param {string} action - The action to perform (e.g., 'list_users')
 * @param {object} [payload={}] - Additional payload
 * @returns {Promise<{data: object|null, error: string|null}>}
 */
export async function callUserManagement(action, payload = {}) {
  const { data, error } = await supabase.functions.invoke(FUNCTION_NAME, {
    body: { action, ...payload },
  })

  if (error) {
    return { data: null, error: error.message || 'Edge Function error' }
  }
  if (data?.error) {
    return { data: null, error: data.message || data.error }
  }
  return { data, error: null }
}
