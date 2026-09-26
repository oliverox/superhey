import { useEffect, useState } from 'react'
import type { EventRow } from '@shared/api'
import { api, useLive } from '../api'
import { clockOf, onDay } from '../calendar/model'
import { EventForm } from './EventForm'

/** A date found in an email: what it is, when, and its meeting link. Times are local. */
export interface MailDate {
  label: string
  date: string
  time?: string | null
  endDate?: string | null
  endTime?: string | null
  link?: string | null
}

const STOP = new Set(['with', 'from', 'your', 'this', 'that', 'call', 'meeting', 'event', 'date', 'time', 'the', 'and', 'for'])
const words = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4 && !STOP.has(w))

/**
 * The calendar event that is this date, if HEY already has it: one on the same day that
 * starts at the same time, or whose title shares a telling word with the label.
 */
export function matchingEvent(d: MailDate, events: EventRow[]): EventRow | null {
  const mine = new Set(words(d.label))
  return (
    events.find((e) => {
      if (!onDay(e, d.date)) return false
      if (d.time && !e.allDay && clockKey(e.startsAt) === d.time) return true
      return words(e.title).some((w) => mine.has(w))
    }) ?? null
  )
}
const clockKey = (iso: string) => {
  const t = new Date(iso)
  return `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`
}

/** Opens the calendar on a day (App listens). */
export const showInCalendar = (day: string) => window.dispatchEvent(new CustomEvent('superhey:open-calendar', { detail: day }))

/**
 * "Add" for a date in an email: opens the event form filled in from it. Once HEY has the
 * event, it says so (and opens the calendar on that day); just after adding, Undo.
 */
export function AddToCalendar({ item, source }: { item: MailDate; source?: string }) {
  const range = useLive(() => api.calendarRange(item.date, item.endDate ?? item.date), [item.date, item.endDate], (e) => e.type === 'change' && e.change.kind === 'calendar')
  const [form, setForm] = useState(false)
  const [added, setAdded] = useState<number | null>(null)
  const [undone, setUndone] = useState(false)
  useEffect(() => {
    if (added == null) return
    const t = setTimeout(() => setAdded(null), 12_000)
    return () => clearTimeout(t)
  }, [added])
  const match = range.data ? matchingEvent(item, range.data.events) : null

  if (added != null) {
    return (
      <span className="inline-flex shrink-0 items-center gap-1.5 text-[12px] font-medium text-ok">
        Added
        <button
          onClick={async () => {
            await api.deleteEvent(added, item.date).catch(() => {})
            setAdded(null)
            setUndone(true)
          }}
          className="rounded-ui px-1 font-semibold text-ink-soft hover:bg-pane-sunk hover:text-ink"
        >
          Undo
        </button>
      </span>
    )
  }
  if (match && !undone) {
    return (
      <button
        onClick={() => showInCalendar(item.date)}
        title={`“${match.title}”${match.allDay ? '' : ` at ${clockOf(match.startsAt)}`} — show in the calendar`}
        className="inline-flex shrink-0 items-center gap-1 rounded-ui px-1 text-[12px] font-medium text-ok hover:bg-pane-sunk"
      >
        <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="m3 8.5 3.5 3.5L13 4.5" />
        </svg>
        In calendar
      </button>
    )
  }
  return (
    <>
      <button
        onClick={(e) => {
          e.stopPropagation()
          setForm(true)
        }}
        disabled={!range.data}
        title="Add to HEY Calendar"
        className="inline-flex shrink-0 items-center gap-1 rounded-ui border border-rule px-1.5 py-px text-[12px] font-medium text-ink-soft hover:border-rule-strong hover:text-ink disabled:opacity-50"
      >
        <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden>
          <rect x="2" y="3" width="12" height="11" rx="2" />
          <path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3M8 8.5v3.5M6.25 10.25h3.5" />
        </svg>
        Add
      </button>
      {form && range.data && (
        <EventForm
          draft={{
            title: item.label,
            startsOn: item.date,
            endsOn: item.endDate ?? item.date,
            startTime: item.time ?? null,
            endTime: item.endTime ?? null,
            link: item.link ?? null,
            notes: source ? `From the email “${source}”` : null,
            source,
          }}
          calendars={range.data.calendars}
          onCancel={() => setForm(false)}
          onDone={(id) => {
            setForm(false)
            setUndone(false)
            if (id != null) setAdded(id)
          }}
        />
      )}
    </>
  )
}
