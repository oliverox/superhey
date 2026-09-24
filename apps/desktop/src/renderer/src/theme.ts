import { useEffect, useState } from 'react'

export type Theme = 'default' | 'omarchy'
export const THEMES: Array<{ id: Theme; label: string }> = [
  { id: 'default', label: 'Default' },
  { id: 'omarchy', label: 'Omarchy' },
]

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

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(storedTheme)
  useEffect(() => {
    applyTheme(theme)
    try {
      localStorage.setItem(KEY, theme)
    } catch {
      // keep working without persistence
    }
  }, [theme])
  const toggle = () => setTheme((t) => (t === 'default' ? 'omarchy' : 'default'))
  return { theme, setTheme, toggle }
}
