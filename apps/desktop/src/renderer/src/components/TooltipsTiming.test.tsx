// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Tooltips } from './Tooltips'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => {
  vi.useRealTimers()
  document.body.innerHTML = ''
})

describe('tooltip timing', () => {
  it('waits for the pointer to rest, and passing over things doesn’t skip the wait', () => {
    vi.useFakeTimers()
    document.body.innerHTML = '<button id="a" title="First">A</button><button id="b" title="Second">B</button>'
    const host = document.body.appendChild(document.createElement('div'))
    act(() => createRoot(host).render(createElement(Tooltips)))
    const over = (id: string) => act(() => void document.getElementById(id)!.dispatchEvent(new Event('pointerover', { bubbles: true })))
    const tip = () => document.querySelector('[role=tooltip]')?.textContent ?? null

    over('a')
    act(() => void vi.advanceTimersByTime(300))
    over('b') // only passing over A
    act(() => void vi.advanceTimersByTime(400))
    expect(tip()).toBeNull()
    act(() => void vi.advanceTimersByTime(400))
    expect(tip()).toBe('Second')
    // From one tip straight to the next: no second wait.
    over('a')
    expect(tip()).toBe('First')
  })
})
