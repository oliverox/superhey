import { useEffect, useState } from 'react'
import type { EntryRow, OutgoingRecord } from '@shared/api'
import { onApiEvent } from './api'
import { isDelivered } from './mail/sent'

/**
 * Replies on their way, kept for the whole window (not one view), so a thread shows what you
 * just sent even if you leave it and come back before HEY has it.
 */
const records = new Map<number, OutgoingRecord>()
const listeners = new Set<() => void>()
let subscribed = false

function subscribe() {
  if (subscribed) return
  subscribed = true
  onApiEvent((e) => {
    if (e.type !== 'outgoing') return
    if (e.record.status === 'cancelled') records.delete(e.record.id)
    else records.set(e.record.id, e.record)
    listeners.forEach((l) => l())
  })
}

/** Stops showing a reply (e.g. a failed one taken back into the composer). */
export function dropOutgoing(id: number) {
  records.delete(id)
  listeners.forEach((l) => l())
}

/** Your replies to this thread that are waiting, sending, sent (until the thread has them) or failed. */
export function useOutgoingReplies(topicId: number | null, entries: EntryRow[]): OutgoingRecord[] {
  const [, setTick] = useState(0)
  useEffect(() => {
    subscribe()
    const l = () => setTick((t) => t + 1)
    listeners.add(l)
    return () => void listeners.delete(l)
  }, [])
  if (topicId == null) return []
  return [...records.values()].filter((r) => r.kind !== 'forward' && r.message.threadId === topicId && !isDelivered(r, entries))
}

/**
 * Open a thread's reply with some words in it (e.g. from Today: "Ask to move it…"), for
 * ⌘J to draft in your voice. Kept until the thread's reply area picks it up.
 */
let pendingReply: { topicId: number; body: string } | null = null
export function replyWith(topicId: number, body: string) {
  pendingReply = { topicId, body }
  window.dispatchEvent(new CustomEvent('superhey:reply-with'))
}
export function takeReplyFor(topicId: number): string | null {
  if (pendingReply?.topicId !== topicId) return null
  const { body } = pendingReply
  pendingReply = null
  return body
}
