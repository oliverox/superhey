import type { AppStatus, BoxRow, EventRow } from '@shared/api'
import { api, useLive } from '../api'
import { clock, startOfDay } from '../format'
import { withShortcut } from '../shortcuts'
import { nextScheme, THEMES, type Scheme, type Theme } from '../theme'
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
}

export function Sidebar({ boxes, activeBoxId, onSelectBox, status, theme, onTheme, scheme, onScheme, active, onOpenActivity, onOpenSettings, today }: Props) {
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
                    <span className="ml-2 rounded-full bg-new px-1.5 text-[11px] leading-[17px] font-semibold text-accent-ink tabular-nums">
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
        </ul>
      </nav>

      <Agenda />

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
        <div className="mb-3 flex items-center gap-1.5">
          <ThemeSwitch theme={theme} onTheme={onTheme} />
          {theme === 'default' && <SchemeButton scheme={scheme} onScheme={onScheme} />}
        </div>
        <SyncStatus status={status} />
      </footer>
    </aside>
  )
}

function Agenda() {
  const from = startOfDay(0).toISOString()
  const to = startOfDay(2).toISOString()
  const events = useLive(() => api.events(from, to), [from], (e) => e.type === 'change' && e.change.kind === 'calendar')
  const tomorrow = startOfDay(1).getTime()
  const groups: Array<[string, EventRow[]]> = [
    ['Today', (events.data ?? []).filter((e) => new Date(e.startsAt).getTime() < tomorrow)],
    ['Tomorrow', (events.data ?? []).filter((e) => new Date(e.startsAt).getTime() >= tomorrow)],
  ]

  return (
    <div className="scroll mt-6 min-h-0 flex-1 px-5">
      {groups.map(([label, items]) => (
        <section key={label} className="mb-5">
          <h2 className="eyebrow mb-2 !text-side-faint">{label}</h2>
          {items.length === 0 ? (
            <p className="text-[13px] text-side-faint">Nothing scheduled</p>
          ) : (
            <ul className="space-y-2">
              {items.map((e) => (
                <li key={e.key} className="flex gap-2.5 text-[13px] leading-snug">
                  <span className="mt-[3px] h-3 w-[2px] shrink-0 bg-accent" />
                  <span className="min-w-0">
                    <span className="block truncate text-side-ink">{e.title}</span>
                    <span className="text-side-faint">{e.allDay ? 'All day' : clock(e.startsAt)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  )
}

function ThemeSwitch({ theme, onTheme }: { theme: Theme; onTheme: (t: Theme) => void }) {
  return (
    <div role="radiogroup" aria-label="Theme" className="flex flex-1 rounded-ui bg-side-sel/60 p-0.5" title="Switch theme (⇧T)">
      {THEMES.map((t) => (
        <button
          key={t.id}
          role="radio"
          aria-label={t.label}
          aria-checked={theme === t.id}
          onClick={() => onTheme(t.id)}
          className={`flex-1 rounded-ui py-1 text-[12px] font-medium transition-colors ${
            theme === t.id ? 'bg-side-sel text-side-ink shadow-sm' : 'text-side-faint hover:text-side-soft'
          }`}
        >
          {t.id === 'omarchy' ? <OmarchyLogo className="mx-auto h-[10px] w-auto" /> : t.label}
        </button>
      ))}
    </div>
  )
}

const SCHEME_NAMES: Record<Scheme, string> = { auto: 'Auto (as macOS)', light: 'Light', dark: 'Dark' }

/** Cycles the Default theme's appearance: Auto → Light → Dark. */
function SchemeButton({ scheme, onScheme }: { scheme: Scheme; onScheme: (s: Scheme) => void }) {
  const label = `Appearance: ${SCHEME_NAMES[scheme]}. Click for ${SCHEME_NAMES[nextScheme(scheme)].replace(' (as macOS)', '')} (⇧D toggles light and dark)`
  return (
    <button
      type="button"
      onClick={() => onScheme(nextScheme(scheme))}
      aria-label={label}
      title={label}
      className="flex size-[30px] shrink-0 items-center justify-center rounded-ui bg-side-sel/60 text-side-soft transition-colors hover:text-side-ink"
    >
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden>
        {scheme === 'light' ? (
          <>
            <circle cx="8" cy="8" r="3" />
            <path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1" />
          </>
        ) : scheme === 'dark' ? (
          <path d="M13 9.5A5.5 5.5 0 0 1 6.5 3a5.5 5.5 0 1 0 6.5 6.5Z" strokeLinejoin="round" />
        ) : (
          <>
            <circle cx="8" cy="8" r="5.5" />
            <path d="M8 2.5v11A5.5 5.5 0 0 0 8 2.5Z" fill="currentColor" stroke="none" />
          </>
        )}
      </svg>
    </button>
  )
}

function SyncStatus({ status }: { status: AppStatus }) {
  const watch = status.sync?.watch ?? 'connecting'
  const label = { live: 'Live', connecting: 'Connecting', reconnecting: 'Reconnecting', stopped: 'Paused' }[watch]
  const dot = watch === 'live' ? 'bg-accent' : 'bg-new pulse'
  return (
    <>
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
