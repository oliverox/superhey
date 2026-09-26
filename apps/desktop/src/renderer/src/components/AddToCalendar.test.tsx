// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import type { EventRow } from '@shared/api'

const ev = (title: string, startsAt: string, allDay = false) =>
  ({ key: title, id: 1, calendarId: null, title, startsAt, endsAt: startsAt, allDay, location: null, color: null, calendarName: null, recurring: false, joinUrl: null, appUrl: null }) as EventRow
const local = (day: string, hm: string) => new Date(`${day}T${hm}:00`).toISOString()

describe('is this date already in the calendar', () => {
  it('matches the same day by start time or a telling word, not by chance', async () => {
    window.bridge = { call: async () => null, onEvent: () => () => {} }
    const { matchingEvent } = await import('./AddToCalendar')
    const day = '2026-10-12'
    const events = [ev('Prep call with OPD', local(day, '17:00')), ev('Gym', local(day, '08:30'))]
    expect(matchingEvent({ label: 'Preparation call', date: day, time: '17:00' }, events)?.title).toBe('Prep call with OPD')
    expect(matchingEvent({ label: 'Gym session', date: day, time: null }, events)).toBeNull() // "gym" is too short to tell
    expect(matchingEvent({ label: 'Field gathering', date: day, time: '10:00' }, events)).toBeNull()
    expect(matchingEvent({ label: 'Arrival in Addis Ababa', date: '2026-11-22' }, [ev('Addis Ababa trip', '2026-11-22T00:00:00Z', true)])?.title).toBe('Addis Ababa trip')
  })
})
