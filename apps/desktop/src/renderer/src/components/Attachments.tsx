import { useEffect, useRef, useState } from 'react'
import type { AttachmentRow } from '@shared/api'
import { api, fileUrl } from '../api'

const THUMB_W = 132
const THUMB_H = 170

/**
 * What to show in the strip: every real attachment, plus embedded files that aren't
 * images (a PDF inside a forwarded message). Embedded images are logos and signatures.
 */
export function visibleAttachments(list: AttachmentRow[]) {
  return list.filter((a) => !a.embedded || !isImage(a))
}

/** Removes the "📎 filename" placeholder lines HEY puts in the body for attachments. */
export function stripAttachmentLines(markdown: string, list: AttachmentRow[]) {
  if (!list.length) return markdown
  const names = new Set(list.map((a) => a.filename))
  return markdown.replace(/^📎️?[ \t]*(.+)\n?/gmu, (line, name: string) => (names.has(name.trim()) ? '' : line))
}

export function AttachmentStrip({ attachments }: { attachments: AttachmentRow[] }) {
  if (!attachments.length) return null
  return (
    <ul className="mt-4 mb-2 flex flex-wrap gap-3" aria-label="Attachments">
      {attachments.map((a) => (
        <li key={a.id}>
          <AttachmentCard attachment={a} />
        </li>
      ))}
    </ul>
  )
}

function AttachmentCard({ attachment: a }: { attachment: AttachmentRow }) {
  const [opening, setOpening] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ext = extension(a.filename)

  return (
    <button
      onClick={async () => {
        setOpening(true)
        setError(null)
        try {
          await api.openAttachment(a.id)
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e))
        } finally {
          setOpening(false)
        }
      }}
      title={error ?? `Open ${a.filename}`}
      className="group block w-[132px] text-left"
    >
      <div
        className="relative overflow-hidden rounded-ui border border-rule bg-pane-sunk transition-[border-color,box-shadow] group-hover:border-rule-strong group-hover:shadow-[0_4px_16px_-8px_rgba(0,0,0,0.25)]"
        style={{ width: THUMB_W, height: THUMB_H }}
      >
        <Preview attachment={a} ext={ext} />
        <span className="absolute bottom-1.5 left-1.5 rounded-[3px] bg-ink/75 px-1.5 py-px text-[9.5px] font-semibold tracking-wide text-pane uppercase">
          {ext || 'file'}
        </span>
        {opening && <span className="absolute inset-0 flex items-center justify-center bg-pane/70 text-[11px] text-ink-soft">Opening…</span>}
      </div>
      <div className="mt-1.5 truncate text-[12px] font-medium text-ink">{a.filename}</div>
      <div className={`text-[11px] ${error ? 'text-danger' : 'text-ink-faint'}`}>
        {error ? "Couldn't open" : formatBytes(a.byteSize)}
      </div>
    </button>
  )
}

function Preview({ attachment: a, ext }: { attachment: AttachmentRow; ext: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const visible = useVisible(ref)

  let content: React.ReactNode = <Placeholder ext={ext} />
  if (visible && isImage(a))
    content = <img src={fileUrl(a.id)} alt="" className="size-full object-cover object-top" draggable={false} />
  else if (visible && isPdf(a)) content = <PdfThumb id={a.id} ext={ext} />

  return (
    <div ref={ref} className="size-full">
      {content}
    </div>
  )
}

function PdfThumb({ id, ext }: { id: string; ext: string }) {
  const [src, setSrc] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    let url: string | null = null
    renderPdfThumb(fileUrl(id), THUMB_W, controller.signal).then(
      (blob) => {
        if (controller.signal.aborted) return
        url = URL.createObjectURL(blob)
        setSrc(url)
      },
      () => !controller.signal.aborted && setFailed(true),
    )
    return () => {
      controller.abort()
      if (url) URL.revokeObjectURL(url)
    }
  }, [id])

  if (src) return <img src={src} alt="" className="block w-full bg-white" draggable={false} />
  return <Placeholder ext={ext} loading={!failed} />
}

/** Renders page 1 on its own off-screen canvas, so overlapping renders never collide. */
async function renderPdfThumb(url: string, width: number, signal: AbortSignal): Promise<Blob> {
  const pdfjs = await import('../pdf')
  // Fetch the bytes ourselves: pdf.js only streams http(s) URLs, and Electron serves
  // attachments from a custom scheme.
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`attachment fetch failed: ${res.status}`)
  const data = new Uint8Array(await res.arrayBuffer())
  const task = pdfjs.getDocument({ data, useWasm: false })
  signal.addEventListener('abort', () => void task.destroy())
  try {
    const doc = await task.promise
    const page = await doc.getPage(1)
    const base = page.getViewport({ scale: 1 })
    const viewport = page.getViewport({ scale: (width * (window.devicePixelRatio || 1)) / base.width })
    const canvas = document.createElement('canvas')
    canvas.width = Math.floor(viewport.width)
    canvas.height = Math.floor(viewport.height)
    await page.render({ canvas, viewport }).promise
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('empty thumbnail'))), 'image/png'),
    )
  } finally {
    void task.destroy()
  }
}

function Placeholder({ ext, loading = false }: { ext: string; loading?: boolean }) {
  return (
    <div className={`flex size-full flex-col gap-1.5 p-3 ${loading ? 'pulse' : ''}`} aria-hidden>
      {[88, 100, 72, 94, 60, 84].map((w, i) => (
        <span key={i} className="h-1.5 rounded-full bg-rule" style={{ width: `${w}%` }} />
      ))}
      <span className="mt-auto self-end text-[18px] font-semibold text-rule-strong uppercase">{ext}</span>
    </div>
  )
}

/** True once the element has scrolled into view; files are only fetched when seen. */
function useVisible(ref: React.RefObject<HTMLElement | null>) {
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || visible) return
    const io = new IntersectionObserver(([e]) => e?.isIntersecting && setVisible(true), { rootMargin: '200px' })
    io.observe(el)
    return () => io.disconnect()
  }, [ref, visible])
  return visible
}

const isPdf = (a: AttachmentRow) => a.contentType === 'application/pdf' || /\.pdf$/i.test(a.filename)
const isImage = (a: AttachmentRow) => /^image\/(png|jpe?g|gif|webp|avif|bmp)$/.test(a.contentType ?? '')
export const extension = (name: string) => (/\.([a-z0-9]{1,5})$/i.exec(name)?.[1] ?? '').toLowerCase()

export function formatBytes(n: number | null) {
  if (n == null) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}
