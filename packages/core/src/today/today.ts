import { ANALYSIS_VERSION, type ThreadAnalysis } from '../ai/analysis'
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
  /** What sort of thing it is (a form to return, a bill to pay…), and a bill's sum. */
  kind: TaskKind
  amount: Money | null
  /** A bill: paid automatically ('yes': this email says so; 'likely': the sender sent an autopay notice lately). */
  autopay?: Autopay
}

/** Whether a bill will be paid without you: 'yes' from its own email, 'likely' from the sender's recent autopay notice. */
export type Autopay = { how: 'yes' } | { how: 'likely'; notice: string; at: string }

/** Something done on one of your accounts to check was you (a sign-in, a new payee), from mail you don't see often. */
export interface AlertItem {
  key: string
  posting: PostingRow
  /** What happened, in a line: "New device signed in to Chase". */
  text: string
  days: number
  /** Which box it's in ("Paper Trail"). */
  box: string
}

export type TaskKind = 'form' | 'bill' | 'rsvp' | 'appointment' | 'task'
export interface Money {
  amount: number
  currency: string
}

/** A calendar event at the same time as a date in mail. */
export interface Clash {
  title: string
  startsAt: string
  endsAt: string | null
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
  /** Something to do by then from the same email ("Confirm attendance"), shown with the date. */
  task?: string | null
  /** The kind of thing to do (for a deadline, or the task above), and a bill's sum. */
  kind?: TaskKind
  amount?: Money | null
  autopay?: Autopay
  /** Within the next two days: nudged. */
  soon?: boolean
  /** An event already in the calendar at that time. */
  clash?: Clash | null
  /** When it ends, and its meeting link, when the mail says (for adding it to the calendar). */
  endDate?: string | null
  endTime?: string | null
  link?: string | null
  /**
   * Set when several emails said this (a booking, then its reminder): how many, and every
   * to-do merged into this row, so Done clears them all.
   */
  merged?: { emails: number; items: Array<{ topicId: number; text: string }>; dates: Array<{ topicId: number; text: string }> }
}

export interface TodoItem {
  key: string
  todo: TodoRow
  /** Whole days past its day; 0 for today's. */
  daysLate: number
}

export interface TodayView {
  generatedAt: string
  /** Security alerts from boxes you don't read closely (Paper Trail, The Feed): was it you? */
  alerts: AlertItem[]
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
  /** Threads to analyse: ones Today can't judge yet (waiting on others?), and shown ones read with older instructions. */
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
  /** Items you ticked Done (see `itemKey`). */
  done?: ReadonlySet<string>
}

/** A to-do's identity for Done: its thread and its words. */
export const itemKey = (topicId: number, text: string) => `${topicId}|${text.trim().toLowerCase().replace(/\s+/g, ' ')}`

/** How far back Today looks in analysed mail. */
const ANALYSED_DAYS = 60
/** How far ahead Coming up looks. */
const COMING_UP_DAYS = 7
/** How long a security alert stays on Today (unless you say it was you). */
const ALERT_DAYS = 14
/** How far apart a statement and its sender's autopay notice may be and still be paired. */
const AUTOPAY_PAIR_DAYS = 20

/**
 * Whether an action item is being somewhere at a set time rather than work to finish. Told
 * by the analysis; older analyses didn't say, so it's read from the wording.
 */
export function isEvent(i: { text: string; event?: boolean }): boolean {
  return i.event ?? /^(attend|join|go to|be at|take part|participate|meet)\b/i.test(i.text.trim())
}

const DAY = 86_400_000

const words = (s: string) => new Set(s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/[^a-z0-9]+/).filter((w) => w.length >= 4))

/**
 * An event in the calendar that overlaps a timed date from mail (an hour when no end is
 * given); not the event itself, once it has been added (same start, or a word in common).
 */
