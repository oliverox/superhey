import { EventEmitter } from 'node:events'
import type { HeyClient, OutgoingMessage } from '../cli/client'
import type { TopicId } from '../ids'

export type OutgoingKind = 'new' | 'reply' | 'reply-all' | 'forward'
export type OutgoingStatus = 'pending' | 'sending' | 'sent' | 'failed' | 'cancelled'

export interface OutgoingRecord {
  id: number
  kind: OutgoingKind
  status: OutgoingStatus
  /** Kept so a cancelled or failed message can go straight back into the composer. */
  message: OutgoingMessage
  /** For forwards: the thread being forwarded. */
  forwardOf: TopicId | null
  /** When the message leaves for HEY, while pending (epoch ms). */
  sendsAt: number
  error: string | null
}

export const UNDO_SEND_MS = 5000

/**
 * Holds outgoing mail for a short undo window before handing it to HEY. The CLI can't
 * recall a sent message, so this is the only undo there is: nothing reaches HEY until the
 * window has passed. Sending always starts from a person pressing Send.
 */
export class Outbox extends EventEmitter<{ outgoing: [OutgoingRecord]; sent: [OutgoingRecord] }> {
  private readonly records = new Map<number, OutgoingRecord>()
  private readonly timers = new Map<number, ReturnType<typeof setTimeout>>()
  private nextId = 1

  constructor(
    private readonly client: HeyClient,
    private readonly delayMs = UNDO_SEND_MS,
    /** Test instances: never deliver; a queued message fails instead of reaching anyone. */
    private readonly sendingDisabled = false,
  ) {
    super()
  }

  /** Queues a message; it goes to HEY after the undo window unless cancelled. */
  send(message: OutgoingMessage, kind: OutgoingKind, forwardOf: TopicId | null = null): OutgoingRecord {
    const record: OutgoingRecord = {
      id: this.nextId++,
      kind,
      status: 'pending',
      message,
      forwardOf,
      sendsAt: Date.now() + this.delayMs,
      error: null,
    }
    this.records.set(record.id, record)
    this.timers.set(
      record.id,
      setTimeout(() => void this.deliver(record.id), this.delayMs),
    )
    this.emit('outgoing', { ...record })
    return { ...record }
  }

  /** Stops a pending message. Returns it (with its content) so it can be edited again. */
  cancel(id: number): OutgoingRecord {
    const record = this.records.get(id)
    if (!record) throw new Error(`no outgoing message ${id}`)
    if (record.status !== 'pending') throw new Error(`Too late to undo: the message is ${record.status}`)
    clearTimeout(this.timers.get(id))
    this.timers.delete(id)
    return this.update(record, { status: 'cancelled' })
  }

  /** Saves a message as a HEY draft (for review or sending later from any HEY app). */
  async saveDraft(message: OutgoingMessage): Promise<number | null> {
    return (await this.client.compose(message, { draft: true })).draftId
  }

  get(id: number): OutgoingRecord | null {
    const r = this.records.get(id)
    return r ? { ...r } : null
  }

  hasPending(): boolean {
    return this.timers.size > 0
  }

  /** Sends everything still waiting, now (e.g. when the app quits). */
  async flush() {
    await Promise.all([...this.timers.keys()].map((id) => this.deliver(id)))
  }

  private async deliver(id: number) {
    const record = this.records.get(id)
    clearTimeout(this.timers.get(id))
    this.timers.delete(id)
    if (!record || record.status !== 'pending') return
    this.update(record, { status: 'sending' })
    try {
      if (this.sendingDisabled) throw new Error('Sending is disabled in this test instance')
      if (record.kind === 'forward') {
        if (record.forwardOf == null) throw new Error('nothing to forward')
        await this.client.forward(record.forwardOf, record.message)
      } else {
        await this.client.compose(record.message)
      }
      this.emit('sent', this.update(record, { status: 'sent' }))
    } catch (err) {
      this.update(record, { status: 'failed', error: err instanceof Error ? err.message : String(err) })
    }
  }

  private update(record: OutgoingRecord, patch: Partial<OutgoingRecord>): OutgoingRecord {
    Object.assign(record, patch)
    const copy = { ...record }
    this.emit('outgoing', copy)
    return copy
  }
}
