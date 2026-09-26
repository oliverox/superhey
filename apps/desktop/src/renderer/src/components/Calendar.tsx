import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { CalendarRow, EventRow } from '@shared/api'
import { api, useLive } from '../api'
import { allDayBars, eventColors, layoutDay, onDay, step, timeRange, viewDays, ymd, type Bar, type CalendarMode } from '../calendar/model'
import { EventForm, type EventDraft } from './EventForm'

/**
 * HEY Calendar, drawn like the Mac's Calendar: Day, Week and Month, events in their
 * calendar's colour, all-day events in a lane above the hours, and a line at the time now.
 * ← → move, T goes to today, D W M switch views; double-click a time to add an event there.
 */

const HOUR = 48
const MODE_KEY = 'calendar:mode'
const monthFmt = new Intl.DateTimeFormat(undefined, { month: 'long' })
const weekdayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short' })
const longDayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' })

function storedMode(): CalendarMode {
  try {
    const m = localStorage.getItem(MODE_KEY)
    return m === 'day' || m === 'month' ? m : 'week'
  } catch {
    return 'week'
  }
}

/** The time now, updated every minute (for the now line and "today"). */
function useNow() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(t)
  }, [])
  return now
}

export function CalendarView({ focus }: { focus?: { day: string; nonce: number } | null }) {
  const now = useNow()
  const today = ymd(now)
  const [mode, setModeState] = useState<CalendarMode>(storedMode)
  const [day, setDay] = useState(focus?.day ?? today)
  useEffect(() => {
    if (focus) setDay(focus.day)
  }, [focus])
  const setMode = (m: CalendarMode) => {
    setModeState(m)
    try {
      localStorage.setItem(MODE_KEY, m)
    } catch {
      // for this visit
    }
  }
  const days = useMemo(() => viewDays(mode, day), [mode, day])
  const data = useLive(() => api.calendarRange(days[0]!, days.at(-1)!), [days[0], days.at(-1)], (e) => e.type === 'change' && e.change.kind === 'calendar')
  const events = data.data?.events ?? []
  const calendars = data.data?.calendars ?? []
  const [open, setOpen] = useState<{ event: EventRow; rect: DOMRect } | null>(null)
  const [draft, setDraft] = useState<EventDraft | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || draft || open) return
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return
      const k = e.key
      if (k === 'ArrowLeft' || k === 'ArrowRight') setDay((d) => step(mode, d, k === 'ArrowRight' ? 1 : -1))
      else if (k === 't') setDay(today)
      else if (k === 'd' || k === 'w' || k === 'm') setMode(k === 'd' ? 'day' : k === 'w' ? 'week' : 'month')
      else return
      e.preventDefault()
      e.stopPropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  const first = days[0]!
  const shown = mode === 'month' ? day : first
  const title = mode === 'day' ? longDayFmt.format(parse(day)) : monthFmt.format(parse(shown))
  const year = parse(mode === 'month' ? day : days[Math.floor(days.length / 2)]!).getFullYear()
  const newAt = (startsOn: string, startTime?: string) =>
    setDraft({ title: '', startsOn, endsOn: startsOn, startTime: startTime ?? null, endTime: null })

  return (
    <main className="pane flex min-h-0 min-w-0 flex-col bg-pane" data-pane="calendar">
      <header className="drag flex h-[52px] shrink-0 items-center gap-3 border-b border-rule px-5">
        <button onClick={() => newAt(day === today ? today : day, mode === 'month' ? undefined : nextHalfHour(now))} title="New event" aria-label="New event" className="no-drag flex size-7 items-center justify-center rounded-ui text-ink-soft hover:bg-pane-sunk hover:text-ink">
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden>
            <path d="M8 3v10M3 8h10" />
          </svg>
        </button>
        <h1 className="font-app text-[20px] leading-none tracking-tight text-ink">
          <span className="font-semibold">{title}</span> {mode !== 'day' && <span className="font-normal text-ink-soft">{year}</span>}
        </h1>
        {data.loading && !data.data && <span className="text-[12px] text-ink-faint">Loading…</span>}
        <div role="radiogroup" aria-label="View" className="no-drag mx-auto flex rounded-ui bg-pane-sunk p-0.5 text-[13px]">
          {(['day', 'week', 'month'] as CalendarMode[]).map((m) => (
            <button
              key={m}
              role="radio"
              aria-checked={mode === m}
              onClick={() => setMode(m)}
              title={`${m[0]!.toUpperCase()}${m.slice(1)} (${m[0]!.toUpperCase()})`}
              className={`rounded-[calc(var(--r)-2px)] px-3.5 py-[3px] font-medium capitalize transition-colors ${mode === m ? 'bg-pane text-ink shadow-sm' : 'text-ink-faint hover:text-ink-soft'}`}
            >
              {m}
            </button>
          ))}
        </div>
        <div className="no-drag flex items-center gap-1">
          <NavButton label="Previous" onClick={() => setDay(step(mode, day, -1))}>
            <path d="M10 3.5 5.5 8l4.5 4.5" />
          </NavButton>
          <button onClick={() => setDay(today)} title="Today (T)" className="rounded-ui border border-rule px-2.5 py-[3px] text-[13px] font-medium text-ink-soft hover:bg-pane-sunk hover:text-ink">
            Today
          </button>
          <NavButton label="Next" onClick={() => setDay(step(mode, day, 1))}>
            <path d="m6 3.5 4.5 4.5L6 12.5" />
          </NavButton>
        </div>
      </header>

      {data.error ? (
        <p className="p-6 text-danger">Couldn't load the calendar: {data.error}</p>
      ) : mode === 'month' ? (
        <MonthGrid days={days} month={day.slice(0, 7)} today={today} events={events} onEvent={(event, rect) => setOpen({ event, rect })} onPickDay={(d) => (setDay(d), setMode('day'))} onNew={(d) => newAt(d)} />
      ) : (
        <TimeGrid days={days} today={today} now={now} events={events} ready={!!data.data} onEvent={(event, rect) => setOpen({ event, rect })} onNew={newAt} onDay={(d) => (setDay(d), setMode('day'))} />
      )}

      {open && <EventPopover event={open.event} rect={open.rect} onClose={() => setOpen(null)} />}
      {draft && <EventForm draft={draft} calendars={calendars} onCancel={() => setDraft(null)} onDone={() => setDraft(null)} />}
    </main>
  )
}

function NavButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} aria-label={label} title={`${label} (${label === 'Next' ? '→' : '←'})`} className="flex size-7 items-center justify-center rounded-full text-ink-soft hover:bg-pane-sunk hover:text-ink">
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {children}
      </svg>
    </button>
  )
}

/** Day and Week: a column per day, all-day events above, hours below. */
function TimeGrid({
  days,
  today,
  now,
  events,
  ready,
  onEvent,
  onNew,
  onDay,
}: {
  days: string[]
  /** Whether the events have loaded (to scroll to the first one). */
  ready: boolean
  today: string
  now: Date
  events: EventRow[]
  onEvent: (e: EventRow, rect: DOMRect) => void
  onNew: (day: string, time?: string) => void
  onDay: (day: string) => void
}) {
  const scroller = useRef<HTMLDivElement>(null)
  // Open on the day's first event (8 AM at the latest), not at midnight; once per view.
  const scrolledFor = useRef<string | null>(null)
  useLayoutEffect(() => {
    const el = scroller.current
    const key = `${days[0]}:${days.length}`
    if (!el || !ready || scrolledFor.current === key) return
    scrolledFor.current = key
    const starts = days.flatMap((d) => layoutDay(events, d).map((p) => p.start))
    const first = starts.length ? Math.min(...starts) / 60 : 8
    el.scrollTop = Math.max(0, Math.min(8, first) - 0.5) * HOUR
  }, [ready, days, events])
  const bars = useMemo(() => allDayBars(events, days), [events, days])
  const lanes = bars.reduce((n, b) => Math.max(n, b.row + 1), 0)
  const nowMin = now.getHours() * 60 + now.getMinutes()

  // One scroller for the day names, the all-day lane and the hours, with the first two
  // held at the top: the columns then line up exactly, whatever the scrollbar takes.
  const cols = { gridTemplateColumns: `56px repeat(${days.length}, minmax(0, 1fr))` }
  return (
    <div ref={scroller} className="scroll relative min-h-0 flex-1 overflow-y-auto">
      <div className="sticky top-0 z-20 bg-pane">
        {/* Day names */}
        <div className="grid" style={cols}>
          <span />
          {days.map((d) => (
            <button key={d} onClick={() => onDay(d)} className="flex items-center justify-center gap-1.5 py-2 text-[14px] text-ink-soft hover:text-ink" title="Show this day">
              <span className={d < today ? 'text-ink-faint' : ''}>{weekdayFmt.format(parse(d))}</span>
              <span className={`flex h-[26px] min-w-[26px] items-center justify-center rounded-full px-1 tabular-nums ${d === today ? 'bg-accent font-semibold text-accent-ink' : d < today ? 'text-ink-faint' : 'text-ink'}`}>{parse(d).getDate()}</span>
            </button>
          ))}
        </div>

        {/* All-day lane */}
        <div className="relative grid border-b border-rule-strong" style={{ ...cols, minHeight: Math.max(1, lanes) * 24 + 8 }}>
          <span className="pt-2 pr-2 text-right text-[11px] text-ink-faint">all-day</span>
          {days.map((d) => (
            <span key={d} className={`border-l border-rule ${d === today ? 'bg-accent/[0.04]' : ''}`} onDoubleClick={() => onNew(d)} />
          ))}
          <div className="pointer-events-none absolute inset-y-0 right-0 left-[56px] grid py-1" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))`, gridAutoRows: '24px' }}>
            {bars.map((b) => (
              <AllDayBar key={b.event.key} bar={b} onEvent={onEvent} />
            ))}
          </div>
        </div>
      </div>

      {/* Hours */}
      <div className="relative grid" style={{ ...cols, height: 24 * HOUR }}>
        <div className="relative">
          {Array.from({ length: 23 }, (_, i) => i + 1).map((h) => (
            <span key={h} className="absolute right-2 -translate-y-1/2 text-[11px] text-ink-faint tabular-nums" style={{ top: h * HOUR }}>
              {hourLabel(h)}
            </span>
          ))}
        </div>
        {days.map((d) => (
          <DayColumn key={d} day={d} isToday={d === today} nowMin={nowMin} events={events} onEvent={onEvent} onNew={onNew} />
        ))}
      </div>
    </div>
  )
}

function DayColumn({ day, isToday, nowMin, events, onEvent, onNew }: { day: string; isToday: boolean; nowMin: number; events: EventRow[]; onEvent: (e: EventRow, rect: DOMRect) => void; onNew: (day: string, time?: string) => void }) {
  const placed = useMemo(() => layoutDay(events, day), [events, day])
  return (
    <div
      className={`relative border-l border-rule ${isToday ? 'bg-accent/[0.04]' : ''}`}
      style={{ backgroundImage: `repeating-linear-gradient(to bottom, var(--rule) 0 1px, transparent 1px ${HOUR}px)` }}
      onDoubleClick={(e) => {
        const y = e.clientY - e.currentTarget.getBoundingClientRect().top
        const min = Math.floor(y / HOUR / 0.5) * 30
        onNew(day, `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`)
      }}
    >
      {placed.map((p) => {
        const c = eventColors(p.event.color)
        const height = Math.max(((p.end - p.start) / 60) * HOUR - 2, 18)
        const short = height < 34
        return (
          <button
            key={p.event.key}
            onClick={(e) => onEvent(p.event, e.currentTarget.getBoundingClientRect())}
            onDoubleClick={(e) => e.stopPropagation()}
            className="cal-event absolute overflow-hidden rounded-[6px] px-2 py-1 text-left leading-tight"
            style={{
              top: (p.start / 60) * HOUR + 1,
              height,
              left: `calc(${(p.col / p.cols) * 100}% + 3px)`,
              width: `calc(${100 / p.cols}% - 6px)`,
              '--ev': c.solid,
            } as React.CSSProperties}
          >
            {short ? (
              <span className="block truncate text-[12px] whitespace-nowrap">
                <span className="font-semibold text-ink">{p.event.title || '(No title)'}</span>
                <span className="ml-1.5 text-ink-soft tabular-nums">{timeRange(p.event).split(' – ')[0]}</span>
              </span>
            ) : (
              <>
                <span className="block truncate text-[12px] font-semibold text-ink">{p.event.title || '(No title)'}</span>
                <span className="mt-px block truncate text-[11px] text-ink-soft tabular-nums">{timeRange(p.event)}</span>
              </>
            )}
            {p.event.recurring && !short && <RepeatIcon />}
          </button>
        )
      })}
      {isToday && (
        <div className="pointer-events-none absolute right-0 left-0 z-10 flex items-center" style={{ top: (nowMin / 60) * HOUR }}>
          <span className="-ml-[4px] size-2 rounded-full bg-danger" />
          <span className="h-[2px] flex-1 bg-danger" />
        </div>
      )}
    </div>
  )
}

function AllDayBar({ bar, onEvent }: { bar: Bar; onEvent: (e: EventRow, rect: DOMRect) => void }) {
  const c = eventColors(bar.event.color)
  return (
    <button
      onClick={(e) => onEvent(bar.event, e.currentTarget.getBoundingClientRect())}
      className="cal-event pointer-events-auto mx-[3px] my-[2px] flex min-w-0 items-center gap-1.5 rounded-[5px] px-2 text-left text-[12px]"
      style={{ gridColumn: `${bar.from + 1} / ${bar.to + 2}`, gridRow: bar.row + 1, '--ev': c.solid } as React.CSSProperties}
    >
      <span className="truncate font-semibold text-ink">{bar.event.title || '(No title)'}</span>
      {bar.event.recurring && <RepeatIcon inline />}
    </button>
  )
}

function MonthGrid({ days, month, today, events, onEvent, onPickDay, onNew }: { days: string[]; month: string; today: string; events: EventRow[]; onEvent: (e: EventRow, rect: DOMRect) => void; onPickDay: (d: string) => void; onNew: (d: string) => void }) {
  const MAX = 3
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid shrink-0 grid-cols-7 border-b border-rule">
        {days.slice(0, 7).map((d) => (
          <span key={d} className="px-2 py-1.5 text-right text-[12px] text-ink-faint">
            {weekdayFmt.format(parse(d))}
          </span>
        ))}
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-7 grid-rows-6">
        {days.map((d) => {
          const on = events
            .filter((e) => onDay(e, d))
            .sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.startsAt.localeCompare(b.startsAt))
          const inMonth = d.startsWith(month)
          return (
            <div key={d} onDoubleClick={() => onNew(d)} className={`flex min-h-0 flex-col overflow-hidden border-r border-b border-rule px-1 pb-1 ${inMonth ? '' : 'bg-pane-alt'}`}>
              <button onClick={() => onPickDay(d)} className="self-end py-1" title="Show this day">
                <span className={`flex h-[22px] min-w-[22px] items-center justify-center rounded-full px-1 text-[13px] tabular-nums ${d === today ? 'bg-accent font-semibold text-accent-ink' : inMonth ? 'text-ink' : 'text-ink-faint'}`}>
                  {parse(d).getDate() === 1 ? `${monthFmt.format(parse(d)).slice(0, 3)} 1` : parse(d).getDate()}
                </span>
              </button>
              <ul className="min-h-0 space-y-px">
                {on.slice(0, MAX).map((e) => {
                  const c = eventColors(e.color)
                  return (
                    <li key={e.key}>
                      <button
                        onClick={(ev) => onEvent(e, ev.currentTarget.getBoundingClientRect())}
                        className="flex w-full min-w-0 items-center gap-1 rounded-[4px] px-1 py-px text-left text-[12px]"
                        style={e.allDay ? { background: c.fill, color: c.text } : { color: 'var(--ink-soft)' }}
                      >
                        <span className="size-[6px] shrink-0 rounded-full" style={{ background: c.solid }} />
                        <span className="min-w-0 flex-1 truncate font-medium" style={e.allDay ? undefined : { color: 'var(--ink)' }}>
                          {e.title || '(No title)'}
                        </span>
                        {!e.allDay && <span className="shrink-0 text-[11px] text-ink-faint tabular-nums">{timeRange(e).split(' – ')[0]}</span>}
                      </button>
                    </li>
                  )
                })}
                {on.length > MAX && (
                  <li>
                    <button onClick={() => onPickDay(d)} className="px-1 text-[11px] font-medium text-ink-faint hover:text-ink">
                      {on.length - MAX} more
                    </button>
                  </li>
                )}
              </ul>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** An event's details, next to it: time, calendar, place, a Join button, a link to HEY. */
export function EventPopover({ event: e, rect, onClose }: { event: EventRow; rect: DOMRect; onClose: () => void }) {
  const card = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const [confirm, setConfirm] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const c = eventColors(e.color)
  useLayoutEffect(() => {
    const w = card.current?.offsetWidth ?? 300
    const h = card.current?.offsetHeight ?? 200
    const right = rect.right + 8 + w < window.innerWidth
    const left = right ? rect.right + 8 : Math.max(8, rect.left - w - 8)
    const top = Math.min(Math.max(8, rect.top), window.innerHeight - h - 8)
    setPos({ left, top })
  }, [rect])
  useEffect(() => {
    const onKey = (k: KeyboardEvent) => {
      if (k.key !== 'Escape') return
      k.preventDefault()
      k.stopPropagation()
      onClose()
    }
    const onDown = (m: MouseEvent) => !card.current?.contains(m.target as Node) && onClose()
    window.addEventListener('keydown', onKey, true)
    document.addEventListener('mousedown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      document.removeEventListener('mousedown', onDown)
    }
  }, [onClose])
  const dayLabel = e.allDay ? longDayFmt.format(parse(e.startsAt.slice(0, 10))) : longDayFmt.format(new Date(e.startsAt))

  return createPortal(
    <div
      ref={card}
      role="dialog"
      aria-label={e.title}
      className="pop-in fixed z-[72] w-[300px] rounded-ui-lg border border-rule-strong bg-pane p-4 shadow-[0_18px_48px_-16px_rgba(0,0,0,0.45)]"
      style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: 0 }}
    >
      <div className="flex items-start gap-2.5">
        <span className="mt-[5px] size-2.5 shrink-0 rounded-full" style={{ background: c.solid }} />
        <div className="min-w-0 flex-1">
          <h3 className="text-[15px] leading-snug font-semibold text-ink">{e.title || '(No title)'}</h3>
          <p className="mt-1 text-[13px] text-ink-soft">{dayLabel}</p>
          <p className="text-[13px] text-ink-soft">
            {timeRange(e)}
            {e.recurring && <span className="text-ink-faint"> · repeats</span>}
          </p>
          {e.calendarName && <p className="mt-1.5 text-[12px] text-ink-faint">{e.calendarName}</p>}
          {e.location && <p className="mt-1.5 text-[13px] text-ink-soft">{e.location}</p>}
        </div>
      </div>
      <div className="mt-3.5 flex items-center gap-2">
        {e.joinUrl && (
          <a href={e.joinUrl} target="_blank" rel="noreferrer" className="btn-primary text-[13px]">
            Join
          </a>
        )}
        {e.appUrl && (
          <a href={e.appUrl} target="_blank" rel="noreferrer" className="rounded-ui px-2 py-1.5 text-[13px] text-ink-soft hover:bg-pane-sunk hover:text-ink">
            Open in HEY ↗
          </a>
        )}
        {!e.recurring && (
          <button
            onClick={async () => {
              if (!confirm) return setConfirm(true)
              try {
                await api.deleteEvent(e.id, e.allDay ? e.startsAt.slice(0, 10) : ymd(new Date(e.startsAt)))
                onClose()
              } catch (err) {
                setError(err instanceof Error ? err.message : String(err))
              }
            }}
            className={`ml-auto rounded-ui px-2 py-1.5 text-[13px] hover:bg-pane-sunk ${confirm ? 'font-semibold text-danger' : 'text-ink-faint hover:text-danger'}`}
          >
            {confirm ? 'Delete it?' : 'Delete'}
          </button>
        )}
      </div>
      {error && <p className="mt-2 text-[12px] text-danger">{error}</p>}
    </div>,
    document.body,
  )
}

function RepeatIcon({ inline }: { inline?: boolean }) {
  return (
    <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-label="Repeats" className={`text-ink-faint ${inline ? 'ml-auto shrink-0' : 'absolute top-[6px] right-[6px]'}`}>
      <path d="M3 7a5 5 0 0 1 9-3l1 1M13 9a5 5 0 0 1-9 3l-1-1M13 2v3h-3M3 14v-3h3" />
    </svg>
  )
}

const parse = (day: string) => {
  const [y, m, d] = day.slice(0, 10).split('-').map(Number) as [number, number, number]
  return new Date(y, m - 1, d)
}
const hourFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric' })
const hourLabel = (h: number) => (h === 12 ? 'Noon' : hourFmt.format(new Date(2026, 0, 1, h)))
const nextHalfHour = (d: Date) => {
  const m = d.getHours() * 60 + d.getMinutes()
  const n = Math.min(23 * 60 + 30, Math.ceil((m + 1) / 30) * 30)
  return `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`
}

export type { CalendarRow }