export function clashWith(c: { label: string; date: string; time: string | null; endTime?: string | null; endDate?: string | null }, events: EventRow[]): Clash | null {
  if (!c.time) return null
  const start = new Date(`${c.date}T${c.time}:00`)
  const end = c.endTime ? new Date(`${c.endDate ?? c.date}T${c.endTime}:00`) : new Date(start.getTime() + 60 * 60_000)
  const mine = words(c.label)
  for (const e of events) {
    if (e.allDay || !e.endsAt) continue
    const s = new Date(e.startsAt)
    const f = new Date(e.endsAt)
    if (!(s < end && f > start)) continue
    if (s.getTime() === start.getTime() || [...words(e.title)].some((w) => mine.has(w))) continue
    return { title: e.title, startsAt: e.startsAt, endsAt: e.endsAt }
  }
  return null
}

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

  // An email about something that's already happened (a meeting this morning): its dates
  // are all over, so what it asked of you (RSVP, confirm) has lapsed too.
  const hmNow = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  const over = (d: { date: string; endDate?: string | null; time: string | null; endTime?: string | null }) => {
    const last = d.endDate ?? d.date
    if (last !== today) return last < today
    const until = d.endTime ?? d.time
    return until != null && until <= hmNow
  }
  const lapsed = (a: ThreadAnalysis) => (a.dates ?? []).length > 0 && (a.dates ?? []).every(over)

  // Done: you ticked it, a later message says so, or (an RSVP) you've since replied.
  const isDone = (topicId: number, i: ThreadAnalysis['actionItems'][number]) =>
    i.done === true || (input.done?.has(itemKey(topicId, i.text)) ?? false) || (i.kind === 'rsvp' && repo.lastEntryIsMine(topicId as TopicId))
  const open = (topicId: number, a: ThreadAnalysis) => (a.actionItems ?? []).filter((i) => !isDone(topicId, i))

  // An appointment is one to confirm, book, move or cancel; checking in or getting ready
  // for guests is a to-do, whatever the model called it.
  const kindOf = (i: ThreadAnalysis['actionItems'][number]) =>
    i.kind === 'appointment' && !/\b(confirm|book|re-?schedule|schedule|cancel|appointment)/i.test(i.text) ? 'task' : (i.kind ?? 'task')
  // A sum is only owed on a bill (older readings put an offer's amount on a plain task).
  const owed = (i: ThreadAnalysis['actionItems'][number]) => (i.kind === 'bill' ? (i.amount ?? null) : null)

  // Autopay notices by sender ("Your automatic payment is scheduled"), to pair with bills.
  const notices = analysed.filter((r) => r.a.autopay === true && r.posting.senderEmail != null)
  const autopayOf = (posting: PostingRow, a: ThreadAnalysis, i: ThreadAnalysis['actionItems'][number]): Autopay | undefined => {
    if (kindOf(i) !== 'bill') return undefined
    if (a.autopay === true) return { how: 'yes' }
    const near = notices.find(
      (r) =>
        r.posting.id !== posting.id &&
        r.posting.senderEmail === posting.senderEmail &&
        Math.abs(Date.parse(r.posting.activeAt ?? '') - Date.parse(posting.activeAt ?? '')) <= AUTOPAY_PAIR_DAYS * DAY,
    )
    return near ? { how: 'likely', notice: near.posting.subject, at: near.posting.activeAt ?? '' } : undefined
  }

  const actions: ActionItem[] = []
  for (const { posting, a } of analysed) {
    if (!shown(posting) || seen.has(posting.topicId!) || lapsed(a) || a.category === 'newsletter' || a.category === 'promotion') continue
    // A call or meeting that has passed is simply over, not late.
    const due = open(posting.topicId!, a).filter((i) => i.due != null && (isEvent(i) ? i.due === today : i.due <= today))
    due.forEach((i, n) =>
      actions.push({ key: `action:${posting.id}:${n}`, posting, text: i.text, due: i.due!, daysLate: Math.round((dayStart(today) - dayStart(i.due!)) / DAY), kind: kindOf(i), amount: owed(i), autopay: autopayOf(posting, a, i) }),
    )
    if (due.length) seen.add(posting.topicId!)
  }
  actions.sort((x, y) => x.due.localeCompare(y.due))

  const laterBox = new Set(repo.replyLater().map((p) => p.topicId))
  const needsReply = items(
    analysed.filter(({ posting, a }) => a.needsReply && !lapsed(a) && !laterBox.has(posting.topicId) && !posting.bubbledUp).map((r) => r.posting),
    seen,
  ).map((i) => ({ ...i, reason: analysisOf.get(i.posting.topicId!)?.replyReason ?? null }))

  const replyLater = items(repo.replyLater(), seen)

  // Waiting on others: you wrote last, and your message asked for something (the analysis
  // judges that; "you wrote last" alone is mostly files sent and thanks said).
  const candidates = repo.waitingOnOthers(input.myEmails, new Date(now.getTime() - WAITING_UNTIL_DAYS * DAY).toISOString(), new Date(now.getTime() - WAITING_AFTER_DAYS * DAY).toISOString())
  const needsAnalysis = candidates.filter((p) => !analysisOf.has(p.topicId!)).map((p) => p.topicId!)
  const outdated = new Set(analysed.filter((r) => r.version < ANALYSIS_VERSION).map((r) => r.posting.topicId!))
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
    const add = (label: string, date: string, time: string | null, isDeadline: boolean, more: Pick<ComingUpItem, 'endDate' | 'endTime' | 'link'> = {}) => {
      if (date < today || date > inAWeek || (date === today && time != null && time < nowHm) || found.has(`${date}|${label.toLowerCase()}`)) return
      // Dismissed: you took this date off the Briefing.
      if (input.done?.has(itemKey(posting.topicId!, label))) return
      found.add(`${date}|${label.toLowerCase()}`)
      comingUp.push({ key: `date:${posting.id}:${comingUp.length}`, posting, label, date, time, isDeadline, ...more })
    }
    for (const d of a.dates ?? []) add(d.label, d.date, d.time, false, { endDate: d.endDate ?? null, endTime: d.endTime ?? null, link: d.link ?? null })
    for (const i of open(posting.topicId!, a)) {
      if (!i.due || i.due <= today) continue
      // A task due on the day of one of the email's dates belongs with it (one row, not two).
      const sameDay = comingUp.find((c) => c.posting.id === posting.id && !c.isDeadline && c.date === i.due && !c.task)
      if (sameDay) Object.assign(sameDay, { task: i.text, kind: kindOf(i), amount: owed(i), autopay: autopayOf(posting, a, i) })
      else {
        add(i.text, i.due, null, true)
        const row = comingUp.at(-1)
        if (row?.label === i.text && row.date === i.due) Object.assign(row, { kind: kindOf(i), amount: owed(i), autopay: autopayOf(posting, a, i) })
      }
    }
  }
  comingUp.sort((x, y) => x.date.localeCompare(y.date) || (x.time ?? '').localeCompare(y.time ?? ''))
  const coming = mergeSameThings(comingUp)

  // Nudges and clashes: what's within two days, and what the calendar already has then.
  const inTwoDays = ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2))
  const calendar = repo.events(startOfToday.toISOString(), new Date(startOfToday.getTime() + (COMING_UP_DAYS + 2) * DAY).toISOString())
  for (const c of coming) {
    c.soon = c.date <= inTwoDays
    c.clash = c.time ? clashWith(c, calendar) : null
  }

  const todos = repo.todosDue(ymd(startOfTomorrow)).map((t) => ({
    key: `todo:${t.id}`,
    todo: t,
    daysLate: t.dueAt ? Math.max(0, Math.round((startOfToday.getTime() - dayStart(t.dueAt)) / DAY)) : 0,
  }))

  // Security alerts from boxes you don't read closely: the Imbox puts them in front of you
  // already. Until you say it was you (Done), or two weeks pass.
  const boxList = repo.boxes()
  const imbox = boxList.find((b) => b.kind === 'imbox')?.id
  const alertSeen = new Set<number>()
  const alerts: AlertItem[] = analysed
    .filter(({ posting, a }) => {
      if (!a.securityAlert || posting.boxId === imbox || !shown(posting) || daysSince(posting.activeAt) > ALERT_DAYS) return false
      if (input.done?.has(itemKey(posting.topicId!, a.securityAlert)) || alertSeen.has(posting.topicId!)) return false
      alertSeen.add(posting.topicId!)
      return true
    })
    .map(({ posting, a }) => ({ key: `alert:${posting.id}`, posting, text: a.securityAlert!, days: daysSince(posting.activeAt), box: boxList.find((b) => b.id === posting.boxId)?.name ?? '' }))

  return {
    generatedAt: now.toISOString(),
    alerts,
    due: { todos, actions, bubbled },
    needsReply,
    replyLater,
    waiting,
    comingUp: coming.slice(0, 8),
    events: repo.events(startOfToday.toISOString(), startOfTomorrow.toISOString()),
    // The first time, "new" is today's: every unread email ever would be noise, not news.
    newSince: {
      since: input.since,
      boxes: repo
        .unseenSince(input.since ?? startOfToday.toISOString())
        .filter((b) => b.count > 0 && b.kind !== 'bubblebox' && b.kind !== 'laterbox')
        .map((b) => ({ ...b, threads: repo.unseenThreadsSince(b.boxId, input.since ?? startOfToday.toISOString(), NEW_SHOWN) })),
    },
    toHandle: alerts.length + todos.length + actions.length + bubbled.length + needsReply.length + replyLater.length + waiting.length,
    // Plus what's shown from a reading made with older instructions, so it's judged again.
    needsAnalysis: [
      ...new Set([
        ...needsAnalysis,
        ...[...alerts, ...actions, ...needsReply, ...waiting, ...coming.slice(0, 8)].map((i) => i.posting.topicId!).filter((id) => outdated.has(id)),
      ]),
    ],
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

// Words that carry no meaning when comparing two rows' wording.
const FILLER = new Set(['a', 'an', 'the', 'to', 'for', 'of', 'in', 'on', 'at', 'and', 'or', 'your', 'you', 'with', 'from', 'by', 'is', 'are', 'be', 'it', 'this'])
const wordsOf = (text: string) => new Set(text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w && !FILLER.has(w)))
// References that name one thing: a flight or train number ("MK 288", "EK704").
const codesOf = (text: string) => new Set([...text.matchAll(/\b([A-Z]{2,3})\s?(\d{2,4})\b/g)].map((m) => `${m[1]}${m[2]}`))

