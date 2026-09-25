import { describe, expect, it } from 'vitest'
import { listTags, parseAddresses, parseForwardedDate, sameSubject, splitForwarded, stripSubjectPrefixes, tagKind, tagMatchesLabel, unwrapHardBreaks } from './forwarded'
import { displayName, formatAddressList, recipientSummaries, replyRecipients, shortName, summarizeRecipients, type Addr } from './people'

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
    // Shorter forms for tight space, longest first.
    expect(recipientSummaries([a, b, c, d], [me])).toEqual(['to you, Barender and 3 others', 'to you and 4 others', 'to you +4'])
    expect(recipientSummaries([a, b], [])).toEqual(['to Barender and José', 'to Barender and 1 other', 'to Barender +1'])
    expect(recipientSummaries([me], [])).toEqual(['to you'])
    expect(recipientSummaries([], [])).toEqual([])
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

describe('forwards with blank lines between the header fields', () => {
  it('reads the header and the forwarded message after your note', () => {
    const body =
      'Dear friends,  \nI am forwarding this report.  \nWarm regards,  \nSam  \n\n\\---------- Forwarded message ---------\n\nFrom: office@example.org\n\nDate: Tue, Sep 8, 2026 at 3:28 PM\n\nSubject: Planning for the round-table\n\nTo: The Secretariat \\<sec@example.org\\> and Sam Lee \\<sam@example.com\\>\n\n> Chers amis,  \n> Je partage un document.'
    const f = splitForwarded(body)!
    expect(f).not.toBeNull()
    expect(f.before).toBe('Dear friends,  \nI am forwarding this report.  \nWarm regards,  \nSam')
    expect(f.header).toMatchObject({ from: { email: 'office@example.org' }, date: 'Tue, Sep 8, 2026 at 3:28 PM', subject: 'Planning for the round-table' })
    expect(f.after.startsWith('> Chers amis,')).toBe(true)
  })

  it('still needs real fields: a marker followed by prose isn’t a forward', () => {
    expect(splitForwarded('---------- Forwarded message ---------\n\nJust some text.\n\nMore text.')).toBeNull()
  })
})

describe('unwrapHardBreaks', () => {
  it('joins lines broken mid-sentence, keeping breaks that mean something (quoted too)', () => {
    const md = '> Chers amis,  \n> Allah’u’abha.  \n> Je partage un document qui présente le cheminement de la  \n> réflexion autour de la paix, jusqu’à la table ronde et  \n> la proposition de collaboration.  \n> Merci.'
    expect(unwrapHardBreaks(md)).toBe(
      '> Chers amis,  \n> Allah’u’abha.  \n> Je partage un document qui présente le cheminement de la\n> réflexion autour de la paix, jusqu’à la table ronde et\n> la proposition de collaboration.  \n> Merci.',
    )
  })

  it('leaves greetings, sign-offs and new sentences alone', () => {
    const md = 'Dear friends,  \nI am forwarding this.  \nWith loving regards,  \nOliver'
    expect(unwrapHardBreaks(md)).toBe(md)
  })

  it('doesn’t join across a quote level, or text without hard breaks', () => {
    expect(unwrapHardBreaks('Thanks for this  \n> and the quote')).toBe('Thanks for this  \n> and the quote')
    expect(unwrapHardBreaks('one line\nand another')).toBe('one line\nand another')
  })
})

describe('parseAddresses with Gmail’s “and”', () => {
  it('splits “A <a> and B <b>”, in English or French', () => {
    expect(parseAddresses('The Secretariat <sec@example.org> and Sam Lee <sam@example.com>').map((a) => a.email)).toEqual(['sec@example.org', 'sam@example.com'])
    expect(parseAddresses('A <a@x.org>, B <b@x.org> et C <c@x.org>').map((a) => a.email)).toEqual(['a@x.org', 'b@x.org', 'c@x.org'])
    // A name with "and" in it isn't split.
    expect(parseAddresses('Salt and Pepper Ltd <hello@example.com>')).toEqual([{ name: 'Salt and Pepper Ltd', email: 'hello@example.com' }])
  })
})

describe('mailing-list tags', () => {
  it('takes list tags off the front, wherever the reply prefixes are', () => {
    expect(listTags("[garden-notes] Weekly digest 183")).toEqual({ tags: ['garden-notes'], rest: "Weekly digest 183" })
    expect(listTags('Re: [tokyo-dev] Re: Meetup on Friday')).toEqual({ tags: ['tokyo-dev'], rest: 'Meetup on Friday' })
    expect(listTags('[EXTERNAL] [ops] Disk full')).toEqual({ tags: ['EXTERNAL', 'ops'], rest: 'Disk full' })
    expect(stripSubjectPrefixes('Fwd: [team] Plans')).toBe('Plans')
  })

  it('leaves ticket numbers, brackets later on, and a subject that is only a tag', () => {
    expect(listTags('[#4521] Printer is on fire')).toEqual({ tags: [], rest: '[#4521] Printer is on fire' })
    expect(listTags('[1234] Order shipped').tags).toEqual([])
    expect(listTags('Minutes [draft]')).toEqual({ tags: [], rest: 'Minutes [draft]' })
    expect(listTags('Re: [announce]')).toEqual({ tags: [], rest: '[announce]' })
    expect(listTags('[x] Too short to be a list').tags).toEqual([])
  })

  it('knows when a HEY label already says it', () => {
    expect(tagMatchesLabel('garden-notes', ['Garden Notes'])).toBe(true)
    expect(tagMatchesLabel('tokyo-dev', ['Tokyo Dev', 'Other'])).toBe(true)
    expect(tagMatchesLabel('ops', ['Operations'])).toBe(false)
  })

  it('compares forwarded subjects without their tags', () => {
    expect(sameSubject('[team] Plans', 'Re: Plans')).toBe(true)
  })
})

describe('kinds of subject tag', () => {
  it('tells what needs you from a list name, and hides a tag that repeats the sender', () => {
    expect(tagKind('Action required', 'Stripe')).toBe('action')
    expect(tagKind('URGENT', 'Bank')).toBe('action')
    expect(tagKind('Reminder', null)).toBe('action')
    expect(tagKind('Payment failed', 'Netflix')).toBe('action')
    expect(tagKind('Due', 'Due')).toBe('sender')
    expect(tagKind('Contoso', 'Contoso Support')).toBe('sender')
    expect(tagKind('garden-notes', 'Notes from the Garden Club')).toBe('list')
    expect(tagKind('Dues', 'Club')).toBe('list')
  })
})
