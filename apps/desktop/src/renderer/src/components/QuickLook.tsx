import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { AttachmentRow } from '@shared/api'
import { api, fileUrl } from '../api'

/** What the preview can show in place; everything else opens in its own app. */
export const canPreview = (a: AttachmentRow) => isPdf(a) || isImage(a)
export const isPdf = (a: AttachmentRow) => a.contentType === 'application/pdf' || /\.pdf$/i.test(a.filename)
export const isImage = (a: AttachmentRow) => /^image\/(png|jpe?g|gif|webp|avif|bmp)$/.test(a.contentType ?? '')

/** Pages rendered in the preview; a longer PDF says so and offers its own app. */
const MAX_PAGES = 40

/** Zoom steps, relative to the page at its reading width (100%). */
export const ZOOMS = [0.5, 0.67, 0.8, 1, 1.25, 1.5, 2, 2.5, 3]
export function nextZoom(z: number, dir: 1 | -1): number {
  return dir > 0 ? (ZOOMS.find((s) => s > z + 0.001) ?? ZOOMS.at(-1)!) : ([...ZOOMS].reverse().find((s) => s < z - 0.001) ?? ZOOMS[0]!)
}

/**
 * Quick Look for attachments: a PDF's pages or an image, full size, over the app. Space or
 * Esc closes it; ← and → move through the message's files; "Open in app" hands it over.
 */
