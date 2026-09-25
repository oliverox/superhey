// Finds the "---------- Forwarded message ---------" block that mail apps paste into a body
// and turns it into data, so the reader can show a compact card instead of five header lines.
import type { Addr } from './people'

export interface ForwardedHeader {
  from: Addr | null
  date: string | null
  subject: string | null
  to: Addr[]
  cc: Addr[]
}

export interface ForwardedSplit {
  before: string
  header: ForwardedHeader
  after: string
}

// Gmail: "---------- Forwarded message ---------"; Apple Mail: "Begin forwarded message:".
// HEY escapes the dashes in Markdown ("\---"). Outlook's "Original Message" is a reply
// quote, handled in quoted.ts.
const MARKER = /^[ \t]*\\?-{2,}\s*Forwarded message\s*-{2,}[ \t]*$|^[ \t]*Begin forwarded message:[ \t]*$/im
const FIELD = /^[ \t>]*(From|Date|Sent|Subject|To|Cc)[ \t]*:[ \t]*(.*)$/i

export function splitForwarded(markdown: string): ForwardedSplit | null {
  const marker = MARKER.exec(markdown)
  if (!marker) return null

  const lines = markdown.slice(marker.index + marker[0].length).split('\n')
  const header: ForwardedHeader = { from: null, date: null, subject: null, to: [], cc: [] }
  let i = 0
  while (i < lines.length && !lines[i]!.trim()) i++ // blank lines right after the marker
  let fields = 0
  let last: string | null = null
  for (; i < lines.length; i++) {
    const line = lines[i]!
    if (!line.trim()) {
      // Some mailers put a blank line between the fields ("From: …", blank, "Date: …").
      let next = i + 1
      while (next < lines.length && !lines[next]!.trim()) next++
      if (fields > 0 && next < lines.length && FIELD.test(lines[next]!)) {
        i = next - 1
        continue
      }
      break
    }
    const m = FIELD.exec(line)
    if (m) {
      last = m[1]!.toLowerCase()
      apply(header, last, clean(m[2]!))
      fields++
    } else if (last === 'to' || last === 'cc') {
      // A long recipient list can wrap onto the next line.
      header[last].push(...parseAddresses(clean(line)))
    } else {
      break
    }
  }
  if (fields < 2 || !header.from) return null

  return {
    before: markdown.slice(0, marker.index).trimEnd(),
    header,
    after: lines.slice(i).join('\n').replace(/^\s+/, ''),
  }
}

function apply(h: ForwardedHeader, field: string, value: string) {
  if (field === 'from') h.from = parseAddresses(value)[0] ?? null
  else if (field === 'date' || field === 'sent') h.date = value || null
  else if (field === 'subject') h.subject = value || null
  else if (field === 'to') h.to.push(...parseAddresses(value))
  else if (field === 'cc') h.cc.push(...parseAddresses(value))
}

