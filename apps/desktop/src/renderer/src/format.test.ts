import { describe, expect, it } from 'vitest'
import { dayAndTime } from './format'

describe('dayAndTime', () => {
  const now = new Date(2026, 8, 24, 12, 0) // Thu 24 Sep 2026, local time
  const at = (y: number, m: number, d: number, h = 9) => new Date(y, m, d, h, 5).toISOString()

  it('always shows the date, adding the year only for other years', () => {
    expect(dayAndTime(at(2026, 8, 24), now).day).toMatch(/Sep 24|24 Sep/)
    expect(dayAndTime(at(2026, 8, 23, 23), now).day).toMatch(/Sep 23|23 Sep/)
    expect(dayAndTime(at(2026, 7, 13), now).day).toMatch(/Aug 13|13 Aug/)
    expect(dayAndTime(at(2026, 7, 13), now).day).not.toMatch(/2026/)
    expect(dayAndTime(at(2024, 7, 13), now).day).toMatch(/2024/)
  })

  it('always gives the clock time separately', () => {
    expect(dayAndTime(at(2026, 7, 13), now).time).toMatch(/9:05/)
  })
})
