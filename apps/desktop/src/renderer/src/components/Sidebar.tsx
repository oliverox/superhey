import type { AppStatus, BoxRow, EventRow } from '@shared/api'
import { api, useLive } from '../api'
import { startOfDay } from '../format'
import { calendarColor, clockOf, onDay, timeRange, ymd } from '../calendar/model'
import { withShortcut } from '../shortcuts'
import { useEffect, useState, type ReactNode } from 'react'
import type { Scheme, Theme } from '../theme'
import { OmarchyLogo } from './OmarchyLogo'

interface Props {
  boxes: BoxRow[]
  activeBoxId: number | null
  onSelectBox: (id: number) => void
  status: AppStatus
  theme: Theme
  onTheme: (t: Theme) => void
  /** Light, dark or the system's, for the Default theme. */
  scheme: Scheme
  onScheme: (s: Scheme) => void
  active: boolean
  onOpenActivity: () => void
  onOpenSettings: () => void
  /** Today, above the boxes: whether it's showing, and how much is left to handle. */
  today: { active: boolean; count: number | null; onSelect: () => void }
  /** The calendar, below the boxes; `onOpen` with a day shows that day. */
  calendar: { active: boolean; onOpen: (day?: string) => void }
}

export function Sidebar({ boxes, activeBoxId, onSelectBox, status, theme, onTheme, scheme, onScheme, active, onOpenActivity, onOpenSettings, today, calendar }: Props) {
  return (
    <aside className="pane flex flex-col bg-side text-side-ink" data-pane="sidebar" data-active={active}>
      <div className="drag h-[52px] shrink-0" />

      <nav className="px-3" aria-label="Boxes">
        <ul className="space-y-px">
          <li className="mb-1.5">
            <button
              onClick={today.onSelect}
              aria-current={today.active ? 'page' : undefined}
              className={`group flex w-full items-center rounded-ui px-2.5 py-[7px] text-left transition-colors ${
                today.active ? 'bg-side-sel text-side-ink' : 'text-side-soft hover:bg-side-sel/60 hover:text-side-ink'
              }`}
            >
              <span className="font-medium">Today</span>
              {!!today.count && <span className="ml-2 text-[12px] text-side-faint tabular-nums">{today.count}</span>}
              <kbd className={`sidebar-key ml-auto ${today.active ? 'is-selected' : ''}`} title="Press 0">
                0
              </kbd>
            </button>
          </li>
          {boxes.map((box, i) => {
            const selected = box.id === activeBoxId
            return (
              <li key={box.id}>
                <button
                  onClick={() => onSelectBox(box.id)}
                  aria-current={selected ? 'page' : undefined}
                  className={`group flex w-full items-center rounded-ui px-2.5 py-[7px] text-left transition-colors ${
                    selected ? 'bg-side-sel text-side-ink' : 'text-side-soft hover:bg-side-sel/60 hover:text-side-ink'
                  }`}
                >
                  <span className="font-medium">{box.name}</span>
                  {box.kind === 'imbox' && box.unseen > 0 && (
                    <span className="ml-2 rounded-full bg-side-accent px-1.5 text-[11px] leading-[17px] font-semibold text-side-accent-ink tabular-nums">
                      {box.unseen}
                    </span>
                  )}
                  <kbd className={`sidebar-key ml-auto ${selected ? 'is-selected' : ''}`} title={`Press ${i + 1}`}>
                    {i + 1}
                  </kbd>
                </button>
              </li>
            )
          })}
          <li className="mt-1.5">
            <button
              onClick={() => calendar.onOpen()}
              aria-current={calendar.active ? 'page' : undefined}
              className={`group flex w-full items-center rounded-ui px-2.5 py-[7px] text-left transition-colors ${
                calendar.active ? 'bg-side-sel text-side-ink' : 'text-side-soft hover:bg-side-sel/60 hover:text-side-ink'
              }`}
            >
              <span className="font-medium">Calendar</span>
              <kbd className={`sidebar-key ml-auto ${calendar.active ? 'is-selected' : ''}`} title="Press 7">
                7
              </kbd>
            </button>
          </li>
        </ul>
      </nav>

      <Agenda onOpen={calendar.onOpen} />

      <footer className="shrink-0 border-t border-side-rule px-4 py-3 text-[12px] text-side-faint">
        <div className="mb-2.5 flex items-center gap-1">
          <button onClick={onOpenActivity} className="flex items-center gap-2 rounded-ui px-1 py-1 text-left text-[12px] text-side-soft hover:text-side-ink">
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden>
              <path d="M2 8h2.5L6 3.5l4 9L11.5 8H14" />
            </svg>
            Activity
          </button>
          <button onClick={onOpenSettings} title={withShortcut('Settings', 'settings')} className="ml-auto flex items-center gap-2 rounded-ui px-1 py-1 text-left text-[12px] text-side-soft hover:text-side-ink">
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden>
              <path d="M3 5h10M3 11h10" />
              <circle cx="6" cy="5" r="1.5" fill="currentColor" />
              <circle cx="10.5" cy="11" r="1.5" fill="currentColor" />
            </svg>
            Settings
          </button>
        </div>
        <AppearanceSwitch theme={theme} scheme={scheme} onTheme={onTheme} onScheme={onScheme} />
        <SyncStatus status={status} />
      </footer>
    </aside>
  )
}

