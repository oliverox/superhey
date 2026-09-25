// The contract between the UI and the core. Electron IPC and the dev web server both
// implement it, so the renderer runs unchanged in either.
import type {
  OutgoingKind,
  OutgoingMessage,
  OutgoingRecord,
  Action,
  ActionRecord,
  AttachmentRow,
  BoxRow,
  CacheChange,
  EntryRow,
  EventRow,
  PostingRow,
  SearchHit,
  SyncStatus,
  ThreadView,
  AiSettings,
  AiTask,
  ProviderId,
  TodayView,
  ThreadItem,
  TodoItem,
} from '@myhey/core'

export type { OutgoingKind, OutgoingMessage, OutgoingRecord, Action, ActionRecord, AttachmentRow, BoxRow, CacheChange, EntryRow, EventRow, PostingRow, SearchHit, SyncStatus, ThreadView, AiSettings, AiTask, ProviderId, TodayView, ThreadItem, TodoItem }

/** Everything Settings shows about AI. API keys themselves never leave the main process. */
export interface AiStatus {
  settings: AiSettings
  /** Which provider runs automatic tasks (if any), and whether a local model takes the quick ones. */
  mode: { cloud: ProviderId | null; local: boolean }
  /** Every provider the app knows, in priority order. Connected: a key is stored (`hint`). */
  providers: Array<{
    id: ProviderId
    name: string
    company: string
    blurb: string
    keyUrl: string
    keyPlaceholder: string
    /** "sk-ant-…abcd" when a key is stored. */
    hint: string | null
    enabled: boolean
    /** The models it uses for quick and main tasks. */
    models: { cheap: string; quality: string }
  }>
  /** Whether keys can be stored safely here (the OS keychain is available). */
  canStoreKey: boolean
  tasks: Array<{ id: AiTask; label: string; tier: 'cheap' | 'quality'; runsOn: { engine: ProviderId | 'local'; model: string } | { engine: null; reason: string } }>
  models: Array<{ id: string; provider: ProviderId; name: string; price: { input: number; output: number } }>
  month: {
    since: string
    spentUsd: number
    budgetUsd: number | null
    calls: number
    byTask: Array<{ task: string; engine: string; model: string; calls: number; input: number; output: number; costUsd: number }>
  }
}

/** A thread's full analysis, for the details panel. */
export interface ThreadAnalysisView {
  summary: string
  needsReply: boolean
  replyReason: string | null
  expectsReply: boolean
  category: string
  actionItems: Array<{ text: string; due: string | null }>
  dates: Array<{ label: string; date: string; time: string | null }>
  amounts: Array<{ label: string; amount: number; currency: string }>
  analyzedAt: string
  model: string
}

export type AiTestResult =
  | { ok: true; engine: ProviderId | 'local'; model: string; ms: number; reply: string; costUsd: number }
  | { ok: false; code: string; message: string }

export type SetupProblem =
  | { code: 'binary'; message: string }
  | { code: 'auth'; message: string }
  | { code: 'other'; message: string }

export interface AppStatus {
  phase: 'starting' | 'ready' | 'blocked'
  cli: { path: string; version: string } | null
  sync: SyncStatus | null
  problem: SetupProblem | null
  backfill: { running: boolean; postings: number }
}

