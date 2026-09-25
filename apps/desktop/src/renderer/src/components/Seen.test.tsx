// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { PostingRow } from '@shared/api'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const calls: Array<[string, unknown[]]> = []
let Bundle: typeof import('./BundleView')
let prefs: typeof import('../prefs')
beforeAll(async () => {
  window.bridge = { call: async (m, a) => (calls.push([m, a]), null), onEvent: () => () => {} }
  Bundle = await import('./BundleView')
  prefs = await import('../prefs')
})

let root: Root
let host: HTMLElement
beforeEach(() => {
  calls.length = 0
  localStorage.clear()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const email = (seen: boolean) => ({ id: 41, seen }) as PostingRow
function Probe({ p, shown }: { p: PostingRow; shown: boolean }) {
  Bundle.useSeenWhenShown(p, shown)
  return null
}
const seenCalls = () => calls.filter(([m]) => m === 'runAction').map(([, a]) => a)

describe('marking seen', () => {
  it('opens as HEY does: on, unless turned off', () => {
    expect(prefs.markSeenOnOpen()).toBe(true)
    prefs.setMarkSeenOnOpen(false)
    expect(prefs.markSeenOnOpen()).toBe(false)
    prefs.setMarkSeenOnOpen(true)
    expect(prefs.markSeenOnOpen()).toBe(true)
  })

  it('marks a bundled email seen once it’s showing, once', () => {
    act(() => root.render(createElement(Probe, { p: email(false), shown: false })))
    expect(seenCalls()).toEqual([])
    act(() => root.render(createElement(Probe, { p: email(false), shown: true })))
    expect(seenCalls()).toEqual([[{ type: 'seen', postingId: 41, seen: true }, 'auto']])
    // Marked unseen again by hand while it's open: left that way.
    act(() => root.render(createElement(Probe, { p: email(true), shown: true })))
    act(() => root.render(createElement(Probe, { p: email(false), shown: true })))
    expect(seenCalls()).toHaveLength(1)
  })

  it('leaves bundled emails new when seen is yours to mark, and skips ones already seen', () => {
    prefs.setMarkSeenOnOpen(false)
    act(() => root.render(createElement(Probe, { p: email(false), shown: true })))
    expect(seenCalls()).toEqual([])
    prefs.setMarkSeenOnOpen(true)
    act(() => root.render(createElement(Probe, { p: { id: 42, seen: true } as PostingRow, shown: true })))
    expect(seenCalls()).toEqual([])
  })
})
