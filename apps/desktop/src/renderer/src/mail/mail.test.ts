import { describe, expect, it } from 'vitest'
import { parseAddresses, parseForwardedDate, sameSubject, splitForwarded, stripSubjectPrefixes } from './forwarded'
import { displayName, formatAddressList, replyRecipients, shortName, summarizeRecipients, type Addr } from './people'

// Shaped like HEY's Markdown for a Gmail forward (escaped dashes and brackets, bold name).
const gmailForward = [
  'FYI, see below.',
  '',
  '\\---------- Forwarded message ---------  ',
  'From: **Example Council** \\<[office@example.org](mailto:office@example.org)\\>  ',
  'Date: Thu, 13 Aug 2026, 11:20  ',
  'Subject: "Quarterly Letter" 51st Edition  ',
  'To: The Board of Example \\<[board@example.com](mailto:board@example.com)\\>  ',
  '',
  'Dear friends,',
].join('\n')

describe('splitForwarded', () => {
  it('parses a Gmail forward and keeps the text around it', () => {
    const r = splitForwarded(gmailForward)!
    expect(r.before).toBe('FYI, see below.')
    expect(r.after).toBe('Dear friends,')
    expect(r.header).toEqual({
      from: { name: 'Example Council', email: 'office@example.org' },
      date: 'Thu, 13 Aug 2026, 11:20',
      subject: '"Quarterly Letter" 51st Edition',
      to: [{ name: 'The Board of Example', email: 'board@example.com' }],
      cc: [],
    })
  })

  it('handles Apple Mail and wrapped recipient lines', () => {
    const md = [
      'Begin forwarded message:',
      '',
      'From: Ana Lima <ana@example.com>',
      'Subject: Plans',
      'Date: 3 September 2026 at 09:12:00 GMT+4',
      'To: "Lee, Sam" <sam@example.com>,',
      ' Kai <kai@example.com>',
      '',
      'Body',
    ].join('\n')
    const r = splitForwarded(md)!
    expect(r.header.to.map((p) => p.email)).toEqual(['sam@example.com', 'kai@example.com'])
    expect(r.header.to[0]!.name).toBe('Lee, Sam')
    expect(r.after).toBe('Body')
  })

  it('ignores bodies without a forward, or a marker with no header fields', () => {
    expect(splitForwarded('Hello there')).toBeNull()
    expect(splitForwarded('---------- Forwarded message ---------\nJust text')).toBeNull()
  })
})

describe('parseAddresses', () => {
  it('reads bare, bracketed and quoted addresses', () => {
    expect(parseAddresses('a@x.com; "B, C" <b@y.org>, Dee <D@Z.io>')).toEqual([
      { name: null, email: 'a@x.com' },
      { name: 'B, C', email: 'b@y.org' },
      { name: 'Dee', email: 'd@z.io' },
    ])
  })
})

describe('names', () => {
  const me: Addr = { name: 'Oliver Oxenham', email: 'me@hey.example', isMe: true }
  const p = (name: string | null, email: string): Addr => ({ name, email, isMe: false })

  it('falls back to the address when there is no name', () => {
    expect(displayName(p(null, 'barenderest@gmail.com'))).toBe('barenderest')
    expect(displayName(p('"Ana Lima"', 'ana@x.com'))).toBe('Ana Lima')
  })

  it('shortens people, not organisations', () => {
    expect(shortName(p('José Pellegrin', 'j@x.com'))).toBe('José')
    expect(shortName(p('National Science Association (NSA)', 'n@x.com'))).toBe('National Science Association (NSA)')
    expect(shortName(p('The HEY Team', 't@x.com'))).toBe('The HEY Team')
  })

  it('copies names only when they are real names', () => {
    expect(formatAddressList([p('Ana Lima', 'ana@x.com'), p('bob42', 'bob42@x.com'), p(null, 'c@x.com')])).toBe(
      'Ana Lima <ana@x.com>, bob42@x.com, c@x.com',
    )
  })

  it('summarises recipients with you first', () => {
    const a = p('Barender Appadoo', 'b@x.com')
    const b = p('José Pellegrin', 'j@x.com')
    const c = p('Shehan Lagan', 's@x.com')
    const d = p('Neela Gopaul', 'n@x.com')
    expect(summarizeRecipients([me], [])).toBe('to you')
    expect(summarizeRecipients([a, b], [])).toBe('to Barender and José')
    expect(summarizeRecipients([a, me, b], [])).toBe('to you, Barender and José')
    expect(summarizeRecipients([a, b, c, d], [me])).toBe('to you, Barender and 3 others')
    expect(summarizeRecipients([a, b, c], [a])).toBe('to Barender, José and Shehan')
    expect(summarizeRecipients([], [])).toBe('')
  })
})

