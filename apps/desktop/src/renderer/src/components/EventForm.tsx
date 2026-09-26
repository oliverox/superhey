import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { CalendarRow, NewEvent } from '@shared/api'
import { api } from '../api'
import { calendarColor } from '../calendar/model'
import { Spinner } from './Spinner'

/**
 * A new event, filled in (from an email's dates, or a day in the calendar) for you to check
 * before it goes to HEY Calendar. Nothing is added until you press Add.
 */
export interface EventDraft extends NewEvent {
  /** Where it came from, shown above the form (e.g. the email's subject). */
  source?: string
}

const CAL_KEY = 'calendar:last'
const lastCalendar = () => {
  try {
    return Number(localStorage.getItem(CAL_KEY)) || null
  } catch {
    return null
  }
}

export function EventForm({ draft, calendars, onDone, onCancel }: { draft: EventDraft; calendars: CalendarRow[]; onDone: (id: number | null, event: NewEvent) => void; onCancel: () => void }) {
  // Calendars you can add to: not HEY's "Maybe" list.
  const choices = useMemo(() => calendars.filter((c) => c.kind !== 'maybe'), [calendars])
  const [title, setTitle] = useState(draft.title)
  const [allDay, setAllDay] = useState(!draft.startTime)
  const [startsOn, setStartsOn] = useState(draft.startsOn)
  const [endsOn, setEndsOn] = useState(draft.endsOn ?? draft.startsOn)
  const [startTime, setStartTime] = useState(draft.startTime ?? '09:00')
  const [endTime, setEndTime] = useState(draft.endTime ?? plusHour(draft.startTime ?? '09:00'))
  const [calendarId, setCalendarId] = useState<number | null>(draft.calendarId ?? (choices.some((c) => c.id === lastCalendar()) ? lastCalendar() : (choices[0]?.id ?? null)))
  const [location, setLocation] = useState(draft.location ?? '')
  const [link, setLink] = useState(draft.link ?? '')
  const [notes, setNotes] = useState(draft.notes ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const titleRef = useRef<HTMLInputElement>(null)
  useEffect(() => titleRef.current?.select(), [])
  const zone = draft.timeZone && draft.timeZone !== Intl.DateTimeFormat().resolvedOptions().timeZone ? draft.timeZone : null

  const problem = !title.trim() ? 'Add a title' : endsOn < startsOn ? 'It ends before it starts' : !allDay && endsOn === startsOn && endTime <= startTime ? 'It ends before it starts' : null

  const add = async () => {
    if (problem || busy) return setError(problem)
    setBusy(true)
    setError(null)
    const event: NewEvent = {
      title: title.trim(),
      startsOn,
      endsOn,
      startTime: allDay ? null : startTime,
      endTime: allDay ? null : endTime,
      timeZone: allDay ? null : (zone ?? null),
      calendarId,
      location: location.trim() || null,
      link: link.trim() || null,
      notes: notes.trim() || null,
    }
    try {
      const id = await api.addEvent(event)
      try {
        if (calendarId != null) localStorage.setItem(CAL_KEY, String(calendarId))
      } catch {
        // not remembered
      }
      onDone(id, event)
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e))
      setBusy(false)
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      onCancel()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onCancel])

  const field = 'field w-full'
  return createPortal(
    <div className="fade-in fixed inset-0 z-[75] flex items-start justify-center bg-black/35 pt-[12vh]" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <form
        role="dialog"
        aria-label="New event"
        onSubmit={(e) => {
          e.preventDefault()
          void add()
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            void add()
          }
        }}
        className="pop-in w-[min(460px,92vw)] rounded-ui-lg border border-rule-strong bg-pane p-5 shadow-[0_24px_64px_-24px_rgba(0,0,0,0.5)]"
      >
        <div className="flex items-baseline gap-2">
          <h2 className="text-[15px] font-semibold text-ink">Add to calendar</h2>
          {draft.source && <span className="min-w-0 truncate text-[12px] text-ink-faint">from “{draft.source}”</span>}
        </div>

        <input ref={titleRef} value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Title" placeholder="Title" className="field mt-4 w-full text-[15px] font-medium" />

        <div className="mt-3 grid grid-cols-[64px_1fr] items-center gap-x-3 gap-y-2.5 text-[13px]">
          <span className="text-ink-faint">All day</span>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} className="accent-[var(--accent)]" />
            <span className="text-ink-soft">{allDay ? 'Yes' : 'No'}</span>
          </label>

          <span className="text-ink-faint">Starts</span>
          <span className="flex gap-2">
            <input
              type="date"
              value={startsOn}
              onChange={(e) => {
                const v = e.target.value
                // Moving the start moves the end with it.
                setEndsOn((end) => (end < v || end === startsOn ? v : end))
                setStartsOn(v)
              }}
              aria-label="Start date"
              className={field}
            />
            {!allDay && <input type="time" value={startTime} onChange={(e) => (setEndTime(plusHour(e.target.value)), setStartTime(e.target.value))} aria-label="Start time" className="field w-[7.5rem]" />}
          </span>

          <span className="text-ink-faint">Ends</span>
          <span className="flex gap-2">
            <input type="date" value={endsOn} min={startsOn} onChange={(e) => setEndsOn(e.target.value)} aria-label="End date" className={field} />
            {!allDay && <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} aria-label="End time" className="field w-[7.5rem]" />}
          </span>
          {!allDay && zone && (
            <>
              <span />
              <span className="-mt-1 text-[12px] text-ink-faint">Times in {zone.replace(/_/g, ' ')}, as the email gives them; HEY shows them in your time.</span>
            </>
          )}

          <span className="text-ink-faint">Calendar</span>
          <span className="flex items-center gap-2">
            <span className="size-2.5 shrink-0 rounded-full" style={{ background: calendarColor(choices.find((c) => c.id === calendarId)?.color) }} />
            <select value={calendarId ?? ''} onChange={(e) => setCalendarId(Number(e.target.value) || null)} aria-label="Calendar" className={field}>
              {choices.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name ?? 'Calendar'}
                </option>
              ))}
            </select>
          </span>

          <span className="text-ink-faint">Where</span>
          <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Location (optional)" aria-label="Location" className={field} />

          <span className="text-ink-faint">Link</span>
          <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="Meeting link (optional)" aria-label="Link" className={field} />

          <span className="self-start pt-1.5 text-ink-faint">Notes</span>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} aria-label="Notes" className="field w-full resize-none" />
        </div>

        <div className="mt-5 flex items-center gap-2">
          <span className={`min-w-0 flex-1 truncate text-[12px] ${error ? 'text-danger' : 'text-ink-faint'}`}>{error ?? ''}</span>
          <button type="button" onClick={onCancel} className="rounded-ui px-3 py-1.5 text-[13px] text-ink-soft hover:bg-pane-sunk hover:text-ink">
            Cancel
          </button>
          <button type="submit" disabled={busy} className="btn-primary inline-flex items-center gap-2 disabled:opacity-60">
            {busy && <Spinner size={12} />}
            {busy ? 'Adding…' : 'Add'}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  )
}

function plusHour(hm: string): string {
  const [h, m] = hm.split(':').map(Number) as [number, number]
  return `${String(Math.min(23, h + 1)).padStart(2, '0')}:${String(h >= 23 ? 59 : m).padStart(2, '0')}`
}
