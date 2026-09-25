import { describe, expect, it } from 'vitest'
import { openDb } from '../src/cache/db'
import { Repo } from '../src/cache/repo'
import * as S from '../src/cli/schemas'
import { buildToday, type TodayInput } from '../src/today/today'
import { alice, me, posting } from './fixtures'

const BOX = { imbox: 1, feedbox: 2, trailbox: 3, laterbox: 4, asidebox: 5, bubblebox: 6 } as const
const NOW = new Date(2026, 8, 25, 12, 0) // 25 Sep, midday, local time
const daysAgo = (d: number, hours = 0) => new Date(NOW.getTime() - d * 86_400_000 - hours * 3_600_000).toISOString()
const bob = { id: 12, name: 'Bob', email_address: 'bob@example.com', contactable_type: 'Person' }

function setup() {
  const repo = new Repo(openDb(':memory:'))
  repo.replaceBoxes(Object.entries(BOX).map(([kind, id]) => ({ id, kind, name: kind })))
  const put = (box: keyof typeof BOX, over: Record<string, unknown>) => repo.upsertPostings([S.Posting.parse(posting({ box_id: BOX[box], ...over }))])
  return { repo, put }
}

const input = (over: Partial<TodayInput> = {}): TodayInput => ({ now: NOW, myEmails: ['me@hey.example'], since: null, hidden: {}, ...over })
const ids = (items: Array<{ posting: { id: number } }>) => items.map((i) => i.posting.id)

