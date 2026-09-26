import type { ThreadAnalysis } from '../ai/analysis'
import type { Contact, EventRow, PostingRow, Repo, TodoRow } from '../cache/repo'
import type { TopicId } from '../ids'

/**
 * Today: what needs you, assembled from the cache (no AI, no calls to HEY). A queue of
 * decisions rather than a dashboard: each item says why it's here, and leaves once handled
 * in HEY (done, moved, replied, bubbled) or put off with "not now".
 */

/** Waiting on others: you sent the latest message at least this long ago… */
export const WAITING_AFTER_DAYS = 3
/** …and not so long ago that it's surely settled. */
export const WAITING_UNTIL_DAYS = 30
/** New mail shown per box on Today; the rest is a click away in the box. */
export const NEW_SHOWN = 5

export interface ThreadItem {
  key: string
  posting: PostingRow
  /** Whole days since the thread's latest activity. */
  days: number
  /** Waiting on others: who you wrote to. */
  people?: Contact[]
  /** Needs your reply: what they want, in a few words (from the analysis). */
  reason?: string | null
}

/** Something the mail says you must do, with a deadline that has come. */
export interface ActionItem {
  key: string
  posting: PostingRow
  text: string
  due: string
  /** Whole days past its deadline; 0 when it's today. */
  daysLate: number
}

/** A date found in mail, in the next week. */
export interface ComingUpItem {
  key: string
  posting: PostingRow
  label: string
  /** YYYY-MM-DD. */
  date: string
  time: string | null
  /** A deadline for something you must do (not just a date). */
  isDeadline: boolean
}

export interface TodoItem {
  key: string
  todo: TodoRow
  /** Whole days past its day; 0 for today's. */
  daysLate: number
}

export interface TodayView {
  generatedAt: string
  /** To-dos overdue or for today, what mail says is due by today, and threads bubbled up now. */
  due: { todos: TodoItem[]; actions: ActionItem[]; bubbled: ThreadItem[] }
  /** Threads the AI judged need your reply (and you haven't parked in Reply Later). */
  needsReply: ThreadItem[]
  replyLater: ThreadItem[]
  waiting: ThreadItem[]
  /** Dates in mail over the next week: bookings, renewals, deadlines. */
  comingUp: ComingUpItem[]
  /** The day's calendar events. */
  events: EventRow[]
  /** Unread mail per box since you last looked (the first time: since the start of today). */
  /** What arrived since you last looked (today's, the first time), per box: how many, and the newest few. */
  newSince: { since: string | null; boxes: Array<{ boxId: number; kind: string; name: string; count: number; threads: PostingRow[] }> }
  /** How many items above are yours to handle (events, dates and new mail aren't). */
  toHandle: number
  /** Threads Today can't judge until they're analysed (candidates for waiting on others). */
  needsAnalysis: TopicId[]
}

export interface TodayInput {
  now: Date
  /** Your addresses (for waiting on others). */
  myEmails: string[]
  /** When you last looked at Today; null the first time (then "new" means new today). */
  since: string | null
  /**
   * Items put off with "not now": key → the thread's activity then, and until when. They
   * return when the thread changes, or when the time comes. (A bare string: activity only.)
   */
  hidden: Record<string, string | { at: string; until: string | null }>
}

/** How far back Today looks in analysed mail. */
const ANALYSED_DAYS = 60
/** How far ahead Coming up looks. */
const COMING_UP_DAYS = 7

/**
 * Whether an action item is being somewhere at a set time rather than work to finish. Told
 * by the analysis; older analyses didn't say, so it's read from the wording.
 */
export function isEvent(i: { text: string; event?: boolean }): boolean {
  return i.event ?? /^(attend|join|go to|be at|take part|participate|meet)\b/i.test(i.text.trim())
}

const DAY = 86_400_000

