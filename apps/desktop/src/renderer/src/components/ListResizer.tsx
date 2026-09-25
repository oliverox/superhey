import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from 'react'

/** The message list's width: dragged by its right edge, remembered on this device. */
export const LIST_WIDTH = { min: 300, max: 720, initial: 400, step: 16 }
const KEY = 'list:width'

export const clampListWidth = (w: number, windowWidth = typeof window === 'undefined' ? 1600 : window.innerWidth) =>
  // Leave the sidebar (232) and a readable reader (at least 420) whatever the window.
  Math.round(Math.min(Math.max(w, LIST_WIDTH.min), LIST_WIDTH.max, Math.max(LIST_WIDTH.min, windowWidth - 232 - 420)))

function stored(): number {
  try {
    const v = Number(localStorage.getItem(KEY))
    return Number.isFinite(v) && v > 0 ? clampListWidth(v) : LIST_WIDTH.initial
  } catch {
    return LIST_WIDTH.initial
  }
}

/** The width, and a setter that saves it. */
export function useListWidth() {
  const [width, setWidth] = useState(stored)
  const save = useCallback((w: number) => {
    const next = clampListWidth(w)
    setWidth(next)
    try {
      localStorage.setItem(KEY, String(next))
    } catch {
      // keep working without persistence
    }
  }, [])
  // A smaller window can't keep a wide list.
  useEffect(() => {
    const onResize = () => setWidth((w) => clampListWidth(w))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return { width, save }
}

/**
 * The handle on the list's right edge. While dragging it writes the width straight to the
 * grid's `--list-w` (no re-render per pixel); the width is saved on release. Arrow keys
 * nudge it, double-click puts it back.
 */
export function ListResizer({ gridRef, width, onResize }: { gridRef: RefObject<HTMLElement | null>; width: number; onResize: (w: number) => void }) {
  const drag = useRef<{ x: number; w: number; now: number } | null>(null)
  const [dragging, setDragging] = useState(false)

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { x: e.clientX, w: width, now: width }
    setDragging(true)
  }
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d) return
    d.now = clampListWidth(d.w + e.clientX - d.x)
    gridRef.current?.style.setProperty('--list-w', `${d.now}px`)
  }
  const end = () => {
    const d = drag.current
    if (!d) return
    drag.current = null
    setDragging(false)
    onResize(d.now)
  }
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const delta = e.key === 'ArrowLeft' ? -LIST_WIDTH.step : e.key === 'ArrowRight' ? LIST_WIDTH.step : 0
    if (!delta) return
    e.preventDefault()
    onResize(width + delta)
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the list"
      aria-valuemin={LIST_WIDTH.min}
      aria-valuemax={LIST_WIDTH.max}
      aria-valuenow={width}
      tabIndex={0}
      title="Drag to resize · double-click to reset"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onDoubleClick={() => onResize(LIST_WIDTH.initial)}
      onKeyDown={onKeyDown}
      className="no-drag group absolute inset-y-0 -right-[3px] z-20 w-[7px] cursor-col-resize outline-none"
    >
      {/* A hairline that lights up while you hover or drag. */}
      <span
        aria-hidden
        className={`absolute inset-y-0 left-[3px] w-px transition-colors duration-(--dur-1) group-hover:bg-accent/60 group-focus-visible:bg-accent ${dragging ? 'bg-accent' : 'bg-transparent'}`}
      />
    </div>
  )
}
