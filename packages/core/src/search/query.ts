/**
 * Search queries as Gmail writes them: free words, "exact phrases", -excluded words,
 * a OR b, and operators (from:, to:, subject:, in:, label:, has:, is:, after:, before:,
 * newer_than:, older_than:). Parsed once, then run against the cache and against HEY.
 */

/** HEY's attachment kinds (`hey search --attachment`). */
export const ATTACHMENT_KINDS = ['any', 'images', 'pdfs', 'calendar_invites', 'documents', 'spreadsheets', 'presentations', 'media', 'zip_files'] as const
export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number]

/** Box kinds as the cache names them. HEY's search reaches the first three and Trash. */
export const SEARCH_BOXES = ['imbox', 'feedbox', 'trailbox', 'laterbox', 'asidebox', 'bubblebox', 'trash'] as const
export type SearchBox = (typeof SEARCH_BOXES)[number]

export interface SearchQuery {
  /** Words that must all appear. */
  words: string[]
  /** Phrases that must appear as written. */
  phrases: string[]
  /** Words that must not appear. */
  excluded: string[]
  /** Groups where at least one word must appear (a OR b, {a b}). */
  anyOf: string[][]
  from: string | null
  to: string | null
  subject: string | null
  box: SearchBox | null
  label: string | null
  attachment: AttachmentKind | null
  /** Read state; known only for mail in the cache. */
  read: boolean | null
  /** YYYY-MM-DD, inclusive. */
  after: string | null
  /** YYYY-MM-DD, exclusive (as in Gmail). */
  before: string | null
  /** Operators that didn't make sense, to show rather than silently ignore. */
  problems: string[]
}

export const OPERATORS = ['from', 'to', 'subject', 'in', 'label', 'has', 'is', 'after', 'before', 'newer_than', 'older_than'] as const
export type Operator = (typeof OPERATORS)[number]

const BOX_NAMES: Record<string, SearchBox> = {
  imbox: 'imbox', inbox: 'imbox',
  feed: 'feedbox', thefeed: 'feedbox', feedbox: 'feedbox',
  papertrail: 'trailbox', trail: 'trailbox', trailbox: 'trailbox', paper: 'trailbox',
  later: 'laterbox', replylater: 'laterbox', laterbox: 'laterbox',
  aside: 'asidebox', setaside: 'asidebox', asidebox: 'asidebox',
  bubble: 'bubblebox', bubbleup: 'bubblebox', bubblebox: 'bubblebox',
  trash: 'trash', bin: 'trash',
}

const ATTACHMENT_NAMES: Record<string, AttachmentKind> = {
  attachment: 'any', attachments: 'any', file: 'any', files: 'any',
  image: 'images', images: 'images', photo: 'images', photos: 'images',
  pdf: 'pdfs', pdfs: 'pdfs',
  invite: 'calendar_invites', invites: 'calendar_invites', calendar: 'calendar_invites', ics: 'calendar_invites',
  document: 'documents', documents: 'documents', doc: 'documents', docs: 'documents',
  spreadsheet: 'spreadsheets', spreadsheets: 'spreadsheets', sheet: 'spreadsheets', xls: 'spreadsheets',
  presentation: 'presentations', presentations: 'presentations', slides: 'presentations',
  media: 'media', video: 'media', audio: 'media',
  zip: 'zip_files', zips: 'zip_files', archive: 'zip_files',
}

const empty = (): SearchQuery => ({
  words: [], phrases: [], excluded: [], anyOf: [], from: null, to: null, subject: null, box: null,
  label: null, attachment: null, read: null, after: null, before: null, problems: [],
})

interface Token {
  /** The operator, lowercased, or null for a plain term. */
  key: string | null
  value: string
  quoted: boolean
  negated: boolean
  /** A {a b} group. */
  group?: string[]
}

/** Splits a query into terms, keeping "quoted values" and {groups} whole. */
function tokenize(input: string): Token[] {
  const tokens: Token[] = []
  const re = /(-?)(?:([a-z_]+):)?(?:"([^"]*)"?|\{([^}]*)\}?|(\S+))/gi
  for (const m of input.matchAll(re)) {
    const [, neg, key, quoted, group, bare] = m
    if (group != null) {
      tokens.push({ key: null, value: group, quoted: false, negated: false, group: group.split(/\s+/).filter(Boolean) })
      continue
    }
    const value = quoted ?? bare ?? ''
    const k = key?.toLowerCase() ?? null
    // An operator still being typed ("from:" with nothing after it yet) asks for nothing.
    if (!k && /^-?[a-z_]+:$/i.test(value) && (OPERATORS as readonly string[]).includes(value.replace(/^-|:$/g, '').toLowerCase())) continue
    // "a:b" where a isn't an operator (a time, a URL) is just a word.
    if (k && !(OPERATORS as readonly string[]).includes(k)) tokens.push({ key: null, value: `${key}:${value}`, quoted: false, negated: !!neg })
    else tokens.push({ key: k, value, quoted: quoted != null, negated: !!neg })
  }
  return tokens
}

