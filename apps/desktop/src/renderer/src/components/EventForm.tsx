import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
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
  /** Where it came from, shown under the title (e.g. the email's subject). */
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

const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
const clockFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })
const parseDay = (day: string) => {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number]
  return new Date(y, m - 1, d)
}
const showDay = (day: string) => dayFmt.format(parseDay(day))
const toMin = (hm: string) => {
  const [h, m] = hm.split(':').map(Number) as [number, number]
  return h * 60 + m
}
const toHm = (min: number) => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
const showTime = (hm: string) => clockFmt.format(new Date(2026, 0, 1, ...(hm.split(':').map(Number) as [number, number])))

/**
 * The event as an inspector, like the Mac's Calendar: everything reads as text and becomes
 * a field only when you point at it or click. The stripe down the side is the calendar's
 * colour. ⌘↵ adds; Esc cancels.
 */
export function EventForm({ draft, calendars, onDone, onCancel }: { draft: EventDraft; calendars: CalendarRow[]; onDone: (id: number | null, event: NewEvent) => void; onCancel: () => void }) {
  // Calendars you can add to: not HEY's "Maybe" list.
  const choices = useMemo(() => calendars.filter((c) => c.kind !== 'maybe'), [calendars])
  const [title, setTitle] = useState(draft.title)
  const [allDay, setAllDay] = useState(!draft.startTime)
  const [startsOn, setStartsOn] = useState(draft.startsOn)
  const [endsOn, setEndsOn] = useState(draft.endsOn ?? draft.startsOn)
  const [startTime, setStartTime] = useState(draft.startTime ?? '09:00')
  const [endTime, setEndTime] = useState(draft.endTime ?? toHm(Math.min(toMin(draft.startTime ?? '09:00') + 60, 23 * 60 + 45)))
  const [calendarId, setCalendarId] = useState<number | null>(draft.calendarId ?? (choices.some((c) => c.id === lastCalendar()) ? lastCalendar() : (choices[0]?.id ?? null)))
  const [location, setLocation] = useState(draft.location ?? '')
  const [link, setLink] = useState(draft.link ?? '')
  const [notes, setNotes] = useState(draft.notes ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [menu, setMenu] = useState<null | 'calendar' | 'start' | 'end'>(null)
  const titleRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!draft.title) titleRef.current?.focus()
  }, [draft.title])

  const calendar = choices.find((c) => c.id === calendarId) ?? null
  const color = calendarColor(calendar?.color)
  const multiDay = endsOn !== startsOn
  const problem = !title.trim() ? 'Add a title' : endsOn < startsOn ? 'It ends before it starts' : !allDay && !multiDay && endTime <= startTime ? 'It ends before it starts' : null

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
      timeZone: null,
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
      if (menu) setMenu(null)
      else onCancel()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onCancel, menu])

  const moveStart = (day: string) => {
    // The end moves with the start, keeping the event's length.
    const span = Math.round((parseDay(endsOn).getTime() - parseDay(startsOn).getTime()) / 86_400_000)
    const end = parseDay(day)
    end.setDate(end.getDate() + Math.max(0, span))
    setStartsOn(day)
    setEndsOn(`${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`)
  }
  const moveStartTime = (hm: string) => {
    const length = Math.max(15, toMin(endTime) - toMin(startTime))
    setStartTime(hm)
    setEndTime(toHm(Math.min(toMin(hm) + length, 23 * 60 + 59)))
  }

  return createPortal(
    <div className="fade-in fixed inset-0 z-[75] flex items-start justify-center bg-black/30 pt-[14vh]" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
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
        className="event-card pop-in relative w-[min(440px,92vw)] overflow-visible rounded-ui-lg bg-pane pt-5 pr-5 pb-4 pl-7 shadow-[0_0_0_1px_var(--rule-strong),0_28px_70px_-28px_rgba(0,0,0,0.55)]"
      >
        {/* The calendar's colour, down the side. */}
        <span aria-hidden className="absolute top-3 bottom-3 left-3 w-[3px] rounded-full transition-colors duration-(--dur-2)" style={{ background: color }} />

        <input
          ref={titleRef}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          aria-label="Title"
          placeholder="New event"
          className="ghost-field w-full text-[20px] leading-tight font-semibold tracking-tight text-ink"
        />
        {draft.source && <p className="mt-0.5 truncate px-2 text-[12px] text-ink-faint">From “{draft.source}”</p>}

        <div className="mt-4 space-y-1.5 text-[14px]">
          {/* When */}
          <Row icon={<ClockIcon />}>
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-0.5 text-ink">
              <DayField value={startsOn} onChange={moveStart} label="Start day" />
              {!allDay && !multiDay && (
                <>
                  <span className="px-0.5 text-ink-faint">·</span>
                  <TimeField value={startTime} open={menu === 'start'} onOpen={(o) => setMenu(o ? 'start' : null)} onChange={moveStartTime} label="Start time" />
                  <span className="px-0.5 text-ink-faint">–</span>
                  <TimeField value={endTime} open={menu === 'end'} onOpen={(o) => setMenu(o ? 'end' : null)} onChange={setEndTime} label="End time" after={startTime} />
                </>
              )}
              {(allDay || multiDay) && (
                <>
                  <span className="px-1 text-ink-faint">→</span>
                  <DayField value={endsOn} onChange={setEndsOn} label="End day" min={startsOn} />
                </>
              )}
              {multiDay && !allDay && (
                <span className="basis-full pl-2 text-[12px] text-ink-faint">
                  from {showTime(startTime)} to {showTime(endTime)}
                </span>
              )}
            </div>
            <Switch on={allDay} onChange={setAllDay} label="All day" />
          </Row>

          {/* Calendar */}
          <Row icon={<span className="size-[9px] rounded-full" style={{ background: color }} />}>
            <div className="relative">
              <button type="button" onClick={() => setMenu(menu === 'calendar' ? null : 'calendar')} aria-haspopup="listbox" aria-expanded={menu === 'calendar'} className="ghost-field inline-flex items-center gap-1.5 text-ink">
                {calendar?.name ?? 'HEY Calendar'}
                <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-ink-faint" aria-hidden>
                  <path d="m4 6 4 4 4-4" />
                </svg>
              </button>
              {menu === 'calendar' && (
                <Popover onClose={() => setMenu(null)}>
                  <ul role="listbox" aria-label="Calendar" className="py-1">
                    {choices.map((c) => (
                      <li key={c.id}>
                        <button
                          type="button"
                          role="option"
                          aria-selected={c.id === calendarId}
                          onClick={() => {
                            setCalendarId(c.id)
                            setMenu(null)
                          }}
                          className="flex w-full items-center gap-2.5 rounded-ui px-2.5 py-1.5 text-left text-[13px] text-ink hover:bg-pane-sunk"
                        >
                          <span className="size-[9px] shrink-0 rounded-full" style={{ background: calendarColor(c.color) }} />
                          <span className="min-w-0 flex-1 truncate">{c.name ?? 'HEY Calendar'}</span>
                          {c.id === calendarId && <CheckIcon />}
                        </button>
                      </li>
                    ))}
                  </ul>
                </Popover>
              )}
            </div>
          </Row>

          <Row icon={<PinIcon />}>
            <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Add location" aria-label="Location" className="ghost-field w-full text-ink" />
          </Row>
          <Row icon={<LinkIcon />}>
            <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="Add meeting link" aria-label="Meeting link" className="ghost-field w-full text-ink" />
          </Row>
          <Row icon={<NoteIcon />} top>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={1} placeholder="Add notes" aria-label="Notes" className="ghost-field block max-h-40 w-full resize-none [field-sizing:content] text-[13px] leading-snug text-ink-soft" />
          </Row>
        </div>

        <div className="mt-4 flex items-center gap-1">
          <span className={`min-w-0 flex-1 truncate px-2 text-[12px] ${error ? 'text-danger' : 'text-ink-faint'}`}>{error ?? 'Nothing is added until you press Add.'}</span>
          <button type="button" onClick={onCancel} className="rounded-ui px-3 py-1.5 text-[13px] text-ink-soft hover:bg-pane-sunk hover:text-ink">
            Cancel
          </button>
          <button type="submit" disabled={busy} title="Add (⌘↵)" className="btn-primary inline-flex items-center gap-2 disabled:opacity-60">
            {busy && <Spinner size={12} />}
            {busy ? 'Adding…' : 'Add'}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  )
}

