// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Command } from '../commands/model'
import { resetShortcuts, useShortcut } from '../shortcuts'
import { CommandBar } from './CommandBar'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
// jsdom doesn't lay out, so it has no scrolling.
Element.prototype.scrollIntoView = () => {}

const cmd = (title: string, over: Partial<Command> = {}): Command => ({ id: title, section: 'Actions', title, run: vi.fn(), ...over })

let root: Root
let host: HTMLElement
beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  resetShortcuts()
  vi.useRealTimers()
})

function render(props: { commands: Command[]; findEmails?: (q: string) => Promise<Command[]>; onClose?: () => void }) {
  const onClose = props.onClose ?? vi.fn()
  act(() => root.render(createElement(CommandBar, { ...props, onClose })))
  return { onClose }
}

const input = () => document.querySelector<HTMLInputElement>('[role=combobox]')!
const rows = () => [...document.querySelectorAll('[role=option]')].map((o) => o.textContent)
const selected = () => document.querySelector('[role=option][aria-selected=true]')?.textContent
const key = (k: string, init: KeyboardEventInit = {}) =>
  act(() => {
    input().dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }))
  })
function type(text: string) {
  // React listens for the native input event, with the value set the way a browser sets it.
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  act(() => {
    setter.call(input(), text)
    input().dispatchEvent(new Event('input', { bubbles: true }))
  })
}
/** Lets the command run: it waits for the bar to close first. */
const flush = () => act(() => vi.runOnlyPendingTimers())

