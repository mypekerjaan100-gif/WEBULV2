import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  AI_PROVIDERS,
  aiConnectionLabel,
  aiModelOptions,
  aiProvider,
  aiProviderDefaults,
  validateAiSettings,
} from './aiSettings.js'
import { aiCheckMeta, describeAiFailure } from './aiValidation.js'

assert.deepEqual(AI_PROVIDERS.map((provider) => provider.value), ['gemini', 'deepseek', 'grok'])
assert.equal(aiProvider('gemini').baseUrl, 'https://generativelanguage.googleapis.com')
assert.equal(aiProvider('deepseek').baseUrl, 'https://api.deepseek.com')
assert.equal(aiProvider('grok').baseUrl, 'https://api.x.ai')
assert.deepEqual(aiProviderDefaults('gemini'), { baseUrl: 'https://generativelanguage.googleapis.com', model: 'gemini-3.6-flash' })
assert(aiModelOptions('gemini', 'custom-model').some((option) => option.value === 'custom-model'))
assert.equal(validateAiSettings({ provider: 'gemini', model: 'gemini-3.6-flash', baseUrl: 'https://generativelanguage.googleapis.com', enabled: false }), null)
assert.match(validateAiSettings({ provider: 'gemini', model: '', baseUrl: 'https://generativelanguage.googleapis.com' }), /model/i)
assert.match(validateAiSettings({ provider: 'gemini', model: 'gemini-3.6-flash', baseUrl: 'https://evil.example.com' }), /Endpoint/i)
assert.match(validateAiSettings({ provider: 'gemini', model: 'gemini-3.6-flash', baseUrl: 'https://generativelanguage.googleapis.com', enabled: true }), /API key/i)
assert.equal(validateAiSettings({ provider: 'gemini', model: 'gemini-3.6-flash', baseUrl: 'https://generativelanguage.googleapis.com', apiKey: 'abcdefgh', enabled: true }), null)
assert.equal(aiConnectionLabel({ has_key: false }), 'Belum ada API key')
assert.match(aiConnectionLabel({ has_key: true, enabled: true, provider: 'gemini' }), /Aktif/)
assert.match(aiConnectionLabel({ has_key: true, enabled: false, provider: 'gemini' }), /nonaktif/i)
assert.equal(aiCheckMeta('match').label, 'Cocok')
assert.equal(aiCheckMeta('mismatch').label, 'Berbeda')
assert.equal(aiCheckMeta('unreadable').label, 'Tidak terbaca')
assert.equal(aiCheckMeta('error').label, 'Gagal diperiksa')
assert.match(describeAiFailure('Validasi AI belum diaktifkan oleh Super Admin.').title, /belum aktif/i)
assert.match(describeAiFailure('authentication_required').title, /Sesi/i)
assert.match(describeAiFailure('Pengaturan AI belum dapat dibaca.').title, /Pemeriksaan/i)
assert.match(describeAiFailure('Penyedia AI menolak permintaan (HTTP 401): API key salah.').title, /Pemeriksaan/i)
assert.match(describeAiFailure('API key tidak valid').title, /Pemeriksaan/i)
assert.match(describeAiFailure('Anda tidak memiliki akses ke kendaraan ini.').title, /Akses/i)
assert.match(describeAiFailure('Penyedia AI menolak permintaan (HTTP 429): quota exceeded').title, /sibuk/i)
assert.match(describeAiFailure('Failed to send a request to the Edge Function').title, /terhubung/i)
assert.match(describeAiFailure('Penyedia AI menolak permintaan (HTTP 400): model does not support image input').title, /Pemeriksaan/i)
assert.match(describeAiFailure('').message, /coba periksa lagi/i)
assert.equal(describeAiFailure('').title, 'Pemeriksaan belum berhasil')
for (const raw of ['', 'HTTP 401', 'HTTP 429', 'Failed to send a request to the Edge Function', 'Anda tidak memiliki akses ke kendaraan ini.']) {
  assert.doesNotMatch(JSON.stringify(describeAiFailure(raw)), /\bAI\b/, `Pesan pemeriksaan tidak boleh menyebut AI: ${raw}`)
}

