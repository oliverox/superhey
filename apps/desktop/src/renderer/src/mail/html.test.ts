// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { frameDocument, isDesigned, toEmailDocument } from './html'

// Synthetic messages shaped like `hey thread read --html`: a header, then the original HTML
// stored as JSON inside an escaped Trix attachment attribute, wrapped in shadow content.
const attr = (v: unknown) => JSON.stringify(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;')
const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const designed = (inner: string) =>
  `<header><div>From: Shop — 2026-09-24T08:41</div></header>
   <div><figure data-trix-attachment="${attr({ contentType: 'text/html', content: `<shadow-content><template>${inner}</template></shadow-content>`, data: '{}' })}"></figure></div>`
const proxied = 'https://gopher.hey.com/200x0,q85,sAbc=/https://cdn.example.com/logo.png'

describe('isDesigned', () => {
  const table = (cells: string) => `<table width="600" style="background-color:#fff"><tr><td style="padding:8px">${cells}</td></tr></table>`

  it('recognises designed mail by its layout', () => {
    expect(isDesigned(designed(table('a') + table('b') + table('c')))).toBe(true)
    expect(isDesigned(designed(`${table(`<action-text-attachment content-type="image" url="${proxied}"></action-text-attachment>`)}<action-text-attachment content-type="image" url="${proxied}"></action-text-attachment>`))).toBe(true)
  })

  it('recognises designed mail laid out with divs instead of tables', () => {
    const s = (css: string) => ` style="${css}"`
    const img = `<action-text-attachment content-type="image" url="${proxied}"></action-text-attachment>`
    const p = (text: string) => `<p${s('margin:0 0 16px;font-size:16px')}>${text}</p>`
    const card =
      `<div${s('background-color:#fff;font-family:Helvetica;padding:24px 12px')}>` +
      `<div${s('background-color:#fff;border-radius:24px;max-width:700px;margin:0 auto')}>` +
      `<div${s('padding:16px 24px')}>${img}</div>` +
      `<span${s('display:none;font-size:0')}>Preheader</span>` +
      `<h1${s('font-size:28px;text-align:center')}>€10.00 has been added</h1>` +
      p('Hi,') + p('You’ve just received a deposit.') + p('Thanks') +
      `<a${s('border:2px solid #000;border-radius:99px;padding:12px 32px')} href="https://example.com">Open</a>` +
      `<div${s('padding:24px;color:#666')}>${p('© Example')}${p('Legal text')}${img}</div></div></div>`
    expect(isDesigned(designed(card))).toBe(true)
  })

  it('does not call a styled reply with a width limit designed', () => {
    const gmailish = designed(
      `<div dir="ltr" style="max-width:600px">${'<div style="font-family:Arial">Line</div>'.repeat(12)}` +
        `<div style="border-left:1px solid #ccc;padding-left:1ex">Earlier message…</div></div>`,
    )
    expect(isDesigned(gmailish)).toBe(false)
  })

  it('treats HTML replies from mail apps as conversation, not design', () => {
    const outlookReply = designed(
      '<p class="MsoNormal" style="margin:0">Thanks, Friday works.</p><p class="MsoNormal" style="margin:0">Sam</p>' +
        '<div style="border-top:solid #E1E1E1 1pt"><p><b>From:</b> Ana</p></div><p class="MsoNormal">Earlier message…</p>',
    )
    const withSignatureLogo = designed(`<div>See you then.</div><action-text-attachment content-type="image" url="${proxied}"></action-text-attachment>`)
    expect(isDesigned(outlookReply)).toBe(false)
    expect(isDesigned(withSignatureLogo)).toBe(false)
  })

  it('never calls plain HEY rich text designed', () => {
    expect(isDesigned('<header></header><div>Dear friends,<br>Plain text.</div>')).toBe(false)
  })
})

describe('toEmailDocument', () => {
  it("unwraps HEY's attachment, turns proxied images into <img>, and drops HEY's header", () => {
    const { html, blockedImages } = toEmailDocument(
      designed(`<div style="max-width:640px"><action-text-attachment content-type="image" url="${proxied}" width="100" height="auto" caption="Shop"></action-text-attachment><p>Your order</p></div>`),
    )
    expect(html).toContain('<div style="max-width:640px">')
    expect(html).toContain(`<img src="${proxied}" width="100" alt="Shop" loading="lazy">`)
    expect(html).toContain('<p>Your order</p>')
    expect(html).not.toMatch(/figure|template|shadow-content|action-text-attachment|From: Shop/)
    expect(blockedImages).toBe(0)
  })

  it('unwraps nested HTML attachments and drops file attachments', () => {
    const nested = `<action-text-attachment content-type="text/html" content="${escape('<table><tr><td>Flight</td></tr></table>')}"></action-text-attachment>`
    const file = `<action-text-attachment content-type="application/pdf" url="https://example.com/x.pdf" filename="x.pdf"></action-text-attachment>`
    const { html } = toEmailDocument(designed(`${nested}${file}`))
    expect(html).toContain('<td>Flight</td>')
    expect(html).not.toContain('x.pdf')
  })

  it('removes anything that could run code or phone home', () => {
    const hostile = [
      '<script>alert(1)</script>',
      '<img src="https://tracker.example/pixel.gif" onload="alert(2)">',
      '<a href="javascript:alert(3)">x</a>',
      '<iframe src="https://evil.example"></iframe>',
      '<form action="https://evil.example"><input name="pw"></form>',
      '<div style="background:url(https://tracker.example/bg.png)">bg</div>',
      '<meta http-equiv="refresh" content="0;url=https://evil.example">',
      '<a href="https://shop.example/order">Order</a>',
    ].join('')
    const { html, blockedImages } = toEmailDocument(designed(hostile))
    expect(html).not.toMatch(/<script|alert|onload|javascript:|<iframe|<form|<input|<meta|tracker\.example/)
    expect(html).toContain('<a href="https://shop.example/order" target="_blank" rel="noopener noreferrer">Order</a>')
    expect(html).toContain('background:none')
    expect(blockedImages).toBe(2)
  })

  it('keeps plain messages as they are, minus the header', () => {
    const { html } = toEmailDocument('<header><div>From: A</div></header><div>Dear friends,<br>Hello.</div>')
    expect(html).toBe('<div>Dear friends,<br>Hello.</div>')
  })
})

describe('frameDocument', () => {
  it("allows images only from HEY's proxy and no scripts", () => {
    const doc = frameDocument('<p>x</p>')
    expect(doc).toContain("default-src 'none'; img-src https://gopher.hey.com/ data:")
    expect(doc).not.toContain('script-src')
  })
})