describe('CommandBar', () => {
  const later = cmd('Reply Later', { keys: ['r'] })
  const trash = cmd('Move to Trash', { keys: ['#'], keywords: ['delete'] })
  const theme = cmd('Switch theme', { section: 'App', keys: ['T'] })
  const imbox = cmd('Imbox', { section: 'Go to', keys: ['1'] })

  it('opens focused, listing everything with section headings and shortcuts', () => {
    render({ commands: [theme, later, imbox, trash] })
    expect(document.activeElement).toBe(input())
    expect(rows()).toEqual(['Reply Later' + 'r', 'Move to Trash' + '#', 'Imbox' + '1', 'Switch theme' + '⇧T'])
    expect([...document.querySelectorAll('.eyebrow')].map((h) => h.textContent)).toEqual(['Actions', 'Go to', 'App'])
    // Each group after the first is set apart by a rule; every row has an icon.
    expect([...document.querySelectorAll('.command-heading')].map((h) => h.classList.contains('border-t'))).toEqual([false, true, true])
    expect(document.querySelectorAll('[role=option] svg')).toHaveLength(4)
    expect(selected()).toContain('Reply Later')
  })

  it('filters as you type and highlights the matched letters', () => {
    render({ commands: [later, trash, theme, imbox] })
    type('rl')
    expect(rows()[0]).toContain('Reply Later')
    expect([...document.querySelectorAll('[role=option] mark')].map((m) => m.textContent).slice(0, 2)).toEqual(['R', 'L'])
    type('delete')
    expect(rows()).toEqual(['Move to Trash#'])
    type('zzz')
    expect(rows()).toEqual([])
    expect(document.body.textContent).toContain('Nothing matches “zzz”.')
  })

  it('moves with the arrows (wrapping) and ⌃N/⌃P, and runs the chosen one with Enter', () => {
    const { onClose } = render({ commands: [later, trash, theme] })
    key('ArrowDown')
    expect(selected()).toContain('Move to Trash')
    key('ArrowUp')
    key('ArrowUp')
    expect(selected()).toContain('Switch theme') // wrapped to the end
    key('n', { ctrlKey: true })
    expect(selected()).toContain('Reply Later')
    key('p', { ctrlKey: true })
    key('Enter')
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(theme.run).not.toHaveBeenCalled() // not until the bar is gone
    flush()
    expect(theme.run).toHaveBeenCalledTimes(1)
    expect(later.run).not.toHaveBeenCalled()
  })

  it('starts again from the top when the query changes', () => {
    render({ commands: [later, trash, theme] })
    key('ArrowDown')
    key('ArrowDown')
    type('t')
    expect(selected()).toBe(rows()[0])
  })

  it('runs a row when clicked, and hovering picks it', () => {
    render({ commands: [later, trash] })
    const second = document.querySelectorAll('[role=option]')[1]!
    act(() => {
      second.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }))
    })
    expect(selected()).toContain('Move to Trash')
    act(() => {
      second.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    flush()
    expect(trash.run).toHaveBeenCalledTimes(1)
  })

  it('closes on Esc without the key reaching the app, and on a click outside', () => {
    const appEsc = vi.fn()
    window.addEventListener('keydown', appEsc)
    const { onClose } = render({ commands: [later] })
    key('Escape')
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(appEsc).not.toHaveBeenCalled()
    window.removeEventListener('keydown', appEsc)

    const backdrop = document.querySelector('[role=dialog]')!.parentElement!
    act(() => {
      backdrop.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    })
    expect(onClose).toHaveBeenCalledTimes(2)
    expect(later.run).not.toHaveBeenCalled()
  })

  it('gives the focus back to where it was', () => {
    const before = document.createElement('button')
    document.body.append(before)
    before.focus()
    render({ commands: [later] })
    expect(document.activeElement).toBe(input())
    key('Escape')
    expect(document.activeElement).toBe(before)
    before.remove()
  })

  it('remembers choices and lists them first next time', () => {
    render({ commands: [later, trash, theme] })
    type('theme')
    key('Enter')
    flush()
    act(() => root.unmount())
    root = createRoot(host)
    render({ commands: [later, trash, theme] })
    expect(rows()[0]).toContain('Switch theme')
    expect(document.querySelector('.eyebrow')?.textContent).toBe('Recent')
  })

  it('adds emails after a pause in typing, below the commands, and drops late answers', async () => {
    const stripe = cmd('Payout failed', { id: 'email:1', section: 'Emails', detail: 'Stripe · Sep 22' })
    const old = cmd('Old news', { id: 'email:2', section: 'Emails' })
    const answers: Record<string, (c: Command[]) => void> = {}
    const findEmails = vi.fn((q: string) => new Promise<Command[]>((resolve) => (answers[q] = resolve)))
    render({ commands: [later, cmd('Pay the bill')], findEmails })

    type('p') // one letter: too short to look up
    act(() => vi.advanceTimersByTime(200))
    expect(findEmails).not.toHaveBeenCalled()

    type('pa')
    type('pay')
    act(() => vi.advanceTimersByTime(200))
    expect(findEmails.mock.calls.map(([q]) => q)).toEqual(['pay']) // the pause skipped "pa"

    type('payo')
    act(() => vi.advanceTimersByTime(200))
    // The newest matches only mid-title; the older one starts with the query.
    const newest = cmd('Re: your payout failed', { id: 'email:3', section: 'Emails', detail: 'Stripe · Sep 23' })
    await act(async () => answers['payo']!([newest, stripe]))
    // They keep the order found (newest first), not the better title match.
    expect(rows().slice(-2).map((r) => r?.slice(0, 13))).toEqual(['Re: your payo', 'Payout failed'])
    expect(rows().at(-1)).toContain('Stripe · Sep 22')
    // The answer for "pay" arrives last; it must not replace the one for what's typed.
    await act(async () => answers['pay']!([old]))
    expect(rows().some((r) => r?.includes('Old news'))).toBe(false)
    expect(rows().at(-1)).toContain('Payout failed')
    expect([...document.querySelectorAll('.eyebrow')].map((h) => h.textContent)).toEqual(['Emails'])
  })

  it('keeps Tab in the bar', () => {
    render({ commands: [later] })
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    act(() => {
      input().dispatchEvent(tab)
    })
    expect(tab.defaultPrevented).toBe(true)
  })
})

describe('CommandBar with the shortcut table', () => {
  it('offers what the keys do right now, and runs it', () => {
    const later = vi.fn()
    function Probe() {
      useShortcut('replyLater', later)
      return null
    }
    const probeRoot = createRoot(document.createElement('div'))
    act(() => probeRoot.render(createElement(Probe)))
    render({ commands: [] })
    expect(rows()).toEqual(['Reply Later' + 'r'])
    key('Enter')
    flush()
    expect(later).toHaveBeenCalledTimes(1)
    act(() => probeRoot.unmount())
  })
})
