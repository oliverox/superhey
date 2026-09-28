// How a Coming up row words itself: what to show under a date, and whether a reply makes sense.
import type { PostingRow } from '@shared/api'

// Small words that don't carry the meaning ("Check in *for* flight").
const FILLER = new Set(['a', 'an', 'the', 'to', 'for', 'at', 'in', 'on', 'of', 'with', 'your', 'my', 'and'])
const PARTICLES = new Set(['in', 'on', 'up', 'out', 'off'])
const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/[()[\],.:;!?"“”‘’]/g, ' ')
    .split(/[\s-]+/)
    .filter(Boolean)

/**
 * The to-do without what the date above it already says: under "Flight to Antananarivo
 * (MK 288)", "Check in for flight MK 288 to Antananarivo" is just "Check in". Unchanged
 * when it adds more than the verb, or when nothing would be left.
 */
export function taskUnder(task: string, label: string): string {
  const said = new Set(words(label))
  const parts = task.trim().split(/\s+/)
  for (let cut = 1; cut < parts.length; cut++) {
    const rest = parts.slice(cut).flatMap(words)
    const meaning = rest.filter((w) => !FILLER.has(w))
    // The repeat starts at a word that means something, not at "for" or "in".
    if (FILLER.has(rest[0] ?? '') || !meaning.length || !meaning.every((w) => said.has(w))) continue
    const kept = parts.slice(0, cut)
    // Drop the linking words left at the end ("Prepare for"), not a verb's own ("Check in").
    const last = () => words(kept.at(-1)!)[0] ?? ''
    while (kept.length > 1 && FILLER.has(last()) && !PARTICLES.has(last())) kept.pop()
    const out = kept.join(' ').replace(/[,:;–-]+$/, '')
    return out || task
  }
  return task
}

// Addresses nobody reads: noreply@, do-not-reply@, notifications@, alerts@…
const UNREAD_ADDRESS = /^(no[-_.]?reply|do[-_.]?not[-_.]?reply|notifications?|alerts?|mailer[-_.]daemon|bounces?|automated|info|news(letter)?)([-_.+][^@]*)?@/i

// What a machine sends: confirmations, receipts, tracking, marketing.
const AUTOMATED = new Set(['notification', 'receipt', 'shipping', 'newsletter', 'promotion'])

/**
 * Whether replying could reach someone: not a no-reply address, and not a machine's
 * message. A booking confirmation isn't answered to confirm it, but can be to move it.
 */
export function canReply(p: Pick<PostingRow, 'senderEmail' | 'ai'>, purpose: 'confirm' | 'move'): boolean {
  if (p.senderEmail && UNREAD_ADDRESS.test(p.senderEmail)) return false
  const category = p.ai?.category
  if (category && AUTOMATED.has(category)) return false
  if (purpose === 'confirm' && category === 'booking') return false
  return true
}
