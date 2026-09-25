import type { Contact, EventRow, PostingRow, Repo, TodoRow } from '../cache/repo'

/**
 * Today: what needs you, assembled from the cache (no AI, no calls to HEY). A queue of
 * decisions rather than a dashboard: each item says why it's here, and leaves once handled
 * in HEY (done, moved, replied, bubbled) or put off with "not now".
 */

/** Waiting on others: you sent the latest message at least this long ago… */
export const WAITING_AFTER_DAYS = 3
/** …and not so long ago that it's surely settled. */
export const WAITING_UNTIL_DAYS = 30

export interface ThreadItem {
  key: string
  posting: PostingRow
  /** Whole days since the thread's latest activity. */
  days: number
  /** Waiting on others: who you wrote to. */
  people?: Contact[]
}

export interface TodoItem {
  key: string
  todo: TodoRow
  /** Whole days past its day; 0 for today's. */
  daysLate: number
}

export interface TodayView {
  generatedAt: string
  /** To-dos overdue or for today, and threads bubbled up now. */
  due: { todos: TodoItem[]; bubbled: ThreadItem[] }
  replyLater: ThreadItem[]
  waiting: ThreadItem[]
  /** The day's calendar events. */
  events: EventRow[]
  /** Unread mail per box since you last looked (the first time: since the start of today). */
  newSince: { since: string | null; boxes: Array<{ boxId: number; kind: string; name: string; count: number }> }
  /** How many items above are yours to handle (events and new mail aren't). */
  toHandle: number
}

export interface TodayInput {
  now: Date
  /** Your addresses (for waiting on others). */
  myEmails: string[]
  /** When you last looked at Today; null the first time (then "new" means new today). */
  since: string | null
  /** Items put off with "not now": key → the thread's activity then. They return when it changes. */
  hidden: Record<string, string>
}

const DAY = 86_400_000

export function buildToday(repo: Repo, input: TodayInput): TodayView {
  const { now } = input
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startOfTomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  const daysSince = (iso: string | null) => (iso ? Math.max(0, Math.floor((now.getTime() - Date.parse(iso)) / DAY)) : 0)

  const shown = (p: PostingRow) => {
    const at = input.hidden[`thread:${p.id}`]
    return at === undefined || at !== (p.activeAt ?? '')
  }
  const items = (rows: PostingRow[], seen: Set<number>) =>
    rows
      .filter((p) => shown(p) && p.topicId != null && !seen.has(p.topicId) && (seen.add(p.topicId), true))
      .map((p) => ({ key: `thread:${p.id}`, posting: p, days: daysSince(p.activeAt) }))

  // A thread appears once, in the first section that claims it: bubbled up, then Reply Later, then waiting.
  const seen = new Set<number>()
  const bubbled = items(repo.bubbledUp(), seen)
  const replyLater = items(repo.replyLater(), seen)
  const waiting = items(
    repo.waitingOnOthers(input.myEmails, new Date(now.getTime() - WAITING_UNTIL_DAYS * DAY).toISOString(), new Date(now.getTime() - WAITING_AFTER_DAYS * DAY).toISOString()),
    seen,
  ).map((i) => ({ ...i, people: repo.otherPeople(i.posting.id, input.myEmails) }))

  const todos = repo.todosDue(ymd(startOfTomorrow)).map((t) => ({
    key: `todo:${t.id}`,
    todo: t,
    daysLate: t.dueAt ? Math.max(0, Math.round((startOfToday.getTime() - dayStart(t.dueAt)) / DAY)) : 0,
  }))

  return {
    generatedAt: now.toISOString(),
    due: { todos, bubbled },
    replyLater,
    waiting,
    events: repo.events(startOfToday.toISOString(), startOfTomorrow.toISOString()),
    // The first time, "new" is today's: every unread email ever would be noise, not news.
    newSince: { since: input.since, boxes: repo.unseenSince(input.since ?? startOfToday.toISOString()).filter((b) => b.count > 0 && b.kind !== 'bubblebox' && b.kind !== 'laterbox') },
    toHandle: todos.length + bubbled.length + replyLater.length + waiting.length,
  }
}

/**
 * The local start of the day a HEY date names. All-day dates come as UTC midnight
 * ("2026-09-25T00:00:00Z"): that's the 25th wherever you are, not the 24th west of UTC.
 */
function dayStart(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number) as [number, number, number]
  return new Date(y, m - 1, d).getTime()
}

/** A local date as YYYY-MM-DD. */
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
