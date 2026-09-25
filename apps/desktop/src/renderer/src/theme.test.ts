import { describe, expect, it } from 'vitest'
import { nextScheme, showsDark } from './theme'

describe('light and dark', () => {
  it('cycles Auto → Light → Dark from the button', () => {
    expect(nextScheme('auto')).toBe('light')
    expect(nextScheme('light')).toBe('dark')
    expect(nextScheme('dark')).toBe('auto')
  })

  it('shows dark when chosen, or on Auto when the system is dark', () => {
    expect(showsDark('dark', false)).toBe(true)
    expect(showsDark('light', true)).toBe(false)
    expect(showsDark('auto', true)).toBe(true)
    expect(showsDark('auto', false)).toBe(false)
  })
})
