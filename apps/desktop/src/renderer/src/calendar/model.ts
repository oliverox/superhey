import type { EventRow } from '@shared/api'

/**
 * The calendar's arithmetic: days, weeks and months (weeks start on Sunday, as in the Mac's
 * Calendar), where each event falls, and how overlapping ones share a column.
 * Days are local, written YYYY-MM-DD.
 */

export type CalendarMode = 'day' | 'week' | 'month'

export const pad = (n: number) => String(n).padStart(2, '0')
export const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
export const parseDay = (day: string) => {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number]
  return new Date(y, m - 1, d)
}
export const addDays = (day: string, n: number) => {
  const d = parseDay(day)
  d.setDate(d.getDate() + n)
  return ymd(d)
}
export const addMonths = (day: string, n: number) => {
  const d = parseDay(day)
  const target = new Date(d.getFullYear(), d.getMonth() + n, 1)
  // The same day of the month, or the month's last if it's shorter.
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate()
  return ymd(new Date(target.getFullYear(), target.getMonth(), Math.min(d.getDate(), last)))
}
export const startOfWeek = (day: string) => addDays(day, -parseDay(day).getDay())
export const startOfMonth = (day: string) => day.slice(0, 8) + '01'
export const daysBetween = (a: string, b: string) => Math.round((parseDay(b).getTime() - parseDay(a).getTime()) / 86_400_000)

/** The days a view shows: one, a week, or the six weeks holding a month. */
export function viewDays(mode: CalendarMode, day: string): string[] {
  const first = mode === 'day' ? day : mode === 'week' ? startOfWeek(day) : startOfWeek(startOfMonth(day))
  const count = mode === 'day' ? 1 : mode === 'week' ? 7 : 42
  return Array.from({ length: count }, (_, i) => addDays(first, i))
}

/** Where ‹ and › go from `day`. */
export const step = (mode: CalendarMode, day: string, dir: 1 | -1) =>
  mode === 'day' ? addDays(day, dir) : mode === 'week' ? addDays(day, 7 * dir) : addMonths(day, dir)

/**
 * The days an event covers. All-day events carry their day in UTC ("…T00:00:00Z") and end
 * on their last day; timed ones fall on the local days they run through.
 */
export function eventDays(e: Pick<EventRow, 'startsAt' | 'endsAt' | 'allDay'>): { first: string; last: string } {
  if (e.allDay) {
    const first = e.startsAt.slice(0, 10)
    const end = (e.endsAt ?? e.startsAt).slice(0, 10)
    return { first, last: end < first ? first : end }
  }
  const start = new Date(e.startsAt)
  const end = new Date(e.endsAt ?? e.startsAt)
  // Ending exactly at midnight doesn't reach into the next day.
  const lastMoment = end > start ? new Date(end.getTime() - 1) : start
  return { first: ymd(start), last: ymd(lastMoment) }
}

export const onDay = (e: EventRow, day: string) => {
  const { first, last } = eventDays(e)
  return first <= day && day <= last
}

/** Minutes from midnight of `day` to when the event starts and ends there (clipped to the day). */
export function minutesOn(e: EventRow, day: string): { start: number; end: number } {
  const dayStart = parseDay(day).getTime()
  const s = (new Date(e.startsAt).getTime() - dayStart) / 60_000
  const f = (new Date(e.endsAt ?? e.startsAt).getTime() - dayStart) / 60_000
  const start = Math.max(0, Math.min(s, 1440))
  const end = Math.max(start, Math.min(f, 1440))
  return { start, end }
}

export interface Placed {
  event: EventRow
  start: number
  end: number
  /** Column and number of columns in its cluster of overlapping events. */
  col: number
  cols: number
}

/**
 * Lays out a day's timed events: overlapping ones side by side, as calendars do. Each
 * cluster of overlapping events shares its columns; very short events count as 20 minutes.
 */
export function layoutDay(events: EventRow[], day: string): Placed[] {
  const items = events
    .filter((e) => !e.allDay && onDay(e, day))
    .map((e) => ({ event: e, ...minutesOn(e, day) }))
    .sort((a, b) => a.start - b.start || b.end - a.end)
  const out: Placed[] = []
  let cluster: Placed[] = []
  let clusterEnd = -1
  const close = () => {
    const cols = Math.max(1, ...cluster.map((p) => p.col + 1))
    for (const p of cluster) p.cols = cols
    out.push(...cluster)
    cluster = []
  }
  for (const it of items) {
    const end = Math.max(it.end, it.start + 20)
    if (cluster.length && it.start >= clusterEnd) close()
    const taken = new Set(cluster.filter((p) => Math.max(p.end, p.start + 20) > it.start).map((p) => p.col))
    let col = 0
    while (taken.has(col)) col++
    cluster.push({ ...it, col, cols: 1 })
    clusterEnd = Math.max(clusterEnd, end)
  }
  if (cluster.length) close()
  return out
}

export interface Bar {
  event: EventRow
  /** First and last column (0-based) within the days shown, and the row in the all-day lane. */
  from: number
  to: number
  row: number
}

/** All-day events (and ones running over several days) as bars across `days`, packed into rows. */
export function allDayBars(events: EventRow[], days: string[]): Bar[] {
  const first = days[0]!
  const last = days.at(-1)!
  const spans = events
    .filter((e) => e.allDay || eventDays(e).first !== eventDays(e).last)
    .map((e) => ({ event: e, ...eventDays(e) }))
    .filter((s) => s.first <= last && s.last >= first)
    .sort((a, b) => a.first.localeCompare(b.first) || b.last.localeCompare(a.last))
  const rows: number[] = [] // last column used in each row
  return spans.map((s) => {
    const from = Math.max(0, daysBetween(first, s.first))
    const to = Math.min(days.length - 1, daysBetween(first, s.last))
    let row = rows.findIndex((end) => end < from)
    if (row < 0) row = rows.push(-1) - 1
    rows[row] = to
    return { event: s.event, from, to, row }
  })
}

/** HEY's calendar colours; the calendar with none uses the app's accent. */
const COLORS: Record<string, string> = {
  red: '#e5484d',
  orange: '#f76b15',
  yellow: '#e2a336',
  green: '#30a46c',
  teal: '#12a594',
  blue: '#3e63dd',
  purple: '#8e4ec6',
  pink: '#d6409f',
  brown: '#a18072',
  gray: '#8b8d98',
  grey: '#8b8d98',
  black: '#6f6f78',
}
export const calendarColor = (name: string | null | undefined) => (name && COLORS[name.toLowerCase()]) || 'var(--accent)'

/** An event's colours: a tint to fill with, the solid for the edge, and readable text. */
export function eventColors(name: string | null | undefined) {
  const c = calendarColor(name)
  return {
    solid: c,
    fill: `color-mix(in oklab, ${c} 18%, var(--pane))`,
    text: `color-mix(in oklab, ${c} 62%, var(--ink))`,
  }
}

const clockFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })
export const clockOf = (iso: string) => clockFmt.format(new Date(iso))
/** "8:30–10 AM" style range for a timed event. */
export function timeRange(e: EventRow): string {
  if (e.allDay) return 'All day'
  return e.endsAt ? `${clockOf(e.startsAt)} – ${clockOf(e.endsAt)}` : clockOf(e.startsAt)
}
