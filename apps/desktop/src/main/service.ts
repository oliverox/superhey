// The app's backend: boots the core and implements the UI API. No Electron imports, so the
// dev web server can host it too.
import { EventEmitter } from 'node:events'
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'
import {
  AI_TASK_IDS,
  AI_TASKS,
  AiClient,
  AiError,
  AiSettings,
  aiMode,
  checkKey,
  CLOUD_MODELS,
  keyHint,
  PROVIDER_IDS,
  PROVIDERS,
  providerModel,
  providerSettings,
  type ProviderId,
  listLocalModels,
  readAiSettings,
  route,
  createCore,
  type Action,
  type MoveTarget,
  type OutgoingKind,
  type OutgoingMessage,
  HeyAuthError,
  HeyBinaryError,
  PostingId,
  TopicId,
  type Core,
} from '@myhey/core'
import { API_METHODS, type AiStatus, type AiTestResult, type Api, type ApiEvent, type ApiMethod, type AppStatus, type SetupProblem } from '../shared/api'

/** Where secrets (the Claude API key) are kept: the OS keychain in the app, none in browser dev mode. */
export interface SecretStore {
  available(): boolean
  get(name: string): string | null
  set(name: string, value: string | null): void
}

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
    private readonly opts: {
      dbPath: string
      cliPath?: string
      openFile: (path: string) => Promise<void>
      /** The system file picker; absent where there isn't one (browser dev mode). */
      pickFiles?: () => Promise<string[]>
      /** Absent in browser dev mode: no key can be stored there. */
      secrets?: SecretStore
      /** Tests pass a core that doesn't need the HEY CLI. */
      createCore?: typeof createCore
    },
  ) {
    super()
    this.aiSettings = readAiSettings(readJson(this.aiSettingsPath))
  }

  private aiSettings: AiSettings
  private ai: AiClient | null = null
  private get aiSettingsPath() {
    return join(dirname(this.opts.dbPath), 'ai-settings.json')
  }

  async boot(): Promise<AppStatus> {
    this.core?.engine.stop()
    this.core = null
    this.update({ phase: 'starting', problem: null })
    try {
      const core = await (this.opts.createCore ?? createCore)({ ...this.opts, sendingDisabled: process.env.MYHEY_TEST_NO_SEND === '1' })
      this.core = core
      this.update({ cli: core.cli })
      core.engine.on('change', (change) => this.emit('event', { type: 'change', change }))
      core.engine.on('status', (sync) => this.update({ sync }))
      core.engine.on('error', (err) => console.error('[sync]', err.message))
      core.actions.on('action', (action) => this.emit('event', { type: 'action', action }))
      core.outbox.on('outgoing', (record) => this.emit('event', { type: 'outgoing', record }))
      this.ai = new AiClient({ settings: () => this.aiSettings, apiKey: (p) => this.apiKey(p), repo: core.repo })
      this.ai.on('usage', () => this.emit('event', { type: 'ai' }))
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

  async findPostings(query: string, limit = 8) {
    if (typeof query !== 'string') throw new Error('query must be a string')
    return this.need().repo.findPostings(query.slice(0, 200), Math.min(int(limit), 50))
  }

  async senderThreads(email: string, excludeTopicId: number | null) {
    if (typeof email !== 'string' || email.length > 320) throw new Error('bad email')
    return this.need().repo.postingsFromSender(email, excludeTopicId == null ? null : TopicId(int(excludeTopicId)), 5)
  }

  async posting(id: number) {
    return this.need().repo.posting(PostingId(int(id)))
  }

  async bundleThreads(postingId: number) {
    return this.need().engine.bundleThreads(PostingId(int(postingId)))
  }

  async labels() {
    return this.need().repo.labels()
  }

  async runAction(action: unknown, source: unknown = 'user') {
    if (source !== 'user' && source !== 'auto') throw new Error('bad action source')
    const checked = validateAction(action)
    // A test instance must never decide on a real sender waiting in the Screener.
    if (checked.type === 'screen' && process.env.MYHEY_TEST_NO_SCREENER_DECISIONS === '1') throw new Error('Screener decisions are off in this test instance')
    // Test instances opening threads to check rendering must not mark real mail as seen.
    if (source === 'auto' && process.env.MYHEY_TEST_NO_AUTO_ACTIONS === '1') throw new Error('automatic actions are off in this instance')
    return this.need().actions.run(checked, source)
  }

  async undoAction(id: number) {
    return this.need().actions.undo(int(id))
  }

  async recentActions(limit = 50) {
    return this.need().actions.recent(Math.min(int(limit), 200))
  }

  private sendersCache: Promise<Array<{ id: number; email: string; default?: boolean | null }>> | null = null

  /** Sender addresses rarely change; fetched once per session. */
  async screener() {
    return this.need()
      .engine.screenerEntries()
      .map((e) => ({ id: e.id, name: e.name ?? null, email: e.email_address, subject: e.subject ?? null, summary: e.summary ?? null, topicId: e.topic_id ?? null }))
  }

  async refreshScreener() {
    this.need().engine.requestScreenerRefresh()
  }

  async senders() {
    this.sendersCache ??= this.need().client.senders().catch((err) => {
      this.sendersCache = null
      throw err
    })
    return this.sendersCache
  }

  async pickFiles() {
    return this.opts.pickFiles ? this.opts.pickFiles() : []
  }

  async sendMessage(message: unknown, kind: unknown, forwardOf: unknown = null) {
    if (!['new', 'reply', 'reply-all', 'forward'].includes(kind as string)) throw new Error('bad message kind')
    const msg = validateMessage(message, kind === 'new')
    const fwd = kind === 'forward' ? TopicId(int(forwardOf)) : null
    return this.need().outbox.send(msg, kind as OutgoingKind, fwd)
  }

  async cancelSend(id: number) {
    return this.need().outbox.cancel(int(id))
  }

  async saveDraft(message: unknown) {
    return this.need().outbox.saveDraft(validateMessage(message, false, true))
  }

  // AI

  async aiStatus(): Promise<AiStatus> {
    const s = this.aiSettings
    const stored = Object.fromEntries(PROVIDER_IDS.map((p) => [p, this.apiKey(p)])) as Record<ProviderId, string | null>
    const has = Object.fromEntries(PROVIDER_IDS.map((p) => [p, !!stored[p]])) as Record<ProviderId, boolean>
    const ai = this.needAi()
    const since = ai.monthStart()
    const byTask = this.need().repo.aiUsageSince(since)
    return {
      settings: s,
      mode: aiMode(s, has),
      providers: s.order.map((id) => {
        const p = PROVIDERS[id]
        return {
          id,
          name: p.name,
          company: p.company,
          blurb: p.blurb,
          keyUrl: p.keyUrl,
          keyPlaceholder: p.keyPlaceholder,
          hint: stored[id] ? keyHint(stored[id]) : null,
          enabled: providerSettings(s, id).enabled,
          models: { cheap: providerModel(s, id, 'cheap'), quality: providerModel(s, id, 'quality') },
        }
      }),
      canStoreKey: this.opts.secrets?.available() ?? false,
      tasks: AI_TASK_IDS.map((id) => {
        const r = route(s, id, has)
        return { id, label: AI_TASKS[id].label, tier: AI_TASKS[id].tier, runsOn: r.engine ? { engine: r.engine, model: r.model } : { engine: null, reason: r.reason } }
      }),
      models: CLOUD_MODELS.map((m) => ({ id: m.id, provider: m.provider, name: m.name, price: { input: m.price.input, output: m.price.output } })),
      month: {
        since,
        spentUsd: ai.spentThisMonth(),
        budgetUsd: s.monthlyBudgetUsd,
        calls: byTask.reduce((n, t) => n + t.calls, 0),
        byTask,
      },
    }
  }

  async setAiSettings(input: unknown) {
    const parsed = AiSettings.safeParse(input)
    if (!parsed.success) throw new Error(`Invalid AI settings: ${parsed.error.issues[0]?.message ?? 'unknown'}`)
    this.aiSettings = parsed.data
    writeJson(this.aiSettingsPath, parsed.data)
    this.emit('event', { type: 'ai' })
    return this.aiStatus()
  }

  async setApiKey(provider: unknown, key: unknown) {
    if (!PROVIDER_IDS.includes(provider as ProviderId)) throw new Error('bad provider')
    const id = provider as ProviderId
    const secrets = this.opts.secrets
    if (!secrets) throw new Error('Keys can’t be stored in browser dev mode.')
    secrets.set(PROVIDERS[id].secretName, key === null ? null : checkKey(id, key))
    this.emit('event', { type: 'ai' })
    return this.aiStatus()
  }

  async localModels(baseUrl: unknown) {
    if (typeof baseUrl !== 'string' || !/^https?:\/\/[^\s]{1,300}$/.test(baseUrl)) throw new Error('Enter an http:// or https:// address.')
    return listLocalModels(baseUrl)
  }

  async testAi(engine: unknown): Promise<AiTestResult> {
    if (engine !== 'local' && !PROVIDER_IDS.includes(engine as ProviderId)) throw new Error('bad engine')
    try {
      const r = await this.needAi().run({
        task: `test-${engine as ProviderId | 'local'}`,
        system: 'You are checking a connection. Reply with exactly: OK',
        prompt: 'Connection test.',
        maxOutputTokens: 16,
        signal: AbortSignal.timeout(engine === 'local' ? 60_000 : 30_000),
      })
      return { ok: true, engine: r.engine, model: r.model, ms: r.ms, reply: r.output.trim().slice(0, 80), costUsd: r.usage.costUsd }
    } catch (e) {
      return { ok: false, code: e instanceof AiError ? e.code : 'failed', message: e instanceof Error ? e.message : String(e) }
    }
  }

  /** Whether a message is still in its undo window. */
  hasPendingSends(): boolean {
    return this.core?.outbox.hasPending() ?? false
  }

  /** Delivers anything still in its undo window (the person pressed Send; quitting shouldn't cancel it). */
  async flushOutbox() {
    await this.core?.outbox.flush()
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

  private apiKey(provider: ProviderId): string | null {
    return this.opts.secrets?.get(PROVIDERS[provider].secretName) ?? null
  }

  private needAi(): AiClient {
    if (!this.ai) throw new Error('HEY is not connected yet')
    return this.ai
  }

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
  if (a.type === 'screen') {
    if (!['approve', 'deny', 'spam'].includes(a.decision as string)) throw new Error('bad action')
    if (a.box != null && !['imbox', 'feedbox', 'trailbox'].includes(a.box as string)) throw new Error('bad action')
    return {
      type: 'screen',
      clearanceId: int(a.clearanceId),
      decision: a.decision as 'approve' | 'deny' | 'spam',
      box: (a.box ?? undefined) as 'imbox' | 'feedbox' | 'trailbox' | undefined,
      name: typeof a.name === 'string' ? a.name.slice(0, 200) : undefined,
    }
  }
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

const EMAIL = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/
const MAX_RECIPIENTS = 50
const MAX_ATTACHMENTS = 10
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024

/** Checks an outgoing message from the UI; anything malformed is refused before HEY sees it. */
function validateMessage(input: unknown, needsSubject: boolean, isDraft = false): OutgoingMessage {
  const m = input as Record<string, unknown>
  if (!m || typeof m !== 'object') throw new Error('bad message')
  const addrs = (v: unknown, label: string): string[] => {
    if (v == null) return []
    if (!Array.isArray(v) || v.length > MAX_RECIPIENTS) throw new Error(`bad ${label} list`)
    return v.map((a) => {
      if (typeof a !== 'string' || !EMAIL.test(a.trim())) throw new Error(`Not an email address: ${String(a)}`)
      return a.trim()
    })
  }
  const to = addrs(m.to, 'To')
  const cc = addrs(m.cc, 'Cc')
  const bcc = addrs(m.bcc, 'Bcc')
  if (!isDraft && to.length + cc.length + bcc.length === 0) throw new Error('Add at least one recipient')
  if (typeof m.body !== 'string' || m.body.length > 500_000) throw new Error('bad message body')
  if (needsSubject && (typeof m.subject !== 'string' || !m.subject.trim())) throw new Error('Add a subject')
  if (m.subject != null && (typeof m.subject !== 'string' || m.subject.length > 998)) throw new Error('bad subject')
  const attach = m.attach == null ? [] : m.attach
  if (!Array.isArray(attach) || attach.length > MAX_ATTACHMENTS) throw new Error(`At most ${MAX_ATTACHMENTS} attachments`)
  for (const path of attach) {
    if (typeof path !== 'string' || !isAbsolute(path)) throw new Error('bad attachment path')
    const st = statSync(path, { throwIfNoEntry: false })
    if (!st?.isFile()) throw new Error(`Attachment not found: ${path}`)
    if (st.size > MAX_ATTACHMENT_BYTES) throw new Error(`Attachment too large (25 MB max): ${path}`)
  }
  if (m.from != null && (typeof m.from !== 'string' || m.from.length > 320)) throw new Error('bad sender')
  return {
    to,
    cc,
    bcc,
    subject: typeof m.subject === 'string' ? m.subject.trim() : undefined,
    body: m.body,
    attach: attach as string[],
    threadId: m.threadId == null ? undefined : TopicId(int(m.threadId)),
    from: typeof m.from === 'string' && m.from ? m.from : undefined,
  }
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return undefined // none yet, or unreadable: the defaults apply
  }
}

function writeJson(path: string, value: unknown) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(value, null, 2))
}
