// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { comboOf, installShortcuts, keyLabel, resetShortcuts, SHORTCUTS, useShortcut, type ShortcutId } from './shortcuts'

// React's act() needs this flag to run effects synchronously in tests.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function mount(bindings: Array<[ShortcutId, () => void, boolean?]>) {
  function Probe() {
    for (const [id, run, enabled] of bindings) useShortcut(id, run, enabled ?? true)
    return null
  }
  const root = createRoot(document.createElement('div'))
  act(() => root.render(createElement(Probe)))
  return () => act(() => root.unmount())
}

const press = (key: string, init: KeyboardEventInit = {}, target: EventTarget = document.body) =>
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }))

afterEach(() => resetShortcuts())

describe('shortcuts', () => {
  it('runs the handler for a key, and only while it is mounted and enabled', () => {
    const uninstall = installShortcuts()
    const reply = vi.fn()
    const unmount = mount([['replyLater', reply]])
    press('r')
    expect(reply).toHaveBeenCalledTimes(1)
    unmount()
    press('r')
    expect(reply).toHaveBeenCalledTimes(1)
    mount([['replyLater', reply, false]])
    press('r')
    expect(reply).toHaveBeenCalledTimes(1)
    uninstall()
  })

  it('ignores keys typed into fields', () => {
    const uninstall = installShortcuts()
    const search = vi.fn()
    mount([['search', search]])
    const input = document.createElement('input')
    document.body.append(input)
    press('/', {}, input)
    expect(search).not.toHaveBeenCalled()
    press('/')
    expect(search).toHaveBeenCalledTimes(1)
    uninstall()
  })

  it('gives the most recently mounted handler the key', () => {
    const uninstall = installShortcuts()
    const outer = vi.fn()
    const inner = vi.fn()
    mount([['help', outer]])
    const unmountInner = mount([['help', inner]])
    press('?')
    expect(inner).toHaveBeenCalledTimes(1)
    expect(outer).not.toHaveBeenCalled()
    unmountInner()
    press('?')
    expect(outer).toHaveBeenCalledTimes(1)
    uninstall()
  })

  it('matches ⌘/Ctrl combos and leaves unbound keys alone', () => {
    const uninstall = installShortcuts()
    const undo = vi.fn()
    mount([['undo', undo]])
    press('z', { metaKey: true })
    press('z', { ctrlKey: true })
    press('z')
    expect(undo).toHaveBeenCalledTimes(3)
    const unbound = new KeyboardEvent('keydown', { key: 'q', bubbles: true, cancelable: true })
    document.body.dispatchEvent(unbound)
    expect(unbound.defaultPrevented).toBe(false)
    expect(comboOf({ key: 'z', metaKey: false, ctrlKey: false, altKey: true })).toBeNull()
    uninstall()
  })

  it('declares every key once, and writes keys the way people read them', () => {
    const all = Object.values(SHORTCUTS).flatMap((s) => [...s.keys])
    expect(new Set(all).size).toBe(all.length)
    expect(keyLabel('ArrowDown')).toBe('↓')
    expect(keyLabel('T')).toBe('⇧T')
    expect(keyLabel('r')).toBe('r')
  })
})
