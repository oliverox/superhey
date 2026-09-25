import { useEffect, useMemo, useRef, useState } from 'react'
import { frameDocument, toEmailDocument } from '../mail/html'

/**
 * A designed email, rendered as its sender built it, inside a sandboxed frame: no scripts
 * (sanitized, and blocked by the frame's CSP), no forms, images only via HEY's proxy.
 * `allow-same-origin` lets the app measure the content to size the frame; without
 * `allow-scripts` the email can't use that access. Links open in the browser.
 */
export function HtmlBody({ entryHtml }: { entryHtml: string }) {
  const { html, blockedImages } = useMemo(() => toEmailDocument(entryHtml), [entryHtml])
  const srcDoc = useMemo(() => frameDocument(html), [html])
  const ref = useRef<HTMLIFrameElement>(null)
  const [height, setHeight] = useState(240)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    const frame = ref.current
    if (!frame) return
    let observer: ResizeObserver | null = null

    // This runs from ResizeObservers, so it must not feed itself. The scale is worked out
    // only when the frame's width changes (briefly measuring at full size); otherwise only
    // the height is updated, and a height change never changes the width.
    let queued = 0
    let lastWidth = -1
    const measure = () => {
      queued = 0
      const doc = frame.contentDocument
      if (!doc?.body) return
      const available = frame.clientWidth
      if (available !== lastWidth) {
        lastWidth = available
        // Designed mail is often 600–800px wide; scale it down rather than scroll sideways.
        doc.body.style.zoom = '1'
        const natural = doc.documentElement.scrollWidth
        doc.body.style.zoom = natural > available + 1 ? String(available / natural) : '1'
      }
      const zoom = Number(doc.body.style.zoom) || 1
      // The body's own margins (emails set them) sit outside its scrollHeight; left out, the
      // last few pixels would be cut off. (Not the root's scrollHeight: that is never less
      // than the frame, so it could only grow.)
      const style = doc.defaultView?.getComputedStyle(doc.body)
      const margins = style ? (parseFloat(style.marginTop) || 0) + (parseFloat(style.marginBottom) || 0) : 0
      const h = Math.ceil((doc.body.scrollHeight + margins) * zoom)
      setHeight((prev) => (Math.abs(prev - h) > 1 ? h : prev))
    }
    const fit = () => {
      if (!queued) queued = requestAnimationFrame(measure)
    }
    const onLoad = () => {
      fit()
      setLoaded(true)
      const doc = frame.contentDocument
      if (!doc) return
      // Also inline, above anything the email's own styles say.
      doc.documentElement.style.setProperty('overflow', 'hidden', 'important')
      doc.body?.style.setProperty('overflow', 'hidden', 'important')
      observer = new ResizeObserver(fit)
      observer.observe(doc.body)
      // Images arriving change the height.
      for (const img of doc.images) img.addEventListener('load', fit, { once: true })
    }
    frame.addEventListener('load', onLoad)
    const outer = new ResizeObserver(fit)
    outer.observe(frame)
    return () => {
      cancelAnimationFrame(queued)
      frame.removeEventListener('load', onLoad)
      observer?.disconnect()
      outer.disconnect()
    }
  }, [srcDoc])

  return (
    <>
      <iframe
        ref={ref}
        aria-label="Email content"
        sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        srcDoc={srcDoc}
        style={{ height }}
        className={`block w-full border-0 bg-white transition-opacity duration-200 ${loaded ? 'opacity-100' : 'opacity-0'}`}
      />
      {blockedImages > 0 && (
        <p className="mt-2 text-[11.5px] text-ink-faint">
          {blockedImages} remote {blockedImages === 1 ? 'image was' : 'images were'} blocked because {blockedImages === 1 ? 'it' : 'they'} didn't come through HEY's privacy proxy.
        </p>
      )}
    </>
  )
}
