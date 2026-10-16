// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ActionRecord, ApiEvent } from '@shared/api'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const listeners = new Set<(e: ApiEvent) => void>()
const emit = (e: ApiEvent) => act(() => listeners.forEach((l) => l(e)))
let Activity: typeof import('./Activity')
beforeAll(async () => {
  window.bridge = { call: async () => null, onEvent: (cb) => (listeners.add(cb), () => listeners.delete(cb)) }
  Activity = await import('./Activity')
})

let root: Root
let host: HTMLElement
beforeEach(() => {
  vi.useFakeTimers()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.useRealTimers()
})

const done = (id: number, summary: string) => ({ type: 'action', action: { id, summary, status: 'done', source: 'user', canUndo: true, verified: true } as unknown as ActionRecord }) as ApiEvent
const stack = () => host.querySelector('[aria-label="Notifications"]') as HTMLElement
const notes = () => [...stack().children] as HTMLElement[]

describe('notifications', () => {
  it('stack into one, newest in front, two peeking, and fan out while hovered', () => {
    act(() => root.render(createElement(Activity.Toasts)))
    for (let i = 1; i <= 4; i++) emit(done(i, `Marked ${i} as seen`))
    expect(notes()).toHaveLength(4)
    expect(notes()[0]!.textContent).toContain('Marked 4')
    expect(notes()[0]!.style.zIndex).toBe('4')
    // The fourth from the front is tucked away; the stack is one note tall plus two edges.
    expect(notes()[3]!.style.opacity).toBe('0')
    expect(stack().style.height).toBe(`${44 + 2 * 8}px`)

    act(() => stack().dispatchEvent(new MouseEvent('mouseover', { bubbles: true })))
    expect(stack().style.height).toBe(`${4 * 44 + 3 * 8}px`)
    expect(notes()[3]!.style.opacity).toBe('1')
    expect(notes()[1]!.style.transform).toContain('translateY(-52px)')
  })

  it('fade away when dismissed or when their time is up, but not while you read them', () => {
    act(() => root.render(createElement(Activity.Toasts)))
    emit(done(1, 'Moved it'))
    act(() => stack().dispatchEvent(new MouseEvent('mouseover', { bubbles: true })))
    act(() => vi.advanceTimersByTime(10_000))
    expect(stack()).not.toBeNull()
    act(() => stack().dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body })))
    act(() => vi.advanceTimersByTime(2000))
    expect(host.querySelector('[aria-label="Notifications"]')).toBeNull()

    emit(done(2, 'Archived it'))
    act(() => (host.querySelector('[aria-label="Dismiss"]') as HTMLButtonElement).click())
    expect(notes()[0]!.style.opacity).toBe('0')
    act(() => vi.advanceTimersByTime(250))
    expect(host.querySelector('[aria-label="Notifications"]')).toBeNull()
  })
})
