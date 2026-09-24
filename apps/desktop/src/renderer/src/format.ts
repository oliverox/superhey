const time = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })
const dayMonth = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })
const full = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
const long = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
})

/** Compact list timestamp: time today, day this year, full date otherwise. */
export function shortDate(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) return time.format(d)
  if (d.getFullYear() === now.getFullYear()) return dayMonth.format(d)
  return full.format(d)
}

/** Split for the time tag: { day: "Aug 13" (or "Aug 13, 2024" for other years), time: "11:21 AM" }. */
export function dayAndTime(iso: string, now = new Date()): { day: string; time: string } {
  const d = new Date(iso)
  const day = d.getFullYear() === now.getFullYear() ? dayMonth.format(d) : full.format(d)
  return { day, time: time.format(d) }
}

export const longDate = (iso: string) => long.format(new Date(iso))
export const clock = (iso: string) => time.format(new Date(iso))

export function startOfDay(offsetDays = 0): Date {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + offsetDays)
}

export const initials = (name: string | null) =>
  (name ?? '?')
    .replace(/[^\p{L}\p{N} ]/gu, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('') || '?'
