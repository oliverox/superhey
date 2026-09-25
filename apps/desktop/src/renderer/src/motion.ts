import { useEffect, useState } from 'react'

/** The motion tokens from styles.css, for code that has to wait on them. */
export const DUR = { fast: 120, base: 180, slow: 220 }

/** Whether motion is off: the system asks for less, or the theme is instant (Omarchy). */
export function motionOff(): boolean {
  if (typeof document !== 'undefined' && document.documentElement.dataset.theme === 'omarchy') return true
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * Keeps something mounted long enough to animate out. `mounted`: render it; `shown`: it's
 * in its open state (false for one frame on the way in, so a transition runs from closed).
 */
export function usePresence(show: boolean, ms = DUR.slow) {
  const [mounted, setMounted] = useState(show)
  const [shown, setShown] = useState(show)
  useEffect(() => {
    if (show) {
      setMounted(true)
      // Next frame: open, so the transition starts from the closed state.
      const f = requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)))
      return () => cancelAnimationFrame(f)
    }
    setShown(false)
    const t = setTimeout(() => setMounted(false), motionOff() ? 0 : ms)
    return () => clearTimeout(t)
  }, [show, ms])
  return { mounted, shown }
}
