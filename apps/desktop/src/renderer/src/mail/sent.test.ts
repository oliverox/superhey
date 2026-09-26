import { describe, expect, it } from 'vitest'
import type { EntryRow, OutgoingRecord } from '@shared/api'
import { isDelivered } from './sent'

const sendsAt = Date.parse('2026-09-26T12:00:05Z')
const record = (status: OutgoingRecord['status']) => ({ id: 1, kind: 'reply', status, message: { to: ['a@example.com'], body: 'Hi', threadId: 9 }, forwardOf: null, sendsAt, error: null }) as OutgoingRecord
const entry = (createdAt: string, isMe: boolean) => ({ id: 1, createdAt, isMine: isMe, from: { name: null, email: 'x@example.com', isMe } }) as unknown as EntryRow

describe('a sent reply in its thread', () => {
  it('is replaced once the thread has your message from when it left', () => {
    expect(isDelivered(record('sent'), [entry('2026-09-26T12:00:07Z', true)])).toBe(true)
  })
  it('stays while it waits or sends, and ignores older messages and other people', () => {
    expect(isDelivered(record('pending'), [entry('2026-09-26T12:00:07Z', true)])).toBe(false)
    expect(isDelivered(record('sent'), [entry('2026-09-25T12:00:00Z', true), entry('2026-09-26T12:00:07Z', false)])).toBe(false)
  })
})
