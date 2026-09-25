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

  // Drawn at the top of the page: inside a message, an animated (transformed) ancestor would
  // hold "fixed" to itself and trap the preview in the reading column.
  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-6" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={dialog}
        role="dialog"
        aria-label={`Preview of ${a.filename}`}
        tabIndex={-1}
        className="rise flex h-[90vh] w-[min(1040px,94vw)] flex-col overflow-hidden rounded-ui-lg border border-rule-strong bg-pane shadow-[0_24px_64px_-24px_rgba(0,0,0,0.6)] outline-none"
      >
        <header className="flex h-12 shrink-0 items-center gap-3 border-b border-rule px-4">
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium text-ink">{a.filename}</div>
          </div>
          {files.length > 1 && (
            <div className="flex items-center gap-1 text-[12px] text-ink-faint">
              <button onClick={() => onIndex((index - 1 + files.length) % files.length)} aria-label="Previous file" title="Previous (←)" className="rounded-ui px-1.5 py-0.5 hover:bg-pane-sunk hover:text-ink">
                ←
              </button>
              <span className="tabular-nums">
                {index + 1} of {files.length}
              </span>
              <button onClick={() => onIndex((index + 1) % files.length)} aria-label="Next file" title="Next (→)" className="rounded-ui px-1.5 py-0.5 hover:bg-pane-sunk hover:text-ink">
                →
              </button>
            </div>
          )}
          <button
            onClick={() => api.openAttachment(a.id).then(() => setOpenError(null), (e: unknown) => setOpenError(e instanceof Error ? e.message : String(e)))}
            title={openError ?? 'Open in its own app'}
            className={`rounded-ui border px-2.5 py-1 text-[13px] font-medium hover:bg-pane-sunk ${openError ? 'border-danger text-danger' : 'border-rule-strong text-ink-soft hover:text-ink'}`}
          >
            {openError ? "Couldn't open" : 'Open in app'}
          </button>
          <button onClick={onClose} aria-label="Close preview" title="Close (Space)" className="rounded-ui px-2 py-1 text-[15px] leading-none text-ink-faint hover:bg-pane-sunk hover:text-ink">
            ×
          </button>
        </header>
        <div className="scroll min-h-0 flex-1 bg-pane-sunk">{isPdf(a) ? <PdfPages key={a.id} id={a.id} /> : <ImageView key={a.id} id={a.id} name={a.filename} />}</div>
      </div>
    </div>,
    document.body,
  )
}

function ImageView({ id, name }: { id: string; name: string }) {
  return (
    <div className="checker flex min-h-full items-center justify-center p-6">
      <img src={fileUrl(id)} alt={name} className="max-h-[calc(90vh-96px)] max-w-full object-contain shadow-sm" draggable={false} />
    </div>
  )
}

/** Every page (up to MAX_PAGES), rendered at the preview's width for this screen. */
function PdfPages({ id }: { id: string }) {
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
      const width = Math.min(host.clientWidth - 48, 900)
      for (let n = 1; n <= count && !controller.signal.aborted; n++) {
        const page = await doc.getPage(n)
        const base = page.getViewport({ scale: 1 })
        const scale = (width * (window.devicePixelRatio || 1)) / base.width
        const viewport = page.getViewport({ scale })
        const canvas = document.createElement('canvas')
        canvas.width = Math.floor(viewport.width)
        canvas.height = Math.floor(viewport.height)
        canvas.style.width = `${width}px`
        canvas.className = 'mx-auto mb-4 block bg-white shadow-sm'
        canvas.setAttribute('aria-label', `Page ${n}`)
        await page.render({ canvas, viewport }).promise
        if (controller.signal.aborted) return
        host.querySelector('[data-pages]')!.append(canvas)
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
    <div ref={box} className="px-6 py-6">
      <div data-pages />
      {state.error ? (
        <p className="py-10 text-center text-danger">Couldn't show this PDF: {state.error}. Try “Open in app”.</p>
      ) : state.shown < Math.min(state.pages, MAX_PAGES) || !state.pages ? (
        <p className="py-6 text-center text-[13px] text-ink-faint">Loading{state.pages ? ` page ${state.shown + 1} of ${state.pages}` : '…'}</p>
      ) : state.pages > MAX_PAGES ? (
        <p className="py-4 text-center text-[13px] text-ink-faint">
          Showing the first {MAX_PAGES} of {state.pages} pages. “Open in app” for the rest.
        </p>
      ) : null}
    </div>
  )
}
