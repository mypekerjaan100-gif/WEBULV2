import { supabase } from './supabaseClient.js'

const FUNCTION_NAME = 'username-auth'
const GENERIC_LOGIN_ERROR = 'Username atau password tidak valid.'
const GENERIC_RECOVERY_MESSAGE = 'Jika akun memiliki email pemulihan terverifikasi, tautan reset akan dikirim.'

export async function signInWithUsername(username, password) {
  const { data, error } = await supabase.functions.invoke(FUNCTION_NAME, {
    body: { action: 'login', username, password },
  })
  if (error || !data?.accessToken || !data?.refreshToken) {
    return { session: null, error: GENERIC_LOGIN_ERROR }
  }
  const { data: sessionData, error: sessionError } = await supabase.auth.setSession({
    access_token: data.accessToken,
    refresh_token: data.refreshToken,
  })
  if (sessionError || !sessionData.session) return { session: null, error: GENERIC_LOGIN_ERROR }
  return { session: sessionData.session, error: null }
}

export async function requestPasswordResetByUsername(username) {
  await supabase.functions.invoke(FUNCTION_NAME, {
    body: { action: 'request_password_reset', username },
  })
  return { message: GENERIC_RECOVERY_MESSAGE }
}
