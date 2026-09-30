import { supabase } from './supabaseClient.js'

const FUNCTION_NAME = 'user-management'

/**
 * Call the user-management Edge Function.
 * @param {string} action - The action to perform (e.g., 'list_users')
 * @param {object} [payload={}] - Additional payload
 * @returns {Promise<{data: object|null, error: string|null}>}
 */
const FALLBACK_ERROR_MESSAGE = 'Terjadi gangguan. Silakan coba lagi.'

const ERROR_CODE_MESSAGES = {
  invalid_username: 'Username harus 3-32 karakter dan hanya menggunakan huruf, angka, titik, underscore, atau tanda minus.',
  invalid_password: 'Password minimal 8 karakter.',
  invalid_email: 'Email pemulihan tidak valid.',
  display_name_required: 'Nama wajib diisi.',
  invalid_role: 'Role tidak valid.',
  username_exists: 'Username sudah digunakan.',
  account_creation_failed: 'Akun tidak dapat dibuat.',
  account_persistence_failed: 'Akun tidak dapat disimpan.',
  access_assignment_failed: 'Role atau scope tidak valid.',
  invalid_request: 'Permintaan tidak valid.',
  authentication_required: 'Sesi berakhir. Silakan login ulang.',
  forbidden: 'Anda tidak memiliki akses untuk tindakan ini.',
}

/**
 * Ambil pesan asli dari response Edge Function saat status non-2xx.
 * Tanpa ini pengguna hanya melihat "Edge Function returned a non-2xx status code".
 */
async function extractFunctionErrorMessage(error) {
  try {
    const response = error?.context
    if (response && typeof response.json === 'function') {
      const body = await response.json()
      if (body?.message) return body.message
      if (typeof body?.error === 'string' && ERROR_CODE_MESSAGES[body.error]) {
        return ERROR_CODE_MESSAGES[body.error]
      }
      if (typeof body?.error === 'string' && body.error) return body.error
    }
  } catch {
    // Abaikan dan pakai pesan fallback di bawah.
  }
  if (error?.message && !/non-2xx/i.test(error.message)) return error.message
  return FALLBACK_ERROR_MESSAGE
}

export async function callUserManagement(action, payload = {}) {
  const { data, error } = await supabase.functions.invoke(FUNCTION_NAME, {
    body: { action, ...payload },
  })

  if (error) {
    return { data: null, error: await extractFunctionErrorMessage(error) }
  }
  if (data?.error) {
    if (data.message) return { data: null, error: data.message }
    if (typeof data.error === 'string' && ERROR_CODE_MESSAGES[data.error]) {
      return { data: null, error: ERROR_CODE_MESSAGES[data.error] }
    }
    return { data: null, error: FALLBACK_ERROR_MESSAGE }
  }
  return { data, error: null }
}