describe('sameSubject', () => {
  it('ignores Fwd/Re prefixes and quotes', () => {
    expect(sameSubject('Fwd: "Quarterly Letter" 51st Edition', '"Quarterly Letter" 51st Edition')).toBe(true)
    expect(sameSubject('Plans', 'Other plans')).toBe(false)
  })
})

describe('subjects and dates', () => {
  it('strips stacked reply and forward prefixes from titles', () => {
    expect(stripSubjectPrefixes('Fwd: "Quarterly Letter" 51st Edition')).toBe('"Quarterly Letter" 51st Edition')
    expect(stripSubjectPrefixes('RE: Fw: AW: Plans')).toBe('Plans')
    expect(stripSubjectPrefixes('Re[2]: Plans')).toBe('Plans')
    expect(stripSubjectPrefixes('Regarding: plans')).toBe('Regarding: plans')
    expect(stripSubjectPrefixes('Fwd:')).toBe('Fwd:')
  })

  it('reads forwarded dates from common mail apps', () => {
    const gmail = parseForwardedDate('Thu, 13 Aug 2026, 11:20')!
    expect([gmail.getFullYear(), gmail.getMonth(), gmail.getDate(), gmail.getHours(), gmail.getMinutes()]).toEqual([2026, 7, 13, 11, 20])
    expect(parseForwardedDate('3 September 2026 at 09:12:00 GMT+4')?.toISOString()).toBe('2026-09-03T05:12:00.000Z')
    const us = parseForwardedDate('September 3, 2026 at 9:12 AM')!
    expect([us.getMonth(), us.getDate(), us.getHours(), us.getMinutes()]).toEqual([8, 3, 9, 12])
    const outlook = parseForwardedDate('Wednesday, September 3, 2026 9:12 AM')!
    expect([outlook.getMonth(), outlook.getDate(), outlook.getHours()]).toEqual([8, 3, 9])
    expect(parseForwardedDate('sometime last week')).toBeNull()
    expect(parseForwardedDate(null)).toBeNull()
  })
})

describe('replyRecipients', () => {
  const me: Addr = { name: 'Me', email: 'me@hey.example', isMe: true }
  const ana: Addr = { name: 'Ana', email: 'ana@x.com', isMe: false }
  const bo: Addr = { name: 'Bo', email: 'bo@x.com', isMe: false }
  const cy: Addr = { name: 'Cy', email: 'cy@x.com', isMe: false }

  it('replies to the sender, and to everyone for reply all (Cc stays Cc, never me)', () => {
    const msg = { from: ana, to: [me, bo], cc: [cy, me] }
    expect(replyRecipients(msg, 'reply')).toEqual({ to: ['ana@x.com'], cc: [] })
    expect(replyRecipients(msg, 'reply-all')).toEqual({ to: ['ana@x.com', 'bo@x.com'], cc: ['cy@x.com'] })
  })

  it('replying to my own message goes back to its recipients', () => {
    const mine = { from: me, to: [ana, bo], cc: [] }
    expect(replyRecipients(mine, 'reply')).toEqual({ to: ['ana@x.com', 'bo@x.com'], cc: [] })
  })

  it('drops duplicates across To and Cc', () => {
    const msg = { from: ana, to: [ana, bo], cc: [bo, cy] }
    expect(replyRecipients(msg, 'reply-all')).toEqual({ to: ['ana@x.com', 'bo@x.com'], cc: ['cy@x.com'] })
  })
})
