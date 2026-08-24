import { buildPontianakRange, formatDurationMinutes, pontianakFormValues } from './overtimeReplacementL2.js'

export const WORK_CATEGORIES = {
  ADMINISTRASI: {
    label: 'Administrasi',
    evidence: [
      { type: 'FOTO_SEBELUM', label: 'Foto Sebelum' },
      { type: 'FOTO_SESUDAH', label: 'Foto Sesudah' },
    ],
  },
  GARDU: {
    label: 'Gardu',
    evidence: [
      { type: 'SPK', label: 'SPK' },
      { type: 'FOTO_BRIEFING', label: 'Foto Briefing', allowMultiple: true, helpers: ['TimeMark Wajib', 'Wajah petugas harus dapat dikenali dengan jelas tanpa mengabaikan penggunaan APD.', 'Secara keseluruhan foto briefing harus mampu membuktikan peserta yang diajukan memang hadir.'] },
      { type: 'FOTO_PROSES', label: 'Foto Proses', helpers: ['TimeMark Wajib', 'Aktivitas dan objek pekerjaan harus terlihat jelas.'] },
      { type: 'FOTO_SELESAI', label: 'Foto Selesai', helpers: ['TimeMark Wajib', 'Hasil pekerjaan harus terlihat jelas.'] },
    ],
  },
  JTM: {
    label: 'JTM',
    evidence: [
      { type: 'SPK', label: 'SPK' },
      { type: 'FOTO_BRIEFING', label: 'Foto Briefing', allowMultiple: true, helpers: ['TimeMark Wajib', 'Wajah petugas harus dapat dikenali dengan jelas tanpa mengabaikan penggunaan APD.', 'Secara keseluruhan foto briefing harus mampu membuktikan peserta yang diajukan memang hadir.'] },
      { type: 'FOTO_PROSES', label: 'Foto Proses', helpers: ['TimeMark Wajib', 'Aktivitas dan objek pekerjaan harus terlihat jelas.'] },
      { type: 'FOTO_SELESAI', label: 'Foto Selesai', helpers: ['TimeMark Wajib', 'Hasil pekerjaan harus terlihat jelas.'] },
    ],
  },
  JTR: {
    label: 'JTR',
    evidence: [
      { type: 'SPK', label: 'SPK' },
      { type: 'FOTO_BRIEFING', label: 'Foto Briefing', allowMultiple: true, helpers: ['TimeMark Wajib', 'Wajah petugas harus dapat dikenali dengan jelas tanpa mengabaikan penggunaan APD.', 'Secara keseluruhan foto briefing harus mampu membuktikan peserta yang diajukan memang hadir.'] },
      { type: 'FOTO_PROSES', label: 'Foto Proses', helpers: ['TimeMark Wajib', 'Aktivitas dan objek pekerjaan harus terlihat jelas.'] },
      { type: 'FOTO_SELESAI', label: 'Foto Selesai', helpers: ['TimeMark Wajib', 'Hasil pekerjaan harus terlihat jelas.'] },
    ],
  },
}

export { buildPontianakRange, formatDurationMinutes, pontianakFormValues }

export function workEvidenceComplete(category, evidenceRows) {
  if (!WORK_CATEGORIES[category]) return false
  const byType = evidenceRows.reduce((acc, r) => {
    acc[r.evidenceType] = acc[r.evidenceType] || []
    acc[r.evidenceType].push(r)
    return acc
  }, {})
  if (category === 'ADMINISTRASI') {
    return ['FOTO_SEBELUM','FOTO_SESUDAH'].every(t => (byType[t]||[]).filter(r=>r.status==='ACTIVE').length===1)
  }
  const spk = (byType['SPK']||[]).filter(r=>r.status==='ACTIVE').length
  const briefing = (byType['FOTO_BRIEFING']||[]).filter(r=>r.status==='ACTIVE').length
  const proses = (byType['FOTO_PROSES']||[]).filter(r=>r.status==='ACTIVE').length
  const selesai = (byType['FOTO_SELESAI']||[]).filter(r=>r.status==='ACTIVE').length
  if (spk!==1 || briefing<1 || proses!==1 || selesai!==1) return false
  const allowed = new Set(['SPK','FOTO_BRIEFING','FOTO_PROSES','FOTO_SELESAI'])
  if (evidenceRows.some(r=>r.status==='ACTIVE' && !allowed.has(r.evidenceType))) return false
  return true
}