export interface Api {
  status(): Promise<AppStatus>
  retry(): Promise<AppStatus>
  boxes(): Promise<BoxRow[]>
  postings(boxId: number, limit?: number): Promise<PostingRow[]>
  /** Cached thread, fetched from HEY first if missing or behind `entryCount`. */
  thread(topicId: number, entryCount: number | null): Promise<ThreadView | null>
  /** Original HTML of each message in a thread, by entry ID (fetched on first use). */
  threadHtml(topicId: number): Promise<Record<number, string>>
  search(query: string): Promise<SearchHit[]>
  /** Emails whose subject or sender contains every word of the query (for jumping to one). */
  findPostings(query: string, limit?: number): Promise<PostingRow[]>
  events(from: string, to: string): Promise<EventRow[]>
  /** Recent threads from one sender, excluding the open one. */
  senderThreads(email: string, excludeTopicId: number | null): Promise<PostingRow[]>
  posting(id: number): Promise<PostingRow | null>
  /** The unread threads inside a bundle row. */
  bundleThreads(postingId: number): Promise<PostingRow[]>
  labels(): Promise<Array<{ id: number; name: string }>>
  /** Runs an action on HEY. `auto` is for behaviours like seen-on-open, kept out of the log. */
  runAction(action: Action, source?: 'user' | 'auto'): Promise<ActionRecord>
  undoAction(id: number): Promise<ActionRecord>
  recentActions(limit?: number): Promise<ActionRecord[]>
  /** First-time senders waiting in The Screener. */
  screener(): Promise<ScreenerItem[]>
  /** Checks The Screener again soon (e.g. when the window regains focus). */
  refreshScreener(): Promise<void>
  /** Configured sender addresses. */
  senders(): Promise<Array<{ id: number; email: string; default?: boolean | null }>>
  /** Opens the system file picker; answers the chosen paths (empty in browser dev mode). */
  pickFiles(): Promise<string[]>
  /** Queues a message; it reaches HEY after the undo window unless cancelled. */
  sendMessage(message: OutgoingMessage, kind: OutgoingKind, forwardOf?: number | null): Promise<OutgoingRecord>
  /** Stops a queued message and hands it back for editing. */
  cancelSend(id: number): Promise<OutgoingRecord>
  /** Saves as a HEY draft; answers the draft ID. */
  saveDraft(message: OutgoingMessage): Promise<number | null>
  /** Downloads if needed, then opens the file in the system's default app. */
  openAttachment(id: string): Promise<void>
  /** What needs you today; `since`: when you last looked (for "new since"). */
  today(since: string | null): Promise<TodayView & { screener: number }>
  /** "Not now": hides a thread from Today until it changes (`activeAt`: its activity now). */
  hideFromToday(key: string, activeAt: string): Promise<void>
  /** What the AI made of a thread: summary, needs reply, action items, dates, amounts. */
  analysis(topicId: number): Promise<ThreadAnalysisView | null>
  aiStatus(): Promise<AiStatus>
  /** Replaces the AI settings; anything invalid is refused. */
  setAiSettings(settings: AiSettings): Promise<AiStatus>
  /** Stores (or with null, forgets) a provider's API key in the keychain. */
  setApiKey(provider: ProviderId, key: string | null): Promise<AiStatus>
  /** The models a local server offers (Ollama, LM Studio). */
  localModels(baseUrl: string): Promise<string[]>
  /** A tiny real call to check an engine works; counted in the usage meter. */
  testAi(engine: ProviderId | 'local'): Promise<AiTestResult>
}

export const API_METHODS = ['status', 'retry', 'boxes', 'postings', 'thread', 'threadHtml', 'search', 'findPostings', 'events', 'senderThreads', 'openAttachment', 'posting', 'bundleThreads', 'labels', 'runAction', 'undoAction', 'recentActions', 'senders', 'pickFiles', 'sendMessage', 'cancelSend', 'saveDraft', 'screener', 'refreshScreener', 'today', 'hideFromToday', 'analysis', 'aiStatus', 'setAiSettings', 'setApiKey', 'localModels', 'testAi'] as const satisfies ReadonlyArray<keyof Api>
export type ApiMethod = (typeof API_METHODS)[number]

export type ApiEvent =
  | { type: 'change'; change: CacheChange }
  | { type: 'status'; status: AppStatus }
  | { type: 'action'; action: ActionRecord }
  | { type: 'outgoing'; record: OutgoingRecord }
  /** AI settings or usage changed. */
  | { type: 'ai' }
  /** Something was put off on Today. */
  | { type: 'today' }
  /** A thread was analysed (its summary and needs-reply are in). */
  | { type: 'analysis'; topicId: number }

/** Content types the file endpoints serve as themselves; anything else is a download. */
const INLINE_TYPES = /^(application\/pdf|image\/(png|jpe?g|gif|webp|avif|bmp|svg\+xml))$/

/** Response headers for an attachment file. Never lets mail content run as a page. */
export function fileHeaders(contentType: string | null, filename: string): Record<string, string> {
  const inline = contentType != null && INLINE_TYPES.test(contentType)
  return {
    'content-type': inline ? contentType! : 'application/octet-stream',
    'content-disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(filename)}`,
    'content-security-policy': 'sandbox',
    'x-content-type-options': 'nosniff',
    'cache-control': 'private, max-age=31536000, immutable',
  }
}

/** Someone waiting in The Screener (`id` is the clearance ID decisions take). */
export interface ScreenerItem {
  id: number
  name: string | null
  email: string
  subject: string | null
  summary: string | null
  topicId: number | null
}