/**
 * What's on: the event happening now or next, large, with how long until it (and Join when
 * it has a meeting link); then the rest of today and tomorrow, one line each. Events that
 * are over drop off. Any of them opens the calendar on its day.
 */
function Agenda({ onOpen }: { onOpen: (day?: string) => void }) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(t)
  }, [])
  const from = startOfDay(0).toISOString()
  const to = startOfDay(2).toISOString()
  const events = useLive(() => api.events(from, to), [from], (e) => e.type === 'change' && e.change.kind === 'calendar')
  const today = ymd(now)
  const tomorrow = ymd(startOfDay(1))
  const all = events.data ?? []
  const endOf = (e: EventRow) => new Date(e.endsAt ?? e.startsAt).getTime()
  const todays = all.filter((e) => onDay(e, today) && (e.allDay || endOf(e) > now.getTime()))
  const timed = todays.filter((e) => !e.allDay)
  const next = timed[0] ?? null
  const rest = [...todays.filter((e) => e.allDay), ...timed.slice(1)]
  const tomorrows = all.filter((e) => onDay(e, tomorrow))

  return (
    <div className="scroll mt-6 min-h-0 flex-1 px-4">
      <h2 className="eyebrow mb-2 px-1 !text-side-faint">Today</h2>
      {next ? <NextUp event={next} now={now} onOpen={() => onOpen(today)} /> : !rest.length && <p className="px-1 text-[13px] text-side-faint">Nothing else today</p>}
      {rest.length > 0 && <AgendaLines events={rest} onOpen={() => onOpen(today)} />}
      <h2 className="eyebrow mt-5 mb-1.5 px-1 !text-side-faint">Tomorrow</h2>
      {tomorrows.length ? <AgendaLines events={tomorrows} max={4} onOpen={() => onOpen(tomorrow)} /> : <p className="px-1 text-[13px] text-side-faint">Nothing scheduled</p>}
    </div>
  )
}