export function buildToday(repo: Repo, input: TodayInput): TodayView {
  const { now } = input
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startOfTomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  const daysSince = (iso: string | null) => (iso ? Math.max(0, Math.floor((now.getTime() - Date.parse(iso)) / DAY)) : 0)

  const shown = (p: PostingRow) => {
    const entry = input.hidden[`thread:${p.id}`]
    if (entry === undefined) return true
    const { at, until } = typeof entry === 'string' ? { at: entry, until: null } : entry
    return at !== (p.activeAt ?? '') || (until != null && now.getTime() >= Date.parse(until))
  }
  const items = (rows: PostingRow[], seen: Set<number>) =>
    rows
      .filter((p) => shown(p) && p.topicId != null && !seen.has(p.topicId) && (seen.add(p.topicId), true))
      .map((p) => ({ key: `thread:${p.id}`, posting: p, days: daysSince(p.activeAt) }))

  const today = ymd(now)
  const inAWeek = ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() + COMING_UP_DAYS))
  const analysed = repo.currentAnalyses(new Date(now.getTime() - ANALYSED_DAYS * DAY).toISOString()).map((r) => ({ ...r, a: r.analysis as unknown as ThreadAnalysis }))
  const analysisOf = new Map(analysed.map((r) => [r.posting.topicId!, r.a]))

  // A thread appears once, in the first section that claims it: due (bubbled up, or a
  // deadline in its mail), needs your reply, Reply Later, waiting on others.
  const seen = new Set<number>()
  const bubbled = items(repo.bubbledUp(), seen)

  const actions: ActionItem[] = []
  for (const { posting, a } of analysed) {
    if (!shown(posting) || seen.has(posting.topicId!)) continue
    // A call or meeting that has passed is simply over, not late.
    const due = (a.actionItems ?? []).filter((i) => i.due != null && (isEvent(i) ? i.due === today : i.due <= today))
    due.forEach((i, n) => actions.push({ key: `action:${posting.id}:${n}`, posting, text: i.text, due: i.due!, daysLate: Math.round((dayStart(today) - dayStart(i.due!)) / DAY) }))
    if (due.length) seen.add(posting.topicId!)
  }
  actions.sort((x, y) => x.due.localeCompare(y.due))

  const laterBox = new Set(repo.replyLater().map((p) => p.topicId))
  const needsReply = items(
    analysed.filter(({ posting, a }) => a.needsReply && !laterBox.has(posting.topicId) && !posting.bubbledUp).map((r) => r.posting),
    seen,
  ).map((i) => ({ ...i, reason: analysisOf.get(i.posting.topicId!)?.replyReason ?? null }))

  const replyLater = items(repo.replyLater(), seen)

  // Waiting on others: you wrote last, and your message asked for something (the analysis
  // judges that; "you wrote last" alone is mostly files sent and thanks said).
  const candidates = repo.waitingOnOthers(input.myEmails, new Date(now.getTime() - WAITING_UNTIL_DAYS * DAY).toISOString(), new Date(now.getTime() - WAITING_AFTER_DAYS * DAY).toISOString())
  const needsAnalysis = candidates.filter((p) => !analysisOf.has(p.topicId!)).map((p) => p.topicId!)
  const waiting = items(
    candidates.filter((p) => analysisOf.get(p.topicId!)?.expectsReply),
    seen,
  ).map((i) => ({ ...i, people: repo.otherPeople(i.posting.id, input.myEmails) }))

  // Coming up: your dates from mail in the next week (not claiming threads: a date isn't a
  // task). Not from newsletters or promotions, and not what's already over today.
  const comingUp: ComingUpItem[] = []
  const nowHm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  for (const { posting, a } of analysed) {
    if (!shown(posting) || a.category === 'newsletter' || a.category === 'promotion') continue
    const found = new Set<string>()
    const add = (label: string, date: string, time: string | null, isDeadline: boolean) => {
      if (date < today || date > inAWeek || (date === today && time != null && time < nowHm) || found.has(`${date}|${label.toLowerCase()}`)) return
      found.add(`${date}|${label.toLowerCase()}`)
      comingUp.push({ key: `date:${posting.id}:${comingUp.length}`, posting, label, date, time, isDeadline })
    }
    for (const d of a.dates ?? []) add(d.label, d.date, d.time, false)
    for (const i of a.actionItems ?? []) if (i.due && i.due > today) add(i.text, i.due, null, true)
  }
  comingUp.sort((x, y) => x.date.localeCompare(y.date) || (x.time ?? '').localeCompare(y.time ?? ''))

  const todos = repo.todosDue(ymd(startOfTomorrow)).map((t) => ({
    key: `todo:${t.id}`,
    todo: t,
    daysLate: t.dueAt ? Math.max(0, Math.round((startOfToday.getTime() - dayStart(t.dueAt)) / DAY)) : 0,
  }))

  return {
    generatedAt: now.toISOString(),
    due: { todos, actions, bubbled },
    needsReply,
    replyLater,
    waiting,
    comingUp: comingUp.slice(0, 8),
    events: repo.events(startOfToday.toISOString(), startOfTomorrow.toISOString()),
    // The first time, "new" is today's: every unread email ever would be noise, not news.
    newSince: {
      since: input.since,
      boxes: repo
        .unseenSince(input.since ?? startOfToday.toISOString())
        .filter((b) => b.count > 0 && b.kind !== 'bubblebox' && b.kind !== 'laterbox')
        .map((b) => ({ ...b, threads: repo.unseenThreadsSince(b.boxId, input.since ?? startOfToday.toISOString(), NEW_SHOWN) })),
    },
    toHandle: todos.length + actions.length + bubbled.length + needsReply.length + replyLater.length + waiting.length,
    needsAnalysis,
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
