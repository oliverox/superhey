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

describe('themes', () => {
  it('gives every Default theme a light and a dark side, and styles the rest by attribute', async () => {
    const { DEFAULT_THEMES, OMARCHY_THEMES, themeCss } = await import('./themes')
    for (const t of DEFAULT_THEMES) expect(t.light.pane).not.toBe(t.dark.pane)
    const css = themeCss()
    // Default's palettes apply to the Default style only (Column has its own colours).
    expect(css).toContain(":root[data-palette='linen'][data-theme='default']")
    expect(css).toContain(":root[data-palette='linen'][data-scheme='dark']")
    expect(css).toContain(":root[data-theme='omarchy'][data-omarchy='catppuccin-latte']")
    expect(css).toContain('color-scheme:light')
    // The styles' own colours live in styles.css.
    expect(css).toContain("data-palette='graphite'")
    expect(css).not.toContain("data-palette='cobalt'")
    expect(css).not.toContain("data-omarchy='tokyo-night'")
    expect(new Set(OMARCHY_THEMES.map((t) => t.id)).size).toBe(OMARCHY_THEMES.length)
  })
})
