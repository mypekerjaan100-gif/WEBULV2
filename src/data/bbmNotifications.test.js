import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const read = (path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const report = read('../components/sla/BbmReport.jsx')
const page = read('../pages/sla/SLAPelayananTeknikPage.jsx')

assert(!report.includes('window.confirm'), 'Laporan BBM tidak boleh memakai dialog bawaan browser')
assert(!report.includes('window.alert'), 'Laporan BBM tidak boleh memakai alert bawaan browser')
assert(report.includes('ConfirmationDialog'), 'Konfirmasi BBM harus memakai dialog aplikasi')
assert(report.includes('bbm-toast'), 'Notifikasi simpan/gagal BBM harus memakai toast aplikasi')
assert(!report.includes('{message && <p role="status"'), 'Pesan simpan tidak boleh tampil sebagai banner di halaman')

assert(!page.includes('window.confirm'), 'Navigasi halaman tidak boleh memakai dialog bawaan browser')
assert(page.includes('ConfirmationDialog'), 'Navigasi dengan perubahan belum disimpan harus memakai dialog aplikasi')
assert(page.includes('requestLeaveEditor'), 'Penjagaan meninggalkan editor hilang')

console.log('BBM notifications: custom dialog and toast without native confirms passed.')