describe('Today', () => {
  it('lists Reply Later oldest first, with how long each has waited', () => {
    const { repo, put } = setup()
    put('laterbox', { id: 1, topic_id: 91, active_at: daysAgo(2), seen: true })
    put('laterbox', { id: 2, topic_id: 92, active_at: daysAgo(9), seen: true })
    const t = buildToday(repo, input())
    expect(ids(t.replyLater)).toEqual([2, 1])
    expect(t.replyLater.map((i) => i.days)).toEqual([9, 2])
  })

  it('lists threads bubbled up now as due', () => {
    const { repo, put } = setup()
    put('imbox', { id: 3, topic_id: 93, bubbled_up: true, active_at: daysAgo(40), seen: true })
    put('imbox', { id: 4, topic_id: 94, active_at: daysAgo(1) })
    expect(ids(buildToday(repo, input()).due.bubbled)).toEqual([3])
  })

  it('finds threads where you sent the latest message 3–30 days ago, to someone else', () => {
    const { repo, put } = setup()
    const fromMe = { creator: me, contacts: [me, alice], seen: true }
    put('imbox', { id: 10, topic_id: 910, active_at: daysAgo(5), ...fromMe }) // waiting
    put('imbox', { id: 11, topic_id: 911, active_at: daysAgo(1), ...fromMe }) // too recent
    put('imbox', { id: 12, topic_id: 912, active_at: daysAgo(45), ...fromMe }) // long settled
    put('imbox', { id: 13, topic_id: 913, active_at: daysAgo(6), creator: alice, contacts: [me, alice], seen: true }) // they answered
    put('imbox', { id: 14, topic_id: 914, active_at: daysAgo(6), creator: me, contacts: [me], seen: true }) // a note to yourself
    put('trailbox', { id: 15, topic_id: 915, active_at: daysAgo(6), ...fromMe }) // filed away
    put('imbox', { id: 16, topic_id: 916, active_at: daysAgo(8), creator: { ...me, email_address: 'ME@HEY.example' }, contacts: [me, bob], seen: true }) // case
    put('imbox', { id: 17, topic_id: 917, active_at: daysAgo(5), name: 'Fwd: The report', visible_entry_count: 1, ...fromMe }) // just your forward: for their information
    put('imbox', { id: 18, topic_id: 918, active_at: daysAgo(5), name: 'TR: Le rapport', visible_entry_count: 1, ...fromMe }) // same, in French
    put('imbox', { id: 19, topic_id: 919, active_at: daysAgo(4), name: 'Fwd: The report', visible_entry_count: 3, ...fromMe }) // a forward they answered, and you again
    const t = buildToday(repo, input())
    expect(ids(t.waiting)).toEqual([16, 10, 19])
    expect(t.waiting.map((i) => i.days)).toEqual([8, 5, 4])
    // Each says who you're waiting on (never you).
    expect(t.waiting.map((i) => i.people!.map((p) => p.email))).toEqual([['bob@example.com'], ['alice@example.com'], ['alice@example.com']])
    expect(t.waiting[1]!.people![0]).toMatchObject({ name: 'Alice Example', avatar: { initials: 'AE' } })
    // Without your addresses there's nothing to go on.
    expect(buildToday(repo, input({ myEmails: [] })).waiting).toEqual([])
  })

  it('shows each thread once, in the first section that claims it', () => {
    const { repo, put } = setup()
    // Parked in Reply Later, sent by you a week ago, and bubbled up: it's due.
    put('laterbox', { id: 20, topic_id: 920, active_at: daysAgo(7), creator: me, contacts: [me, alice], bubbled_up: true, seen: true })
    const t = buildToday(repo, input())
    expect(ids(t.due.bubbled)).toEqual([20])
    expect(t.replyLater).toEqual([])
    expect(t.waiting).toEqual([])
    expect(t.toHandle).toBe(1)
  })

  it('lists to-dos overdue or for today, not done ones or later ones, by calendar day', () => {
    const { repo } = setup()
    repo.replaceTodos([
      { id: 1, title: 'File the declaration', starts_at: '2026-09-22T00:00:00Z' },
      { id: 2, title: 'Pick up flyers', starts_at: '2026-09-25T00:00:00Z' },
      { id: 3, title: 'Tomorrow’s thing', starts_at: '2026-09-26T00:00:00Z' },
      { id: 4, title: 'Done already', starts_at: '2026-09-20T00:00:00Z', completed_at: '2026-09-21T09:00:00Z' },
      { id: 5, title: 'Someday', starts_at: null },
    ])
    const t = buildToday(repo, input())
    expect(t.due.todos.map((i) => [i.todo.title, i.daysLate])).toEqual([
      ['File the declaration', 3],
      ['Pick up flyers', 0],
    ])
  })

  it('shows the day’s events', () => {
    const { repo } = setup()
    const at = (h: number, day = 25) => new Date(2026, 8, day, h).toISOString()
    repo.replaceEvents(new Date(2026, 8, 20).toISOString(), new Date(2026, 9, 5).toISOString(), [
      { id: 1, title: 'Gym', starts_at: at(8), ends_at: at(9) },
      { id: 2, title: 'Treasury meeting', starts_at: at(22), ends_at: at(23) },
      { id: 3, title: 'Tomorrow', starts_at: at(10, 26), ends_at: at(11, 26) },
      { id: 4, title: 'Yesterday', starts_at: at(10, 24), ends_at: at(11, 24) },
    ])
    expect(buildToday(repo, input()).events.map((e) => e.title)).toEqual(['Gym', 'Treasury meeting'])
  })

  it('counts new unread mail per box since you last looked', () => {
    const { repo, put } = setup()
    put('imbox', { id: 30, topic_id: 930, active_at: daysAgo(0, 2) })
    put('imbox', { id: 31, topic_id: 931, active_at: daysAgo(0, 30) })
    put('feedbox', { id: 32, topic_id: 932, active_at: daysAgo(0, 1) })
    put('imbox', { id: 33, topic_id: 933, active_at: daysAgo(0, 1), seen: true })
    const counts = (since: string | null) => buildToday(repo, input({ since })).newSince.boxes.map((b) => [b.kind, b.count])
    expect(counts(daysAgo(0, 5))).toEqual([
      ['imbox', 1],
      ['feedbox', 1],
    ])
    // The first time: what came in today, not every unread email ever.
    put('trailbox', { id: 34, topic_id: 934, active_at: daysAgo(90) })
    expect(counts(null)).toEqual([
      ['imbox', 1],
      ['feedbox', 1],
    ])
  })

  it('keeps an item put off with "not now" away until its thread changes', () => {
    const { repo, put } = setup()
    put('laterbox', { id: 40, topic_id: 940, active_at: daysAgo(4), seen: true })
    const hidden = { 'thread:40': daysAgo(4) }
    expect(buildToday(repo, input({ hidden })).replyLater).toEqual([])
    expect(buildToday(repo, input({ hidden })).toHandle).toBe(0)
    // A new message in the thread brings it back.
    put('laterbox', { id: 40, topic_id: 940, active_at: daysAgo(0, 1), seen: true })
    expect(ids(buildToday(repo, input({ hidden })).replyLater)).toEqual([40])
  })

  it('counts what’s yours to handle', () => {
    const { repo, put } = setup()
    put('laterbox', { id: 50, topic_id: 950, active_at: daysAgo(3), seen: true })
    put('imbox', { id: 51, topic_id: 951, active_at: daysAgo(4), creator: me, contacts: [me, alice], seen: true })
    repo.replaceTodos([{ id: 9, title: 'Call Bob', starts_at: '2026-09-24T00:00:00Z' }])
    expect(buildToday(repo, input()).toHandle).toBe(3)
  })
})
