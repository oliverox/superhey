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
  /** Whether quoted history was folded away (asked for with `foldQuote`). */
  quoted: boolean
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
  // Judged on what the message adds: a reply quoting a newsletter is still a reply. (HEY
  // keeps a quoted email as an attachment inside the quote, so the quote goes first; then
  // what the sender's client quoted inside the HTML it sent.)
  const outer = new DOMParser().parseFromString(`<!doctype html><body>${entryHtml}</body>`, 'text/html')
  foldQuoted(outer, true)
  // (HEY wraps it in <shadow-content><template>, whose content isn't searchable as it is.)
  const unwrapped = storedHtml(outer.body.innerHTML).replace(/<\/?(shadow-content|template)\b[^>]*>/gi, '')
  const stored = new DOMParser().parseFromString(`<!doctype html><body>${unwrapped}</body>`, 'text/html')
  foldQuoted(stored, true)
  const html = stored.body.innerHTML
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

/**
 * `foldQuote`: leave out the history a reply quotes below what it adds (as HEY does), for
 * the reader to show on request. `laterInThread`: Outlook's From/Sent block counts as a
 * quote only after a thread's first message (in the first, it's usually a forward).
 */
export function toEmailDocument(entryHtml: string, opts: { foldQuote?: boolean; laterInThread?: boolean } = {}): EmailDocument {
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

  const quoted = opts.foldQuote ? foldQuoted(doc, opts.laterInThread ?? false) : false

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
  return { html: typeof html === 'string' ? html : String(html), quoted, blockedImages }
}

// Where mail clients start the history a reply quotes.
const QUOTE_STARTS = [
  '.gmail_quote_container', // Gmail
  '.gmail_quote',
  '.yahoo_quoted', // Yahoo
  '.protonmail_quote', // Proton
  '.moz-cite-prefix', // Thunderbird: its "On … wrote:" line, then the blockquote
  'blockquote[type="cite"]', // Apple Mail, Thunderbird
  '#appendonsend', // Outlook: an empty marker right before the history
]
// Outlook's "From: … Sent: …" block (in a reply; in a first message it's usually a forward).
const OUTLOOK_STARTS = ['#divRplyFwdMsg', '#x_divRplyFwdMsg', 'div[style*="border-top:solid #E1E1E1"]', 'div[style*="border-top: solid #E1E1E1"]']
const WROTE_LINE = /(?:wrote|a écrit|schrieb|escribió|ha scritto|escreveu|schreef|skrev|napsal)\s?:\s*$/i
const FORWARD_INTRO = /^\s*(-{2,}\s*Forwarded message|Begin forwarded message|-{2,}\s*Original Message)/i

/**
 * Removes a reply's quoted history: everything from where it starts to the end of the
 * message. Not when nothing would be left above it (an inline reply), and not a forward.
 * Says whether anything was removed.
 */
export function foldQuoted(doc: Document, laterInThread: boolean): boolean {
  const selectors = [...QUOTE_STARTS, ...(laterInThread ? OUTLOOK_STARTS : [])]
  const starts = selectors.flatMap((sel) => [...doc.body.querySelectorAll(sel)])
  // HEY and others with no marker: an "On … wrote:" line, then the quote in a blockquote.
  for (const quote of doc.body.querySelectorAll('blockquote')) {
    let intro = quote.previousElementSibling
    while (intro && !intro.textContent?.trim()) intro = intro.previousElementSibling
    if (intro && WROTE_LINE.test(intro.textContent ?? '')) starts.push(intro)
  }
  if (!starts.length) return false
  // The first in the document, and from its outermost wrapper that holds nothing else.
  let start = starts.sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))[0]!
  if (FORWARD_INTRO.test(start.textContent ?? '')) return false
  // Outlook puts a rule just above its From/Sent block: it goes too.
  const ruleAbove = start.previousElementSibling
  if (ruleAbove?.tagName === 'HR' || (ruleAbove?.tagName === 'DIV' && /^\s*$/.test(ruleAbove.textContent ?? '') && ruleAbove.querySelector('hr'))) start = ruleAbove
  const range = doc.createRange()
  range.setStartBefore(start)
  range.setEndAfter(doc.body.lastChild!)
  const before = doc.createRange()
  before.setStart(doc.body, 0)
  before.setEndBefore(start)
  if (!before.toString().replace(/[\s\u00a0\u200b]+/g, '')) return false
  range.deleteContents()
  return true
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
