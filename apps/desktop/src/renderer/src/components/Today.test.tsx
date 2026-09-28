// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { clockHm } from '../format'
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
    due: { todos: [todo(1, 'File the declaration', 3)], actions: [], bubbled: [thread(2, 'Reflections on Growth', 40)] },
    needsReply: [],
    replyLater: [thread(3, 'Invitation to the field day', 9)],
    waiting: [{ ...thread(4, 'Quote for the flyers', 5), people: [{ name: 'Printer Ltd', email: 'print@example.com', avatar: { url: null, color: null, initials: 'PL' } }] }],
    comingUp: [],
    events: [],
    newSince: { since: null, boxes: [] },
    toHandle: 4,
    needsAnalysis: [],
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
    act(() => root.render(createElement(Today.TodayList, { today: data(), selectedId: null, onOpen: vi.fn(), onGoToBox: vi.fn() })))
    const sections = [...host.querySelectorAll('section')].map((s) => s.getAttribute('aria-label'))
    expect(sections).toEqual(['Due', 'Reply Later', 'Waiting on others'])
    expect(text()).toContain('File the declaration3 days late · To-do')
    expect(text()).toContain('Reflections on GrowthDana Novak · Bubbled up')
    expect(text()).toContain('Waiting on your reply · 9 days')
    expect(text()).toContain('Printer Ltd · No reply for 5 days') // who you're waiting on, not you
  })

  it('opens a thread, completes a to-do in HEY, and puts a thread off with Not now', async () => {
    const onOpen = vi.fn()
    act(() => root.render(createElement(Today.TodayList, { today: data(), selectedId: 3, onOpen, onGoToBox: vi.fn() })))
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
    act(() => root.render(createElement(Today.TodayList, { today: data({ replyLater: many, toHandle: 11 }), selectedId: null, onOpen: vi.fn(), onGoToBox: vi.fn() })))
    const later = () => host.querySelectorAll('section[aria-label="Reply Later"] [role=option]').length
    expect(later()).toBe(5)
    await click([...host.querySelectorAll('button')].find((b) => b.textContent === 'Show all 8')!)
    expect(later()).toBe(8)
  })

  it('says you’re caught up when there’s nothing to handle', () => {
    act(() => root.render(createElement(Today.TodayList, { today: data({ due: { todos: [], actions: [], bubbled: [] }, replyLater: [], waiting: [], toHandle: 0 }), selectedId: null, onOpen: vi.fn(), onGoToBox: vi.fn() })))
    expect(text()).toContain('You’re caught up.')
    expect(host.querySelector('section')).toBeNull() // nothing new either
  })
})

describe('what the AI found', () => {
  it('lists deadlines from mail in Due, what needs your reply with why, and dates coming up', async () => {
    const onOpen = vi.fn()
    const today = data({
      due: { todos: [], actions: [{ key: 'action:5:0', posting: posting(5, 'Reservation for Seaside Retreat', 'Airbnb'), text: 'Send the signed form', due: '2026-09-24', daysLate: 1, kind: 'task', amount: null }], bubbled: [] },
      needsReply: [{ ...thread(6, 'Early check-in?', 1), reason: 'guest asks about early check-in' }],
      replyLater: [],
      waiting: [],
      comingUp: [
        { key: 'date:7:0', posting: posting(7, 'Booking confirmed'), label: 'Check-in', date: '2099-01-02', time: '14:00', isDeadline: false },
        { key: 'date:7:1', posting: posting(7, 'Booking confirmed'), label: 'Confirm numbers', date: '2099-01-03', time: null, isDeadline: true },
      ],
      toHandle: 2,
    })
    act(() => root.render(createElement(Today.TodayList, { today, selectedId: null, onOpen, onGoToBox: vi.fn() })))
    expect([...host.querySelectorAll('section')].map((s) => s.getAttribute('aria-label'))).toEqual(['Due', 'Needs your reply', 'Coming up'])
    expect(text()).toContain('Send the signed form1 day late · Reservation for Seaside Retreat')
    expect(text()).toContain('Dana Novak · Guest asks about early check-in')
    const coming = host.querySelector('section[aria-label="Coming up"]')!.textContent
    // The time in the app's clock; the sender, not the subject, says where it came from.
    expect(coming).toContain(`${clockHm('14:00')}Check-inDana Novak`)
    expect(coming).toContain('DueConfirm numbers')
    await click([...host.querySelectorAll('section[aria-label="Coming up"] button')][0]!)
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 7 }))
  })
})

