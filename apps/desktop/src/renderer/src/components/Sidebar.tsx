import type { AppStatus, BoxRow, EventRow } from '@shared/api'
import { api, useLive } from '../api'
import { clock, startOfDay } from '../format'
import { THEMES, type Theme } from '../theme'

interface Props {
  boxes: BoxRow[]
  activeBoxId: number | null
  onSelectBox: (id: number) => void
  status: AppStatus
  theme: Theme
  onTheme: (t: Theme) => void
  active: boolean
  onOpenActivity: () => void
}

export function Sidebar({ boxes, activeBoxId, onSelectBox, status, theme, onTheme, active, onOpenActivity }: Props) {
  return (
    <aside className="pane flex flex-col bg-side text-side-ink" data-pane="sidebar" data-active={active}>
      <div className="drag h-[52px] shrink-0" />

      <nav className="px-3" aria-label="Boxes">
        <ul className="space-y-px">
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
                    <span className="ml-2 rounded-full bg-new px-1.5 text-[10.5px] leading-[17px] font-semibold text-accent-ink tabular-nums">
                      {box.unseen}
                    </span>
                  )}
                  <span className="ml-auto text-[10.5px] text-side-faint opacity-0 transition-opacity group-hover:opacity-100">
                    {i + 1}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </nav>

      <Agenda />

      <footer className="shrink-0 border-t border-side-rule px-4 py-3 text-[11.5px] text-side-faint">
        <button
          onClick={onOpenActivity}
          className="mb-2.5 flex w-full items-center gap-2 rounded-ui px-1 py-1 text-left text-[12px] text-side-soft hover:text-side-ink"
        >
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden>
            <path d="M2 8h2.5L6 3.5l4 9L11.5 8H14" />
          </svg>
          Activity
        </button>
        <ThemeSwitch theme={theme} onTheme={onTheme} />
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
            <p className="text-[12.5px] text-side-faint">Nothing scheduled</p>
          ) : (
            <ul className="space-y-2">
              {items.map((e) => (
                <li key={e.key} className="flex gap-2.5 text-[12.5px] leading-snug">
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
    <div role="radiogroup" aria-label="Theme" className="mb-3 flex rounded-ui bg-side-sel/60 p-0.5" title="Switch theme (⇧T)">
      {THEMES.map((t) => (
        <button
          key={t.id}
          role="radio"
          aria-checked={theme === t.id}
          onClick={() => onTheme(t.id)}
          className={`flex-1 rounded-ui py-1 text-[11.5px] font-medium transition-colors ${
            theme === t.id ? 'bg-side-sel text-side-ink shadow-sm' : 'text-side-faint hover:text-side-soft'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
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