export function QuickLook({ files, index, onIndex, onClose }: { files: AttachmentRow[]; index: number; onIndex: (i: number) => void; onClose: () => void }) {
  const a = files[index]!
  const dialog = useRef<HTMLDivElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const [openError, setOpenError] = useState<string | null>(null)
  const [zoom, setZoomNow] = useState(1)
  const zoomRef = useRef(zoom)
  zoomRef.current = zoom
  useEffect(() => setZoomNow(1), [a.id])
  /** Zooms keeping the middle of what you're reading in the middle. */
  const setZoom = (z: number) => {
    const root = scroller.current
    const from = zoomRef.current
    if (z === from) return
    const cx = root ? root.scrollLeft + root.clientWidth / 2 : 0
    const cy = root ? root.scrollTop + root.clientHeight / 2 : 0
    setZoomNow(z)
    requestAnimationFrame(() => {
      if (!root) return
      root.scrollLeft = cx * (z / from) - root.clientWidth / 2
      root.scrollTop = cy * (z / from) - root.clientHeight / 2
    })
  }
  const setZoomRef = useRef(setZoom)
  setZoomRef.current = setZoom

  useEffect(() => {
    dialog.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || (e.key === ' ' && !(e.target instanceof HTMLInputElement))) {
        e.preventDefault()
        e.stopPropagation()
        onClose()
      } else if (e.key === '+' || e.key === '=' || e.key === '-' || e.key === '_' || (e.key === '0' && (e.metaKey || e.ctrlKey || !e.altKey))) {
        // + and − zoom (with or without ⌘), 0 goes back to the reading width.
        e.preventDefault()
        e.stopPropagation()
        setZoomRef.current(e.key === '0' ? 1 : nextZoom(zoomRef.current, e.key === '+' || e.key === '=' ? 1 : -1))
      } else if (e.key === 'ArrowRight' && files.length > 1) {
        e.preventDefault()
        e.stopPropagation()
        onIndex((index + 1) % files.length)
      } else if (e.key === 'ArrowLeft' && files.length > 1) {
        e.preventDefault()
        e.stopPropagation()
        onIndex((index - 1 + files.length) % files.length)
      }
    }
    // Capture: ahead of the app's own keys (Esc leaving search, arrows moving the list).
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [files.length, index, onClose, onIndex])

  // Pinching the trackpad (or ⌘/Ctrl + scroll) zooms smoothly between the steps' ends.
  useEffect(() => {
    const root = scroller.current
    if (!root) return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      const z = Math.min(ZOOMS.at(-1)!, Math.max(ZOOMS[0]!, zoomRef.current * Math.exp(-e.deltaY / 200)))
      setZoomRef.current(Math.round(z * 100) / 100)
    }
    root.addEventListener('wheel', onWheel, { passive: false })
    return () => root.removeEventListener('wheel', onWheel)
  }, [])

  // The page you're on, from where the reading is scrolled (PDFs).
  const [page, setPage] = useState({ at: 1, of: 0 })
  const onScroll = () => {
    const root = scroller.current
    if (!root) return
    const sheets = [...root.querySelectorAll<HTMLElement>('[data-page]')]
    const middle = root.scrollTop + root.clientHeight / 2
    const at = sheets.filter((el) => el.offsetTop <= middle).length || 1
    setPage((p) => (p.at === at ? p : { ...p, at }))
  }
  const previous = () => onIndex((index - 1 + files.length) % files.length)
  const next = () => onIndex((index + 1) % files.length)

  // Drawn at the top of the page: inside a message, an animated (transformed) ancestor would
  // hold "fixed" to itself and trap the preview in the reading column.
  // A reading desk: the app stays behind, blurred and dimmed, and the document lies on it as
  // sheets of paper, with a slim toolbar floating above. Clicking the desk puts it away.
  return createPortal(
    <div ref={dialog} role="dialog" aria-label={`Preview of ${a.filename}`} tabIndex={-1} className="ql-desk fade-in fixed inset-0 z-[70] outline-none">
      <div
        ref={scroller}
        onScroll={onScroll}
        onMouseDown={(e) => !(e.target as HTMLElement).closest('[data-page], [data-sheet]') && onClose()}
        className="scroll absolute inset-0 overflow-auto px-6 pt-[76px] pb-16"
      >
        {isPdf(a) ? <PdfPages key={a.id} id={a.id} zoom={zoom} onPages={(of) => setPage({ at: 1, of })} /> : <ImageView key={a.id} id={a.id} name={a.filename} zoom={zoom} />}
      </div>

      <header className="ql-bar pop-in absolute top-4 left-1/2 flex max-w-[calc(100vw-32px)] -translate-x-1/2 items-center gap-1 rounded-full py-1 pr-1 pl-3.5 text-[13px]">
        <FileGlyph pdf={isPdf(a)} />
        <span className="ml-1.5 min-w-0 truncate font-medium text-ink" title={a.filename}>
          {a.filename}
        </span>
        {isPdf(a) && page.of > 0 && (
          <span className="ml-2 shrink-0 text-[12px] text-ink-faint tabular-nums">
            Page {page.at} of {page.of}
          </span>
        )}
        <span className="mx-2 h-4 w-px shrink-0 bg-rule" aria-hidden />
        <span className="flex shrink-0 items-center text-[12px] text-ink-faint">
          <BarButton onClick={() => setZoom(nextZoom(zoom, -1))} label="Zoom out" title="Zoom out (−)">
            <path d="M3.5 8h9" />
          </BarButton>
          <button
            onClick={() => setZoom(1)}
            title="Actual reading size (0)"
            className="min-w-[3.25em] rounded-full px-1 py-0.5 text-center tabular-nums hover:bg-pane-sunk hover:text-ink"
          >
            {Math.round(zoom * 100)}%
          </button>
          <BarButton onClick={() => setZoom(nextZoom(zoom, 1))} label="Zoom in" title="Zoom in (+)">
            <path d="M3.5 8h9M8 3.5v9" />
          </BarButton>
        </span>
        <span className="mx-2 h-4 w-px shrink-0 bg-rule" aria-hidden />
        {files.length > 1 && (
          <span className="flex shrink-0 items-center text-[12px] text-ink-faint">
            <BarButton onClick={previous} label="Previous file" title="Previous (←)">
              <path d="M10 3.5 5.5 8l4.5 4.5" />
            </BarButton>
            <span className="px-0.5 tabular-nums">
              {index + 1} of {files.length}
            </span>
            <BarButton onClick={next} label="Next file" title="Next (→)">
              <path d="m6 3.5 4.5 4.5L6 12.5" />
            </BarButton>
          </span>
        )}
        <button
          onClick={() => api.openAttachment(a.id).then(() => setOpenError(null), (e: unknown) => setOpenError(e instanceof Error ? e.message : String(e)))}
          title={openError ?? 'Open in its own app'}
          className={`shrink-0 rounded-full px-3 py-1 font-medium ${openError ? 'text-danger' : 'text-ink-soft hover:bg-pane-sunk hover:text-ink'}`}
        >
          {openError ? "Couldn't open" : 'Open in app'}
        </button>
        <BarButton onClick={onClose} label="Close preview" title="Close (Space or Esc)">
          <path d="m4 4 8 8m0-8-8 8" />
        </BarButton>
      </header>
    </div>,
    document.body,
  )
}

