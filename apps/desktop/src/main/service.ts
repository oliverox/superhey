// The app's backend: boots the core and implements the UI API. No Electron imports, so the
// dev web server can host it too.
import { EventEmitter } from 'node:events'
import {
  createCore,
  type Action,
  type MoveTarget,
  HeyAuthError,
  HeyBinaryError,
  PostingId,
  TopicId,
  type Core,
} from '@myhey/core'
import { API_METHODS, type Api, type ApiEvent, type ApiMethod, type AppStatus, type SetupProblem } from '../shared/api'

const BACKFILL_DELAY_MS = 1_000

export class AppService extends EventEmitter<{ event: [ApiEvent] }> implements Api {
  private core: Core | null = null
  private state: AppStatus = {
    phase: 'starting',
    cli: null,
    sync: null,
    problem: null,
    backfill: { running: false, postings: 0 },
  }

  constructor(
    private readonly opts: { dbPath: string; cliPath?: string; openFile: (path: string) => Promise<void> },
  ) {
    super()
  }

  async boot(): Promise<AppStatus> {
    this.core?.engine.stop()
    this.core = null
    this.update({ phase: 'starting', problem: null })
    try {
      const core = await createCore(this.opts)
      this.core = core
      this.update({ cli: core.cli })
      core.engine.on('change', (change) => this.emit('event', { type: 'change', change }))
      core.engine.on('status', (sync) => this.update({ sync }))
      core.engine.on('error', (err) => console.error('[sync]', err.message))
      core.actions.on('action', (action) => this.emit('event', { type: 'action', action }))
      await core.engine.start()
      this.update({ phase: 'ready', sync: core.engine.getStatus() })
      void this.backfill(core)
    } catch (err) {
      this.update({ phase: 'blocked', problem: toProblem(err) })
    }
    return this.state
  }

  stop() {
    this.core?.engine.stop()
  }

  /** Validates and routes a call from the UI. The UI is untrusted input like any other. */
  async dispatch(method: string, args: unknown[]): Promise<unknown> {
    if (!API_METHODS.includes(method as ApiMethod)) throw new Error(`unknown method ${method}`)
    const fn = this[method as ApiMethod] as (...a: unknown[]) => Promise<unknown>
    return fn.apply(this, args)
  }

  // Api

  async status() {
    return this.state
  }

  async retry() {
    return this.boot()
  }

  async boxes() {
    return this.need().repo.boxes()
  }

  async postings(boxId: number, limit = 200) {
    return this.need().repo.postings(int(boxId), Math.min(int(limit), 1000))
  }

  async thread(topicId: number, entryCount: number | null) {
    return this.need().engine.ensureThread(TopicId(int(topicId)), entryCount == null ? null : int(entryCount))
  }

  async threadHtml(topicId: number) {
    return this.need().engine.ensureThreadHtml(TopicId(int(topicId)))
  }

  async search(query: string) {
    if (typeof query !== 'string') throw new Error('query must be a string')
    return this.need().repo.search(query.slice(0, 200))
  }

  async events(from: string, to: string) {
    if (typeof from !== 'string' || typeof to !== 'string') throw new Error('from/to must be ISO strings')
    return this.need().repo.events(from, to)
  }

  async senderThreads(email: string, excludeTopicId: number | null) {
    if (typeof email !== 'string' || email.length > 320) throw new Error('bad email')
    return this.need().repo.postingsFromSender(email, excludeTopicId == null ? null : TopicId(int(excludeTopicId)), 5)
  }

  async posting(id: number) {
    return this.need().repo.posting(PostingId(int(id)))
  }

  async labels() {
    return this.need().repo.labels()
  }

  async runAction(action: unknown, source: unknown = 'user') {
    if (source !== 'user' && source !== 'auto') throw new Error('bad action source')
    // Test instances opening threads to check rendering must not mark real mail as seen.
    if (source === 'auto' && process.env.MYHEY_TEST_NO_AUTO_ACTIONS === '1') throw new Error('automatic actions are off in this instance')
    return this.need().actions.run(validateAction(action), source)
  }

