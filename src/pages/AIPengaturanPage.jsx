import { useEffect, useState } from 'react'
import Icon from '../components/Icon.jsx'
import BbmSelect from '../components/sla/BbmSelect.jsx'
import { Alert, Button, ConfirmationDialog, StatePanel } from '../components/ui/Primitives.jsx'
import {
  AI_PROVIDERS,
  aiConnectionLabel,
  aiModelOptions,
  aiProvider,
  aiProviderDefaults,
  validateAiSettings,
} from '../data/aiSettings.js'
import {
  clearAiApiKey,
  getAiSettings,
  saveAiSettings,
  testAiConnection,
} from '../data/aiRepository.js'
import './AIPengaturanPage.css'

const OTHER_MODEL = '__other__'

const formatDateTime = (value) => {
  if (!value) return 'Belum pernah'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Belum pernah'
  return new Intl.DateTimeFormat('id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function formFromSettings(settings) {
  return {
    provider: settings?.provider ?? 'gemini',
    model: settings?.model ?? aiProvider('gemini').defaultModel,
    baseUrl: settings?.base_url ?? aiProvider('gemini').baseUrl,
    apiKey: '',
    enabled: Boolean(settings?.enabled),
  }
}

export default function AIPengaturanPage({ onBack }) {
  const [settings, setSettings] = useState(null)
  const [form, setForm] = useState(() => formFromSettings(null))
  const [customModel, setCustomModel] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [confirmClear, setConfirmClear] = useState(false)
  const [clearing, setClearing] = useState(false)

  useEffect(() => {
    let active = true
    setLoading(true)
    getAiSettings()
      .then((data) => {
        if (!active) return
        setSettings(data)
        setForm(formFromSettings(data))
        setCustomModel(!aiProvider(data?.provider).models.includes(data?.model))
      })
      .catch((err) => { if (active) setError(err.message) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  const sameProvider = settings?.provider === form.provider
  const hasSavedKey = Boolean(settings?.has_key && sameProvider)
  const provider = aiProvider(form.provider)
  const dirty = Boolean(settings) && (
    form.provider !== settings.provider
    || form.model !== settings.model
    || form.baseUrl !== settings.base_url
    || form.enabled !== settings.enabled
    || form.apiKey.trim() !== ''
  )

  const update = (key, value) => {
    setNotice('')
    setError('')
    setForm((current) => ({ ...current, [key]: value }))
  }

  const changeProvider = (nextProvider) => {
    const next = aiProvider(nextProvider)
    setNotice('')
    setError('')
    setCustomModel(false)
    setForm((current) => ({
      ...current,
      provider: nextProvider,
      baseUrl: next.baseUrl,
      model: next.defaultModel,
      apiKey: '',
      enabled: false,
    }))
  }

  const changeModel = (value) => {
    if (value === OTHER_MODEL) {
      setCustomModel(true)
      if (aiProvider(form.provider).models.includes(form.model)) update('model', '')
      return
    }
    setCustomModel(false)
    update('model', value)
  }

  const save = async (event) => {
    event?.preventDefault?.()
    if (saving || testing) return
    setError('')
    setNotice('')
    const providerChanged = settings && settings.provider !== form.provider
    if (providerChanged && !form.apiKey.trim()) {
      setError('Masukkan API key untuk penyedia AI yang baru.')
      return
    }
    const validation = validateAiSettings({
      provider: form.provider,
      model: form.model,
      baseUrl: form.baseUrl,
      apiKey: form.apiKey,
      hasKey: hasSavedKey,
      enabled: form.enabled,
    })
    if (validation) {
      setError(validation)
      return
    }
    setSaving(true)
    try {
      const next = await saveAiSettings({
        provider: form.provider,
        model: form.model.trim(),
        baseUrl: form.baseUrl,
        apiKey: form.apiKey.trim(),
        enabled: form.enabled,
      })
      setSettings(next)
      setForm(formFromSettings(next))
      setCustomModel(!aiProvider(next.provider).models.includes(next.model))
      setNotice('Pengaturan AI tersimpan.')
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const test = async () => {
    if (testing || saving || !settings?.has_key || dirty) return
    setTesting(true)
    setError('')
    setNotice('')
    try {
      const result = await testAiConnection()
      setNotice(result?.message || 'Koneksi AI berhasil.')
      const next = await getAiSettings()
      setSettings(next)
      setForm(formFromSettings(next))
    } catch (err) {
      setError(err.message)
      try {
        const next = await getAiSettings()
        setSettings(next)
      } catch {
        // Abaikan kegagalan refresh status.
      }
    } finally {
      setTesting(false)
    }
  }

  const removeKey = async () => {
    if (clearing) return
    setClearing(true)
    setError('')
    setNotice('')
    try {
      const next = await clearAiApiKey()
      setSettings(next)
      setForm(formFromSettings(next))
      setConfirmClear(false)
      setNotice('API key AI telah dihapus. AI dinonaktifkan.')
    } catch (err) {
      setError(err.message)
    } finally {
      setClearing(false)
    }
  }

  if (loading) {
    return <div className="page ai-settings-page"><StatePanel state="loading" title="Memuat pengaturan AI" /></div>
  }

  if (!settings) {
    return (
      <div className="page ai-settings-page">
        <div className="page-header-row">
          <button type="button" className="back-button" onClick={onBack}>&larr; Kembali</button>
        </div>
        <StatePanel state="error" title="Pengaturan AI tidak dapat dimuat">
          <p>{error || 'Hanya Super Admin yang dapat membuka pengaturan ini.'}</p>
        </StatePanel>
      </div>
    )
  }

  const connection = aiConnectionLabel(settings)
  const statusTone = !settings.has_key ? 'idle' : settings.enabled ? 'active' : 'standby'
  const modelValue = customModel ? OTHER_MODEL : form.model

  return (
    <div className="page ai-settings-page">
      <div className="page-header-row">
        <button type="button" className="back-button" onClick={onBack}>&larr; Kembali</button>
      </div>
      <section className="page-hero">
        <h1 className="page-title">Pengaturan AI</h1>
        <p className="page-subtitle">
          Penyedia, model, dan API key untuk fitur AI di aplikasi. Pengaturan ini bersifat umum,
          termasuk untuk validasi foto odometer BBM.
        </p>
      </section>

      {error && <Alert tone="danger">{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}

      <div className="ai-settings-layout">
        <form className="ai-settings-card" onSubmit={save}>
          <header className="ai-card-header">
            <span className="ai-card-icon" aria-hidden="true"><Icon name="sparkles" size={22} /></span>
            <div>
              <h2>Koneksi penyedia AI</h2>
              <p>API key hanya disimpan di server dan tidak ditampilkan kembali di browser.</p>
            </div>
            <span className={`ai-connection-pill is-${statusTone}`}>{connection}</span>
          </header>

          <div className="ai-form-grid">
            <label className="ai-field">
              <span>Penyedia</span>
              <BbmSelect
                ariaLabel="Penyedia AI"
                value={form.provider}
                disabled={saving || testing}
                options={AI_PROVIDERS.map((item) => ({ value: item.value, label: item.label }))}
                onChange={changeProvider}
              />
            </label>

            <label className="ai-field">
              <span>Model</span>
              <BbmSelect
                ariaLabel="Model AI"
                value={modelValue}
                disabled={saving || testing}
                options={[
                  ...aiModelOptions(form.provider, form.model).filter((option) => option.value !== OTHER_MODEL),
                  { value: OTHER_MODEL, label: 'Model lain…' },
                ]}
                onChange={changeModel}
              />
              {customModel && (
                <input
                  className="ai-input"
                  type="text"
                  aria-label="Nama model AI lain"
                  placeholder="Nama model dari penyedia"
                  value={form.model}
                  disabled={saving || testing}
                  onChange={(event) => update('model', event.target.value)}
                  maxLength={120}
                  autoComplete="off"
                />
              )}
            </label>

            <label className="ai-field ai-field-wide">
              <span>Endpoint dasar</span>
              <input
                className="ai-input"
                type="url"
                aria-label="Endpoint dasar AI"
                value={form.baseUrl}
                disabled={saving || testing}
                onChange={(event) => update('baseUrl', event.target.value)}
                spellCheck={false}
                autoComplete="off"
              />
              <small>Endpoint dibatasi ke alamat resmi penyedia yang dipilih.</small>
            </label>

            <label className="ai-field ai-field-wide">
              <span>API key</span>
              <input
                className="ai-input"
                type="password"
                aria-label="API key AI"
                placeholder={hasSavedKey ? `Kosongkan untuk mempertahankan key ${settings.key_hint || 'tersimpan'}` : 'Masukkan API key dari penyedia'}
                value={form.apiKey}
                disabled={saving || testing}
                onChange={(event) => update('apiKey', event.target.value)}
                maxLength={500}
                autoComplete="new-password"
                spellCheck={false}
              />
              <small>
                {hasSavedKey
                  ? `API key tersimpan: ${settings.key_hint || '••••'}. Isi kolom hanya bila ingin menggantinya.`
                  : 'Key dikirim melalui koneksi aman lalu disimpan terenkripsi di server.'}
              </small>
            </label>
          </div>

          <p className="ai-vision-note"><Icon name="info" size={15} /> {provider.visionNote}</p>

          <label className="ai-switch">
            <input
              type="checkbox"
              checked={form.enabled}
              disabled={saving || testing}
              onChange={(event) => update('enabled', event.target.checked)}
            />
            <span>
              <strong>Aktifkan AI</strong>
              <small>Izinkan fitur yang mendukung memakai koneksi AI ini.</small>
            </span>
          </label>

          <div className="ai-actions">
            <Button variant="primary" type="submit" disabled={saving || testing} icon={<Icon name="save" size={16} />}>
              {saving ? 'Menyimpan…' : 'Simpan pengaturan'}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={saving || testing || !settings.has_key || dirty}
              onClick={test}
              title={dirty ? 'Simpan perubahan terlebih dahulu' : undefined}
              icon={<Icon name="refresh-cw" size={16} />}
            >
              {testing ? 'Menguji…' : 'Uji koneksi'}
            </Button>
            {settings.has_key && (
              <Button type="button" variant="danger" disabled={saving || testing || clearing} onClick={() => setConfirmClear(true)}>
                Hapus API key
              </Button>
            )}
          </div>
          {dirty && <p className="ai-dirty-note">Ada perubahan yang belum disimpan. Uji koneksi memakai pengaturan yang sudah tersimpan.</p>}
        </form>

        <aside className="ai-settings-side">
          <section className="ai-settings-card ai-side-card">
            <h3>Status koneksi</h3>
            <dl className="ai-status-list">
              <div><dt>Penyedia</dt><dd>{aiProvider(settings.provider).label}</dd></div>
              <div><dt>Model</dt><dd>{settings.model}</dd></div>
              <div><dt>API key</dt><dd>{settings.has_key ? settings.key_hint || 'Tersimpan' : 'Belum ada'}</dd></div>
              <div><dt>Kondisi</dt><dd>{settings.enabled ? 'Aktif' : 'Nonaktif'}</dd></div>
              <div><dt>Terakhir diuji</dt><dd>{formatDateTime(settings.last_test_at)}</dd></div>
            </dl>
            {settings.last_test_at && (
              <p className={`ai-test-result ${settings.last_test_ok ? 'is-ok' : 'is-fail'}`}>
                <Icon name={settings.last_test_ok ? 'check-circle' : 'alert-triangle'} size={15} />
                {settings.last_test_message || (settings.last_test_ok ? 'Koneksi berhasil.' : 'Koneksi gagal.')}
              </p>
            )}
          </section>

          <section className="ai-settings-card ai-side-card">
            <h3>Dipakai untuk</h3>
            <p className="ai-side-copy">Pemeriksaan foto odometer BBM: setelah foto diunggah, sistem membaca angka pada foto lalu membandingkannya dengan Stand Akhir yang diisi pengguna.</p>
            <p className="ai-side-copy">Fitur AI lain dapat ditambahkan nanti tanpa membuat pengaturan baru.</p>
          </section>

          <section className="ai-settings-card ai-side-card ai-security-card">
            <h3><Icon name="shield" size={17} /> Keamanan</h3>
            <ul>
              <li>API key disimpan terenkripsi di server dan tidak pernah dikirim kembali ke browser.</li>
              <li>Hanya Super Admin yang dapat melihat status dan mengubah pengaturan.</li>
              <li>Endpoint dibatasi ke alamat resmi penyedia untuk mencegah penyalahgunaan.</li>
            </ul>
          </section>
        </aside>
      </div>

      <ConfirmationDialog
        open={confirmClear}
        title="Hapus API key AI?"
        description="API key akan dihapus dari server dan AI langsung dinonaktifkan. Semua fitur AI yang bergantung pada koneksi ini tidak dapat digunakan sampai key baru disimpan."
        confirmLabel="Hapus API key"
        cancelLabel="Batal"
        confirmTone="danger"
        icon="alert-triangle"
        loading={clearing}
        onConfirm={removeKey}
        onCancel={() => { if (!clearing) setConfirmClear(false) }}
      />
    </div>
  )
}