function BarButton({ onClick, label, title, children }: { onClick: () => void; label: string; title: string; children: React.ReactNode }) {
  return (
    <button onClick={onClick} aria-label={label} title={title} className="flex size-7 shrink-0 items-center justify-center rounded-full text-ink-faint hover:bg-pane-sunk hover:text-ink">
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {children}
      </svg>
    </button>
  )
}

/** A folded-corner sheet (PDF, marked red) or a picture frame. */
function FileGlyph({ pdf }: { pdf: boolean }) {
  return pdf ? (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden className="shrink-0">
      <path d="M4 1.75h5.25L12.5 5v9.25H4z" fill="var(--pane)" stroke="var(--ink-faint)" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M9.25 1.75V5h3.25" stroke="var(--ink-faint)" strokeWidth="1.2" strokeLinejoin="round" />
      <rect x="2.5" y="8.25" width="7.5" height="4" rx="1" fill="#d93a30" />
    </svg>
  ) : (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden className="shrink-0 text-ink-faint">
      <rect x="2" y="3" width="12" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="m3 11.5 3.5-3.5 2.5 2.5 1.5-1.5 2.5 2.5" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  )
}

function ImageView({ id, name, zoom }: { id: string; name: string; zoom: number }) {
  // 100% fits the window; zooming scales from that size.
  const [fit, setFit] = useState<number | null>(null)
  return (
    <div className="flex min-h-full w-max min-w-full items-center justify-center">
      <img
        data-sheet
        src={fileUrl(id)}
        alt={name}
        onLoad={(e) => setFit(e.currentTarget.getBoundingClientRect().width)}
        style={fit && zoom !== 1 ? { width: fit * zoom, maxWidth: 'none', maxHeight: 'none' } : undefined}
        className="ql-sheet checker rise max-h-[calc(100vh-140px)] max-w-full object-contain"
        draggable={false}
      />
    </div>
  )
}

