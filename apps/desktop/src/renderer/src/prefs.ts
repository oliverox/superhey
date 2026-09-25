import { useSyncExternalStore } from 'react'

/**
 * Reading preferences, kept on this device. Read at the moment they matter (so a change in
 * Settings applies at once) and subscribed to where they're shown.
 */

const MARK_SEEN_KEY = 'pref:mark-seen-on-open'
const EVENT = 'superhey:prefs'

/** Whether opening an email marks it seen (as HEY does), rather than leaving that to you. */
export function markSeenOnOpen(): boolean {
  try {
    return localStorage.getItem(MARK_SEEN_KEY) !== 'false'
  } catch {
    return true
  }
}

export function setMarkSeenOnOpen(on: boolean) {
  try {
    localStorage.setItem(MARK_SEEN_KEY, String(on))
  } catch {
    // keep working without persistence
  }
  window.dispatchEvent(new Event(EVENT))
}

export function useMarkSeenOnOpen(): boolean {
  return useSyncExternalStore(
    (changed) => {
      window.addEventListener(EVENT, changed)
      return () => window.removeEventListener(EVENT, changed)
    },
    markSeenOnOpen,
  )
}
