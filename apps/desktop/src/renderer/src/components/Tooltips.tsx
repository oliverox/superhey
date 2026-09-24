import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

/** How long the pointer rests before the first tip shows; after that, neighbours show at once. */
const DELAY = 450
const WARM_FOR = 400
const GAP = 6
const EDGE = 8

interface Tip {
  text: string
  /** The shortcut from a `withShortcut` label ("Reply Later (r)"), drawn as a key. */
  key: string | null
  anchor: DOMRect
}

/**
 * The app's tooltips, mounted once. Any element with a `title` gets one: the native tip
 * (slow, and drawn by the OS) is suppressed by moving the text to `data-tip`, and a small
 * tip is drawn under the element instead (above it near the bottom of the window). Also
 * shown for keyboard focus. Components keep using plain `title=`.
 */
export function Tooltips() {
  const [tip, setTip] = useState<Tip | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const warmUntil = useRef(0)
  const current = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const hide = () => {
      window.clearTimeout(timer.current)
      if (current.current) warmUntil.current = Date.now() + WARM_FOR
      current.current = null
      setTip(null)
    }
    const show = (el: HTMLElement, immediate: boolean) => {
      const text = claim(el)
      if (!text) return
      window.clearTimeout(timer.current)
      current.current = el
      const open = () => {
        if (current.current !== el || !el.isConnected) return
        setTip({ ...splitShortcut(el.dataset.tip ?? text), anchor: el.getBoundingClientRect() })
      }
      if (immediate || Date.now() < warmUntil.current) open()
      else timer.current = window.setTimeout(open, DELAY)
    }

    const onOver = (e: PointerEvent) => {
      const el = target(e.target)
      if (el === current.current) return
      if (!el) return hide()
      show(el, false)
    }
    const onOut = (e: PointerEvent) => {
      // Moving within the element (onto its icon, say) isn't leaving it.
      if (current.current && e.relatedTarget instanceof Node && current.current.contains(e.relatedTarget)) return
      if (!target(e.relatedTarget)) hide()
    }
    const onFocus = (e: FocusEvent) => {
      const el = target(e.target)
      if (el && el.matches(':focus-visible')) show(el, false)
    }
    // Pressing, typing or scrolling means the tip has done its job.
    const cancel = () => {
      warmUntil.current = 0
      hide()
    }

    document.addEventListener('pointerover', onOver)
    document.addEventListener('pointerout', onOut)
    document.addEventListener('focusin', onFocus)
    document.addEventListener('focusout', hide)
    document.addEventListener('pointerdown', cancel, true)
    document.addEventListener('keydown', cancel, true)
    document.addEventListener('scroll', cancel, true)
    window.addEventListener('blur', cancel)
    return () => {
      window.clearTimeout(timer.current)
      document.removeEventListener('pointerover', onOver)
      document.removeEventListener('pointerout', onOut)
      document.removeEventListener('focusin', onFocus)
      document.removeEventListener('focusout', hide)
      document.removeEventListener('pointerdown', cancel, true)
      document.removeEventListener('keydown', cancel, true)
      document.removeEventListener('scroll', cancel, true)
      window.removeEventListener('blur', cancel)
    }
  }, [])

  return tip ? createPortal(<Bubble tip={tip} />, document.body) : null
}

function Bubble({ tip }: { tip: Tip }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number; above: boolean } | null>(null)

  // Measure, then place: centred under the anchor, flipped above near the bottom, kept on screen.
  useLayoutEffect(() => {
    const box = ref.current?.getBoundingClientRect()
    if (!box) return
    const a = tip.anchor
    const above = a.bottom + GAP + box.height > window.innerHeight - EDGE
    const left = Math.min(Math.max(a.left + a.width / 2 - box.width / 2, EDGE), window.innerWidth - box.width - EDGE)
    setPos({ left, top: above ? a.top - GAP - box.height : a.bottom + GAP, above })
  }, [tip])

  return (
    <div
      ref={ref}
      role="tooltip"
      className="tooltip"
      data-above={pos?.above}
      style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: 0, visibility: 'hidden' }}
    >
      <span>{tip.text}</span>
      {tip.key && <kbd className="tooltip-key">{tip.key}</kbd>}
    </div>
  )
}

/** The nearest element with a tip, from an event target. */
function target(node: EventTarget | null): HTMLElement | null {
  if (!(node instanceof Element)) return null
  return node.closest<HTMLElement>('[title], [data-tip]')
}

/**
 * Takes an element's `title` for our tip (so the OS doesn't draw its own), keeping it as
 * the accessible name when the element has no other.
 */
function claim(el: HTMLElement): string | null {
  const title = el.getAttribute('title')
  if (title != null) {
    el.removeAttribute('title')
    if (title.trim()) {
      el.dataset.tip = title
      if (!el.hasAttribute('aria-label') && !el.textContent?.trim()) el.setAttribute('aria-label', title)
    }
  }
  return el.dataset.tip?.trim() || null
}

/** "Reply Later (r)" → text and key. Only short parentheticals count as keys. */
export function splitShortcut(label: string): { text: string; key: string | null } {
  const m = /^(.*\S)\s+\(([^()\s]{1,8})\)$/.exec(label)
  return m ? { text: m[1]!, key: m[2]! } : { text: label, key: null }
}