describe('forms, bills, RSVPs and clashes', () => {
  it('tags what sort of thing it is, nudges when it’s close, says what it clashes with, and lets you tick it done', async () => {
    const t = data({
      due: { todos: [], actions: [], bubbled: [] },
      replyLater: [],
      waiting: [],
      toHandle: 0,
      comingUp: [
        { key: 'date:8:0', posting: posting(8, 'School trip'), label: 'Pay the school trip', date: '2099-01-02', time: null, isDeadline: true, kind: 'bill', amount: { amount: 40, currency: 'EUR' }, soon: true },
        { key: 'date:9:0', posting: posting(9, 'Party'), label: 'Birthday party', date: '2099-01-03', time: '15:00', isDeadline: false, task: 'Say if you’re coming', kind: 'rsvp', clash: { title: 'Gym', startsAt: '2099-01-03T15:00:00Z', endsAt: '2099-01-03T16:00:00Z' } },
      ],
    })
    act(() => root.render(createElement(Today.TodayList, { today: t, selectedId: null, onOpen: vi.fn(), onGoToBox: vi.fn() })))
    const coming = host.querySelector('section[aria-label="Coming up"]')!
    expect(coming.textContent).toContain('Bill · €40Pay the school trip')
    expect(coming.textContent).toContain('RSVPSay if you’re coming')
    expect(coming.textContent).toContain('Clashes with Gym')
    expect(coming.querySelector('.text-attn')).not.toBeNull() // nudged: due soon
    await click([...coming.querySelectorAll('button')].find((b) => b.textContent === 'Done')!)
    expect(calls).toContainEqual(['markItemDone', [80, 'Pay the school trip']])
    expect([...coming.querySelectorAll('button')].some((b) => b.textContent === 'Ask to move')).toBe(true)
  })
})

describe('Done', () => {
  const withEverything = () =>
    data({
      due: { todos: [], actions: [{ key: 'action:5:0', posting: posting(5, 'Form'), text: 'Send the form', due: '2026-09-24', daysLate: 1, kind: 'task', amount: null }], bubbled: [thread(2, 'Newsletter', 40)] },
      needsReply: [{ ...thread(6, 'Early check-in?', 1), reason: 'asks about check-in' }],
      replyLater: [thread(3, 'Parked', 9)],
      waiting: [thread(4, 'Quote', 5)],
    })

  it('means what it should for where the thread is listed', async () => {
    const t = withEverything()
    for (const id of [5, 6, 4]) {
      calls.length = 0
      await Today.doneFor(t, id)!()
      expect(calls).toEqual([['markHandled', [id * 10]]]) // handled: you dealt with it, maybe outside HEY
    }
    calls.length = 0
    await Today.doneFor(t, 2)!()
    expect(calls).toEqual([['runAction', [{ type: 'unbubble', postingId: 2 }]]])
    calls.length = 0
    await Today.doneFor(t, 3)!()
    expect(calls).toEqual([['runAction', [{ type: 'move', postingId: 3, to: 'imbox' }]]])
    expect(Today.doneFor(t, 99)).toBeNull()
  })

  it('is on every thread row, beside Not now, and doesn’t open the thread', async () => {
    const onOpen = vi.fn()
    act(() => root.render(createElement(Today.TodayList, { today: withEverything(), selectedId: null, onOpen, onGoToBox: vi.fn() })))
    const rowOf = (s: string) => [...host.querySelectorAll('[role=option]')].find((r) => r.textContent?.includes(s))!
    const buttons = (r: Element) => [...r.querySelectorAll('button')].map((b) => b.textContent)
    expect(buttons(rowOf('Early check-in?'))).toEqual(['Done', 'Not now'])
    expect(buttons(rowOf('Send the form'))).toEqual(['Done'])
    calls.length = 0
    await click([...rowOf('Early check-in?').querySelectorAll('button')][0]!)
    expect(calls).toEqual([['markHandled', [60]]])
    expect(onOpen).not.toHaveBeenCalled()
  })
})

