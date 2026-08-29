import { supabase } from '../lib/supabaseClient.js'

export async function listManagementOperationalScopes() {
  const { data, error } = await supabase.rpc('list_management_operational_scopes')
  if (error) throw error
  return data ?? []
}
