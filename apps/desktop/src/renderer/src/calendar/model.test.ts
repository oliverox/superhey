import { describe, expect, it } from 'vitest'
import type { EventRow } from '@shared/api'
import { addMonths, allDayBars, eventDays, layoutDay, step, viewDays } from './model'

const ev = (key: string, startsAt: string, endsAt: string | null, allDay = false) =>
  ({ key, id: 1, calendarId: null, title: key, startsAt, endsAt, allDay, location: null, color: null, calendarName: null, recurring: false, joinUrl: null, appUrl: null }) as EventRow
// Local times, so the tests hold in any time zone.
const at = (day: string, hm: string) => new Date(`${day}T${hm}:00`).toISOString()

describe('calendar days', () => {
  it('shows a week from Sunday, and a month as six weeks', () => {
    expect(viewDays('week', '2026-09-23')).toEqual(['2026-09-20', '2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26'])
    const month = viewDays('month', '2026-09-26')
    expect(month).toHaveLength(42)
    expect(month[0]).toBe('2026-08-30')
    expect(viewDays('day', '2026-09-26')).toEqual(['2026-09-26'])
  })

  it('steps by a day, a week or a month, keeping the day of the month when it can', () => {
    expect(step('day', '2026-09-26', 1)).toBe('2026-09-27')
    expect(step('week', '2026-09-26', -1)).toBe('2026-09-19')
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28')
  })

  it('reads all-day events by their UTC day, timed ones by the local days they run through', () => {
    expect(eventDays(ev('a', '2026-09-21T00:00:00Z', '2026-09-21T00:00:00Z', true))).toEqual({ first: '2026-09-21', last: '2026-09-21' })
    expect(eventDays(ev('b', '2026-11-22T00:00:00Z', '2026-11-29T00:00:00Z', true))).toEqual({ first: '2026-11-22', last: '2026-11-29' })
    expect(eventDays(ev('c', at('2026-09-26', '22:00'), at('2026-09-27', '00:00')))).toEqual({ first: '2026-09-26', last: '2026-09-26' })
    expect(eventDays(ev('d', at('2026-09-26', '22:00'), at('2026-09-27', '01:00')))).toEqual({ first: '2026-09-26', last: '2026-09-27' })
  })
})

describe('laying out a day', () => {
  it('puts overlapping events side by side and the rest full width', () => {
    const day = '2026-09-26'
    const placed = layoutDay([ev('gym', at(day, '08:30'), at(day, '10:00')), ev('call', at(day, '09:00'), at(day, '09:30')), ev('lunch', at(day, '12:00'), at(day, '13:00'))], day)
    const by = Object.fromEntries(placed.map((p) => [p.event.key, [p.start, p.end, p.col, p.cols]]))
    expect(by.gym).toEqual([510, 600, 0, 2])
    expect(by.call).toEqual([540, 570, 1, 2])
    expect(by.lunch).toEqual([720, 780, 0, 1])
  })

  it('packs all-day bars into rows across the week', () => {
    const days = viewDays('week', '2026-09-23')
    const bars = allDayBars([ev('trip', '2026-09-21T00:00:00Z', '2026-09-24T00:00:00Z', true), ev('library', '2026-09-22T00:00:00Z', '2026-09-22T00:00:00Z', true), ev('fri', '2026-09-25T00:00:00Z', null, true)], days)
    expect(bars.map((b) => [b.event.key, b.from, b.to, b.row])).toEqual([
      ['trip', 1, 4, 0],
      ['library', 2, 2, 1],
      ['fri', 5, 5, 0],
    ])
  })
})
