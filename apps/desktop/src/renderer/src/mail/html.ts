// Turns a message's HTML, as `hey thread read --html` prints it, into a safe standalone
// document for a sandboxed frame. HEY keeps a designed email's original HTML inside Trix
// attachments and routes every image through its privacy proxy; this unwraps the former
// and allows only the latter.
import DOMPurify, { type Config } from 'dompurify'

/** HEY's image proxy: fetches remote images for HEY so senders can't track the reader. */
export const IMAGE_PROXY = 'https://gopher.hey.com/'

export interface EmailDocument {
  /** Sanitized body HTML. */
  html: string
  /** Remote images that didn't go through HEY's proxy and were left out. */
  blockedImages: number
}

/**
 * Whether a message is a *designed* email (newsletter, receipt, ticket) that should be shown
 * as its sender laid it out. HEY stores most HTML mail the same way, conversational replies
 * included, so this looks at the layout itself: designed mail is built from tables, images
 * and heavy inline styling; replies from Gmail, Outlook or Yahoo are styled text.
 * Calibrated on real mail: newsletters have 5–56 tables and 3–14 images; replies have none.
 * Some senders (Northwind, Contoso) lay out with styled divs instead of tables: a centred
 * max-width container plus at least two of images, backgrounds, rounded corners and a
 * hidden preheader.
 */
