import { useState, useEffect, createContext, useContext } from 'react'
import { supabase } from './supabaseClient.js'

const AuthContext = createContext(null)

export function useAuth() {
  return useContext(AuthContext)
}

export default function AppAuth({ children }) {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s)
      setLoading(false)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s)
    })

    return () => subscription.unsubscribe()
  }, [])

  const signIn = async (email, password) => {
    setError(null)
    const { error: authErr } = await supabase.auth.signInWithPassword({
      email,
      password,
    })
    if (authErr) {
      setError(authErr.message)
      return false
    }
    return true
  }

  const signOut = async () => {
    await supabase.auth.signOut()
  }

  if (loading) {
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

  if (!session) {
    return <SignInForm onSignIn={signIn} error={error} />
  }

  return (
    <AuthContext.Provider value={{ session, user: session.user, signOut }}>
      {children}
    </AuthContext.Provider>
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