/** Whether two rows on the same day are about the same thing. */
function sameThing(a: ComingUpItem, b: ComingUpItem): boolean {
  if (a.date !== b.date) return false
  const textA = `${a.label} ${a.task ?? ''}`
  const textB = `${b.label} ${b.task ?? ''}`
  const codesA = codesOf(textA)
  if ([...codesOf(textB)].some((c) => codesA.has(c))) return true
  if (a.time && a.time === b.time && a.posting.senderEmail && a.posting.senderEmail === b.posting.senderEmail) return true
  const wa = wordsOf(textA)
  const wb = wordsOf(textB)
  const shared = [...wa].filter((w) => wb.has(w)).length
  return shared >= 3 && shared / new Set([...wa, ...wb]).size >= 0.6
}

/**
 * One row per thing, however many emails mention it: the booking, its reminder and its
 * check-in notice become one flight. The row with a time (else the first) stands for the
 * group; it takes a to-do from the others if it has none, and remembers every to-do merged
 * in, so Done clears them all and none comes back. Rows stay in their order.
 */
export function mergeSameThings(items: ComingUpItem[]): ComingUpItem[] {
  const groups: ComingUpItem[][] = []
  for (const item of items) {
    const group = groups.find((g) => g.some((other) => sameThing(item, other)))
    if (group) group.push(item)
    else groups.push([item])
  }
  return groups.map((group) => {
    if (group.length === 1) return group[0]!
    const lead = group.find((c) => c.time && !c.isDeadline) ?? group.find((c) => !c.isDeadline) ?? group[0]!
    const row: ComingUpItem = { ...lead }
    // A to-do for the row: the lead's own, else the first other one (a deadline's text is its label).
    // (A deadline row is a to-do already.)
    const todo = lead.task || lead.isDeadline ? null : group.find((c) => c !== lead && (c.task || c.isDeadline))
    if (todo) Object.assign(row, { task: todo.task ?? todo.label, kind: todo.kind, amount: todo.amount, autopay: todo.autopay })
    const items = group
      .filter((c) => c.task || c.isDeadline)
      .map((c) => ({ topicId: c.posting.topicId!, text: c.task ?? c.label }))
      .filter((it, i, all) => all.findIndex((o) => o.topicId === it.topicId && o.text === it.text) === i)
    // Every row's own label, so dismissing the date dismisses it in each email.
    const dates = group.map((c) => ({ topicId: c.posting.topicId!, text: c.label }))
    row.merged = { emails: new Set(group.map((c) => c.posting.id)).size, items, dates }
    return row
  })
}
