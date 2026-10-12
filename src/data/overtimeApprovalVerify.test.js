import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

let passed = 0
function assert(condition, message) {
  if (!condition) throw new Error(message)
  passed += 1
}

const lemburUrl = new URL('../components/sla/SLALembur.jsx', import.meta.url)
const lembur = readFileSync(fileURLToPath(lemburUrl), 'utf8')

// Handler approval menerima entryId eksplisit dari modal detail.
assert(lembur.includes('const handleApprove = async (record, entryIdOverride)'), 'handleApprove harus menerima entryId eksplisit')
assert(lembur.includes('const handleReject = async (record, entryIdOverride)'), 'handleReject harus menerima entryId eksplisit')
assert(lembur.includes('onClick={()=>handleApprove(detailActivity, detailEntryId)}'), 'Tombol Setujui harus mengirim detailEntryId')
assert(lembur.includes('onClick={()=>handleReject(detailActivity, detailEntryId)}'), 'Tombol penolakan harus mengirim detailEntryId')

// ID hasil RPC dicocokkan dengan peserta yang dipilih sebelum sukses.
assert(lembur.includes('String(resultId) !== String(entryId)'), 'ID hasil approval harus dicocokkan dengan peserta')
assert(lembur.includes('Data peserta tidak valid. Tutup detail lalu buka kembali dari baris peserta.'), 'Entry kosong harus ditolak dengan pesan jelas')

// Status diverifikasi ulang setelah refresh sebelum toast sukses.
assert(lembur.includes('verifyParticipantStatus'), 'Verifikasi status peserta setelah refresh hilang')
assert(lembur.includes("await onRefresh?.()"), 'Refresh harus berjalan sebelum verifikasi')
assert(lembur.includes('Approval peserta belum tersimpan. Muat ulang lalu coba lagi.'), 'Kegagalan verifikasi approval harus berpesan jelas')
assert(lembur.includes('Penolakan peserta belum tersimpan. Muat ulang lalu coba lagi.'), 'Kegagalan verifikasi penolakan harus berpesan jelas')

// Toast sukses menyebut nama peserta agar tidak tertukar.
assert(lembur.includes('berhasil disetujui.`'), 'Toast sukses harus menyebut nama peserta')

console.log(`Overtime approval verify tests passed: ${passed}`)
