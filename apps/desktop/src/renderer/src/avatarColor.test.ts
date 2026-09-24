import { describe, expect, it } from 'vitest'
import { paletteColor } from './avatarColor'

describe('paletteColor', () => {
  it('gives the same sender the same HEY colour, and spreads senders across the palette', () => {
    expect(paletteColor('ana@example.com')).toBe(paletteColor('ANA@example.com'))
    const colours = new Set(Array.from({ length: 50 }, (_, i) => paletteColor(`sender${i}@example.com`)))
    expect(colours.size).toBeGreaterThan(8)
    expect([...colours].every((c) => /^#[0-9A-F]{6}$/.test(c))).toBe(true)
  })
})
