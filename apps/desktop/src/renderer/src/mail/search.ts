// The search box's helpers: completing operators as you type, merging the cache's results
// with HEY's, and finding the words to highlight.
import { OPERATORS, type Operator } from '@superhey/core/search/query'
import type { PostingRow } from '@shared/api'

/** What's being typed at the end of the query: an operator's value, or an operator's name. */
export type Completing =
  | { kind: 'value'; op: Operator; value: string; start: number }
  | { kind: 'operator'; prefix: string; start: number }

/** What the last term of `text` is, if it's something to complete. */
export function completing(text: string): Completing | null {
  const value = /(^|\s)-?([a-z_]+):("[^"]*|[^\s"]*)$/i.exec(text)
  if (value && (OPERATORS as readonly string[]).includes(value[2]!.toLowerCase())) {
    return { kind: 'value', op: value[2]!.toLowerCase() as Operator, value: value[3]!.replace(/^"/, ''), start: value.index + value[1]!.length }
  }
  const word = /(^|\s)([a-z_]{2,})$/i.exec(text)
  if (word && OPERATORS.some((o) => o.startsWith(word[2]!.toLowerCase()) && o !== word[2]!.toLowerCase())) {
    return { kind: 'operator', prefix: word[2]!.toLowerCase(), start: word.index + word[1]!.length }
  }
  return null
}

export interface Suggestion {
  label: string
  hint?: string
  /** Replaces the term being typed. Ends with ":" to keep completing, else a space follows. */
  insert: string
}

/** What each operator does, for the tips and for completing its name. */
export const OPERATOR_HELP: Record<Operator, { example: string; hint: string }> = {
  from: { example: 'from:sam', hint: 'Sender' },
  to: { example: 'to:sam', hint: 'Recipient' },
  subject: { example: 'subject:invoice', hint: 'Words in the subject' },
  in: { example: 'in:feed', hint: 'A box' },
  label: { example: 'label:travel', hint: 'A label' },
  has: { example: 'has:pdf', hint: 'Attachments' },
  is: { example: 'is:unread', hint: 'Read or unread' },
  after: { example: 'after:2026-01-31', hint: 'On or after a day' },
  before: { example: 'before:2026-01-31', hint: 'Before a day' },
  newer_than: { example: 'newer_than:7d', hint: 'Within the last 7 days (d, w, m, y)' },
  older_than: { example: 'older_than:1y', hint: 'Older than a year' },
}

const quote = (v: string) => (/\s/.test(v) ? `"${v}"` : v)

/** Fixed choices per operator; from:, to: and label: are looked up instead. */
const CHOICES: Partial<Record<Operator, Array<[string, string]>>> = {
  in: [['imbox', 'Imbox'], ['feed', 'The Feed'], ['papertrail', 'Paper Trail'], ['later', 'Reply Later'], ['aside', 'Set Aside'], ['bubble', 'Bubble Up'], ['trash', 'Trash']],
  has: [['attachment', 'Any attachment'], ['pdf', 'PDF'], ['image', 'Image'], ['document', 'Document'], ['spreadsheet', 'Spreadsheet'], ['presentation', 'Presentation'], ['media', 'Audio or video'], ['zip', 'Zip file'], ['invite', 'Calendar invite']],
  is: [['unread', 'Unread'], ['read', 'Read']],
  newer_than: [['1d', 'Last day'], ['7d', 'Last 7 days'], ['1m', 'Last month'], ['1y', 'Last year']],
  older_than: [['7d', 'Older than a week'], ['1m', 'Older than a month'], ['1y', 'Older than a year']],
}

/**
 * Suggestions for what's being typed. `people` and `labels` are what's known for from:/to:
 * and label: (looked up by the caller as the value changes).
 */
export function suggestions(c: Completing | null, people: Array<{ name: string | null; email: string }> = [], labels: string[] = []): Suggestion[] {
  if (!c) return []
  if (c.kind === 'operator') {
    return OPERATORS.filter((o) => o.startsWith(c.prefix)).map((o) => ({ label: `${o}:`, hint: OPERATOR_HELP[o].hint, insert: `${o}:` }))
  }
  const v = c.value.toLowerCase()
  if (c.op === 'from' || c.op === 'to') return people.map((p) => ({ label: p.name ?? p.email, hint: p.name ? p.email : undefined, insert: `${c.op}:${p.email}` }))
  if (c.op === 'label') return labels.filter((l) => l.toLowerCase().includes(v)).slice(0, 8).map((l) => ({ label: l, insert: `label:${quote(l)}` }))
  return (CHOICES[c.op] ?? [])
    .filter(([value, label]) => !v || value.startsWith(v) || label.toLowerCase().split(/\s+/).some((w) => w.startsWith(v)))
    .map(([value, label]) => ({ label, hint: `${c.op}:${value}`, insert: `${c.op}:${value}` }))
}

/** The text with the term being typed replaced by a suggestion. */
export function accept(text: string, c: Completing, s: Suggestion): string {
  return text.slice(0, c.start) + s.insert + (s.insert.endsWith(':') ? '' : ' ')
}

/** The cache's results and HEY's, one row per thread (the cache's when both have it: it knows more), newest first. */
export function mergeResults(local: PostingRow[], hey: PostingRow[]): PostingRow[] {
  const byTopic = new Map<number, PostingRow>()
  for (const r of [...local, ...hey]) if (r.topicId != null && !byTopic.has(r.topicId)) byTopic.set(r.topicId, r)
  return [...byTopic.values()].sort((a, b) => (b.activeAt ?? '').localeCompare(a.activeAt ?? ''))
}

/** `text` split into plain and matching parts (case-insensitive), for highlighting. */
export function splitMatches(text: string, terms: string[]): Array<{ text: string; match: boolean }> {
  const words = [...new Set(terms.map((t) => t.trim()).filter((t) => t.length > 1))].sort((a, b) => b.length - a.length)
  if (!words.length || !text) return [{ text, match: false }]
  const re = new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi')
  return text
    .split(re)
    .filter(Boolean)
    .map((part) => ({ text: part, match: words.some((w) => w.toLowerCase() === part.toLowerCase()) }))
}
