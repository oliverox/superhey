import { describe, expect, it, vi } from 'vitest'
import type { BoxRow, PostingRow } from '@shared/api'
import type { ShortcutId } from '../shortcuts'
import { rank } from './model'
import { boxCommands, emailCommand, labelCommands, shortcutCommands } from './sources'

const posting = (over: Partial<PostingRow> = {}): PostingRow =>
  ({
    id: 7,
    topicId: 70,
    boxId: 1,
    subject: 'Payout failed',
    summary: null,
    senderName: 'Stripe',
    senderEmail: 'notifications@stripe.com',
    seen: true,
    bubbledUp: false,
    entryCount: 1,
    hasAttachments: false,
    isBundle: false,
    activeAt: '2026-09-22T10:00:00Z',
    appUrl: null,
    labels: [],
    avatar: { url: null, color: null, initials: 'S' },
    blockedTrackers: false,
    bundleCount: null,
    ...over,
  }) as PostingRow

describe('shortcutCommands', () => {
  it('offers only what is available right now, and runs it by its shortcut', () => {
    const available = new Set<ShortcutId>(['replyLater', 'trash', 'compose', 'screener', 'palette', 'nextThread', 'box1'])
    const run = vi.fn()
    const list = shortcutCommands((id) => available.has(id), run)
    // The bar itself, list movement and box keys aren't commands.
    expect(list.map((c) => c.id)).toEqual(['key:replyLater', 'key:trash', 'key:compose', 'key:screener'])
    expect(list.find((c) => c.id === 'key:trash')).toMatchObject({ title: 'Move to Trash', section: 'Actions', keys: ['#'] })
    expect(list.find((c) => c.id === 'key:compose')?.section).toBe('App')
    expect(list.find((c) => c.id === 'key:screener')?.section).toBe('Go to')
    list[0]!.run()
    expect(run).toHaveBeenCalledWith('replyLater')
    expect(list.map((c) => c.icon)).toEqual(['action', 'action', 'app', 'box'])
  })

  it('answers to other words: "delete" finds Move to Trash', () => {
    const list = shortcutCommands(() => true, vi.fn())
    expect(rank('delete', list)[0]?.command.title).toBe('Move to Trash')
    expect(rank('dark', list)[0]?.command.title).toBe('Switch theme')
  })
})

describe('boxCommands', () => {
  it('lists the boxes with their number keys, and goes to the box', () => {
    const boxes = [
      { id: 11, kind: 'imbox', name: 'Imbox', unseen: 0 },
      { id: 12, kind: 'feedbox', name: 'The Feed', unseen: 0 },
    ] as BoxRow[]
    const go = vi.fn()
    const list = boxCommands(boxes, go)
    expect(list.map((c) => [c.title, c.keys, c.section])).toEqual([
      ['Imbox', ['1'], 'Go to'],
      ['The Feed', ['2'], 'Go to'],
    ])
    list[1]!.run()
    expect(go).toHaveBeenCalledWith(12)
  })
})

describe('labelCommands', () => {
  const labels = [
    { id: 1, name: 'Travel' },
    { id: 2, name: 'Receipts' },
  ]

  it('adds the labels a thread lacks and removes the ones it has', () => {
    const toggle = vi.fn()
    const list = labelCommands(labels, posting({ labels: ['Receipts'] }), toggle)
    expect(list.map((c) => c.title)).toEqual(['Label Travel', 'Remove label Receipts'])
    list[0]!.run()
    list[1]!.run()
    expect(toggle.mock.calls).toEqual([
      [1, true],
      [2, false],
    ])
  })

  it('offers none without an open thread, or for a bundle', () => {
    expect(labelCommands(labels, null, vi.fn())).toEqual([])
    expect(labelCommands(labels, posting({ isBundle: true }), vi.fn())).toEqual([])
  })
})

describe('emailCommand', () => {
  it('is found by subject, sender, or both in either order, and opens the email', () => {
    const open = vi.fn()
    const p = posting()
    const c = emailCommand(p, open)
    expect(c).toMatchObject({ id: 'email:7', section: 'Emails', title: 'Payout failed' })
    expect(c.detail).toMatch(/^Stripe · /)
    for (const q of ['payout', 'stripe', 'stripe payout', 'payout stripe', 'stripe.com']) expect(rank(q, [c])).toHaveLength(1)
    c.run()
    expect(open).toHaveBeenCalledWith(p)
  })
})
