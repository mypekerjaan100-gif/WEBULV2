import { createContext, useContext, useEffect, useState } from 'react'

const STORAGE_KEY = 'pln-nd-theme'
const SYSTEM_QUERY = '(prefers-color-scheme: dark)'
const THEMES = new Set(['light', 'dark', 'system'])
const ThemeContext = createContext(null)

function storedPreference() {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY)
    return THEMES.has(value) ? value : 'system'
  } catch {
    return 'system'
  }
}

function systemPrefersDark() {
  return window.matchMedia?.(SYSTEM_QUERY).matches === true
}

export function ThemeProvider({ children }) {
  const [preference, setPreferenceState] = useState(storedPreference)
  const [systemDark, setSystemDark] = useState(systemPrefersDark)
  const resolvedTheme = preference === 'system' ? (systemDark ? 'dark' : 'light') : preference

  useEffect(() => {
    const media = window.matchMedia?.(SYSTEM_QUERY)
    if (!media) return undefined
    const handleChange = (event) => setSystemDark(event.matches)
    if (media.addEventListener) media.addEventListener('change', handleChange)
    else media.addListener?.(handleChange)
    return () => {
      if (media.removeEventListener) media.removeEventListener('change', handleChange)
      else media.removeListener?.(handleChange)
    }
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme
    try {
      window.localStorage.setItem(STORAGE_KEY, preference)
    } catch {
      // Theme storage is optional; the active preference still applies for this session.
    }
  }, [preference, resolvedTheme])

  useEffect(() => {
    const handleStorage = (event) => {
      if (event.key === STORAGE_KEY || event.key === null) {
        setPreferenceState(THEMES.has(event.newValue) ? event.newValue : storedPreference())
      }
    }
    window.addEventListener('storage', handleStorage)
    return () => window.removeEventListener('storage', handleStorage)
  }, [])

  const setPreference = (value) => {
    if (THEMES.has(value)) setPreferenceState(value)
  }

  return (
    <ThemeContext.Provider value={{ preference, resolvedTheme, setPreference }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const value = useContext(ThemeContext)
  if (!value) throw new Error('useTheme must be used within ThemeProvider')
  return value
}

export { STORAGE_KEY as THEME_STORAGE_KEY }
