// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { PostingRow } from '@shared/api'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const calls: Array<[string, unknown[]]> = []
let Bar: typeof import('./ActionBar')

beforeAll(async () => {
  window.bridge = {
    call: async (m, a) => (calls.push([m, a]), m === 'boxes' ? [{ id: 1, kind: 'imbox', name: 'Imbox', unseen: 0 }] : m === 'labels' ? [] : null),
    onEvent: () => () => {},
  }
  Bar = await import('./ActionBar')
})

let root: Root
let host: HTMLElement
beforeEach(() => {
  calls.length = 0
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const member = (id: number, seen: boolean) => ({ id, topicId: id * 10, boxId: 1, seen, labels: [], bubbledUp: false }) as unknown as PostingRow
const flush = () => act(async () => {})
const button = (label: string) => host.querySelector<HTMLButtonElement>(`[aria-label="${label}"], [title="${label}"], [data-tip="${label}"]`)!

describe('bundle actions', () => {
  it('asks before acting on every email, and runs them together', async () => {
    let left = 0
    act(() => root.render(createElement(Bar.BundleActionBar, { members: [member(1, true), member(2, false)], sender: 'Stripe', onLeaveBox: () => left++ })))
    await flush()
    await act(async () => button('Set Aside: the whole bundle').click())
    expect(host.querySelector('[role=alertdialog]')!.textContent).toContain('Set Aside all 2 emails from Stripe?')
    expect(calls.some(([m]) => m === 'runActions')).toBe(false)

    await act(async () => [...host.querySelectorAll('[role=alertdialog] button')].find((b) => b.textContent === 'Cancel')!.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(host.querySelector('[role=alertdialog]')).toBeNull()

    await act(async () => button('Set Aside: the whole bundle').click())
    await act(async () => [...host.querySelectorAll('[role=alertdialog] button')].find((b) => b.textContent?.startsWith('Set Aside'))!.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(calls.find(([m]) => m === 'runActions')?.[1]).toEqual([[
      { type: 'move', postingId: 1, to: 'asidebox' },
      { type: 'move', postingId: 2, to: 'asidebox' },
    ]])
    expect(left).toBe(1)
  })

  it('marks seen only the emails that aren’t', async () => {
    act(() => root.render(createElement(Bar.BundleActionBar, { members: [member(1, true), member(2, false)], sender: 'Stripe', onLeaveBox: () => {} })))
    await flush()
    await act(async () => button('Mark the whole bundle seen').click())
    expect(host.querySelector('[role=alertdialog]')!.textContent).toContain('Mark the 1 email from Stripe seen?')
  })
})