function NextUp({ event: e, now, onOpen }: { event: EventRow; now: Date; onOpen: () => void }) {
  const start = new Date(e.startsAt).getTime()
  const end = new Date(e.endsAt ?? e.startsAt).getTime()
  const on = start <= now.getTime()
  const mins = Math.round(((on ? end : start) - now.getTime()) / 60_000)
  const when = on ? `Now · ${span(mins)} left` : mins <= 60 ? `In ${span(mins)}` : timeRange(e)
  const color = calendarColor(e.color)
  return (
    <div className="mb-2 rounded-ui bg-side-sel/60 px-3 py-2.5">
      <button onClick={onOpen} className="block w-full text-left">
        <span className="flex items-center gap-2 text-[12px] font-medium" style={{ color: on || mins <= 15 ? color : undefined }}>
          <span className={`size-[7px] shrink-0 rounded-full ${on ? 'pulse' : ''}`} style={{ background: color }} />
          <span className={on || mins <= 15 ? '' : 'text-side-soft'}>{when}</span>
        </span>
        <span className="mt-1 block text-[14px] leading-snug font-medium text-side-ink">{e.title || '(No title)'}</span>
        <span className="mt-0.5 block text-[12px] text-side-faint">
          {on || mins <= 60 ? timeRange(e) : e.calendarName ?? ''}
          {e.location ? ` · ${e.location}` : ''}
        </span>
      </button>
      {e.joinUrl && (
        <a href={e.joinUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex rounded-ui bg-side-accent px-2.5 py-1 text-[12px] font-semibold text-side-accent-ink hover:opacity-90">
          Join
        </a>
      )}
    </div>
  )
}

function AgendaLines({ events, max = 8, onOpen }: { events: EventRow[]; max?: number; onOpen: () => void }) {
  return (
    <ul>
      {events.slice(0, max).map((e) => (
        <li key={e.key}>
          <button onClick={onOpen} className="flex w-full min-w-0 items-baseline gap-2 rounded-ui px-1 py-[3px] text-left text-[13px] hover:bg-side-sel/60">
            <span className="size-[6px] shrink-0 -translate-y-[1px] self-center rounded-full" style={{ background: calendarColor(e.color) }} />
            <span className="w-[54px] shrink-0 text-[12px] text-side-faint tabular-nums">{e.allDay ? 'All day' : clockOf(e.startsAt)}</span>
            <span className="min-w-0 truncate text-side-soft">{e.title || '(No title)'}</span>
          </button>
        </li>
      ))}
      {events.length > max && (
        <li>
          <button onClick={onOpen} className="px-1 py-[3px] text-[12px] text-side-faint hover:text-side-soft">
            {events.length - max} more
          </button>
        </li>
      )}
    </ul>
  )
}

const span = (mins: number) => (mins < 60 ? `${Math.max(1, mins)} min` : `${Math.floor(mins / 60)} h${mins % 60 ? ` ${mins % 60} min` : ''}`)

type Look = 'light' | 'dark' | 'auto' | 'omarchy'

const LOOKS: Array<{ id: Look; label: string; icon: ReactNode }> = [
  {
    id: 'light',
    label: 'Light',
    icon: (
      <>
        <circle cx="8" cy="8" r="3" />
        <path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1" />
      </>
    ),
  },
  { id: 'dark', label: 'Dark', icon: <path d="M13 9.5A5.5 5.5 0 0 1 6.5 3a5.5 5.5 0 1 0 6.5 6.5Z" strokeLinejoin="round" /> },
  {
    id: 'auto',
    label: 'System (as macOS)',
    icon: (
      <>
        <circle cx="8" cy="8" r="5.5" />
        <path d="M8 2.5v11A5.5 5.5 0 0 0 8 2.5Z" fill="currentColor" stroke="none" />
      </>
    ),
  },
  { id: 'omarchy', label: 'Omarchy', icon: null },
]

/**
 * How the app looks, in one switch: Default in light, dark or as the system is, or
 * Omarchy. ⇧D flips light and dark; ⇧T switches Default and Omarchy.
 */
function AppearanceSwitch({ theme, scheme, onTheme, onScheme }: { theme: Theme; scheme: Scheme; onTheme: (t: Theme) => void; onScheme: (s: Scheme) => void }) {
  const current: Look = theme === 'omarchy' ? 'omarchy' : scheme
  const choose = (look: Look) => {
    if (look === 'omarchy') return onTheme('omarchy')
    onTheme('default')
    onScheme(look)
  }
  return (
    <div role="radiogroup" aria-label="Appearance" className="mb-3 flex rounded-ui bg-side-sel/60 p-0.5">
      {LOOKS.map((l) => (
        <button
          key={l.id}
          role="radio"
          aria-checked={current === l.id}
          aria-label={l.label}
          title={l.label}
          onClick={() => choose(l.id)}
          className={`flex h-[26px] flex-1 items-center justify-center rounded-ui transition-colors ${
            current === l.id ? 'bg-side-sel text-side-ink shadow-sm' : 'text-side-faint hover:text-side-soft'
          }`}
        >
          {l.id === 'omarchy' ? (
            <OmarchyLogo className="size-[13px]" />
          ) : (
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden>
              {l.icon}
            </svg>
          )}
        </button>
      ))}
    </div>
  )
}

function SyncStatus({ status }: { status: AppStatus }) {
  const watch = status.sync?.watch ?? 'connecting'
  const label = { live: 'Live', connecting: 'Connecting', reconnecting: 'Reconnecting', stopped: 'Paused' }[watch]
  const dot = watch === 'live' ? 'bg-side-accent' : 'bg-side-accent pulse'
  return (
    <>
      {status.testInstance && (
        <div className="mb-2 rounded-ui border border-danger/50 px-2 py-1 text-[12px] font-medium text-danger" title="Opened by Claude to check changes: emails are never marked seen, nothing is sent, the Screener is untouched. Use your own SuperHey window.">
          Test instance (read-only)
        </div>
      )}
      <div className="flex items-center gap-2">
        <span className={`size-1.5 rounded-full ${dot}`} />
        <span>{label}</span>
        {status.cli && <span className="ml-auto">CLI {status.cli.version}</span>}
      </div>
      {status.backfill.running && (
        <div className="mt-1">Caching older mail · {status.backfill.postings.toLocaleString()}</div>
      )}
      {status.sync?.lastError && (
        <div className="mt-1 truncate text-danger" title={status.sync.lastError}>
          {status.sync.lastError}
        </div>
      )}
    </>
  )
}