/** Undoes HEY's Markdown: escapes, bold, links, hard-break spaces. */
function clean(value: string) {
  return value
    .replace(/\[([^\]]*)\]\((?:mailto:)?[^)]*\)/g, '$1')
    .replace(/\\([\\`*_{}[\]()#+\-.!<>|~])/g, '$1')
    .replace(/\*\*|__/g, '')
    .trim()
}

const EMAIL = /[^\s<>(),;"']+@[^\s<>(),;"']+\.[^\s<>(),;"']+/

/** "Name <a@b.c>, c@d.e" → addresses. Commas inside quotes or brackets don't split. */
export function parseAddresses(value: string): Addr[] {
  // Gmail joins the last two with a word ("A <a>, B <b> and C <c>"; "et" in French).
  value = value.replace(/>\s+(?:and|et|und|y|e)\s+/gi, '>, ')
  const parts: string[] = []
  let depth = 0
  let quoted = false
  let current = ''
  for (const ch of value) {
    if (ch === '"') quoted = !quoted
    if (ch === '<') depth++
    if (ch === '>') depth = Math.max(0, depth - 1)
    if ((ch === ',' || ch === ';') && depth === 0 && !quoted) {
      parts.push(current)
      current = ''
    } else current += ch
  }
  parts.push(current)

  return parts.flatMap((part) => {
    const email = EMAIL.exec(part)?.[0]
    if (!email) return []
    const name = part
      .replace(/<[^>]*>/, '')
      .replace(email, '')
      .replace(/^[\s"']+|[\s"']+$/g, '')
    return [{ name: name || null, email: email.toLowerCase() }]
  })
}

// Re:, Fwd:, Fw:, and the German/French/Scandinavian forms, possibly stacked ("Re: Fwd: …").
const PREFIXES = /^\s*((re|fwd?|fw|aw|wg|tr|sv|vs)\s*(\[\d+\])?\s*:\s*)+/i

// A mailing list's tag at the front: "[garden-notes] …". Not a ticket number ("[#4521]",
// "[1234]"): that's part of the subject.
const LIST_TAG = /^\s*\[([^\[\]]{2,40})\]\s*/
const isTicket = (tag: string) => /^#?\s*[\d\s-]+$/.test(tag)

/**
 * The subject's mailing-list tags and what's left: "Re: [tokyo-dev] Re: Meetup" is
 * { tags: ['tokyo-dev'], rest: 'Meetup' }. Reply/forward prefixes are dropped wherever they are.
 */
export function listTags(subject: string): { tags: string[]; rest: string } {
  const tags: string[] = []
  let rest = subject
  for (;;) {
    const before = rest
    rest = rest.replace(PREFIXES, '')
    const m = LIST_TAG.exec(rest)
    if (m && !isTicket(m[1]!)) {
      if (!tags.some((t) => t.toLowerCase() === m[1]!.toLowerCase())) tags.push(m[1]!.trim())
      rest = rest.slice(m[0].length)
    }
    if (rest === before) break
  }
  rest = rest.trim()
  return rest ? { tags, rest } : { tags: [], rest: subject.replace(PREFIXES, '').trim() || subject }
}

/** Whether a HEY label already says what a list tag does ("Garden Notes" ~ "garden-notes"). */
export function tagMatchesLabel(tag: string, labels: string[]): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
  return labels.some((l) => norm(l) === norm(tag))
}

/** The subject without reply/forward prefixes or mailing-list tags, for titles. */
export function stripSubjectPrefixes(subject: string): string {
  return listTags(subject).rest
}

/** Whether a forwarded subject just repeats the thread's subject. */
export function sameSubject(a: string | null, b: string | null) {
  const norm = (s: string | null) =>
    listTags(s ?? '').rest
      .replace(/["'“”‘’]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase()
  return norm(a) === norm(b)
}

/**
 * Reads the date line of a forwarded header ("Thu, 13 Aug 2026, 11:20",
 * "3 September 2026 at 09:12:00 GMT+4"). Null when it can't be read reliably.
 */
export function parseForwardedDate(value: string | null): Date | null {
  if (!value) return null
  const cleaned = value
    .replace(/^(mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?,?\s+/i, '') // weekday
    .replace(/\s+at\s+/i, ' ')
    .replace(/,/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const t = Date.parse(cleaned)
  return Number.isNaN(t) ? null : new Date(t)
}

/**
 * Undoes the hard line breaks of mail written at a fixed width: a line that doesn't end a
 * sentence, followed by one that carries on (starts lowercase), was one line. Only the
 * Markdown hard break (two trailing spaces, or a backslash) is removed, so the text flows;
 * breaks that mean something ("Dear friends,", "Allah'u'abha.") stay. Works inside quotes.
 */
export function unwrapHardBreaks(markdown: string): string {
  const lines = markdown.split('\n')
  for (let i = 0; i < lines.length - 1; i++) {
    const line = lines[i]!
    const next = lines[i + 1]!
    const quote = /^((?:[ \t]*>)*[ \t]?)/.exec(line)![1]!
    if (!/(?: {2,}|\\)$/.test(line) || !next.startsWith(quote.trimEnd())) continue
    const text = line.slice(quote.length).replace(/(?: {2,}|\\)$/, '')
    const carriesOn = next.slice(quote.trimEnd().length).trimStart()
    if (/[.!?:;…]["'”’)]*$/.test(text.trim()) || !/^\p{Ll}/u.test(carriesOn)) continue
    lines[i] = quote + text
  }
  return lines.join('\n')
}
