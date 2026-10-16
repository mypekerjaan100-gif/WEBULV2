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
assert(lembur.includes('const openApproveConfirm = (record, entryIdOverride)'), 'openApproveConfirm harus menerima entryId eksplisit')
assert(lembur.includes('const confirmApprove = async'), 'confirmApprove harus mengeksekusi approval')
assert(lembur.includes('onClick={()=>openApproveConfirm(detailActivity, detailEntryId)}'), 'Tombol Setujui harus membuka dialog konfirmasi dengan detailEntryId')
assert(lembur.includes('const handleReject = async (record, entryIdOverride)'), 'handleReject harus menerima entryId eksplisit')
assert(lembur.includes('onClick={()=>handleReject(detailActivity, detailEntryId)}'), 'Tombol penolakan harus mengirim detailEntryId')

// Approve tidak boleh memakai native confirm; diganti dialog custom.
assert(!lembur.includes('window.confirm(`Setujui pengajuan lembur'), 'Approve tidak boleh memakai window.confirm')
assert(lembur.includes('<ConfirmationDialog'), 'Approve harus memakai ConfirmationDialog')
assert(lembur.includes('cancelLabel="Batal"'), 'Dialog harus punya tombol Batal')
assert(lembur.includes('confirmLabel="Konfirmasi"'), 'Dialog harus punya tombol Konfirmasi')
assert(lembur.includes('Memproses...'), 'Dialog harus menampilkan loading saat proses berjalan')

// ID hasil RPC dicocokkan dengan peserta yang dipilih sebelum sukses.
assert(lembur.includes('String(resultId) !== String(entryId)'), 'ID hasil approval harus dicocokkan dengan peserta')
assert(lembur.includes('Data peserta tidak valid. Tutup detail lalu buka kembali dari baris peserta.'), 'Entry kosong harus ditolak dengan pesan jelas')

// Status diverifikasi ulang setelah refresh sebelum toast sukses.
assert(lembur.includes('verifyParticipantStatus'), 'Verifikasi status peserta setelah refresh hilang')
assert(lembur.includes("await onRefresh?.()"), 'Refresh harus berjalan sebelum verifikasi')
assert(lembur.includes('Approval peserta belum tersimpan. Muat ulang lalu coba lagi.'), 'Kegagalan verifikasi approval harus berpesan jelas')
assert(lembur.includes('Penolakan peserta belum tersimpan. Muat ulang lalu coba lagi.'), 'Kegagalan verifikasi penolakan harus berpesan jelas')

// Nama peserta diambil untuk semua tipe lembur (termasuk Pengganti Cuti).
assert(lembur.includes('const participantName = record.participantName'), 'Nama peserta harus diambil untuk semua tipe lembur')
assert(!lembur.includes("record.type === 'WORK' ? record.participantName"), 'Nama peserta tidak boleh dibatasi tipe WORK')
assert(lembur.includes('Pegawai Pengganti'), 'Dialog harus memakai label Pegawai Pengganti untuk tipe pengganti')
assert(lembur.includes('berhasil disetujui.`'), 'Toast sukses harus menyebut nama peserta')
assert(lembur.includes("showToast(message, 'danger')"), 'Kegagalan approval harus menampilkan toast danger')

// Primitive dialog konfirmasi harus reusable dan aman saat loading.
const primitivesUrl = new URL('../components/ui/Primitives.jsx', import.meta.url)
const primitives = readFileSync(fileURLToPath(primitivesUrl), 'utf8')
assert(primitives.includes('export function ConfirmationDialog'), 'ConfirmationDialog harus tersedia di Primitives')
assert(primitives.includes('dismissDisabled'), 'Modal harus bisa dikunci saat proses berjalan')
assert(primitives.includes('showCloseButton'), 'Modal harus bisa menyembunyikan tombol X')

console.log(`Overtime approval verify tests passed: ${passed}`)
