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
assert(bbm.includes('Validasi foto odometer dengan AI'), 'Dialog validasi odometer AI harus tersedia')

console.log('AI settings: providers, validation, access guard, secure storage and BBM integration passed.')
