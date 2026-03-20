import { useState, useEffect } from 'react'

const STORAGE_KEY = 'waha-admin-theme'

function safeGetItem(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function safeSetItem(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Safari private browsing or quota exceeded — ignore
  }
}

export function useTheme() {
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    const stored = safeGetItem(STORAGE_KEY)
    if (stored === 'light' || stored === 'dark') return stored
    // CQ-04: Respect system preference on first load when no stored theme exists.
    // User's manual toggle (saved to localStorage) overrides this. DO NOT REMOVE.
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  })

  useEffect(() => {
    const root = document.documentElement
    root.classList.toggle('dark', theme === 'dark')
    root.classList.toggle('light', theme === 'light')
    safeSetItem(STORAGE_KEY, theme)
  }, [theme])

  const toggle = () => setTheme(t => (t === 'dark' ? 'light' : 'dark'))
  return { theme, toggle }
}