  async undoAction(id: number) {
    return this.need().actions.undo(int(id))
  }

  async recentActions(limit = 50) {
    return this.need().actions.recent(Math.min(int(limit), 200))
  }

  async openAttachment(id: string) {
    const file = await this.attachmentFile(id)
    await this.opts.openFile(file.path)
  }

  /** For the file endpoints: a cached real avatar image, or null for initials-only senders. */
  async avatarFile(url: string) {
    if (typeof url !== 'string' || url.length > 2000) return null
    return this.need().avatars.get(url)
  }

  /** For the file endpoints. Only attachments already listed in the cache can be served. */
  async attachmentFile(id: string) {
    if (typeof id !== 'string' || id.length > 200) throw new Error('bad attachment id')
    return this.need().engine.attachmentFile(id)
  }

  // Internals

  private need(): Core {
    if (!this.core) throw new Error('HEY is not connected yet')
    return this.core
  }

  /** Pages older mail into the cache, one box at a time, slowly. Resumes across launches. */
  private async backfill(core: Core) {
    this.update({ backfill: { running: true, postings: core.repo.postingCount() } })
    try {
      for (const box of core.repo.boxes()) {
        while (this.core === core) {
          const pages = await core.engine.backfillBox(box.id, { maxPages: 1, delayMs: BACKFILL_DELAY_MS })
          if (pages === 0) break
          this.update({ backfill: { running: true, postings: core.repo.postingCount() } })
        }
      }
    } catch (err) {
      console.error('[backfill]', err instanceof Error ? err.message : err)
    }
    if (this.core === core) this.update({ backfill: { running: false, postings: core.repo.postingCount() } })
  }

  private update(patch: Partial<AppStatus>) {
    this.state = { ...this.state, ...patch }
    this.emit('event', { type: 'status', status: this.state })
  }
}

function toProblem(err: unknown): SetupProblem {
  const message = err instanceof Error ? err.message : String(err)
  if (err instanceof HeyAuthError) return { code: 'auth', message }
  if (err instanceof HeyBinaryError) return { code: 'binary', message }
  return { code: 'other', message }
}

function int(v: unknown): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) throw new Error(`expected a positive integer, got ${String(v)}`)
  return v
}

const MOVE_TARGETS: MoveTarget[] = ['imbox', 'feedbox', 'trailbox', 'laterbox', 'asidebox']
const BUBBLE_KINDS = ['now', 'tomorrow', 'weekend', 'next-week', 'on']

/** Checks an action from the UI field by field; anything unexpected is refused. */
function validateAction(input: unknown): Action {
  const a = input as Record<string, unknown>
  if (!a || typeof a !== 'object') throw new Error('bad action')
  const postingId = int(a.postingId)
  switch (a.type) {
    case 'seen':
      if (typeof a.seen !== 'boolean') break
      return { type: 'seen', postingId, seen: a.seen }
    case 'move':
      if (!MOVE_TARGETS.includes(a.to as MoveTarget)) break
      return { type: 'move', postingId, to: a.to as MoveTarget }
    case 'bubble': {
      const when = a.when as { kind?: unknown; date?: unknown } | undefined
      if (!when || !BUBBLE_KINDS.includes(when.kind as string)) break
      if (when.kind === 'on') {
        if (typeof when.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(when.date)) break
        return { type: 'bubble', postingId, when: { kind: 'on', date: when.date } }
      }
      return { type: 'bubble', postingId, when: { kind: when.kind as 'now' | 'tomorrow' | 'weekend' | 'next-week' } }
    }
    case 'unbubble':
      return { type: 'unbubble', postingId }
    case 'label':
      if (typeof a.add !== 'boolean') break
      return { type: 'label', postingId, labelId: int(a.labelId), add: a.add }
    case 'trash':
      return { type: 'trash', postingId }
  }
  throw new Error('bad action')
}
