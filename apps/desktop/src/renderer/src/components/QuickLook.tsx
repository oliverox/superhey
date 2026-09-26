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

/**
 * Quick Look for attachments: a PDF's pages or an image, full size, over the app. Space or
 * Esc closes it; ← and → move through the message's files; "Open in app" hands it over.
 */
export function QuickLook({ files, index, onIndex, onClose }: { files: AttachmentRow[]; index: number; onIndex: (i: number) => void; onClose: () => void }) {
  const a = files[index]!
  const dialog = useRef<HTMLDivElement>(null)
  const [openError, setOpenError] = useState<string | null>(null)

  useEffect(() => {
    dialog.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || (e.key === ' ' && !(e.target instanceof HTMLInputElement))) {
        e.preventDefault()
        e.stopPropagation()
        onClose()
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

  // The page you're on, from where the reading is scrolled (PDFs).
  const scroller = useRef<HTMLDivElement>(null)
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
        className="scroll absolute inset-0 overflow-y-auto px-6 pt-[76px] pb-16"
      >
        {isPdf(a) ? <PdfPages key={a.id} id={a.id} onPages={(of) => setPage({ at: 1, of })} /> : <ImageView key={a.id} id={a.id} name={a.filename} />}
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

function ImageView({ id, name }: { id: string; name: string }) {
  return (
    <div className="flex min-h-full items-center justify-center">
      <img data-sheet src={fileUrl(id)} alt={name} className="ql-sheet checker rise max-h-[calc(100vh-140px)] max-w-full object-contain" draggable={false} />
    </div>
  )
}

/** Every page (up to MAX_PAGES), rendered at the preview's width for this screen. */
function PdfPages({ id, onPages }: { id: string; onPages: (count: number) => void }) {
  const box = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<{ pages: number; shown: number; error: string | null }>({ pages: 0, shown: 0, error: null })

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
      const doc = await task.promise
      const count = Math.min(doc.numPages, MAX_PAGES)
      setState({ pages: doc.numPages, shown: 0, error: null })
      onPages(count)
      // A comfortable reading width for a page: not the whole window.
      const width = Math.min(host.clientWidth, 860)
      for (let n = 1; n <= count && !controller.signal.aborted; n++) {
        const page = await doc.getPage(n)
        const base = page.getViewport({ scale: 1 })
        const scale = (width * (window.devicePixelRatio || 1)) / base.width
        const viewport = page.getViewport({ scale })
        const canvas = document.createElement('canvas')
        canvas.width = Math.floor(viewport.width)
        canvas.height = Math.floor(viewport.height)
        canvas.style.width = `${width}px`
        canvas.className = 'block bg-white'
        canvas.setAttribute('aria-label', `Page ${n}`)
        await page.render({ canvas, viewport }).promise
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

  return (
    <div ref={box} className="mx-auto max-w-[860px]">
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