/** Every page (up to MAX_PAGES), rendered at the preview's width for this screen. */
function PdfPages({ id, zoom, onPages }: { id: string; zoom: number; onPages: (count: number) => void }) {
  const box = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<{ pages: number; shown: number; error: string | null }>({ pages: 0, shown: 0, error: null })
  // The page's width at 100%, and how sharp the canvases are drawn (as a zoom), for zooming.
  const doc = useRef<{ width: number; drawnAt: number; zoom: number; draw: (canvas: HTMLCanvasElement, n: number, at: number) => Promise<void> } | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    const host = box.current!
    let destroy = () => {}
    ;(async () => {
      const pdfjs = await import('../pdf')
      // pdf.js only streams http(s); the attachment comes from the app's own scheme.
      const res = await fetch(fileUrl(id), { signal: controller.signal })
      if (!res.ok) throw new Error(`couldn't read the file (${res.status})`)
      const task = pdfjs.getDocument({ data: new Uint8Array(await res.arrayBuffer()), useWasm: false })
      destroy = () => void task.destroy()
      const pdf = await task.promise
      const count = Math.min(pdf.numPages, MAX_PAGES)
      setState({ pages: pdf.numPages, shown: 0, error: null })
      onPages(count)
      // A comfortable reading width for a page: not the whole window.
      const width = Math.min(host.parentElement!.clientWidth - 48, 860)
      /** Draws page n into `canvas`, sharp at zoom `at`. */
      const draw = async (canvas: HTMLCanvasElement, n: number, at: number) => {
        const page = await pdf.getPage(n)
        const base = page.getViewport({ scale: 1 })
        const viewport = page.getViewport({ scale: (width * at * (window.devicePixelRatio || 1)) / base.width })
        const next = document.createElement('canvas')
        next.width = Math.floor(viewport.width)
        next.height = Math.floor(viewport.height)
        await page.render({ canvas: next, viewport }).promise
        canvas.width = next.width
        canvas.height = next.height
        canvas.getContext('2d')!.drawImage(next, 0, 0)
      }
      const drawnAt = Math.max(1, zoomNow.current)
      doc.current = { width, drawnAt, zoom: zoomNow.current, draw }
      for (let n = 1; n <= count && !controller.signal.aborted; n++) {
        const canvas = document.createElement('canvas')
        canvas.style.width = `${width * zoomNow.current}px`
        canvas.className = 'block bg-white'
        canvas.setAttribute('aria-label', `Page ${n}`)
        await draw(canvas, n, drawnAt)
        if (controller.signal.aborted) return
        // A sheet on the desk, with its number underneath.
        const sheet = document.createElement('figure')
        sheet.dataset.page = String(n)
        sheet.className = 'ql-page rise mx-auto mb-3 w-fit'
        const paper = document.createElement('div')
        paper.className = 'ql-sheet'
        paper.append(canvas)
        const number = document.createElement('figcaption')
        number.className = 'ql-number'
        number.textContent = String(n)
        sheet.append(paper, number)
        host.querySelector('[data-pages]')!.append(sheet)
        setState((s) => ({ ...s, shown: n }))
      }
    })().catch((e: unknown) => {
      if (!controller.signal.aborted) setState((s) => ({ ...s, error: e instanceof Error ? e.message : String(e) }))
    })
    return () => {
      controller.abort()
      destroy()
    }
  }, [id])

  // Zooming: the pages resize at once, then are drawn again sharper when zoomed past what
  // they were drawn for (a moment later, once the zooming settles).
  const zoomNow = useRef(zoom)
  zoomNow.current = zoom
  useEffect(() => {
    const d = doc.current
    const host = box.current
    if (!d || !host) return
    const canvases = [...host.querySelectorAll<HTMLCanvasElement>('[data-page] canvas')]
    for (const c of canvases) c.style.width = `${d.width * zoom}px`
    if (zoom <= d.drawnAt + 0.01) return
    const t = setTimeout(() => {
      d.drawnAt = zoom
      void (async () => {
        for (const [i, c] of canvases.entries()) {
          if (d.drawnAt !== zoom) return
          await d.draw(c, i + 1, zoom)
        }
      })()
    }, 250)
    return () => clearTimeout(t)
  }, [zoom])

  return (
    <div ref={box} className="mx-auto w-max min-w-full">
      <div data-pages />
      {state.error ? (
        <p data-sheet className="ql-note mx-auto w-fit text-danger">Couldn't show this PDF: {state.error}. Try “Open in app”.</p>
      ) : state.shown < Math.min(state.pages, MAX_PAGES) || !state.pages ? (
        <p className="ql-note mx-auto w-fit text-[13px]">Loading{state.pages ? ` page ${state.shown + 1} of ${state.pages}` : '…'}</p>
      ) : state.pages > MAX_PAGES ? (
        <p data-sheet className="ql-note mx-auto w-fit text-[13px]">
          Showing the first {MAX_PAGES} of {state.pages} pages. “Open in app” for the rest.
        </p>
      ) : null}
    </div>
  )
}
