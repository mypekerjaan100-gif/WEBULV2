import { supabase } from './supabaseClient.js'

async function rpc(name, parameters) {
  const { data, error } = await supabase.rpc(name, parameters)
  if (error) throw new Error(error.message || 'Permintaan role gagal.')
  return data
}

export async function listCustomRoles() {
  const rows = await rpc('list_custom_roles')
  return (rows ?? []).map((row) => ({
    id: row.id,
    code: row.code,
    displayName: row.display_name,
    description: row.description ?? '',
    scopeLevel: row.scope_level,
    isActive: row.is_active !== false,
    revision: Number(row.revision ?? 1),
    menuAccess: row.menu_access ?? {},
    assignedUsers: Number(row.assigned_users ?? 0),
  }))
}

export async function saveCustomRole({
  roleId = null,
  code,
  displayName,
  description = '',
  scopeLevel = 'ULP',
  menuAccess,
  expectedRevision = null,
}) {
  return rpc('save_custom_role', {
    p_role_id: roleId,
    p_code: code,
    p_display_name: displayName,
    p_description: description,
    p_scope_level: scopeLevel,
    p_menu_access: menuAccess,
    p_expected_revision: expectedRevision,
  })
}

export async function setCustomRoleActive({ roleId, isActive, expectedRevision }) {
  return rpc('set_custom_role_active', {
    p_role_id: roleId,
    p_is_active: isActive,
    p_expected_revision: expectedRevision,
  })
}
