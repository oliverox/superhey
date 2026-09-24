// The contract between the UI and the core. Electron IPC and the dev web server both
// implement it, so the renderer runs unchanged in either.
import type {
  AttachmentRow,
  BoxRow,
  CacheChange,
  EntryRow,
  EventRow,
  PostingRow,
  SearchHit,
  SyncStatus,
  ThreadView,
} from '@myhey/core'

export type { AttachmentRow, BoxRow, CacheChange, EntryRow, EventRow, PostingRow, SearchHit, SyncStatus, ThreadView }

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
  search(query: string): Promise<SearchHit[]>
  events(from: string, to: string): Promise<EventRow[]>
  /** Recent threads from one sender, excluding the open one. */
  senderThreads(email: string, excludeTopicId: number | null): Promise<PostingRow[]>
  /** Downloads if needed, then opens the file in the system's default app. */
  openAttachment(id: string): Promise<void>
}

export const API_METHODS = ['status', 'retry', 'boxes', 'postings', 'thread', 'search', 'events', 'senderThreads', 'openAttachment'] as const satisfies ReadonlyArray<keyof Api>
export type ApiMethod = (typeof API_METHODS)[number]

export type ApiEvent =
  | { type: 'change'; change: CacheChange }
  | { type: 'status'; status: AppStatus }

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