const read = (path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const app = read('../App.jsx')
const sidebar = read('../components/Sidebar.jsx')
const page = read('../pages/AIPengaturanPage.jsx')
const repository = read('./aiRepository.js')
const migration = read('../../supabase/migrations/20261123063158_ai_settings.sql')
const bbm = read('../components/sla/BbmReport.jsx')

assert(app.includes('AIPengaturanPage'), 'Halaman Pengaturan AI harus terpasang di App')
assert(app.includes("'ai-pengaturan'"), 'Rute Pengaturan AI harus tersedia')
assert(app.includes("currentPage === 'ai-pengaturan' && !effectiveIsSuperAdmin"), 'Rute Pengaturan AI harus dibatasi Super Admin')
assert(app.includes("first === 'ai-pengaturan' && effectiveIsSuperAdmin"), 'Refresh rute Pengaturan AI harus tetap dibatasi Super Admin')
assert(sidebar.includes('Pengaturan AI'), 'Menu Pengaturan AI harus tersedia untuk Super Admin')
assert(page.includes('Penyedia AI') && page.includes('Model AI') && page.includes('API key AI'), 'Form pengaturan AI tidak lengkap')
assert(!page.includes('settings.api_key'), 'Halaman tidak boleh membaca API key mentah')
assert(repository.includes("rpc('ai_get_settings')"), 'Repository harus memakai RPC pengaturan AI')
assert(repository.includes("invoke('ai-gateway'"), 'Pemeriksaan AI harus melalui Edge Function')
assert(migration.includes('vault.create_secret'), 'API key harus disimpan di Vault')
assert(migration.includes('revoke all on schema ai_private from public, anon, authenticated'), 'Skema privat AI harus ditutup dari browser')
assert(migration.includes('bbm_ai_can_validate'), 'Validasi odometer harus memeriksa akses kendaraan')
assert(bbm.includes('getAiPublicStatus') && bbm.includes('validateBbmOdometer'), 'Laporan BBM harus terhubung ke validasi AI')
assert(bbm.includes('requestAiCheck') && bbm.includes('enqueueAiCheck'), 'Pemeriksaan odometer harus berjalan otomatis setelah foto diunggah')
assert(bbm.includes('handleEndBlur') && bbm.includes('onBlur={() => handleEndBlur(day.date)}'), 'Stand Akhir harus memicu pemeriksaan setelah diisi')
assert(bbm.includes('title="Pemeriksaan odometer"') && bbm.includes('Angka odometer sesuai'), 'Hasil pemeriksaan yang sesuai harus memakai istilah netral')
assert(bbm.includes('bbm-ai-dialog') && bbm.includes('Angka odometer berbeda'), 'Ketidakcocokan harus memakai popup hasil pemeriksaan')
assert(bbm.includes('Pemeriksaan belum aktif') && bbm.includes('Pemeriksaan belum tersedia'), 'Keadaan nonaktif/gangguan harus diinformasikan dengan jelas')
assert(bbm.includes('Foto odometer terunggah. Isi Stand Akhir'), 'Foto tanpa Stand Akhir harus memberi arahan yang jelas')
assert(bbm.includes('Angka odometer tidak terbaca'), 'Keadaan tidak terbaca harus punya penjelasan')
assert(!bbm.includes('bbm-ai-open'), 'Pemeriksaan tidak boleh bergantung pada tombol manual lama')
assert(!bbm.includes('Validasi AI') && !bbm.includes('AI membaca') && !bbm.includes('diperiksa AI'), 'Teks pemeriksaan tidak boleh menyebut AI')

console.log('AI settings: providers, validation, access guard, secure storage and BBM integration passed.')