describe('What’s new, and nothing left', () => {
  it('lists the new mail itself, per box, and offers the rest of the box', async () => {
    const onGoToBox = vi.fn()
    const onOpen = vi.fn()
    const letter = { ...posting(7, 'Three new fonts', 'Design Weekly'), summary: 'This week in type', seen: false }
    const today = data({
      newSince: {
        since: '2026-09-25T06:00:00Z',
        boxes: [
          { boxId: 201228, kind: 'imbox', name: 'Imbox', count: 1, threads: [posting(6, 'Lunch Friday?', 'Sam')] },
          { boxId: 201229, kind: 'feedbox', name: 'The Feed', count: 12, threads: [letter] },
        ],
      },
    })
    act(() => root.render(createElement(Today.TodayList, { today, selectedId: null, onOpen, onGoToBox })))
    const sections = [...host.querySelectorAll('section')].map((s) => s.getAttribute('aria-label'))
    expect(sections.at(-1)).toBe('New')
    const block = host.querySelector('section[aria-label="New"]')!.textContent!
    expect(block).toContain('New since you last looked')
    expect(block).toContain('Imbox · 1')
    expect(block).toContain('Lunch Friday?')
    expect(block).toContain('Three new fonts')
    expect(block).toContain('Design Weekly – This week in type')
    // One shown of 12: the rest are in the box.
    expect(block).toContain('11 more in The Feed')
    expect(block).not.toContain('more in Imbox')
    await click([...host.querySelectorAll('section[aria-label="New"] [role=option]')].find((o) => o.textContent!.includes('Three new fonts'))!)
    expect(onOpen).toHaveBeenCalledWith(letter)
    await click([...host.querySelectorAll('section[aria-label="New"] button')].find((b) => b.textContent === '11 more in The Feed')!)
    expect(onGoToBox).toHaveBeenCalledWith(201229)
    // j/k reach the new mail after everything to handle.
    expect(Today.todayRows(today).map((p) => p.id).slice(-2)).toEqual([6, 7])
  })

  it('says you’re caught up, and still shows what’s new', () => {
    const today = data({ due: { todos: [], actions: [], bubbled: [] }, replyLater: [], waiting: [], toHandle: 0, newSince: { since: null, boxes: [{ boxId: 1, kind: 'imbox', name: 'Imbox', count: 1, threads: [posting(8, 'Hello')] }] } })
    act(() => root.render(createElement(Today.TodayList, { today, selectedId: null, onOpen: vi.fn(), onGoToBox: vi.fn() })))
    expect(text()).toContain('You’re caught up.')
    expect(text()).toContain('New today')
    expect(text()).toContain('Hello')
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
    // Each thread once, even when it has several deadlines.
    const twice = data({ due: { todos: [], actions: [{ key: 'a1', posting: posting(2, 'x'), text: 'a', due: '2026-09-24', daysLate: 1, kind: 'task', amount: null }, { key: 'a2', posting: posting(2, 'x'), text: 'b', due: '2026-09-25', daysLate: 0, kind: 'task', amount: null }], bubbled: [thread(2, 'x', 1)] } })
    expect(Today.todayThreads(twice).map((p) => p.id)).toEqual([2, 3, 4])
    expect(Today.todayThreads(null)).toEqual([])
  })
})
