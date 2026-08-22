import { useState, useEffect, createContext, useContext } from 'react'
import { supabase } from './supabaseClient.js'
import { callUserManagement } from './userManagement.js'

const AuthContext = createContext(null)

export function useAuth() {
  return useContext(AuthContext)
}

async function resolveAuthority() {
  try {
    const { data, error } = await callUserManagement('session_context')
    if (error) return { actor: null, error }
    if (!data?.actor) return { actor: null, error: 'Otoritas akun tidak tersedia.' }
    return { actor: data.actor, error: null }
  } catch {
    return { actor: null, error: 'Gagal memverifikasi otoritas akun.' }
  }
}

export default function AppAuth({ children }) {
  const [session, setSession] = useState(null)
  const [view, setView] = useState('loading')
  const [error, setError] = useState(null)
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
    resolveAuthority().then(({ actor, error: capabilityError }) => {
      if (cancelled) return
      setAuthority({
        loading: false,
        actor,
        error: capabilityError,
      })
    })

    return () => { cancelled = true }
  }, [session?.user?.id])

  const signIn = async (email, password) => {
    setError(null)
    const { data, error: authErr } = await supabase.auth.signInWithPassword({
      email,
      password,
    })
    if (authErr) {
      setError(authErr.message)
      return false
    }
    setAuthority({ loading: true, actor: null, error: null })
    setSession(data.session)
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
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          height: '100vh',
          fontFamily: 'sans-serif',
        }}
      >
        <p>Memuat sesi...</p>
      </div>
    )
  }

  if (view === 'recovery') {
    return <UpdatePasswordForm />
  }

  if (view === 'signin' || !session) {
    return <SignInForm onSignIn={signIn} error={error} />
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
          resolveAuthority().then(({ actor, error: capabilityError }) => {
            setAuthority({ loading: false, actor, error: capabilityError })
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
        message="Akun Anda sudah aktif, tetapi akses belum diberikan. Silakan hubungi administrator."
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
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        gap: 12,
        height: '100vh',
        fontFamily: 'sans-serif',
      }}
    >
      <p>{message}</p>
      {actionLabel && <button type="button" onClick={onAction}>{actionLabel}</button>}
      {secondaryActionLabel && <button type="button" onClick={onSecondaryAction}>{secondaryActionLabel}</button>}
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
    <div
      style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        height: '100vh',
        fontFamily: 'sans-serif',
      }}
    >
      <form
        onSubmit={handleSubmit}
        style={{
          minWidth: 320,
          padding: 24,
          border: '1px solid #ddd',
          borderRadius: 8,
        }}
      >
        <h2 style={{ marginTop: 0 }}>Buat Password Baru</h2>
        <p style={{ fontSize: 14, color: '#555', marginTop: 0 }}>
          Masukkan password baru Anda di bawah ini.
        </p>
        {error && (
          <p style={{ color: '#d32f2f', fontSize: 14 }}>{error}</p>
        )}
        {success && (
          <p style={{ color: '#2e7d32', fontSize: 14 }}>{success}</p>
        )}
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', fontSize: 14, marginBottom: 4 }}>
            Password Baru
          </label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
            style={{ width: '100%', padding: '8px', boxSizing: 'border-box' }}
          />
        </div>
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', fontSize: 14, marginBottom: 4 }}>
            Konfirmasi Password
          </label>
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
            minLength={6}
            style={{ width: '100%', padding: '8px', boxSizing: 'border-box' }}
          />
        </div>
        <button
          type="submit"
          disabled={submitting || !!success}
          style={{
            width: '100%',
            padding: '10px',
            backgroundColor: '#1976d2',
            color: '#fff',
            border: 'none',
            borderRadius: 4,
            cursor: 'pointer',
            fontSize: 14,
          }}
        >
          {submitting ? 'Menyimpan...' : 'Simpan Password'}
        </button>
      </form>
    </div>
  )
}

function SignInForm({ onSignIn, error }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSubmitting(true)
    await onSignIn(email, password)
    setSubmitting(false)
  }

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        height: '100vh',
        fontFamily: 'sans-serif',
      }}
    >
      <form
        onSubmit={handleSubmit}
        style={{
          minWidth: 320,
          padding: 24,
          border: '1px solid #ddd',
          borderRadius: 8,
        }}
      >
        <h2 style={{ marginTop: 0 }}>Login SLA</h2>
        {error && (
          <p style={{ color: '#d32f2f', fontSize: 14 }}>{error}</p>
        )}
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', fontSize: 14, marginBottom: 4 }}>
            Email
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            style={{ width: '100%', padding: '8px', boxSizing: 'border-box' }}
          />
        </div>
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', fontSize: 14, marginBottom: 4 }}>
            Password
          </label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            style={{ width: '100%', padding: '8px', boxSizing: 'border-box' }}
          />
        </div>
        <button
          type="submit"
          disabled={submitting}
          style={{
            width: '100%',
            padding: '10px',
            backgroundColor: '#1976d2',
            color: '#fff',
            border: 'none',
            borderRadius: 4,
            cursor: 'pointer',
            fontSize: 14,
          }}
        >
          {submitting ? 'Masuk...' : 'Masuk'}
        </button>
      </form>
    </div>
  )
}
