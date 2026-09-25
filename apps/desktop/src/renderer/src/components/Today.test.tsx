// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PostingRow, ThreadItem, TodoItem } from '@shared/api'
import type { TodayData } from './Today'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
Element.prototype.scrollIntoView = () => {}

const calls: Array<[string, unknown[]]> = []
let Today: typeof import('./Today')

beforeAll(async () => {
  // The page picks its bridge when it loads.
  window.bridge = { call: async (m, a) => (calls.push([m, a]), null), onEvent: () => () => {} }
  Today = await import('./Today')
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

const posting = (id: number, subject: string, sender = 'Dana Novak'): PostingRow =>
  ({ id, topicId: id * 10, boxId: 1, subject, senderName: sender, senderEmail: 'd@example.com', activeAt: '2026-09-20T10:00:00Z', avatar: { url: null, color: null, initials: 'DN' } }) as PostingRow
const thread = (id: number, subject: string, days: number): ThreadItem => ({ key: `thread:${id}`, posting: posting(id, subject), days })
const todo = (id: number, title: string, daysLate: number): TodoItem => ({ key: `todo:${id}`, todo: { id, title, dueAt: '2026-09-22T00:00:00Z', completedAt: null }, daysLate })

function data(over: Partial<TodayData> = {}): TodayData {
  const d: TodayData = {
    generatedAt: '2026-09-25T08:00:00Z',
    due: { todos: [todo(1, 'File the declaration', 3)], bubbled: [thread(2, 'Reflections on Growth', 40)] },
    replyLater: [thread(3, 'Invitation to the field day', 9)],
    waiting: [{ ...thread(4, 'Quote for the flyers', 5), people: [{ name: 'Printer Ltd', email: 'print@example.com', avatar: { url: null, color: null, initials: 'PL' } }] }],
    events: [],
    newSince: { since: null, boxes: [] },
    toHandle: 4,
    screener: 0,
    ...over,
  }
  return d
}

const text = () => host.textContent ?? ''
const click = (el: Element) =>
  act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })

describe('TodayList', () => {
  it('lists what’s due, what you meant to reply to, and who you’re waiting on, each with why', () => {
    act(() => root.render(createElement(Today.TodayList, { today: data(), selectedId: null, onOpen: vi.fn() })))
    const sections = [...host.querySelectorAll('section')].map((s) => s.getAttribute('aria-label'))
    expect(sections).toEqual(['Due', 'Reply Later', 'Waiting on others'])
    expect(text()).toContain('File the declaration3 days late · To-do')
    expect(text()).toContain('Reflections on GrowthDana Novak · Bubbled up')
    expect(text()).toContain('Waiting on your reply · 9 days')
    expect(text()).toContain('Printer Ltd · No reply for 5 days') // who you're waiting on, not you
  })

  it('opens a thread, completes a to-do in HEY, and puts a thread off with Not now', async () => {
    const onOpen = vi.fn()
    act(() => root.render(createElement(Today.TodayList, { today: data(), selectedId: 3, onOpen })))
    const row = [...host.querySelectorAll('[role=option]')].find((r) => r.textContent?.includes('Invitation'))!
    expect(row.getAttribute('aria-selected')).toBe('true')
    await click(row)
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 3 }))

    await click(host.querySelector('[aria-label="Complete “File the declaration”"]')!)
    expect(calls).toContainEqual(['runAction', [{ type: 'todo', todoId: 1, done: true }]])

    const notNow = [...row.querySelectorAll('button')].find((b) => b.textContent === 'Not now')!
    await click(notNow)
    expect(calls).toContainEqual(['hideFromToday', ['thread:3', '2026-09-20T10:00:00Z']])
    expect(onOpen).toHaveBeenCalledTimes(1) // Not now doesn't open the thread
  })

  it('shows a few per section, and the rest on request', async () => {
    const many = Array.from({ length: 8 }, (_, i) => thread(10 + i, `Parked ${i}`, i))
    act(() => root.render(createElement(Today.TodayList, { today: data({ replyLater: many, toHandle: 11 }), selectedId: null, onOpen: vi.fn() })))
    const later = () => host.querySelectorAll('section[aria-label="Reply Later"] [role=option]').length
    expect(later()).toBe(5)
    await click([...host.querySelectorAll('button')].find((b) => b.textContent === 'Show all 8')!)
    expect(later()).toBe(8)
  })

  it('says you’re caught up when there’s nothing to handle', () => {
    act(() => root.render(createElement(Today.TodayList, { today: data({ due: { todos: [], bubbled: [] }, replyLater: [], waiting: [], toHandle: 0 }), selectedId: null, onOpen: vi.fn() })))
    expect(text()).toContain('You’re caught up.')
    expect(host.querySelector('section')).toBeNull()
  })
})

describe('TodayOverview', () => {
  it('shows the day’s calendar and what’s new, each a click from its box', async () => {
    const onGoToBox = vi.fn()
    const onOpenScreener = vi.fn()
    const today = data({
      events: [{ key: 'e1', id: 1, calendarId: null, title: 'Treasury meeting', startsAt: '2026-09-25T18:00:00Z', endsAt: null, allDay: false, location: 'Port Louis' }],
      newSince: { since: '2026-09-25T06:00:00Z', boxes: [{ boxId: 201228, kind: 'imbox', name: 'Imbox', count: 4 }] },
      screener: 2,
    })
    act(() => root.render(createElement(Today.TodayOverview, { today, onGoToBox, onOpenScreener })))
    expect(text()).toContain('4 things to handle.')
    expect(text()).toContain('Treasury meeting')
    expect(text()).toContain('Port Louis')
    expect(text()).toContain('New since you last looked')
    await click([...host.querySelectorAll('button')].find((b) => b.textContent?.startsWith('Imbox'))!)
    expect(onGoToBox).toHaveBeenCalledWith(201228)
    await click([...host.querySelectorAll('button')].find((b) => b.textContent?.startsWith('The Screener'))!)
    expect(onOpenScreener).toHaveBeenCalled()
    expect(text()).toContain('2 first-time senders waiting')
  })

  it('is calm when there’s nothing', () => {
    act(() => root.render(createElement(Today.TodayOverview, { today: data({ toHandle: 0 }), onGoToBox: vi.fn(), onOpenScreener: vi.fn() })))
    expect(text()).toContain('You’re caught up.')
    expect(text()).toContain('Nothing on the calendar today.')
    expect(text()).toContain('Nothing new.')
  })
})

describe('why and order', () => {
  it('says why in a few words, singular and plural', () => {
    expect(Today.why.todo(todo(1, 'x', 0))).toBe('Due today')
    expect(Today.why.todo(todo(1, 'x', 1))).toBe('1 day late')
    expect(Today.why.replyLater(thread(1, 'x', 0))).toBe('Waiting on your reply')
    expect(Today.why.waiting(thread(1, 'x', 1))).toBe('No reply for 1 day')
  })

  it('walks the threads in the order listed (for j / k)', () => {
    expect(Today.todayThreads(data()).map((p) => p.id)).toEqual([2, 3, 4])
    expect(Today.todayThreads(null)).toEqual([])
  })
})
