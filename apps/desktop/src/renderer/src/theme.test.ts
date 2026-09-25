import { describe, expect, it } from 'vitest'
import { showsDark } from './theme'

describe('light and dark', () => {
  it('shows dark when chosen, or on Auto when the system is dark', () => {
    expect(showsDark('dark', false)).toBe(true)
    expect(showsDark('light', true)).toBe(false)
    expect(showsDark('auto', true)).toBe(true)
    expect(showsDark('auto', false)).toBe(false)
  })
})
