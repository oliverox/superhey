// @vitest-environment jsdom
import { act, createElement, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PostingRow } from '@shared/api'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
Element.prototype.scrollIntoView = () => {}

let Lists: typeof import('./Lists')
beforeAll(async () => {
  window.bridge = { call: async () => null, onEvent: () => () => {} }
  Lists = await import('./Lists')
})

let root: Root
let host: HTMLElement
beforeEach(() => {
  localStorage.clear()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const row = (id: number, subject: string, seen: boolean): PostingRow =>
  ({ id, topicId: id * 10, boxId: 1, subject, seen, bubbledUp: false, senderName: 'Sam', senderEmail: 's@example.com', summary: null, activeAt: '2026-09-20T10:00:00Z', labels: [], avatar: { url: null, color: null, initials: 'S' }, ai: null }) as unknown as PostingRow

const rows = [row(1, 'Lunch Friday?', false), row(2, 'Invoice', true), row(3, 'Old news', true)]

/** The list as App uses it: groups folded with useCollapsedGroups for box 7. */
function Box({ box = 7 }: { box?: number }) {
  const { collapsed, toggle } = Lists.useCollapsedGroups(box)
  const [, force] = useState(0)
  return createElement('div', { onClick: () => force((n) => n + 1) }, createElement(Lists.PostingList, { postings: rows, loading: false, selectedId: null, onOpen: vi.fn(), collapsed, onToggleGroup: toggle }))
}

const heading = (name: string) => [...host.querySelectorAll('button[aria-expanded]')].find((b) => b.textContent?.includes(name)) as HTMLButtonElement
const subjects = () => [...host.querySelectorAll('[role=option]')].map((o) => o.textContent)

describe('folding a box’s groups', () => {
  it('hides a group’s rows behind its heading, with a count, and brings them back', () => {
    act(() => root.render(createElement(Box)))
    expect(subjects()).toHaveLength(3)
    act(() => heading('Previously seen').click())
    expect(heading('Previously seen').getAttribute('aria-expanded')).toBe('false')
    expect(heading('Previously seen').textContent).toContain('· 2')
    expect(subjects().join()).toContain('Lunch Friday?')
    expect(subjects().join()).not.toContain('Invoice')
    act(() => heading('Previously seen').click())
    expect(subjects()).toHaveLength(3)
  })

  it('remembers what’s folded per box', () => {
    act(() => root.render(createElement(Box)))
    act(() => heading('New for you').click())
    act(() => root.render(createElement(Box, { box: 8 })))
    expect(subjects()).toHaveLength(3)
    act(() => root.render(createElement(Box, { box: 7 })))
    expect(heading('New for you').getAttribute('aria-expanded')).toBe('false')
    expect(subjects()).toHaveLength(2)
  })
})

describe('an email opened while new', () => {
  it('stays in New for you, unbolded, until another is opened', () => {
    const at = (r: PostingRow, activeAt: string) => ({ ...r, activeAt }) as PostingRow
    // Opened and marked seen: the cache now sorts it among the seen.
    const list = [at(row(4, 'Still new', false), '2026-09-20T09:00:00Z'), at(row(1, 'Just opened', true), '2026-09-20T10:00:00Z'), at(row(2, 'Invoice', true), '2026-09-19T10:00:00Z')]
    const held = Lists.inGroupOrder(list, 1)
    expect(held.map((p) => [p.subject, Lists.groupOf(p, 1)])).toEqual([
      ['Just opened', 'New for you'],
      ['Still new', 'New for you'],
      ['Invoice', 'Previously seen'],
    ])
    expect(Lists.inGroupOrder(list, null)).toBe(list)
    expect(Lists.groupOf(list[1]!)).toBe('Previously seen')
  })
})
