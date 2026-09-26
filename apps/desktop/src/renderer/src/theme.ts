import { useSyncExternalStore } from 'react'
import { defaultTheme, installThemes, omarchyTheme } from './themes'

/**
 * How the app looks, per device: the style (Default or Omarchy), light or dark for Default,
 * and each style's colour theme (see themes.ts). One store, so the sidebar's switch and
 * Settings stay in step. Set on <html>: data-theme, data-scheme, data-palette, data-omarchy.
 */
export type Theme = 'default' | 'omarchy'

/**
 * Light or dark, for the Default style: "auto" follows the system; "light" and "dark" hold
 * whatever the system does. Omarchy themes are light or dark by their own nature.
 */
export type Scheme = 'auto' | 'light' | 'dark'

export interface Look {
  theme: Theme
  scheme: Scheme
  /** The Default style's colour theme. */
  palette: string
  /** The Omarchy style's colour theme. */
  omarchy: string
}

// A per-device preference: storage may be unavailable, so every access is guarded.
function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
function save(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // keep working without persistence
  }
}

export const storedTheme = (): Theme => (read('theme') === 'omarchy' ? 'omarchy' : 'default')
export function storedScheme(): Scheme {
  const v = read('scheme')
  return v === 'light' || v === 'dark' ? v : 'auto'
}
const storedLook = (): Look => ({
  theme: storedTheme(),
  scheme: storedScheme(),
  palette: defaultTheme(read('palette') ?? '').id,
  omarchy: omarchyTheme(read('palette:omarchy') ?? '').id,
})

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme
}
export function applyScheme(scheme: Scheme) {
  document.documentElement.dataset.scheme = scheme
}
function applyLook(l: Look) {
  installThemes()
  applyTheme(l.theme)
  applyScheme(l.scheme)
  document.documentElement.dataset.palette = l.palette
  document.documentElement.dataset.omarchy = l.omarchy
}

const systemIsDark = () => typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches

/** Whether a scheme shows dark right now. */
export const showsDark = (scheme: Scheme, systemDark = systemIsDark()) => scheme === 'dark' || (scheme === 'auto' && systemDark)

let look: Look | null = null
const listeners = new Set<() => void>()
const current = () => (look ??= storedLook())

/** Applies the stored look before first paint. */
export const applyStoredLook = () => applyLook(current())

export function setLook(change: Partial<Look>) {
  look = { ...current(), ...change }
  applyLook(look)
  save('theme', look.theme)
  save('scheme', look.scheme)
  save('palette', look.palette)
  save('palette:omarchy', look.omarchy)
  listeners.forEach((l) => l())
}

export function useLook(): Look {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => void listeners.delete(l)
    },
    current,
  )
}

export function useTheme() {
  const l = useLook()
  return {
    theme: l.theme,
    setTheme: (theme: Theme) => setLook({ theme }),
    toggle: () => setLook({ theme: current().theme === 'default' ? 'omarchy' : 'default' }),
    scheme: l.scheme,
    setScheme: (scheme: Scheme) => setLook({ scheme }),
    /** Flips what's showing now: dark to light, light to dark (the shortcut). */
    toggleDark: () => setLook({ scheme: showsDark(current().scheme) ? 'light' : 'dark' }),
  }
}
