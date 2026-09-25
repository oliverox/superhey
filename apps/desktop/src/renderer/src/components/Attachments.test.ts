// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import type { AttachmentRow } from '@shared/api'
import { stripAttachmentLines } from './Attachments'

const file = (filename: string, embedded = false) => ({ id: filename, filename, embedded }) as AttachmentRow

describe('stripAttachmentLines', () => {
  it('drops HEY’s placeholders for files the message has, both kinds', () => {
    const body = '[image: logo-white.png]\n\n[image: logo.png]\n\nHere are both versions.\n\n📎 brief.pdf\n'
    expect(stripAttachmentLines(body, [file('logo-white.png'), file('logo.png'), file('brief.pdf')])).toBe('Here are both versions.')
  })

  it('drops the Markdown images HEY puts in for inline images (as in a real message)', () => {
    const body =
      '![acme-logo-stacked-white.png](/rails/active_storage/blobs/redirect/eyJfcmFpbHMi--817c)\n\n![acme-logo-stacked.png](/rails/active_storage/blobs/redirect/eyJfcmFpbHMi--9a1b)\n'
    expect(stripAttachmentLines(body, [file('acme-logo-stacked-white.png'), file('acme-logo-stacked.png')])).toBe('')
    // An image of something else stays.
    expect(stripAttachmentLines('![chart](https://example.com/c.png)', [file('logo.png')])).toBe('![chart](https://example.com/c.png)')
  })

  it('drops a placeholder for an embedded image too (its file is hidden, but it’s there)', () => {
    expect(stripAttachmentLines('Thanks!\n\n[image: signature.png]', [file('signature.png', true)])).toBe('Thanks!')
  })

  it('keeps a placeholder for a file the message doesn’t have, and text that merely mentions one', () => {
    const body = '[image: missing.png]\nSee [image: logo.png] above.'
    expect(stripAttachmentLines(body, [file('logo.png')])).toBe(body)
  })

  it('leaves a body with no files alone', () => {
    expect(stripAttachmentLines('[image: x.png]\n\n\n\nHi', [])).toBe('[image: x.png]\n\n\n\nHi')
  })
})
