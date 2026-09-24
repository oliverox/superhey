import { z } from 'zod'
import { PostingId, TopicId } from '../ids'
import type { HeyRunner } from './runner'
import * as S from './schemas'

export type BoxRef = string | number

export interface OutgoingMessage {
  to: string[]
  cc?: string[]
  bcc?: string[]
  /** Required for a new message; a reply carries the thread's. */
  subject?: string
  /** Markdown. */
  body: string
  /** Local file paths. */
  attach?: string[]
  /** Reply into this thread instead of starting a new one. */
  threadId?: TopicId
  /** A configured sender address or ID. */
  from?: string
}

export type BubbleWhen = { kind: 'now' | 'tomorrow' | 'weekend' | 'next-week' } | { kind: 'on'; date: string }

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

  /**
   * The original HTML of every message in a thread, by entry ID. The CLI prints one
   * `<article id="entry-…">` per message; inner HTML (and any `<article>` written in an
   * email) sits escaped inside attributes, so splitting on the top-level tags is safe.
   */
  async threadHtml(topicId: TopicId): Promise<Map<number, string>> {
    return splitThreadHtml(await this.runner.text(['thread', 'read', String(topicId), '--html']))
  }

  attachments(topicId: TopicId) {
    return this.data(['attachment', 'list', String(topicId)], z.array(S.Attachment))
  }

  /** Downloads one attachment into `dir` under its original filename; returns the file path. */
  async saveAttachment(id: string, dir: string): Promise<string> {
    const saved = await this.data(['attachment', 'save', id, '--output', `${dir}/`, '--force'], S.SavedAttachment)
    return saved.path
  }

  /** Configured sender addresses (e.g. an @hey.com address and a linked one). */
  senders() {
    return this.data(['account', 'senders'], z.array(z.looseObject({ id: z.number(), email: z.string(), default: z.boolean().nullish() })))
  }

  /**
   * Sends a new message, or a reply into a thread (`threadId`) with explicit recipients,
   * or saves either as a HEY draft. Returns the draft ID when `draft` is set.
   */
  async compose(msg: OutgoingMessage, opts: { draft?: boolean } = {}): Promise<{ draftId: number | null }> {
    const list = (flag: string, addrs?: string[]) => (addrs?.length ? [flag, addrs.join(',')] : [])
    const args = [
      'compose',
      ...(msg.threadId != null ? ['--thread-id', String(msg.threadId)] : ['--subject', msg.subject ?? '']),
      ...list('--to', msg.to),
      ...list('--cc', msg.cc),
      ...list('--bcc', msg.bcc),
      ...(msg.from ? ['--from', msg.from] : []),
      '-m',
      msg.body,
      ...(msg.attach ?? []).flatMap((path) => ['--attach', path]),
      ...(opts.draft ? ['--draft'] : []),
    ]
    const data = (await this.runner.json<{ id?: number } | null>(args)).data
    return { draftId: opts.draft ? (data?.id ?? null) : null }
  }

  /** Forwards a thread's latest message with an optional note. Sends at once (no draft form). */
  async forward(topicId: TopicId, msg: Pick<OutgoingMessage, 'to' | 'cc' | 'bcc' | 'body'>) {
    const list = (flag: string, addrs?: string[]) => (addrs?.length ? [flag, addrs.join(',')] : [])
    await this.runner.json(['forward', String(topicId), ...list('--to', msg.to), ...list('--cc', msg.cc), ...list('--bcc', msg.bcc), ...(msg.body ? ['-m', msg.body] : [])])
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
   * Moves a thread to another box and checks where it landed. A box item keeps its ID
   * when moved, so it is looked for by ID: found in the destination = confirmed; still in
   * the box it came from = not applied; neither = couldn't confirm.
   */
  async move(id: PostingId, to: string, from?: BoxRef): Promise<Verified> {
    await this.runner.json(['move', String(id), '--to', to])
    if (await this.findInBox(to, (p) => p.id === id)) return { verified: true }
    if (from != null && (await this.findInBox(from, (p) => p.id === id, 1))) return { verified: false }
    return { verified: null }
  }

  /** Bubbles a thread up now, or schedules it. `on` is YYYY-MM-DD. */
  async bubbleUp(id: PostingId, when: BubbleWhen): Promise<Verified> {
    const flag = when.kind === 'on' ? ['--on', when.date] : [`--${when.kind}`]
    await this.runner.json(['bubble', 'up', String(id), ...flag])
    const { scheduled, bubbledUp } = await this.bubbled()
    return { verified: scheduled.includes(id) || bubbledUp.includes(id) }
  }

  async bubblePop(id: PostingId): Promise<Verified> {
    await this.runner.json(['bubble', 'pop', String(id)])
    const { scheduled } = await this.bubbled()
    return { verified: !scheduled.includes(id) }
  }

  /** Posting IDs waiting in Bubble Up, and those already bubbled up to the Imbox. */
  async bubbled(): Promise<{ scheduled: PostingId[]; bubbledUp: PostingId[] }> {
    const data = await this.data(
      ['bubble', 'list'],
      z.looseObject({ scheduled: z.array(S.Posting).default([]), bubbled_up: z.array(S.Posting).default([]) }),
    )
    return { scheduled: data.scheduled.map((p) => PostingId(p.id)), bubbledUp: data.bubbled_up.map((p) => PostingId(p.id)) }
  }

  // Label and trash commands answer not_found for IDs that aren't box items, so a
  // successful answer is trusted.
  async labelAdd(id: PostingId, labelId: number) {
    await this.runner.json(['label', 'add', String(id), '--to', String(labelId)])
  }

  async labelRemove(id: PostingId, labelId: number) {
    await this.runner.json(['label', 'remove', String(id), '--from', String(labelId)])
  }

  async trash(id: PostingId) {
    await this.runner.json(['trash', String(id)])
  }

  private async findInBox(box: BoxRef, match: (p: S.Posting) => boolean, pages = VERIFY_PAGES) {
    let page: string | undefined
    for (let i = 0; i < pages; i++) {
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

export function splitThreadHtml(doc: string): Map<number, string> {
  const out = new Map<number, string>()
  const starts = [...doc.matchAll(/<article id="entry-(\d+)"[^>]*>/g)]
  const bodyEnd = doc.lastIndexOf('</body>')
  const docEnd = bodyEnd >= 0 ? bodyEnd : doc.length
  starts.forEach((m, i) => {
    const from = m.index + m[0].length
    const to = i + 1 < starts.length ? starts[i + 1]!.index : docEnd
    const inner = doc.slice(from, to).replace(/\s*<\/article>\s*$/, '')
    out.set(Number(m[1]), inner)
  })
  return out
}
