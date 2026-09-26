// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReplyDraftRow, ThreadView } from '@shared/api'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const calls: Array<[string, unknown[]]> = []
const answers: Record<string, (args: unknown[]) => unknown> = {}
let Draft: typeof import('./DraftReply')
let Reply: typeof import('./ReplyArea')
beforeAll(async () => {
  window.bridge = { call: async (m, a) => (calls.push([m, a]), answers[m]?.(a) ?? null), onEvent: () => () => {} }
  Draft = await import('./DraftReply')
  Reply = await import('./ReplyArea')
})

let root: Root
let host: HTMLElement
beforeEach(() => {
  calls.length = 0
  for (const k of Object.keys(answers)) delete answers[k]
  localStorage.clear()
  // Shown before: no typing it out (that's tested on its own).
  localStorage.setItem('drafts:typed', JSON.stringify(['900:2026-09-26T08:00:00Z']))
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const draft = (over: Partial<ReplyDraftRow> = {}): ReplyDraftRow =>
  ({ topicId: 900, body: 'Hi Alice,\n\nFriday works. Shall we meet at [place]?\n\nWith warm regards,\nOliver', placeholders: ['[place]'], instruction: null, model: 'claude-sonnet-5', createdAt: '2026-09-26T08:00:00Z', stale: false, ...over }) as ReplyDraftRow

const alice = { name: 'Alice', email: 'alice@example.com', isMe: false }
const meP = { name: 'Oliver', email: 'me@hey.example', isMe: true }
const thread = (lastFromMe = false): ThreadView =>
  ({
    topicId: 900,
    subject: 'Lunch on Friday?',
    fetchedAt: '',
    entries: [{ id: 1, from: lastFromMe ? meP : alice, to: [lastFromMe ? alice : meP], cc: [], createdAt: '2026-09-25T10:00:00Z', bodyMd: 'Lunch?', isMine: lastFromMe, attachments: [] }],
  }) as unknown as ThreadView

const button = (name: string) => [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === name) as HTMLButtonElement | undefined
async function flush() {
  await act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve()
  })
}

describe('a draft reply', () => {
  it('shows the draft with its placeholders marked, and offers use, redraft and discard', () => {
    const onUse = vi.fn()
    const onRedraft = vi.fn()
    const onDiscard = vi.fn()
    act(() => root.render(createElement(Draft.DraftCard, { draft: draft(), onUse, onRedraft, onDiscard })))
    expect(host.textContent).toContain('Draft reply')
    expect(host.textContent).toContain('in your voice')
    expect(host.querySelector('mark')!.textContent).toBe('[place]')
    expect(host.textContent).toContain('Fill in before sending: [place]')
    act(() => button('Use draft')!.click())
    act(() => button('Redraft…')!.click())
    act(() => button('Discard')!.click())
    expect([onUse, onRedraft, onDiscard].map((f) => f.mock.calls.length)).toEqual([1, 1, 1])
  })

  it('types itself out the first time it’s shown, and a click shows it all', () => {
    localStorage.clear()
    act(() => root.render(createElement(Draft.DraftCard, { draft: draft({ createdAt: '2026-09-26T09:00:00Z' }), onUse: vi.fn(), onRedraft: vi.fn(), onDiscard: vi.fn() })))
    expect(host.querySelector('.type-caret')).toBeTruthy()
    act(() => (host.querySelector('[title="Show it all"]') as HTMLElement).click())
    expect(host.querySelector('.type-caret')).toBeNull()
    expect(host.textContent).toContain('With warm regards')
    expect(localStorage.getItem('drafts:typed')).toContain('900:2026-09-26T09:00:00Z')
  })

  it('says when it was written before the latest message, or what it was asked to say', () => {
    act(() => root.render(createElement(Draft.DraftCard, { draft: draft({ stale: true }), onUse: vi.fn(), onRedraft: vi.fn(), onDiscard: vi.fn() })))
    expect(host.textContent).toContain('written before the latest message')
    act(() => root.render(createElement(Draft.DraftCard, { draft: draft({ instruction: 'say yes' }), onUse: vi.fn(), onRedraft: vi.fn(), onDiscard: vi.fn() })))
    expect(host.textContent).toContain('“say yes”')
  })

  it('asks for a draft with an optional instruction, and shows why it couldn’t', async () => {
    const onDone = vi.fn()
    answers.draftReply = () => draft()
    act(() => root.render(createElement(Draft.DraftRequest, { thread: thread(), onDone, onCancel: vi.fn() })))
    const input = host.querySelector('input')!
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '  yes, but Friday  ')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => void host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    await flush()
    expect(calls).toContainEqual(['draftReply', [900, 'yes, but Friday']])
    expect(onDone).toHaveBeenCalled()

    answers.draftReply = () => {
      throw new Error('This month’s AI budget is used up.')
    }
    act(() => root.render(createElement(Draft.DraftRequest, { thread: thread(), onDone: vi.fn(), onCancel: vi.fn() })))
    await act(async () => void host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    await flush()
    expect(host.textContent).toContain('budget is used up')
  })
})

describe('the reply area with drafts', () => {
  it('opens a waiting draft in the composer, to the sender, and lets it go from the queue', async () => {
    answers.replyDraft = () => draft()
    act(() => root.render(createElement(Reply.ReplyArea, { thread: thread() })))
    await flush()
    act(() => button('Use draft')!.click())
    await flush()
    const box = host.querySelector('textarea') as HTMLTextAreaElement
    expect(box.value).toContain('Friday works')
    expect(calls).toContainEqual(['discardDraft', [900]])
  })

  it('offers “Draft reply” when there’s no draft, and hides one your own reply made moot', async () => {
    answers.replyDraft = () => null
    act(() => root.render(createElement(Reply.ReplyArea, { thread: thread() })))
    await flush()
    expect(button('Draft reply')).toBeTruthy()
    act(() => button('Draft reply')!.click())
    expect(host.querySelector('input[aria-label="What the reply should say"]')).toBeTruthy()

    act(() => root.unmount())
    root = createRoot(host)
    answers.replyDraft = () => draft({ stale: true })
    act(() => root.render(createElement(Reply.ReplyArea, { thread: thread(true) })))
    await flush()
    expect(host.textContent).not.toContain('Draft reply·')
    expect(button('Use draft')).toBeUndefined()
  })

  it('offers replies that fit the email, and checks the proposed time against the calendar', async () => {
    const onDone = vi.fn()
    answers.draftReply = () => draft()
    answers.analysis = () => ({ replyOptions: ['Yes, I’ll be there', 'Can’t make it, thank them'], dates: [{ label: 'MDA event', date: '2099-10-03', time: '09:00' }] })
    const at = (hm: string) => new Date(`2099-10-03T${hm}:00`).toISOString()
    answers.calendarRange = () => ({ calendars: [], events: [{ key: 'g', id: 1, title: 'Gym', startsAt: at('08:30'), endsAt: at('10:00'), allDay: false }] })
    act(() => root.render(createElement(Draft.DraftRequest, { thread: thread(), onDone, onCancel: vi.fn() })))
    await flush()
    await flush()
    expect(host.textContent).toContain('clashes with Gym')
    await act(async () => button('Yes, I’ll be there')!.click())
    await flush()
    expect(calls).toContainEqual(['draftReply', [900, 'Yes, I’ll be there']])
    expect(onDone).toHaveBeenCalled()
    delete answers.analysis
    delete answers.calendarRange
  })
})
