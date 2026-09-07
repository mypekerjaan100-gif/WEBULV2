import { useState, useEffect, createContext, useContext } from 'react'
import { supabase } from './supabaseClient.js'
import { callUserManagement } from './userManagement.js'
import { requestPasswordResetByUsername, signInWithUsername } from './usernameAuth.js'

const AuthContext = createContext(null)
const AUTHORITY_TIMEOUT_MS = 15000

export function useAuth() {
  return useContext(AuthContext)
}

function withTimeout(promise, timeoutMs, message) {
  let timeoutId
  const timeout = new Promise((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error(message)), timeoutMs)
  })
  return Promise.race([promise, timeout]).finally(() => window.clearTimeout(timeoutId))
}

async function resolveAuthority() {
  try {
    const { data, error } = await withTimeout(
      callUserManagement('session_context'),
      AUTHORITY_TIMEOUT_MS,
      'Verifikasi otoritas melebihi batas waktu. Silakan coba lagi.',
    )
    if (error) return { actor: null, error }
    if (!data?.actor) return { actor: null, error: 'Otoritas akun tidak tersedia.' }
    return { actor: data.actor, error: null }
  } catch (error) {
    return { actor: null, error: error.message || 'Gagal memverifikasi otoritas akun.' }
  }
}

export default function AppAuth({ children }) {
  const [session, setSession] = useState(null)
  const [view, setView] = useState('loading')
  const [error, setError] = useState(null)
  const [recoveryUsername, setRecoveryUsername] = useState('')
  const [authority, setAuthority] = useState({ loading: true, actor: null, error: null })

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s)
      const hash = window.location.hash || ''
      if (s && hash.includes('type=recovery')) {
        setView('recovery')
      } else if (s) {
        setView('app')
      } else {
        setView('signin')
      }
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s)
      if (event === 'PASSWORD_RECOVERY') {
        setView('recovery')
      } else if (event === 'SIGNED_IN') {
        setView('app')
      } else if (event === 'TOKEN_REFRESHED') {
        resolveAuthority().then(({ actor, error: authorityError }) => {
          if (!authorityError && actor) setAuthority({ loading: false, actor, error: null })
        })
      } else if (event === 'SIGNED_OUT') {
        setAuthority({ loading: false, actor: null, error: null })
        setView('signin')
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session?.user) {
      setAuthority({ loading: false, actor: null, error: null })
      return
    }

    let cancelled = false
    setAuthority({ loading: true, actor: null, error: null })
    let resolvedActor = null
    let resolvedError = null
    const bootstrapAuthority = async () => {
      try {
        const result = await resolveAuthority()
        resolvedActor = result.actor
        resolvedError = result.error
      } catch {
        resolvedError = 'Gagal memverifikasi otoritas akun.'
      } finally {
        if (!cancelled) {
          setAuthority({ loading: false, actor: resolvedActor, error: resolvedError })
        }
      }
    }
    bootstrapAuthority()

    return () => { cancelled = true }
  }, [session?.user?.id])

  const signIn = async (username, password) => {
    setError(null)
    setAuthority({ loading: true, actor: null, error: null })
    const { session: nextSession, error: authErr } = await signInWithUsername(username, password)
    if (authErr) {
      setError(authErr)
      setAuthority({ loading: false, actor: null, error: null })
      return false
    }
    setSession(nextSession)
    setView('app')
    return true
  }

  const signOut = async () => {
    const { error: authErr } = await supabase.auth.signOut()
    if (authErr) {
      setError(authErr.message)
      return false
    }
    setSession(null)
    setAuthority({ loading: false, actor: null, error: null })
    setView('signin')
    return true
  }

  if (view === 'loading') {
    return (
      <div className="auth-page auth-state-page">
        <p>Memuat sesi...</p>
      </div>
    )
  }

  if (view === 'recovery') {
    return <UpdatePasswordForm />
  }

  if (view === 'forgot-password') {
    return (
      <ForgotPasswordForm
        initialUsername={recoveryUsername}
        onBack={() => setView('signin')}
      />
    )
  }

  if (view === 'signin' || !session) {
    return (
      <SignInForm
        onSignIn={signIn}
        onForgotPassword={(username) => {
          setRecoveryUsername(username)
          setView('forgot-password')
        }}
        error={error}
      />
    )
  }

  if (authority.loading) {
    return <AuthState message="Memverifikasi otoritas akun..." />
  }

  if (authority.error || !authority.actor) {
    return (
      <AuthState
        message={authority.error || 'Otoritas akun tidak tersedia.'}
        actionLabel="Coba Lagi"
        onAction={() => {
          setAuthority({ loading: true, actor: null, error: null })
          resolveAuthority()
            .then(({ actor, error: capabilityError }) => {
              setAuthority({ loading: false, actor, error: capabilityError })
            })
            .catch(() => {
              setAuthority({ loading: false, actor: null, error: 'Gagal memverifikasi otoritas akun.' })
            })
        }}
        secondaryActionLabel="Keluar"
        onSecondaryAction={signOut}
      />
    )
  }

  if (authority.actor.access_state === 'AWAITING_ASSIGNMENT') {
    return (
      <AuthState
        message="Akun Anda belum memiliki akses aktif."
        secondaryActionLabel="Keluar"
        onSecondaryAction={signOut}
      />
    )
  }

  const contractAccess = authority.actor.contract_access ?? []
  const organizationAccess = authority.actor.organization_access ?? []
  const totalActive = contractAccess.length + organizationAccess.length + (authority.actor.is_super_admin ? 1 : 0)
  if (totalActive > 1) {
    return (
      <AuthState
        message="Pengguna memiliki lebih dari satu akses aktif. Pilih akses yang dipertahankan."
        secondaryActionLabel="Keluar"
        onSecondaryAction={signOut}
      />
    )
  }

  return (
    <AuthContext.Provider value={{ session, user: session.user, authority, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

function AuthState({ message, actionLabel, onAction, secondaryActionLabel, onSecondaryAction }) {
  return (
    <div className="auth-page auth-state-page">
      <p>{message}</p>
      {actionLabel && <button type="button" className="ui-button ui-button-primary" onClick={onAction}>{actionLabel}</button>}
      {secondaryActionLabel && <button type="button" className="ui-button ui-button-secondary" onClick={onSecondaryAction}>{secondaryActionLabel}</button>}
    </div>
  )
}

function UpdatePasswordForm() {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setSuccess('')

    if (!password) {
      setError('Password wajib diisi.')
      return
    }
    if (password.length < 6) {
      setError('Password minimal 6 karakter.')
      return
    }
    if (password !== confirm) {
      setError('Konfirmasi password tidak cocok.')
      return
    }

    setSubmitting(true)
    const { error: updateErr } = await supabase.auth.updateUser({ password })
    setSubmitting(false)

    if (updateErr) {
      setError(updateErr.message)
      return
    }

    setSuccess('Password berhasil diperbarui. Anda akan dialihkan ke halaman login...')
    setTimeout(async () => {
      await supabase.auth.signOut()
      window.location.hash = ''
      window.location.reload()
    }, 2000)
  }

  return (
    <div className="auth-page">
      <form
        onSubmit={handleSubmit}
        className="auth-card"
      >
        <h2 className="auth-title">Buat Password Baru</h2>
        <p className="auth-help">
          Masukkan password baru Anda di bawah ini.
        </p>
        {error && (
          <p className="auth-message auth-message-danger">{error}</p>
        )}
        {success && (
          <p className="auth-message auth-message-success">{success}</p>
        )}
        <div className="auth-field">
          <label>
            Password Baru
          </label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
            className="ui-control"
          />
        </div>
        <div className="auth-field">
          <label>
            Konfirmasi Password
          </label>
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
            minLength={6}
            className="ui-control"
          />
        </div>
        <button
          type="submit"
          disabled={submitting || !!success}
          className="ui-button ui-button-primary auth-submit"
        >
          {submitting ? 'Menyimpan...' : 'Simpan Password'}
        </button>
      </form>
    </div>
  )
}

function ForgotPasswordForm({ initialUsername, onBack }) {
  const [username, setUsername] = useState(initialUsername)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  const handleSubmit = async (event) => {
    event.preventDefault()
    setSubmitting(true)
    setError('')
    await requestPasswordResetByUsername(username)
    setSubmitting(false)
    setError('')
    setSuccess(true)
  }

  return (
    <AuthFormShell title="Reset Password">
      <p className="auth-help">
        Masukkan username. Jika email pemulihan telah terverifikasi, tautan reset akan dikirim.
      </p>
      {error && <p className="auth-message auth-message-danger">{error}</p>}
      {success ? (
        <p className="auth-message auth-message-success">
          Jika akun memiliki email pemulihan terverifikasi, tautan reset akan dikirim.
        </p>
      ) : (
        <form onSubmit={handleSubmit}>
          <div className="auth-field">
            <label>Username</label>
            <input
              type="text"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              required
              autoComplete="username"
              className="ui-control"
            />
          </div>
          <button type="submit" disabled={submitting} className="ui-button ui-button-primary auth-submit">
            {submitting ? 'Mengirim...' : 'Kirim Tautan Reset Password'}
          </button>
        </form>
      )}
      <button type="button" className="ui-button ui-button-ghost auth-link" onClick={onBack}>Kembali ke Login</button>
    </AuthFormShell>
  )
}

function AuthFormShell({ title, children }) {
  return (
    <div className="auth-page">
      <div className="auth-card">
        <h2 className="auth-title">{title}</h2>
        {children}
      </div>
    </div>
  )
}

function SignInForm({ onSignIn, onForgotPassword, error }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSubmitting(true)
    await onSignIn(username, password)
    setSubmitting(false)
  }

  return (
    <div className="auth-page">
      <form
        onSubmit={handleSubmit}
        className="auth-card"
      >
        <h2 className="auth-title">Login SLA</h2>
        {error && (
          <p className="auth-message auth-message-danger">{error}</p>
        )}
        <div className="auth-field">
          <label>
            Username
          </label>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            autoComplete="username"
            className="ui-control"
          />
        </div>
        <div className="auth-field">
          <label>
            Password
          </label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
            className="ui-control"
          />
        </div>
        <button
          type="submit"
          disabled={submitting}
          className="ui-button ui-button-primary auth-submit"
        >
          {submitting ? 'Masuk...' : 'Masuk'}
        </button>
        <button
          type="button"
          onClick={() => onForgotPassword(username)}
          className="ui-button ui-button-ghost auth-link"
        >
          Lupa Password?
        </button>
      </form>
    </div>
  )
}
