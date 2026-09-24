import { z } from 'zod'
import { PostingId, TopicId } from '../ids'
import type { HeyRunner } from './runner'
import * as S from './schemas'

export type BoxRef = string | number

export interface BoxPage {
  box: S.Box
  postings: S.Posting[]
  nextPage: string | null
}

/** Result of a mutation the CLI cannot confirm on its own. */
export interface Verified {
  /** true = confirmed, false = confirmed wrong, null = could not find it to check. */
  verified: boolean | null
}

/** How many box pages to scan when confirming a mutation. */
const VERIFY_PAGES = 3

/** Typed access to the HEY CLI. Every method is one or a few CLI calls. */
export class HeyClient {
  constructor(private readonly runner: HeyRunner) {}

  private async data<T extends z.ZodType>(args: string[], schema: T): Promise<z.infer<T>> {
    const env = await this.runner.json<unknown>(args)
    return schema.parse(env.data)
  }

  boxes() {
    return this.data(['box', 'list'], z.array(S.Box))
  }

  async boxPage(box: BoxRef, page?: string): Promise<BoxPage> {
    const args = ['box', 'view', String(box), ...(page ? ['--page', page] : [])]
    const view = await this.data(args, S.BoxView)
    const { postings, next_page, ...rest } = view
    return { box: S.Box.parse(rest), postings, nextPage: next_page ?? null }
  }

  thread(topicId: TopicId) {
    return this.data(['thread', 'read', String(topicId)], S.Thread)
  }

  attachments(topicId: TopicId) {
    return this.data(['attachment', 'list', String(topicId)], z.array(S.Attachment))
  }

  /** Downloads one attachment into `dir` under its original filename; returns the file path. */
  async saveAttachment(id: string, dir: string): Promise<string> {
    const saved = await this.data(['attachment', 'save', id, '--output', `${dir}/`, '--force'], S.SavedAttachment)
    return saved.path
  }

  /** The account's own sender addresses; used to tell sent entries from received ones. */
  async myAddresses(): Promise<string[]> {
    const senders = await this.data(['account', 'senders'], z.array(S.Sender))
    return senders.map((s) => s.email.toLowerCase())
  }

  calendars() {
    return this.data(['calendar', 'list'], z.array(S.Calendar))
  }

  /** Events of the week containing `date` (YYYY-MM-DD), repeating events expanded. */
  eventsWeek(date?: string) {
    return this.data(['event', 'week', ...(date ? [date] : []), '--all'], z.array(S.CalendarEvent))
  }

  todos() {
    return this.data(['todo', 'list', '--all'], z.array(S.Todo))
  }

  labels() {
    return this.data(['label', 'list'], z.array(S.Named))
  }

  collections() {
    return this.data(['collection', 'list'], z.array(S.Named))
  }

  // Mutations. `seen`, `unseen` and `move` answer success even for IDs that are not box
  // items, so each one is checked against the box afterwards.

  async markSeen(id: PostingId, boxId: number, seen = true): Promise<Verified> {
    await this.runner.json([seen ? 'seen' : 'unseen', String(id)])
    const found = await this.findInBox(boxId, (p) => p.id === id)
    return { verified: found ? (found.seen === true) === seen : null }
  }

  /**
   * Moves a thread to another box. Checked by thread ID in the destination, since the
   * box item there is not guaranteed to keep its ID.
   */
  async move(id: PostingId, topicId: TopicId, to: string): Promise<Verified> {
    await this.runner.json(['move', String(id), '--to', to])
    const found = await this.findInBox(to, (p) => p.topic_id === topicId)
    return { verified: found ? true : null }
  }

  private async findInBox(box: BoxRef, match: (p: S.Posting) => boolean) {
    let page: string | undefined
    for (let i = 0; i < VERIFY_PAGES; i++) {
      const res = await this.boxPage(box, page)
      const hit = res.postings.find(match)
      if (hit) return hit
      if (!res.nextPage) return null
      page = res.nextPage
    }
    return null
  }
}

export { PostingId, TopicId }
