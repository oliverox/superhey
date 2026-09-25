import { useEffect, useState } from 'react'

export type Theme = 'default' | 'omarchy'
const KEY = 'theme'

// A per-device preference: storage may be unavailable, so every access is guarded.
export function storedTheme(): Theme {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'omarchy' ? 'omarchy' : 'default'
  } catch {
    return 'default'
  }
}

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme
}

/**
 * Light or dark, for the Default theme: "auto" follows the system; "light" and "dark" hold
 * whatever the system does. Set on <html data-scheme>; Omarchy is always dark.
 */
export type Scheme = 'auto' | 'light' | 'dark'
const SCHEME_KEY = 'scheme'

export function storedScheme(): Scheme {
  try {
    const v = localStorage.getItem(SCHEME_KEY)
    return v === 'light' || v === 'dark' ? v : 'auto'
  } catch {
    return 'auto'
  }
}

export function applyScheme(scheme: Scheme) {
  document.documentElement.dataset.scheme = scheme
}

const systemIsDark = () => typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches

/** Whether a scheme shows dark right now. */
export const showsDark = (scheme: Scheme, systemDark = systemIsDark()) => scheme === 'dark' || (scheme === 'auto' && systemDark)

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(storedTheme)
  const [scheme, setScheme] = useState<Scheme>(storedScheme)
  useEffect(() => {
    applyTheme(theme)
    save(KEY, theme)
  }, [theme])
  useEffect(() => {
    applyScheme(scheme)
    save(SCHEME_KEY, scheme)
  }, [scheme])
  const toggle = () => setTheme((t) => (t === 'default' ? 'omarchy' : 'default'))
  /** Flips what's showing now: dark to light, light to dark (the shortcut). */
  const toggleDark = () => setScheme((s) => (showsDark(s) ? 'light' : 'dark'))
  return { theme, setTheme, toggle, scheme, setScheme, toggleDark }
}

function save(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // keep working without persistence
  }
}
