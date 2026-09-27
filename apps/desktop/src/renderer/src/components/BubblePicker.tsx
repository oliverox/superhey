import { useMemo, useState, type KeyboardEvent } from 'react'
import type { Action } from '@shared/api'
import { addDays, addMonths, parseDay, startOfWeek, ymd } from '../calendar/model'

type BubbleWhen = Extract<Action, { type: 'bubble' }>['when']

/**
 * When to bubble a thread back up: the quick choices with the day each one lands on, and a
 * month to pick any other day. A picked day is shown before it's confirmed. Arrow keys move
 * the day in the month; Enter bubbles it up.
 */
const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
const monthFmt = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' })
const weekdayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'narrow' })

/** The next `weekday` (0 = Sunday) strictly after `day`. */
const nextWeekday = (day: string, weekday: number) => addDays(day, ((weekday - parseDay(day).getDay() + 6) % 7) + 1)

export function BubblePicker({ onPick }: { onPick: (when: BubbleWhen) => void }) {
  const today = ymd(new Date())
  const presets = useMemo(
    () => [
      { label: 'Now', hint: 'Right away', when: { kind: 'now' } as BubbleWhen, day: today },
      { label: 'Later today', hint: 'This evening', when: { kind: 'on', date: today } as BubbleWhen, day: today },
      { label: 'Tomorrow', hint: dayFmt.format(parseDay(addDays(today, 1))), when: { kind: 'tomorrow' } as BubbleWhen, day: addDays(today, 1) },
      { label: 'This weekend', hint: dayFmt.format(parseDay(nextWeekday(today, 6))), when: { kind: 'weekend' } as BubbleWhen, day: nextWeekday(today, 6) },
      { label: 'Next week', hint: dayFmt.format(parseDay(nextWeekday(today, 1))), when: { kind: 'next-week' } as BubbleWhen, day: nextWeekday(today, 1) },
    ],
    [today],
  )
  const [picked, setPicked] = useState<string | null>(null)
  const [month, setMonth] = useState(today.slice(0, 8) + '01')
  const current = month === today.slice(0, 8) + '01'
  // This month starts at this week (no past weeks), five weeks ahead; later months, the month.
  const first = current ? startOfWeek(today) : startOfWeek(month)
  const days = Array.from({ length: current ? 35 : 42 }, (_, i) => addDays(first, i))
  const shown = !current && days.slice(35).every((d) => !d.startsWith(month.slice(0, 7))) ? days.slice(0, 35) : days
  const lastShown = shown.at(-1)!
  const title =
    current && lastShown.slice(0, 7) !== month.slice(0, 7)
      ? `${new Intl.DateTimeFormat(undefined, { month: 'long' }).format(parseDay(month))} – ${monthFmt.format(parseDay(lastShown))}`
      : monthFmt.format(parseDay(month))
  const presetDays = new Set(presets.slice(2).map((p) => p.day))

  const pick = (d: string) => {
    if (d <= today) return
    setPicked(d)
    if (!shown.includes(d)) setMonth(d.slice(0, 8) + '01')
  }
  const onGridKey = (e: KeyboardEvent) => {
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key]
    if (step != null) {
      e.preventDefault()
      e.stopPropagation()
      pick(addDays(picked ?? today, step) <= today ? addDays(today, 1) : addDays(picked ?? today, step))
      requestAnimationFrame(() => (document.querySelector('[data-bubble-day][aria-selected="true"]') as HTMLElement | null)?.focus())
    } else if (e.key === 'Enter' && picked) {
      e.preventDefault()
      onPick({ kind: 'on', date: picked })
    }
  }

  return (
    <div className="w-[272px]">
      {presets.map((p) => (
        <button key={p.label} role="menuitem" onClick={() => onPick(p.when)} className="flex w-full items-baseline gap-3 rounded-ui px-2.5 py-1.5 text-left hover:bg-pane-alt focus-visible:bg-pane-alt focus-visible:outline-none">
          <span className="flex-1 text-ink">{p.label}</span>
          <span className="text-[12px] text-ink-faint tabular-nums">{p.hint}</span>
        </button>
      ))}

      <div className="mx-1 my-1.5 h-px bg-rule" />

      {/* Any other day */}
      <div className="px-1.5 pt-1 pb-1.5">
        <div className="mb-1.5 flex items-center px-1">
          <span className="flex-1 truncate text-[13px] font-semibold text-ink">{title}</span>
          <MonthButton label="Previous month" disabled={month <= today.slice(0, 8) + '01'} onClick={() => setMonth(addMonths(month, -1))}>
            <path d="M10 3.5 5.5 8l4.5 4.5" />
          </MonthButton>
          <MonthButton label="Next month" onClick={() => setMonth(addMonths(month, 1))}>
            <path d="m6 3.5 4.5 4.5L6 12.5" />
          </MonthButton>
        </div>
        <div className="grid grid-cols-7 text-center text-[11px] text-ink-faint">
          {shown.slice(0, 7).map((d) => (
            <span key={d} className="py-1">
              {weekdayFmt.format(parseDay(d))}
            </span>
          ))}
        </div>
        <div role="grid" aria-label="Pick a day" className="grid grid-cols-7 gap-y-0.5" onKeyDown={onGridKey}>
          {shown.map((d) => {
            const inMonth = current || d.startsWith(month.slice(0, 7))
            // The 1st of a month, in a rolling view, says which month it starts.
            const monthStart = current && d.endsWith('-01')
            const past = d <= today
            const on = d === picked
            return (
              <button
                key={d}
                data-bubble-day
                role="gridcell"
                aria-selected={on}
                aria-label={dayFmt.format(parseDay(d))}
                disabled={past}
                tabIndex={on || (!picked && d === addDays(today, 1)) ? 0 : -1}
                onClick={() => pick(d)}
                onDoubleClick={() => !past && onPick({ kind: 'on', date: d })}
                className={`relative mx-auto flex size-8 items-center justify-center rounded-full text-[13px] tabular-nums transition-colors duration-(--dur-1) focus-visible:outline-none ${
                  on
                    ? 'bg-accent font-semibold text-accent-ink'
                    : past
                      ? 'text-ink-faint/50'
                      : `${inMonth ? 'text-ink' : 'text-ink-faint'} hover:bg-pane-sunk focus-visible:bg-pane-sunk`
                } ${d === today && !on ? 'font-semibold ring-1 ring-rule-strong ring-inset' : ''}`}
              >
                {monthStart ? <span className="text-[10px] leading-none font-semibold uppercase">{new Intl.DateTimeFormat(undefined, { month: 'short' }).format(parseDay(d)).replace('.', '')}<br />1</span> : parseDay(d).getDate()}
                {presetDays.has(d) && !on && <span aria-hidden className="absolute bottom-[3px] size-[3px] rounded-full bg-accent/70" />}
              </button>
            )
          })}
        </div>
      </div>

      {/* The day picked, and the go-ahead */}
      <div className="flex items-center gap-2 border-t border-rule px-2.5 pt-2 pb-1">
        <span className={`min-w-0 flex-1 truncate text-[12px] ${picked ? 'text-ink-soft' : 'text-ink-faint'}`}>
          {picked ? `${dayFmt.format(parseDay(picked))}, in the morning` : 'Or pick a day'}
        </span>
        <button
          type="button"
          disabled={!picked}
          onClick={() => picked && onPick({ kind: 'on', date: picked })}
          className="btn-primary px-3 py-1 text-[12px] disabled:opacity-40"
        >
          Bubble up
        </button>
      </div>
    </div>
  )
}

function MonthButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-label={label} title={label} className="flex size-6 items-center justify-center rounded-full text-ink-soft hover:bg-pane-sunk hover:text-ink disabled:opacity-30">
      <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {children}
      </svg>
    </button>
  )
}
