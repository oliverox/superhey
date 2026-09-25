// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PostingRow } from '@shared/api'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let Lists: typeof import('./Lists')
let Resizer: typeof import('./ListResizer')
let motion: typeof import('../motion')
beforeAll(async () => {
  window.bridge = { call: async () => null, onEvent: () => () => {} }
  // jsdom has no matchMedia: motion is on.
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia
  Lists = await import('./Lists')
  Resizer = await import('./ListResizer')
  motion = await import('../motion')
})

let root: Root
let host: HTMLElement
beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  document.documentElement.dataset.theme = 'default'
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.useRealTimers()
})

const row = (id: number) => ({ id }) as PostingRow
let seen: number[] = []
function Probe({ rows, enabled = true }: { rows: PostingRow[]; enabled?: boolean }) {
  seen = Lists.useLeavingRows(rows, enabled).rows.map((r) => r.id)
  return null
}

describe('rows leaving a box', () => {
  it('keeps a row that left where it was, then lets it go', () => {
    act(() => root.render(createElement(Probe, { rows: [row(1), row(2), row(3)] })))
    act(() => root.render(createElement(Probe, { rows: [row(1), row(3)] })))
    expect(seen).toEqual([1, 2, 3])
    act(() => vi.advanceTimersByTime(motion.DUR.base + 100))
    expect(seen).toEqual([1, 3])
  })

  it('keeps the first row at the top, and new rows arrive as they are', () => {
    act(() => root.render(createElement(Probe, { rows: [row(1), row(2)] })))
    act(() => root.render(createElement(Probe, { rows: [row(9), row(2)] })))
    expect(seen).toEqual([1, 9, 2])
  })

  it('redraws rather than animates a wholesale change, or with motion off', () => {
    const many = [1, 2, 3, 4, 5, 6, 7].map(row)
    act(() => root.render(createElement(Probe, { rows: many })))
    act(() => root.render(createElement(Probe, { rows: [row(7)] })))
    expect(seen).toEqual([7])
    act(() => root.render(createElement(Probe, { rows: [row(1), row(2)], enabled: false })))
    act(() => root.render(createElement(Probe, { rows: [row(2)], enabled: false })))
    expect(seen).toEqual([2])
    document.documentElement.dataset.theme = 'omarchy'
    act(() => root.render(createElement(Probe, { rows: [row(1), row(2)] })))
    act(() => root.render(createElement(Probe, { rows: [row(2)] })))
    expect(seen).toEqual([2])
  })
})

describe('the list’s width', () => {
  it('stays between its limits, and leaves the reader room', () => {
    expect(Resizer.clampListWidth(100, 1600)).toBe(Resizer.LIST_WIDTH.min)
    expect(Resizer.clampListWidth(5000, 2400)).toBe(Resizer.LIST_WIDTH.max)
    expect(Resizer.clampListWidth(600, 1100)).toBe(1100 - 232 - 420)
    expect(Resizer.clampListWidth(450.6, 1600)).toBe(451)
  })

  it('is remembered on this device', () => {
    Object.defineProperty(window, 'innerWidth', { value: 1600, configurable: true })
    let api!: ReturnType<typeof Resizer.useListWidth>
    function W() {
      api = Resizer.useListWidth()
      return null
    }
    act(() => root.render(createElement(W)))
    expect(api.width).toBe(Resizer.LIST_WIDTH.initial)
    act(() => api.save(520))
    expect(localStorage.getItem('list:width')).toBe('520')
    act(() => root.unmount())
    root = createRoot(host)
    act(() => root.render(createElement(W)))
    expect(api.width).toBe(520)
  })

  it('moves with the arrow keys and resets on double-click', () => {
    const onResize = vi.fn()
    const grid = { current: document.createElement('div') }
    act(() => root.render(createElement(Resizer.ListResizer, { gridRef: grid, width: 400, onResize })))
    const handle = host.querySelector('[role=separator]')!
    act(() => void handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })))
    expect(onResize).toHaveBeenLastCalledWith(416)
    act(() => void handle.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })))
    expect(onResize).toHaveBeenLastCalledWith(Resizer.LIST_WIDTH.initial)
  })
})

describe('presence', () => {
  it('stays mounted while it animates out', () => {
    let p = { mounted: false, shown: false }
    function P({ show }: { show: boolean }) {
      p = motion.usePresence(show, 200)
      return null
    }
    act(() => root.render(createElement(P, { show: true })))
    expect(p.mounted).toBe(true)
    act(() => root.render(createElement(P, { show: false })))
    expect(p).toEqual({ mounted: true, shown: false })
    act(() => vi.advanceTimersByTime(250))
    expect(p.mounted).toBe(false)
  })
})
