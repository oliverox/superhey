// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { PostingRow, ThreadAnalysisView } from '@shared/api'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
Element.prototype.scrollIntoView = () => {}

let answer: ThreadAnalysisView | null = null
let Panel: typeof import('./ContextPanel')
let Lists: typeof import('./Lists')
beforeAll(async () => {
  window.bridge = { call: async (m) => (m === 'analysis' ? answer : null), onEvent: () => () => {} }
  Panel = await import('./ContextPanel')
  Lists = await import('./Lists')
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
const flush = () => act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve() })

const analysis = (over: Partial<ThreadAnalysisView> = {}): ThreadAnalysisView => ({
  summary: 'Alice asks if you’re free for lunch on Friday',
  needsReply: true,
  replyReason: 'asks if Friday works',
  expectsReply: false,
  category: 'personal',
  actionItems: [{ text: 'Answer Alice about lunch', due: '2020-01-03' }, { text: 'Book a table', due: null }],
  dates: [{ label: 'Lunch', date: '2026-09-26', time: '12:30' }],
  amounts: [{ label: 'Deposit', amount: 20, currency: 'EUR' }],
  analyzedAt: '2026-09-25T10:00:00Z',
  model: 'claude-haiku-4-5',
  ...over,
})

describe('the Summary in the details panel', () => {
  it('shows what the thread is about, that it needs you and why, what to do and the facts', async () => {
    answer = analysis()
    act(() => root.render(createElement(Panel.Understanding, { topicId: 900 })))
    await flush()
    const text = host.textContent!
    expect(text).toContain('Alice asks if you’re free for lunch on Friday')
    expect(text).toContain('Needs your reply: asks if Friday works')
    expect([...host.querySelectorAll('[aria-label="Action items"] li')].map((li) => li.textContent)).toEqual([
      `Answer Alice about lunch${new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(2020, 0, 3))}`,
      'Book a table',
    ])
    expect(host.querySelector('[aria-label="Action items"] .text-danger')).not.toBeNull() // overdue
    expect(text).toContain('Lunch')
    expect(text).toContain(', 12:30')
    expect(text).toContain(new Intl.NumberFormat(undefined, { style: 'currency', currency: 'EUR' }).format(20))
  })

  it('says when you’re the one waiting, and shows nothing before the thread is read', async () => {
    answer = analysis({ needsReply: false, replyReason: null, expectsReply: true, actionItems: [], dates: [], amounts: [] })
    act(() => root.render(createElement(Panel.Understanding, { topicId: 900 })))
    await flush()
    expect(host.textContent).toContain('You asked; waiting on their answer.')
    expect(host.textContent).not.toContain('Needs your reply')
    answer = null
    act(() => root.render(createElement(Panel.Understanding, { topicId: 901 })))
    await flush()
    expect(host.textContent).toBe('')
  })
})

describe('list rows', () => {
  const row = (over: Partial<PostingRow>) =>
    ({ id: 1, topicId: 9, boxId: 1, subject: 'Lunch on Friday?', summary: 'Are you free for lunch on…', senderName: 'Alice', senderEmail: 'a@x', seen: false, bubbledUp: false, entryCount: 1, hasAttachments: false, isBundle: false, activeAt: '2026-09-25T09:00:00Z', appUrl: null, labels: [], avatar: { url: null, color: null, initials: 'A' }, blockedTrackers: false, bundleCount: null, ai: null, ...over }) as PostingRow

  it('show the AI’s summary instead of HEY’s opening words, and Reply when a thread needs you', () => {
    act(() => root.render(createElement(Lists.PostingList, { postings: [row({ ai: { summary: 'Alice asks about Friday lunch', needsReply: true, replyReason: 'asks if Friday works', expectsReply: false, category: 'personal' } })], loading: false, selectedId: null, onOpen: () => {} })))
    const li = host.querySelector('[role=option]')!
    expect(li.textContent).toContain('ReplyAlice – Alice asks about Friday lunch')
    expect(li.textContent).not.toContain('Are you free')
  })

  it('show HEY’s opening words before the thread is read, and no Reply', () => {
    act(() => root.render(createElement(Lists.PostingList, { postings: [row({})], loading: false, selectedId: null, onOpen: () => {} })))
    expect(host.querySelector('[role=option]')!.textContent).toContain('Alice – Are you free for lunch on…')
    expect(host.textContent).not.toContain('Reply')
  })
})
