import type { EntryRow, OutgoingRecord } from '@shared/api'

/**
 * Whether the thread already has the message HEY delivered for `r`: one of yours, written
 * no earlier than a minute before it was due to leave.
 */
export function isDelivered(r: OutgoingRecord, entries: EntryRow[]): boolean {
  if (r.status !== 'sent') return false
  const since = r.sendsAt - 60_000
  return entries.some((e) => (e.isMine || e.from?.isMe) && Date.parse(e.createdAt) >= since)
}
