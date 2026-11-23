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
  addAiApiKey,
  deleteAiApiKey,
  getAiSettings,
  promoteAiApiKey,
  saveAiSettings,
  testAiConnection,
  updateAiApiKey,
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
  const [keyForm, setKeyForm] = useState({ label: '', apiKey: '' })
  const [addingKey, setAddingKey] = useState(false)
  const [keyBusy, setKeyBusy] = useState('')
  const [confirmDeleteKey, setConfirmDeleteKey] = useState(null)
  const [deletingKey, setDeletingKey] = useState(false)

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
  const savedKeys = settings?.keys ?? []
  const enabledKeys = savedKeys.filter((key) => key.enabled)
  const enabledKeyCount = enabledKeys.length
  const primaryKeyId = enabledKeys[0]?.id ?? null
  const hasSavedKey = sameProvider && enabledKeyCount > 0
  const provider = aiProvider(form.provider)
  const dirty = Boolean(settings) && (
    form.provider !== settings.provider
    || form.model !== settings.model
    || form.baseUrl !== settings.base_url
    || form.enabled !== settings.enabled
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
    const validation = validateAiSettings({
      provider: form.provider,
      model: form.model,
      baseUrl: form.baseUrl,
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
    if (testing || saving || !enabledKeyCount || dirty) return
    setTesting(true)
    setError('')
    setNotice('')
    try {
      const result = await testAiConnection()
      const summary = result?.tested
        ? ` ${result.ok_count} dari ${result.tested} API key siap.`
        : ''
      setNotice(`${result?.message || 'Koneksi AI berhasil.'}${summary}`)
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

  const addKey = async (event) => {
    event?.preventDefault?.()
    if (addingKey || keyBusy) return
    const apiKey = keyForm.apiKey.trim()
    if (apiKey.length < 8 || apiKey.length > 500) {
      setError('API key harus terdiri dari 8 sampai 500 karakter.')
      return
    }
    setAddingKey(true)
    setError('')
    setNotice('')
    try {
      const next = await addAiApiKey({
        provider: settings.provider,
        apiKey,
        label: keyForm.label.trim(),
      })
      setSettings(next)
      setKeyForm({ label: '', apiKey: '' })
      setNotice('API key berhasil ditambahkan.')
    } catch (err) {
      setError(err.message)
    } finally {
      setAddingKey(false)
    }
  }

  const toggleKey = async (key) => {
    if (keyBusy || addingKey) return
    setKeyBusy(key.id)
    setError('')
    setNotice('')
    try {
      const next = await updateAiApiKey({ keyId: key.id, enabled: !key.enabled })
      setSettings(next)
      setNotice(key.enabled ? 'API key dinonaktifkan.' : 'API key diaktifkan.')
    } catch (err) {
      setError(err.message)
    } finally {
      setKeyBusy('')
    }
  }

  const promoteKey = async (key) => {
    if (keyBusy || addingKey) return
    setKeyBusy(key.id)
    setError('')
    setNotice('')
    try {
      const next = await promoteAiApiKey(key.id)
      setSettings(next)
      setNotice('API key dijadikan utama.')
    } catch (err) {
      setError(err.message)
    } finally {
      setKeyBusy('')
    }
  }

  const removeKey = async () => {
    if (!confirmDeleteKey || deletingKey) return
    setDeletingKey(true)
    setError('')
    setNotice('')
    try {
      const next = await deleteAiApiKey(confirmDeleteKey.id)
      setSettings(next)
      setConfirmDeleteKey(null)
      setNotice('API key telah dihapus.')
    } catch (err) {
      setError(err.message)
      setConfirmDeleteKey(null)
    } finally {
      setDeletingKey(false)
    }
  }

  const keyStatus = (key) => {
    if (!key.enabled) return { label: 'Nonaktif', tone: 'off' }
    if (key.status === 'invalid') return { label: 'Perlu diganti', tone: 'danger' }
    if (key.status === 'cooldown' && key.cooldown_until
      && new Date(key.cooldown_until).getTime() > Date.now()) {
      const until = new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit' }).format(new Date(key.cooldown_until))
      return { label: `Dibatasi s.d. ${until}`, tone: 'warning' }
    }
    return { label: 'Siap', tone: 'ok' }
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
          Penyedia, model, dan beberapa API key untuk fitur AI di aplikasi, termasuk pemeriksaan
          odometer BBM. Key utama dan cadangan membantu pemeriksaan tetap berjalan saat satu key dibatasi.
        </p>
      </section>

      {error && <Alert tone="danger">{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}

      <div className="ai-settings-layout">
        <div className="ai-settings-main">
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
                  className="ai-select"
                  popupClassName="ai-select-popup"
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
                  className="ai-select"
                  popupClassName="ai-select-popup"
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
            </div>

            <p className="ai-vision-note"><Icon name="info" size={15} /> {provider.visionNote}</p>

            <label className="ai-switch">
              <input
                type="checkbox"
                checked={form.enabled}
                disabled={saving || testing || !sameProvider || enabledKeyCount === 0}
                onChange={(event) => update('enabled', event.target.checked)}
              />
              <span>
                <strong>Aktifkan AI</strong>
                <small>Izinkan fitur yang mendukung memakai koneksi AI ini.</small>
              </span>
            </label>
            {!sameProvider ? (
              <p className="ai-key-hint"><Icon name="info" size={14} /> Simpan perubahan penyedia terlebih dahulu sebelum mengaktifkan AI.</p>
            ) : enabledKeyCount === 0 ? (
              <p className="ai-key-hint"><Icon name="key" size={14} /> Tambahkan API key di bawah sebelum mengaktifkan AI.</p>
            ) : null}

            <div className="ai-actions">
              <Button variant="primary" type="submit" disabled={saving || testing} icon={<Icon name="save" size={16} />}>
                {saving ? 'Menyimpan…' : 'Simpan pengaturan'}
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={saving || testing || enabledKeyCount === 0 || dirty}
                onClick={test}
                title={dirty ? 'Simpan perubahan terlebih dahulu' : undefined}
                icon={<Icon name="refresh-cw" size={16} />}
              >
                {testing ? 'Menguji…' : 'Uji koneksi'}
              </Button>
            </div>
            {dirty && <p className="ai-dirty-note">Ada perubahan yang belum disimpan. Uji koneksi memakai pengaturan yang sudah tersimpan.</p>}
          </form>

          <section className="ai-settings-card ai-keys-card">
            <header className="ai-card-header">
              <span className="ai-card-icon" aria-hidden="true"><Icon name="key" size={22} /></span>
              <div>
                <h2>API key &amp; rotasi</h2>
                <p>Simpan beberapa key untuk penyedia ini. Key utama dipakai lebih dulu; key cadangan dicoba otomatis saat key utama dibatasi.</p>
              </div>
              {sameProvider && <span className="ai-key-count">{savedKeys.length} key</span>}
            </header>

            {!sameProvider ? (
              <p className="ai-key-switch-note"><Icon name="info" size={15} /> Simpan perubahan penyedia terlebih dahulu untuk mengelola API key penyedia ini.</p>
            ) : (
              <>
                <form className="ai-key-add" onSubmit={addKey}>
                  <label className="ai-field">
                    <span>Nama key (opsional)</span>
                    <input
                      className="ai-input"
                      type="text"
                      aria-label="Nama API key"
                      placeholder="Contoh: Utama atau Cadangan 1"
                      value={keyForm.label}
                      disabled={addingKey || saving || testing}
                      onChange={(event) => setKeyForm((current) => ({ ...current, label: event.target.value }))}
                      maxLength={80}
                      autoComplete="off"
                    />
                  </label>
                  <label className="ai-field">
                    <span>API key baru</span>
                    <input
                      className="ai-input"
                      type="password"
                      aria-label="API key baru"
                      placeholder="Masukkan API key dari penyedia"
                      value={keyForm.apiKey}
                      disabled={addingKey || saving || testing}
                      onChange={(event) => setKeyForm((current) => ({ ...current, apiKey: event.target.value }))}
                      maxLength={500}
                      autoComplete="new-password"
                      spellCheck={false}
                    />
                  </label>
                  <Button
                    type="submit"
                    variant="secondary"
                    disabled={addingKey || saving || testing || keyForm.apiKey.trim().length < 8}
                    icon={<Icon name="plus" size={16} />}
                  >
                    {addingKey ? 'Menambahkan…' : 'Tambah key'}
                  </Button>
                </form>

                {savedKeys.length === 0 ? (
                  <p className="ai-key-empty">Belum ada API key untuk {aiProvider(settings.provider).label}. Tambahkan minimal satu key agar AI dapat diaktifkan.</p>
                ) : (
                  <ul className="ai-key-list">
                    {savedKeys.map((key, index) => {
                      const primary = key.id === primaryKeyId
                      const status = keyStatus(key)
                      const disabled = keyBusy === key.id || addingKey || saving || testing
                      const lastActiveLocked = settings.enabled && key.enabled && enabledKeyCount === 1
                      const lockTitle = lastActiveLocked ? 'Nonaktifkan AI terlebih dahulu' : undefined
                      return (
                        <li key={key.id} className={`ai-key-row${primary ? ' is-primary' : ''}`}>
                          <span className="ai-key-mark" aria-hidden="true"><Icon name={primary ? 'star' : 'key'} size={16} /></span>
                          <div className="ai-key-copy">
                            <strong>
                              {key.label || `Key ${index + 1}`}
                              {primary && !/utama/i.test(key.label || '') && <span className="ai-key-badge">Utama</span>}
                            </strong>
                            <small>
                              {key.hint || '••••'}
                              <span className={`ai-key-status is-${status.tone}`}>{status.label}</span>
                            </small>
                            {key.last_error && key.status !== 'active' && (
                              <small className="ai-key-error" title={key.last_error}>{key.last_error}</small>
                            )}
                          </div>
                          <div className="ai-key-actions">
                            {!primary && key.enabled && (
                              <button type="button" disabled={disabled} onClick={() => promoteKey(key)} aria-label={`Jadikan ${key.label || key.hint} utama`}>Jadikan utama</button>
                            )}
                            <button type="button" disabled={disabled || lastActiveLocked} title={lockTitle} onClick={() => toggleKey(key)} aria-label={`${key.enabled ? 'Nonaktifkan' : 'Aktifkan'} ${key.label || key.hint}`}>
                              {key.enabled ? 'Nonaktifkan' : 'Aktifkan'}
                            </button>
                            <button type="button" className="is-danger" disabled={disabled || lastActiveLocked} title={lockTitle} onClick={() => setConfirmDeleteKey(key)} aria-label={`Hapus ${key.label || key.hint}`}>Hapus</button>
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                )}
                <p className="ai-key-footnote">
                  <Icon name="shield" size={14} /> Nilai key tidak ditampilkan kembali. Jika key kena batas, sistem mencoba key cadangan pada penyedia yang sama. Failover tidak menambah kuota penyedia.
                </p>
              </>
            )}
          </section>
        </div>

        <aside className="ai-settings-side">
          <section className="ai-settings-card ai-side-card">
            <h3>Status koneksi</h3>
            <dl className="ai-status-list">
              <div><dt>Penyedia</dt><dd>{aiProvider(settings.provider).label}</dd></div>
              <div><dt>Model</dt><dd>{settings.model}</dd></div>
              <div><dt>API key</dt><dd>{settings.has_key ? `${settings.active_key_count ?? 0}/${settings.key_count ?? 0} aktif` : 'Belum ada'}</dd></div>
              <div><dt>Key utama</dt><dd>{settings.key_hint || '—'}</dd></div>
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
        open={Boolean(confirmDeleteKey)}
        title="Hapus API key?"
        description={`API key ${confirmDeleteKey?.hint || ''}${confirmDeleteKey?.label ? ` (${confirmDeleteKey.label})` : ''} akan dihapus dari server. Key cadangan lain tetap tersedia.`}
        confirmLabel="Hapus key"
        cancelLabel="Batal"
        confirmTone="danger"
        icon="alert-triangle"
        loading={deletingKey}
        onConfirm={removeKey}
        onCancel={() => { if (!deletingKey) setConfirmDeleteKey(null) }}
      />
    </div>
  )
}
