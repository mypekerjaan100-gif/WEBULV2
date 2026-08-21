const MONTHS = [
  'Januari',
  'Februari',
  'Maret',
  'April',
  'Mei',
  'Juni',
  'Juli',
  'Agustus',
  'September',
  'Oktober',
  'November',
  'Desember',
]

export function periodKeyFromLabel(label) {
  const parts = String(label ?? '').trim().split(/\s+/)
  const monthName = parts[0]
  const year = parts[1]
  const monthIndex = MONTHS.indexOf(monthName)
  if (monthIndex < 0 || !year) return ''
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}-01`
}

export function formatDateKey(value) {
  if (!value) return null
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value))
  return match ? `${match[3]}-${match[2]}-${match[1]}` : String(value)
}

export function versionMetadataValid(version) {
  const missing = []
  if (!version?.name || !String(version.name).trim()) missing.push('Nama SLA/Addendum')
  if (!version?.agreementName || !String(version.agreementName).trim())
    missing.push('Nomor Surat Perjanjian/Addendum')
  if (!version?.effectiveDate) missing.push('Tanggal Berlaku SLA')
  if (!version?.periodStart || !version?.periodEnd) {
    missing.push('Periode Berlaku')
  } else if (String(version.periodStart).slice(0, 10) > String(version.periodEnd).slice(0, 10)) {
    missing.push('Periode Berlaku valid (mulai sebelum selesai)')
  }
  return { valid: missing.length === 0, missing }
}

export function versionReferences(version, context = {}) {
  const refs = []
  if (version?.used) {
    refs.push({ kind: 'pelaporan', label: 'data pelaporan (input realisasi / export)' })
  }
  return refs
}

export function scopedVersionsOf(versions, contractId, up3Id) {
  return (versions ?? []).filter(
    (version) => version.contractId === contractId && version.up3Id === up3Id,
  )
}

export function versionInScope(version, contractId, up3Id) {
  return (
    !!version &&
    version.contractId === contractId &&
    version.up3Id === up3Id
  )
}

export function activateScopedVersion(versions, id, contractId, up3Id) {
  const target = (versions ?? []).find((version) => version.id === id)
  if (!target || !versionInScope(target, contractId, up3Id)) {
    return { versions, ok: false, message: 'Versi tidak ditemukan dalam scope UP3 ini.' }
  }
  const next = (versions ?? []).map((version) => {
    if (version.id === id) return { ...version, status: 'Aktif' }
    if (
      version.status === 'Aktif' &&
      version.contractId === contractId &&
      version.up3Id === up3Id
    ) {
      return { ...version, status: 'Arsip', archivedBy: id }
    }
    return version
  })
  return { versions: next, ok: true, message: `SLA "${target.name}" diaktifkan.` }
}

export function rollbackScopedVersion(versions, id, contractId, up3Id) {
  const target = (versions ?? []).find((version) => version.id === id)
  if (!target || !versionInScope(target, contractId, up3Id)) {
    return { versions, ok: false, message: 'Versi tidak ditemukan dalam scope UP3 ini.' }
  }
  if (target.status !== 'Aktif') {
    return { versions, ok: false, message: 'Versi ini bukan SLA Aktif.' }
  }
  if (versionReferences(target).length) {
    return {
      versions,
      ok: false,
      message:
        'SLA ini sudah digunakan pada data pelaporan dan tidak dapat dibatalkan atau dihapus. Buat Addendum baru untuk melakukan perubahan.',
    }
  }
  const archived = (versions ?? [])
    .filter((version) => version.archivedBy === id && version.status === 'Arsip')
    .sort((a, b) => String(b.effectiveDate ?? '').localeCompare(String(a.effectiveDate ?? '')))
  const restore = archived[0] ?? null
  const next = (versions ?? []).map((version) => {
    if (version.id === id) return { ...version, status: 'Draft' }
    if (restore && version.id === restore.id) return { ...version, status: 'Aktif', archivedBy: null }
    if (version.archivedBy === id) return { ...version, archivedBy: null }
    return version
  })
  return {
    versions: next,
    ok: true,
    message: `Aktivasi "${target.name}" dibatalkan; versi sebelumnya "${restore?.name ?? '—'}" kembali Aktif. Metadata dan struktur kedua versi dipertahankan.`,
    nextVersionId: restore?.id ?? id,
  }
}

export function deleteScopedDraft(versions, id, contractId, up3Id) {
  const target = (versions ?? []).find((version) => version.id === id)
  if (!target || !versionInScope(target, contractId, up3Id)) {
    return { versions, ok: false, message: 'Versi tidak ditemukan dalam scope UP3 ini.' }
  }
  if (target.status !== 'Draft') {
    return {
      versions,
      ok: false,
      message:
        'Hanya Draft yang belum digunakan yang dapat dihapus permanen. SLA Aktif/Arsip dipertahankan sebagai histori.',
    }
  }
  if (versionReferences(target).length) {
    return {
      versions,
      ok: false,
      message:
        'SLA ini sudah digunakan pada data pelaporan dan tidak dapat dibatalkan atau dihapus. Buat Addendum baru untuk melakukan perubahan.',
    }
  }
  const next = (versions ?? []).filter((version) => version.id !== id)
  const scoped = next.filter(
    (version) => version.contractId === contractId && version.up3Id === up3Id,
  )
  const nextVersionId = scoped.find((version) => version.status === 'Aktif')?.id
    ?? scoped[0]?.id
    ?? ''
  return {
    versions: next,
    ok: true,
    message: `Draft "${target.name}" dihapus permanen.`,
    nextVersionId,
  }
}

export function updateScopedVersion(versions, id, patch, contractId, up3Id) {
  const target = (versions ?? []).find((version) => version.id === id)
  if (!target || !versionInScope(target, contractId, up3Id)) {
    return { versions, ok: false, message: 'Versi tidak ditemukan dalam scope UP3 ini.' }
  }
  const next = (versions ?? []).map((version) =>
    version.id === id ? { ...version, ...patch } : version,
  )
  return { versions: next, ok: true, message: `Versi "${target.name}" diperbarui.` }
}

export function markScopedVersionUsed(versions, id, contractId, up3Id) {
  if (!id) return versions
  const target = (versions ?? []).find((version) => version.id === id)
  if (!target || !versionInScope(target, contractId, up3Id)) return versions
  return (versions ?? []).map((version) =>
    version.id === id ? { ...version, used: true } : version,
  )
}

export function resolveVersionForPeriod(versions, { contractId, up3Id, periodKey }) {
  const candidates = (versions ?? []).filter(
    (version) =>
      version.status === 'Aktif' &&
      version.contractId === contractId &&
      version.up3Id === up3Id,
  )
  if (!candidates.length) return null
  const key = (date) => (date ? String(date).slice(0, 10) : '')
  const covering = candidates.filter(
    (version) =>
      (!version.periodStart || key(version.periodStart) <= periodKey) &&
      (!version.periodEnd || periodKey <= key(version.periodEnd)),
  )
  if (covering.length) {
    return [...covering].sort((a, b) =>
      key(b.effectiveDate).localeCompare(key(a.effectiveDate)),
    )[0]
  }
  const before = candidates
    .filter((version) => key(version.effectiveDate) <= periodKey)
    .sort((a, b) => key(b.effectiveDate).localeCompare(key(a.effectiveDate)))
  if (before.length) return before[0]
  return candidates[0]
}