function Row({ icon, top, children }: { icon: ReactNode; top?: boolean; children: ReactNode }) {
  return (
    <div className={`flex gap-2 ${top ? 'items-start' : 'items-center'}`}>
      <span className={`flex w-5 shrink-0 justify-center text-ink-faint ${top ? 'pt-[7px]' : ''}`}>{icon}</span>
      <div className="flex min-w-0 flex-1 items-center gap-2">{children}</div>
    </div>
  )
}

/** A day that reads as "Sat, Oct 3" and opens the date picker when clicked. */
function DayField({ value, onChange, label, min }: { value: string; onChange: (v: string) => void; label: string; min?: string }) {
  const input = useRef<HTMLInputElement>(null)
  return (
    <span className="relative inline-flex">
      <button type="button" onClick={() => input.current?.showPicker?.()} className="ghost-field font-medium" aria-label={`${label}: ${showDay(value)}`}>
        {showDay(value)}
      </button>
      {/* The native picker, anchored under the text; the input itself stays out of sight. */}
      <input
        ref={input}
        type="date"
        value={value}
        min={min}
        onChange={(e) => e.target.value && onChange(e.target.value)}
        tabIndex={-1}
        aria-hidden
        className="pointer-events-none absolute bottom-0 left-0 h-0 w-full opacity-0"
      />
    </span>
  )
}

