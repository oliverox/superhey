// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let status: unknown = null
let Spend: typeof import('./AiSpend')
beforeAll(async () => {
  window.bridge = { call: async (m) => (m === 'aiStatus' ? status : null), onEvent: () => () => {} }
  Spend = await import('./AiSpend')
})
let root: Root
let host: HTMLElement
beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})
const flush = () => act(async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve()
})
const month = (spentUsd: number, budgetUsd: number | null) => ({ mode: { cloud: 'claude', local: false }, month: { since: '', spentUsd, budgetUsd, calls: 42, byTask: [] } })

describe('AI spend in the header', () => {
  it('shows the month’s spend against the budget, and opens usage', async () => {
    status = month(0.42, 5)
    const onOpen = vi.fn()
    act(() => root.render(createElement(Spend.AiSpend, { onOpen })))
    await flush()
    const b = host.querySelector('button')!
    expect(b.textContent).toBe('$0.42')
    expect(b.title).toContain('$0.42 of your $5.00 budget · 42 requests')
    act(() => b.click())
    expect(onOpen).toHaveBeenCalled()
  })

  it('stays quiet under 80% of the budget, red from there; hidden without AI', async () => {
    status = month(3.5, 5)
    act(() => root.render(createElement(Spend.AiSpend, { onOpen: vi.fn() })))
    await flush()
    expect(host.querySelector('button')!.className).not.toContain('text-danger')
    status = month(4.5, 5)
    act(() => root.unmount())
    root = createRoot(host)
    act(() => root.render(createElement(Spend.AiSpend, { onOpen: vi.fn() })))
    await flush()
    expect(host.querySelector('button')!.className).toContain('text-danger')
    status = { mode: { cloud: null, local: false }, month: { since: '', spentUsd: 0, budgetUsd: null, calls: 0, byTask: [] } }
    act(() => root.unmount())
    root = createRoot(host)
    act(() => root.render(createElement(Spend.AiSpend, { onOpen: vi.fn() })))
    await flush()
    expect(host.querySelector('button')).toBeNull()
  })
})
