// Turning addresses into the words a person would use.

export interface Addr {
  name: string | null
  email: string
  isMe?: boolean
}

/** "Barender Appadoo", or "barenderest" when HEY has no name. Quotes and brackets trimmed. */
export function displayName(p: Addr): string {
  const name = p.name?.replace(/^["'\s]+|["'\s]+$/g, '').trim()
  if (name && name.toLowerCase() !== p.email.toLowerCase()) return name
  return p.email.split('@')[0] ?? p.email
}

/** False when HEY's "name" is only the address, or the part before the @. */
export function hasRealName(p: Addr): boolean {
  const name = p.name?.replace(/^["'\s]+|["'\s]+$/g, '').trim().toLowerCase()
  const email = p.email.toLowerCase()
  return !!name && name !== email && name !== email.split('@')[0]
}

/** First name for compact lists; organisations keep their full name. */
export function shortName(p: Addr): string {
  if (p.isMe) return 'you'
  const full = displayName(p)
  if (!p.name) return full
  const words = full.split(/\s+/)
  // "National Science Association (NSA)" reads badly as "National"; only people get shortened.
  const looksPersonal = words.length <= 3 && !/[()&]|\b(team|inc|ltd|llc|the|of|for|and)\b/i.test(full)
  return looksPersonal ? words[0]! : full
}

/**
 * "to you", "to Barender and José", "to you, Barender and 3 others".
 * You come first; at most two names are spelled out.
 */
export function summarizeRecipients(to: Addr[], cc: Addr[]): string {
  const all = dedupe([...to, ...cc])
  if (!all.length) return ''
  const ordered = [...all.filter((p) => p.isMe), ...all.filter((p) => !p.isMe)]
  const shown = ordered.slice(0, ordered.length === 3 ? 3 : 2).map(shortName)
  const rest = ordered.length - shown.length
  if (rest === 0) return `to ${joinAnd(shown)}`
  return `to ${shown.join(', ')} and ${rest} ${rest === 1 ? 'other' : 'others'}`
}

/**
 * The recipient summary from longest to shortest, for when space is tight:
 * "to you, Barender and 3 others" → "to you and 4 others" → "to you +4".
 * The first is summarizeRecipients; the last always fits a narrow column.
 */
export function recipientSummaries(to: Addr[], cc: Addr[]): string[] {
  const full = summarizeRecipients(to, cc)
  if (!full) return []
  const all = dedupe([...to, ...cc])
  const ordered = [...all.filter((p) => p.isMe), ...all.filter((p) => !p.isMe)]
  const first = shortName(ordered[0]!)
  const rest = ordered.length - 1
  const out = [full]
  if (rest > 0) {
    out.push(`to ${first} and ${rest} ${rest === 1 ? 'other' : 'others'}`)
    out.push(`to ${first} +${rest}`)
  }
  return [...new Set(out)]
}

export function dedupe(list: Addr[]): Addr[] {
  const seen = new Set<string>()
  return list.filter((p) => {
    const key = p.email.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function joinAnd(parts: string[]) {
  if (parts.length <= 1) return parts.join('')
  return `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`
}

/** "Name <email>" lines, the form mail apps paste best. */
export function formatAddressList(list: Addr[]): string {
  return list.map((p) => (hasRealName(p) ? `${displayName(p)} <${p.email}>` : p.email)).join(', ')
}

export interface MessagePeople {
  from: Addr | null
  to: Addr[]
  cc: Addr[]
}

/**
 * Who a reply goes to, the way HEY addresses one: `reply` answers the sender; `reply-all`
 * adds everyone the message was addressed to, keeping Cc as Cc. You are never included,
 * and replying to your own message goes back to its recipients.
 */
export function replyRecipients(msg: MessagePeople, mode: 'reply' | 'reply-all'): { to: string[]; cc: string[] } {
  const notMe = (list: Addr[]) => list.filter((p) => !p.isMe)
  const fromOther = msg.from && !msg.from.isMe ? [msg.from] : []
  const base = fromOther.length ? fromOther : notMe(msg.to)
  if (mode === 'reply') return { to: emails(dedupe(base)), cc: [] }
  const to = dedupe([...base, ...notMe(msg.to)])
  const toSet = new Set(to.map((p) => p.email.toLowerCase()))
  const cc = dedupe(notMe(msg.cc)).filter((p) => !toSet.has(p.email.toLowerCase()))
  return { to: emails(to), cc: emails(cc) }
}

const emails = (list: Addr[]) => list.map((p) => p.email)