/** `today` anchors newer_than/older_than; YYYY-MM-DD in local time. */
export function parseQuery(input: string, today = new Date()): SearchQuery {
  const q = empty()
  const tokens = tokenize(input)
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!
    if (t.group) {
      if (t.group.length) q.anyOf.push(t.group)
      continue
    }
    if (t.key == null) {
      if (!t.value) continue
      // a OR b (OR b…): one group.
      if (!t.negated && !t.quoted && tokens[i + 1]?.key == null && tokens[i + 1]?.value === 'OR' && tokens[i + 2] && tokens[i + 2]!.key == null) {
        const group = [t.value]
        while (tokens[i + 1]?.value === 'OR' && tokens[i + 2]?.key == null && tokens[i + 2]?.value) {
          group.push(tokens[i + 2]!.value)
          i += 2
        }
        q.anyOf.push(group)
        continue
      }
      if (t.negated) q.excluded.push(t.value)
      else if (t.quoted) q.phrases.push(t.value)
      else q.words.push(t.value)
      continue
    }
    const v = t.value.trim()
    if (!v) continue
    switch (t.key as Operator) {
      case 'from':
      case 'to':
      case 'subject':
      case 'label':
        q[t.key as 'from' | 'to' | 'subject' | 'label'] = v
        break
      case 'in': {
        const box = BOX_NAMES[v.toLowerCase().replace(/[\s_-]/g, '')]
        if (box) q.box = box
        else q.problems.push(`in:${v}`)
        break
      }
      case 'has': {
        const kind = ATTACHMENT_NAMES[v.toLowerCase()]
        if (kind) q.attachment = kind
        else q.problems.push(`has:${v}`)
        break
      }
      case 'is': {
        const s = v.toLowerCase()
        if (s === 'unread' || s === 'new') q.read = false
        else if (s === 'read' || s === 'seen') q.read = true
        else q.problems.push(`is:${v}`)
        break
      }
      case 'after':
      case 'before': {
        const d = parseDate(v)
        if (d) q[t.key as 'after' | 'before'] = d
        else q.problems.push(`${t.key}:${v}`)
        break
      }
      case 'newer_than':
      case 'older_than': {
        const d = ago(v, today)
        if (!d) q.problems.push(`${t.key}:${v}`)
        else if (t.key === 'newer_than') q.after = d
        else q.before = d
        break
      }
    }
  }
  return q
}

/** 2026-09-25, 2026/9/25 or 25/09/2026 as YYYY-MM-DD. */
function parseDate(s: string): string | null {
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s)
  let y: number, mo: number, d: number
  if (m) [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  else if ((m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s))) [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])]
  else if ((m = /^(\d{4})$/.exec(s))) [y, mo, d] = [Number(m[1]), 1, 1]
  else return null
  const date = new Date(y, mo - 1, d)
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return null
  return ymd(date)
}

/** 7d, 2w, 3m, 1y before `today`. */
function ago(s: string, today: Date): string | null {
  const m = /^(\d{1,4})([dwmy])$/i.exec(s)
  if (!m) return null
  const n = Number(m[1])
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const unit = m[2]!.toLowerCase()
  if (unit === 'd') d.setDate(d.getDate() - n)
  else if (unit === 'w') d.setDate(d.getDate() - 7 * n)
  else if (unit === 'm') d.setMonth(d.getMonth() - n)
  else d.setFullYear(d.getFullYear() - n)
  return ymd(d)
}

export function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Whether the query asks for anything at all. */
export function isEmptyQuery(q: SearchQuery): boolean {
  return (
    !q.words.length && !q.phrases.length && !q.excluded.length && !q.anyOf.length && !q.from && !q.to && !q.subject &&
    !q.box && !q.label && !q.attachment && q.read == null && !q.after && !q.before
  )
}

/** The words to highlight in results. */
export function highlightTerms(q: SearchQuery): string[] {
  return [...q.words, ...q.phrases, ...q.anyOf.flat(), ...(q.subject ? q.subject.split(/\s+/) : [])].filter((w) => w.length > 1)
}

/**
 * The query text with `op:` set to `value` (or removed when null), for filter chips that
 * edit the text the person typed. Values with spaces are quoted.
 */
export function withOperator(input: string, op: Operator, value: string | null): string {
  const re = new RegExp(`(^|\\s)-?${op}:(?:"[^"]*"?|\\S*)`, 'gi')
  const rest = input.replace(re, ' ').replace(/\s+/g, ' ').trim()
  if (value == null) return rest
  const v = /\s/.test(value) ? `"${value}"` : value
  return `${rest}${rest ? ' ' : ''}${op}:${v}`
}

/** The value of `op:` in the text, as typed (for chips showing what's set). */
export function operatorValue(input: string, op: Operator): string | null {
  const m = new RegExp(`(?:^|\\s)${op}:(?:"([^"]*)"?|(\\S+))`, 'i').exec(input)
  return m ? (m[1] ?? m[2] ?? null) : null
}
