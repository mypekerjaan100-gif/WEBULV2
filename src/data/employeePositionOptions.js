const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function cleanPositionName(value) {
  return String(value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ')
}

export function normalizePositionName(value) {
  return cleanPositionName(value).toLocaleLowerCase('id')
}

/**
 * Gabungkan jabatan master Supabase (UUID) dengan jabatan lokal/legacy yang
 * namanya sama. ID Supabase selalu menjadi nilai utama; ID legacy tetap
 * disimpan di positionIds agar pegawai lama dan filter lama tetap valid.
 */
export function dedupePositionOptions({ supabasePositions = [], legacyPositions = [] } = {}) {
  const groups = new Map()
  const legacyKeyToGroupKey = new Map()

  const add = (position, { fromSupabase = false, keyOverride = null } = {}) => {
    const name = cleanPositionName(position?.name)
    if (!name || !position?.id) return
    const key = keyOverride ?? normalizePositionName(name)
    const existing = groups.get(key)
    if (existing) {
      if (!existing.positionIds.includes(position.id)) existing.positionIds.push(position.id)
      if (fromSupabase) {
        existing.fromSupabase = true
        existing.status = position.status ?? existing.status
        // UUID Supabase lebih stabil daripada ID legacy.
        if (!UUID_RE.test(String(existing.id))) {
          existing.id = position.id
          existing.name = name
          existing.order = position.order ?? existing.order
        }
      }
      return
    }
    groups.set(key, {
      id: position.id,
      name,
      order: position.order ?? 0,
      status: position.status ?? 'Aktif',
      fromSupabase,
      positionIds: [position.id],
    })
  }

  // Master Supabase lebih dulu agar menjadi kandidat ID utama.
  for (const position of supabasePositions) {
    add(position, { fromSupabase: true })
    if (position?.legacyKey) {
      legacyKeyToGroupKey.set(position.legacyKey, normalizePositionName(position.name))
    }
  }

  // Jabatan lokal digabung lewat legacy_key bila ada, atau nama ternormalisasi.
  for (const position of legacyPositions) {
    add(position, {
      fromSupabase: false,
      keyOverride: legacyKeyToGroupKey.get(position?.id) ?? null,
    })
  }

  return [...groups.values()]
    .filter((option) => option.id)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name, 'id'))
}
