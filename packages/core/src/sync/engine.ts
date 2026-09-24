import { EventEmitter } from 'node:events'
import { existsSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { HeyNotFoundError } from '../cli/errors'
import type { HeyClient } from '../cli/client'
import type { HeyRunner } from '../cli/runner'
import type { WatchLine } from '../cli/schemas'
import type { TopicId } from '../ids'
import type { Repo, ThreadView } from '../cache/repo'
import { Watcher, type WatchStatus } from './watcher'

export type CacheChange =
  | { kind: 'boxes' }
  | { kind: 'postings'; boxId: number }
  | { kind: 'thread'; topicId: TopicId }
  | { kind: 'calendar' }
  | { kind: 'todos' }

export interface SyncStatus {
  watch: WatchStatus
  initialSyncDone: boolean
  lastError: string | null
}

interface EngineEvents {
  change: [CacheChange]
  status: [SyncStatus]
  error: [Error]
}

const DAY_MS = 86_400_000
const BOX_REFRESH_DEBOUNCE_MS = 1_000
const CALENDAR_REFRESH_DEBOUNCE_MS = 2_000

/**
 * Keeps the local cache in step with HEY. The UI reads only from the cache; this engine
 * is the only writer. Startup refreshes the first page of every box, then `hey watch`
 * streams every change after that.
 */
export class SyncEngine extends EventEmitter<EngineEvents> {
  private readonly watcher: Watcher
  private readonly boxTimers = new Map<number, NodeJS.Timeout>()
  private calendarTimer: NodeJS.Timeout | null = null
  private readonly threadFetches = new Map<TopicId, Promise<ThreadView | null>>()
  private readonly fileFetches = new Map<string, Promise<AttachmentFile>>()
  private backfillPaused = false
  private status: SyncStatus = { watch: 'stopped', initialSyncDone: false, lastError: null }

  constructor(
    private readonly client: HeyClient,
    private readonly repo: Repo,
    runner: HeyRunner,
    private readonly opts: { attachmentsDir: string },
  ) {
    super()
    this.watcher = new Watcher(runner, () => repo.getState('watch_since'))
    this.watcher.on('line', (line) => this.onWatchLine(line))
    this.watcher.on('status', (watch) => this.setStatus({ watch }))
    this.watcher.on('error', (err) => this.fail(err))
  }

  getStatus(): SyncStatus {
    return this.status
  }

  async start() {
    await this.initialSync()
    this.watcher.start()
  }

  stop() {
    this.watcher.stop()
    for (const t of this.boxTimers.values()) clearTimeout(t)
    if (this.calendarTimer) clearTimeout(this.calendarTimer)
    this.backfillPaused = true
  }

  /** Fast refresh of everything the first screen needs. A few seconds at most. */
  async initialSync() {
    const [boxes, addresses] = await Promise.all([this.client.boxes(), this.client.myAddresses()])
    this.repo.replaceBoxes(boxes)
    this.repo.replaceMyAddresses(addresses)
    this.emit('change', { kind: 'boxes' })

    await Promise.all([
      ...boxes.map((box) => this.refreshBox(box.id)),
      this.refreshCalendar(),
      this.refreshTodos(),
      this.client.labels().then((l) => this.repo.replaceNamed('labels', l)),
      this.client.collections().then((c) => this.repo.replaceNamed('collections', c)),
    ])

    // From now on the watch resumes from here, so changes while the app was closed replay.
    if (!this.repo.getState('watch_since')) this.repo.setState('watch_since', new Date().toISOString())
    this.setStatus({ initialSyncDone: true })
  }

  async refreshBox(boxId: number) {
    const page = await this.client.boxPage(boxId)
    this.repo.upsertPostings(page.postings, boxId)
    // Backfill resumes from page 2 onward; remember where page 1 ended the first time.
    if (!this.repo.getState(`backfill:${boxId}`))
      this.repo.setState(`backfill:${boxId}`, page.nextPage ?? 'done')
    this.emit('change', { kind: 'postings', boxId })
  }

  async refreshCalendar() {
    const today = startOfLocalDay(new Date())
    const nextWeek = new Date(today.getTime() + 7 * DAY_MS)
    const [calendars, thisWeek, following] = await Promise.all([
      this.client.calendars(),
      this.client.eventsWeek(ymd(today)),
      this.client.eventsWeek(ymd(nextWeek)),
    ])
    this.repo.replaceCalendars(calendars)
    // Together the two weeks cover at least [today, today + 7 days), so that span is
    // replaced wholesale and deleted events disappear.
    this.repo.replaceEvents(today.toISOString(), nextWeek.toISOString(), [...thisWeek, ...following])
    this.emit('change', { kind: 'calendar' })
  }

  async refreshTodos() {
    this.repo.replaceTodos(await this.client.todos())
    this.emit('change', { kind: 'todos' })
  }

  /** Returns the thread from the cache, fetching it first if missing or behind. */
  async ensureThread(topicId: TopicId, entryCount: number | null = null): Promise<ThreadView | null> {
    if (!this.repo.threadIsStale(topicId, entryCount)) return this.repo.thread(topicId)
    const inFlight = this.threadFetches.get(topicId)
    if (inFlight) return inFlight

    const fetch = (async () => {
      const posting = this.repo.db
        .prepare('SELECT subject, has_attachments FROM postings WHERE topic_id = ? LIMIT 1')
        .get(topicId) as { subject: string; has_attachments: number } | undefined
      // Ask for attachments alongside the thread when the posting says there are some,
      // or when there is no posting to ask (a thread opened from search).
      const wanted = !posting || posting.has_attachments === 1
      const [entries, listed] = await Promise.all([
        this.client.thread(topicId),
        wanted ? this.client.attachments(topicId) : null,
      ])
      const attachments =
        listed ?? (entries.some((e) => e.body.includes('📎')) ? await this.client.attachments(topicId) : [])
      this.repo.storeThread(topicId, entries, posting?.subject ?? null)
      this.repo.replaceAttachments(topicId, attachments)
      this.emit('change', { kind: 'thread', topicId })
      return this.repo.thread(topicId)
    })().finally(() => this.threadFetches.delete(topicId))

    this.threadFetches.set(topicId, fetch)
    return fetch
  }

  /** Local copy of an attachment, downloaded through the CLI on first use. */
  async attachmentFile(id: string): Promise<AttachmentFile> {
    const a = this.repo.attachment(id)
    if (!a) throw new HeyNotFoundError(`unknown attachment ${id}`)
    const file = (path: string) => ({ path, filename: a.filename, contentType: a.contentType })
    if (a.localPath && existsSync(a.localPath)) return file(a.localPath)

    const inFlight = this.fileFetches.get(id)
    if (inFlight) return inFlight
    const fetch = (async () => {
      // One directory per attachment keeps the original filename without collisions.
      const dir = join(this.opts.attachmentsDir, id.replace(/[^\w-]/g, '_'))
      mkdirSync(dir, { recursive: true })
      const path = resolve(await this.client.saveAttachment(id, dir))
      this.repo.setAttachmentPath(id, path)
      return file(path)
    })().finally(() => this.fileFetches.delete(id))
    this.fileFetches.set(id, fetch)
    return fetch
  }

  /**
   * Pages further back through a box in the background. Resumable: the cursor is saved
   * after every page. Returns the number of pages read.
   */
  async backfillBox(boxId: number, opts: { maxPages?: number; delayMs?: number } = {}) {
    const { maxPages = Infinity, delayMs = 500 } = opts
    this.backfillPaused = false
    let pages = 0
    while (pages < maxPages && !this.backfillPaused) {
      const cursor = this.repo.getState(`backfill:${boxId}`)
      if (!cursor || cursor === 'done') break
      const page = await this.client.boxPage(boxId, cursor)
      this.repo.upsertPostings(page.postings, boxId)
      this.repo.setState(`backfill:${boxId}`, page.nextPage ?? 'done')
      this.emit('change', { kind: 'postings', boxId })
      pages++
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs))
    }
    return pages
  }

  pauseBackfill() {
    this.backfillPaused = true
  }

  // Watch handling

  private onWatchLine(line: WatchLine) {
    if (line.at) this.repo.setState('watch_since', line.at)

    switch (line.change) {
      case 'added':
      case 'updated':
        if (line.posting && line.box) {
          this.repo.upsertPostings([line.posting], line.box.id)
          this.emit('change', { kind: 'postings', boxId: line.box.id })
        } else if (line.box) {
          // Some updates name the posting without its content: re-read that box.
          this.scheduleBoxRefresh(line.box.id)
        }
        break
      case 'deleted':
        if (line.posting_id != null) {
          this.repo.deletePosting(line.posting_id)
          if (line.box) this.emit('change', { kind: 'postings', boxId: line.box.id })
        }
        break
      case 'resync':
        if (line.box) this.scheduleBoxRefresh(line.box.id)
        break
      default:
        if (line.change.startsWith('recording_') || line.change.startsWith('calendar_')) {
          this.scheduleCalendarRefresh()
        }
    }
  }

  private scheduleBoxRefresh(boxId: number) {
    clearTimeout(this.boxTimers.get(boxId))
    this.boxTimers.set(
      boxId,
      setTimeout(() => {
        this.boxTimers.delete(boxId)
        this.refreshBox(boxId).catch((e) => this.fail(e))
      }, BOX_REFRESH_DEBOUNCE_MS),
    )
  }

  private scheduleCalendarRefresh() {
    if (this.calendarTimer) clearTimeout(this.calendarTimer)
    this.calendarTimer = setTimeout(() => {
      this.calendarTimer = null
      Promise.all([this.refreshCalendar(), this.refreshTodos()]).catch((e) => this.fail(e))
    }, CALENDAR_REFRESH_DEBOUNCE_MS)
  }

  private fail(err: unknown) {
    const error = err instanceof Error ? err : new Error(String(err))
    this.setStatus({ lastError: error.message })
    this.emit('error', error)
  }

  private setStatus(patch: Partial<SyncStatus>) {
    this.status = { ...this.status, ...patch }
    this.emit('status', this.status)
  }
}

export interface AttachmentFile {
  path: string
  filename: string
  contentType: string | null
}

function startOfLocalDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

function ymd(d: Date) {
  const p = (x: number) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