export function isDesigned(entryHtml: string): boolean {
  if (!/(&quot;|")contentType\1:\1text\/html\1/.test(entryHtml)) return false
  const html = storedHtml(entryHtml)
  const count = (re: RegExp) => html.match(re)?.length ?? 0
  const tables = count(/<table|&lt;table/gi)
  const images = count(/content-type=(\\?"|&quot;|\\&quot;)image|<img|&lt;img/gi)
  const styles = count(/style=/gi)
  const backgrounds = count(/background(-color)?\s*:/gi)
  if (tables >= 3 || (images >= 2 && tables >= 1) || (styles >= 50 && backgrounds >= 2)) return true
  const container = count(/max-width\s*:/gi) >= 1 && styles >= 12
  const signs = [images >= 2, backgrounds >= 2, count(/border-radius\s*:/gi) >= 1, count(/display\s*:\s*none/gi) >= 1].filter(Boolean).length
  return container && signs >= 2
}

/** The original HTML HEY keeps in a message's Trix HTML attachments, concatenated. */
function storedHtml(entryHtml: string): string {
  const doc = new DOMParser().parseFromString(`<!doctype html><body>${entryHtml}</body>`, 'text/html')
  return [...doc.querySelectorAll('figure[data-trix-attachment]')]
    .map((fig) => {
      try {
        const meta = JSON.parse(fig.getAttribute('data-trix-attachment') ?? '{}') as { contentType?: string; content?: string }
        return meta.contentType === 'text/html' ? (meta.content ?? '') : ''
      } catch {
        return ''
      }
    })
    .join('\n')
}

const MAX_UNWRAP_ROUNDS = 6

export function toEmailDocument(entryHtml: string): EmailDocument {
  const doc = new DOMParser().parseFromString(`<!doctype html><body>${entryHtml}</body>`, 'text/html')
  // HEY's From/To rows; the app shows its own header.
  doc.querySelector('body > header')?.remove()

  // Attachments can nest (an HTML attachment containing images and more HTML).
  for (let round = 0; round < MAX_UNWRAP_ROUNDS; round++) {
    const figures = [...doc.querySelectorAll('figure[data-trix-attachment]')]
    const attachments = [...doc.querySelectorAll('action-text-attachment')]
    if (!figures.length && !attachments.length) break
    for (const fig of figures) unwrapFigure(doc, fig)
    for (const att of attachments) unwrapAttachment(doc, att)
  }

  let blockedImages = 0
  const purify = DOMPurify(window)
  purify.addHook('afterSanitizeAttributes', (node) => {
    const el = node as Element
    if (el.tagName === 'IMG') {
      const src = el.getAttribute('src') ?? ''
      if (!src.startsWith(IMAGE_PROXY) && !src.startsWith('data:image/')) {
        blockedImages++
        el.removeAttribute('src')
      }
      el.removeAttribute('srcset')
      el.setAttribute('loading', 'lazy')
    }
    if (el.tagName === 'A') {
      const href = el.getAttribute('href') ?? ''
      if (/^(https?:|mailto:)/i.test(href)) {
        el.setAttribute('target', '_blank')
        el.setAttribute('rel', 'noopener noreferrer')
      } else {
        el.removeAttribute('href')
      }
    }
    const style = el.getAttribute('style')
    if (style && /url\(/i.test(style)) {
      el.setAttribute(
        'style',
        style.replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gi, (m, _q, url: string) => {
          if (url.startsWith(IMAGE_PROXY)) return m
          blockedImages++
          return 'none'
        }),
      )
    }
  })
  const config: Config = {
    FORBID_TAGS: ['form', 'input', 'button', 'textarea', 'select', 'iframe', 'frame', 'object', 'embed', 'base', 'link', 'meta', 'script'],
    FORBID_ATTR: ['srcset', 'action', 'formaction', 'ping'],
    ALLOW_DATA_ATTR: false,
  }
  const html = purify.sanitize(doc.body, config) as unknown as string
  purify.removeAllHooks()
  return { html: typeof html === 'string' ? html : String(html), blockedImages }
}

/** A Trix attachment figure: an HTML attachment becomes its content; anything else (files) goes. */
function unwrapFigure(doc: Document, fig: Element) {
  let meta: { contentType?: string; content?: string } = {}
  try {
    meta = JSON.parse(fig.getAttribute('data-trix-attachment') ?? '{}') as typeof meta
  } catch {
    // malformed: drop it
  }
  if (meta.contentType === 'text/html' && meta.content) fig.replaceWith(fragment(doc, meta.content))
  else fig.remove()
}

/** `<action-text-attachment>`: images become <img>, HTML becomes its content, files are dropped. */
function unwrapAttachment(doc: Document, att: Element) {
  const type = att.getAttribute('content-type') ?? ''
  if (type.startsWith('image')) {
    const img = doc.createElement('img')
    img.setAttribute('src', att.getAttribute('url') ?? '')
    for (const a of ['width', 'height']) {
      const v = att.getAttribute(a)
      if (v && /^\d+$/.test(v)) img.setAttribute(a, v)
    }
    img.setAttribute('alt', att.getAttribute('caption') ?? '')
    att.replaceWith(img)
  } else if (type === 'text/html' && att.getAttribute('content')) {
    att.replaceWith(fragment(doc, att.getAttribute('content')!))
  } else {
    att.remove()
  }
}

/** Parses HEY's stored HTML, unwrapping its <shadow-content><template> wrapper. */
function fragment(doc: Document, html: string): DocumentFragment {
  const parsed = new DOMParser().parseFromString(`<!doctype html><body>${html}</body>`, 'text/html')
  const template = parsed.querySelector('template')
  const source = template ? template.content : parsed.body
  const frag = doc.createDocumentFragment()
  for (const node of [...source.childNodes]) frag.append(doc.importNode(node, true))
  return frag
}

/** The complete document for the sandboxed frame, with its own strict CSP. */
export function frameDocument(body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${IMAGE_PROXY} data:; style-src 'unsafe-inline'; font-src data:">
<style>
html,body{margin:0;padding:0;background:#fff}
/* The frame is sized to its content; it never scrolls itself, so the wheel always moves the reader. */
html,body{overflow:hidden!important}
body{font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;color:#222;overflow-wrap:anywhere;-webkit-font-smoothing:antialiased}
img{max-width:100%;height:auto}
a{color:#1a5cff}
</style></head><body>${body}</body></html>`
}