/** A time that reads as "9:00 AM" and opens a list of times every quarter hour. */
function TimeField({ value, onChange, open, onOpen, label, after }: { value: string; onChange: (v: string) => void; open: boolean; onOpen: (open: boolean) => void; label: string; after?: string }) {
  const list = useRef<HTMLUListElement>(null)
  useLayoutEffect(() => {
    if (open) list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'center' })
  }, [open])
  const times = useMemo(() => {
    const all = Array.from({ length: 96 }, (_, i) => toHm(i * 15))
    return all.includes(value) ? all : [...all, value].sort()
  }, [value])
  return (
    <span className="relative inline-flex">
      <button type="button" onClick={() => onOpen(!open)} aria-haspopup="listbox" aria-expanded={open} aria-label={`${label}: ${showTime(value)}`} className="ghost-field tabular-nums">
        {showTime(value)}
      </button>
      {open && (
        <Popover onClose={() => onOpen(false)} narrow>
          <ul ref={list} role="listbox" aria-label={label} className="scroll max-h-56 overflow-y-auto py-1">
            {times.map((t) => {
              const length = after ? toMin(t) - toMin(after) : null
              return (
                <li key={t}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={t === value}
                    onClick={() => {
                      onChange(t)
                      onOpen(false)
                    }}
                    className={`flex w-full items-baseline gap-2 rounded-ui px-2.5 py-1 text-left text-[13px] tabular-nums hover:bg-pane-sunk ${t === value ? 'font-semibold text-accent' : 'text-ink'}`}
                  >
                    {showTime(t)}
                    {length != null && length > 0 && <span className="ml-auto text-[11px] font-normal text-ink-faint">{length < 60 ? `${length} min` : `${Math.round((length / 60) * 4) / 4} h`}</span>}
                  </button>
                </li>
              )
            })}
          </ul>
        </Popover>
      )}
    </span>
  )
}

/** A small menu under its trigger; clicking elsewhere closes it. */
function Popover({ onClose, narrow, children }: { onClose: () => void; narrow?: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node) && !ref.current?.parentElement?.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [onClose])
  return (
    <div ref={ref} className={`pop-in absolute top-full left-0 z-20 mt-1 rounded-ui-lg border border-rule-strong bg-pane p-1 shadow-[0_14px_36px_-14px_rgba(0,0,0,0.45)] ${narrow ? 'w-[150px]' : 'w-[220px]'}`}>
      {children}
    </div>
  )
}

function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="ml-auto flex shrink-0 cursor-pointer items-center gap-2 self-start pt-[5px] text-[12px] text-ink-faint select-none">
      {label}
      <button
        type="button"
        role="switch"
        aria-checked={on}
        onClick={() => onChange(!on)}
        className={`relative h-[18px] w-[30px] rounded-full transition-colors duration-(--dur-1) ${on ? 'bg-accent' : 'bg-rule-strong'}`}
      >
        <span className={`absolute top-[2px] left-[2px] size-[14px] rounded-full bg-pane shadow-sm transition-transform duration-(--dur-1) ${on ? 'translate-x-[12px]' : ''}`} />
      </button>
    </label>
  )
}

const Icon = ({ children }: { children: ReactNode }) => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {children}
  </svg>
)
const ClockIcon = () => (
  <Icon>
    <circle cx="8" cy="8" r="6" />
    <path d="M8 4.5V8l2.5 1.5" />
  </Icon>
)
const PinIcon = () => (
  <Icon>
    <path d="M8 14s-4.5-4.2-4.5-7.5a4.5 4.5 0 0 1 9 0C12.5 9.8 8 14 8 14Z" />
    <circle cx="8" cy="6.5" r="1.5" />
  </Icon>
)
const LinkIcon = () => (
  <Icon>
    <path d="M6.5 9.5a3 3 0 0 0 4.2.3l2-2a3 3 0 0 0-4.2-4.3l-1 1M9.5 6.5a3 3 0 0 0-4.2-.3l-2 2a3 3 0 0 0 4.2 4.3l1-1" />
  </Icon>
)
const NoteIcon = () => (
  <Icon>
    <path d="M3 3.5h10M3 7h10M3 10.5h6" />
  </Icon>
)
const CheckIcon = () => (
  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-accent" aria-hidden>
    <path d="m3 8.5 3.5 3.5L13 4.5" />
  </svg>
)
