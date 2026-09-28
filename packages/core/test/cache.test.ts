import { describe, expect, it } from 'vitest'
import { openDb } from '../src/cache/db'
import { Repo } from '../src/cache/repo'
import * as S from '../src/cli/schemas'
import { normalizeUtc } from '../src/cli/schemas'
import { PostingId, TopicId } from '../src/ids'
import { alice, entry, me, posting } from './fixtures'

const repo = () => new Repo(openDb(':memory:'))
const P = (over: Record<string, unknown> = {}) => S.Posting.parse(posting(over))

describe('Repo postings', () => {
  it('treats an absent seen flag as unseen and orders like the Imbox', () => {
    const r = repo()
    r.upsertPostings([
      P({ id: 1, seen: true, active_at: '2026-09-23T00:00:00Z' }),
      P({ id: 2, active_at: '2026-09-21T00:00:00Z' }),
      P({ id: 3, active_at: '2026-09-22T00:00:00Z' }),
      P({ id: 4, seen: true, bubbled_up: true, active_at: '2026-01-01T00:00:00Z' }),
    ])
    expect(r.postings(1).map((p) => [p.id, p.seen])).toEqual([
      [4, true],
      [3, false],
      [2, false],
      [1, true],
    ])
  })

  it('upserts in place and marks bundles', () => {
    const r = repo()
    r.upsertPostings([P({ name: 'Old subject' })])
    r.upsertPostings([P({ name: 'New subject' }), P({ id: 101, topic_id: null, name: 'A • B' })])
    expect(r.postingCount(1)).toBe(2)
    expect(r.posting(PostingId(100))?.subject).toBe('New subject')
    expect(r.posting(PostingId(101))).toMatchObject({ isBundle: true, topicId: null })
  })

  it('exposes label names', () => {
    const r = repo()
    r.upsertPostings([P({ folders: [{ id: 1, name: 'Travel' }, { id: 2, name: 'Receipts' }] })])
    expect(r.posting(PostingId(100))?.labels).toEqual(['Travel', 'Receipts'])
  })

  it("exposes the sender's avatar and the tracker flag, with initials as a fallback", () => {
    const r = repo()
    r.upsertPostings([
      P({
        blocked_trackers: true,
        creator: { ...alice, avatar_url: 'https://app.hey.com/avatars/x', avatar_background_color: '#FF7182', initials: 'AE' },
      }),
      P({ id: 101, creator: { id: 12, name: 'Bea Lin', email_address: 'bea@example.com' } }),
    ])
    expect(r.posting(PostingId(100))).toMatchObject({
      avatar: { url: 'https://app.hey.com/avatars/x', color: '#FF7182', initials: 'AE' },
      blockedTrackers: true,
    })
    expect(r.posting(PostingId(101))).toMatchObject({ avatar: { url: null, color: null, initials: 'BL' }, blockedTrackers: false })
  })

  it('knows which calendars take new events: yours, not feeds or HEY’s own lists', () => {
    const r = repo()
    r.replaceCalendars([
      S.Calendar.parse({ id: 1, kind: 'normal', name: null, personal: true }),
      S.Calendar.parse({ id: 2, kind: 'maybe', name: 'Maybe', owned: true }),
      S.Calendar.parse({ id: 3, kind: 'normal', name: 'Personal', owned: true }),
      S.Calendar.parse({ id: 4, kind: 'normal', name: 'Google', owned: true, external: true }),
    ])
    expect(r.calendars().map((c) => [c.id, c.writable])).toEqual([
      [1, false],
      [2, false],
      [3, true],
      [4, false],
    ])
  })

  it('names a thread by its own email, not by a bundle that shares it', () => {
    const r = repo()
    const stripe = { id: 51, name: 'Stripe', email_address: 'notify@stripe.com' }
    r.upsertPostings([
      P({ id: 1, kind: 'bundle', topic_id: 950, name: 'Payment received • Provide a tax ID • Instant Payouts', creator: stripe, active_at: '2026-09-26T06:01:00Z' }),
      P({ id: 2, kind: 'topic', topic_id: 950, name: 'Payment received', creator: stripe, active_at: '2026-09-26T06:01:00Z' }),
    ])
    // Cached earlier with the bundle's name: read back with the thread's own.
    r.storeThread(TopicId(950), [S.Entry.parse(entry())], 'Payment received • Provide a tax ID • Instant Payouts')
    expect(r.thread(TopicId(950))?.subject).toBe('Payment received')
  })

  it('lists a bundle once and hides the mail it holds, read or not, as HEY does', () => {
    const r = repo()
    const wise = { id: 50, name: 'Wise', email_address: 'noreply@wise.com' }
    r.upsertPostings([
      P({ id: 1, kind: 'bundle', topic_id: 901, name: 'Money received', creator: wise, active_at: '2026-09-24T13:24:00Z' }),
      P({ id: 2, kind: 'topic', topic_id: 901, name: 'Money received', creator: wise, active_at: '2026-09-24T13:24:00Z' }),
      P({ id: 3, kind: 'topic', topic_id: 902, name: 'Old statement', creator: wise, seen: true, active_at: '2026-09-01T00:00:00Z' }),
      P({ id: 4, name: 'Lunch', active_at: '2026-09-23T00:00:00Z' }),
    ])
    const rows = r.postings(1)
    expect(rows.map((p) => [p.id, p.isBundle, p.bundleCount])).toEqual([
      [1, true, 1], // "1 new": the unread one
      [4, false, null],
      // The read statement is in the bundle too (HEY lists only the bundle).
    ])
    r.replaceBoxes([{ id: 1, kind: 'imbox', name: 'Imbox' }])
    expect(r.boxes().find((b) => b.id === 1)?.unseen).toBe(2) // the bundle and Lunch
    expect(r.posting(PostingId(2))).not.toBeNull() // hidden from the list, still openable
  })

  it("doesn't take a posting without a thread for a bundle when HEY says what it is", () => {
    // A HEY World post of your own has no thread; it once hid all your unread mail as a "bundle".
    const r = repo()
    r.upsertPostings([
      P({ id: 1, kind: 'world/post', topic_id: null, name: 'Good Software Is Still Hard', creator: me, seen: true }),
      P({ id: 2, kind: 'topic', topic_id: 902, name: 'Test send', creator: me, active_at: '2026-09-24T17:48:00Z' }),
    ])
    expect(r.posting(PostingId(1))?.isBundle).toBe(false)
    expect(r.postings(1).map((p) => p.id)).toEqual([2, 1])
    r.upsertPostings([P({ id: 1, kind: 'world/post', topic_id: null, name: 'Good Software Is Still Hard', creator: me, seen: true })])
    expect(r.posting(PostingId(1))?.isBundle).toBe(false) // the update path too
  })

  it('finds emails by every word of subject and sender, newest first, once per thread', () => {
    const r = repo()
    const stripe = { id: 60, name: 'Stripe', email_address: 'notifications@stripe.com' }
    r.upsertPostings([
      P({ id: 1, topic_id: 901, name: 'Your payout is on the way', creator: stripe, active_at: '2026-09-20T00:00:00Z' }),
      P({ id: 2, topic_id: 902, name: 'Payout failed', creator: stripe, active_at: '2026-09-22T00:00:00Z' }),
      P({ id: 3, topic_id: 902, name: 'Payout failed', creator: stripe, active_at: '2026-09-21T00:00:00Z' }), // same thread, older
      P({ id: 4, topic_id: 903, name: 'Lunch payout?', creator: alice, active_at: '2026-09-23T00:00:00Z' }),
      P({ id: 5, kind: 'bundle', topic_id: null, name: 'Payout • Payout', creator: stripe }),
      P({ id: 6, topic_id: 904, name: '100% off_today', creator: alice }),
    ])
    expect(r.findPostings('payout').map((p) => p.id)).toEqual([4, 2, 1])
    expect(r.findPostings('stripe PAYOUT').map((p) => p.id)).toEqual([2, 1]) // sender and subject
    expect(r.findPostings('stripe.com way').map((p) => p.id)).toEqual([1]) // the address counts
    expect(r.findPostings('payout', 1).map((p) => p.id)).toEqual([4])
    expect(r.findPostings('   ')).toEqual([])
    // LIKE's wildcards are taken literally.
    expect(r.findPostings('100%').map((p) => p.id)).toEqual([6])
    expect(r.findPostings('f_t').map((p) => p.id)).toEqual([6])
    expect(r.findPostings('%')).toHaveLength(1)
  })

  it('prefers the alternative sender name', () => {
    const r = repo()
    r.upsertPostings([P({ alternative_sender_name: 'Example Newsletter' })])
    expect(r.posting(PostingId(100))).toMatchObject({ senderName: 'Example Newsletter', senderEmail: 'alice@example.com' })
  })

  it('lists other recent threads from a sender, once each, newest first', () => {
    const r = repo()
    r.upsertPostings([
      P({ id: 1, topic_id: 10, active_at: '2026-09-01T00:00:00Z' }),
      P({ id: 2, topic_id: 11, active_at: '2026-09-03T00:00:00Z' }),
      P({ id: 3, topic_id: 11, box_id: 2, active_at: '2026-09-02T00:00:00Z' }), // same thread, another box
      P({ id: 4, topic_id: 12, active_at: '2026-09-04T00:00:00Z' }), // the open thread
      P({ id: 5, topic_id: 13, creator: { ...alice, email_address: 'bob@example.com' } }),
    ])
    expect(r.postingsFromSender('Alice@Example.com', TopicId(12)).map((p) => p.id)).toEqual([2, 1])
    expect(r.postingsFromSender('alice@example.com', null, 1).map((p) => p.id)).toEqual([4])
  })

  it('falls back to the given box id', () => {
    const r = repo()
    r.upsertPostings([P({ box_id: null })], 7)
    expect(r.postings(7)).toHaveLength(1)
  })
})

describe('Repo threads', () => {
  it('stores entries, marks my own, and searches them', () => {
    const r = repo()
    r.replaceMyAddresses(['ME@hey.example'])
    r.storeThread(
      TopicId(900),
      [
        S.Entry.parse(entry()),
        S.Entry.parse(entry({ id: 5001, creator: me, body: 'Friday works. See you at noon.', created_at: '2026-09-20T11:00:00Z' })),
      ],
      'Lunch on Friday?',
    )
    const t = r.thread(TopicId(900))!
    expect(t.entries.map((e) => e.isMine)).toEqual([false, true])
    expect(t.entries[0]).toMatchObject({
      from: { name: 'Alice Example', email: 'alice@example.com', isMe: false },
      to: [{ name: 'Me', email: 'me@hey.example', isMe: true }],
    })
    expect(r.search('harb').map((h) => h.entryId)).toEqual([5000])
    expect(r.search('"quoted')).toEqual([])
  })

  it('uses sender over creator when HEY recorded one', () => {
    const r = repo()
    const other = { ...alice, id: 12, name: 'Real Sender', email_address: 'real@example.com' }
    r.storeThread(TopicId(900), [S.Entry.parse(entry({ sender: other }))], null)
    expect(r.thread(TopicId(900))!.entries[0]!.from?.email).toBe('real@example.com')
  })

  it('replaces a thread on refetch without duplicating search rows', () => {
    const r = repo()
    r.storeThread(TopicId(900), [S.Entry.parse(entry())], 's')
    r.storeThread(TopicId(900), [S.Entry.parse(entry())], 's')
    expect(r.search('harbour')).toHaveLength(1)
  })

  it('reads recipients stored by older versions as bare addresses', () => {
    const r = repo()
    r.replaceMyAddresses(['me@hey.example'])
    r.storeThread(TopicId(900), [S.Entry.parse(entry())], 's')
    r.db.prepare('UPDATE entries SET recipients_json = ?').run(JSON.stringify({ to: ['Me@hey.example'], cc: [] }))
    expect(r.thread(TopicId(900))!.entries[0]!.to).toEqual([{ name: null, email: 'me@hey.example', isMe: true }])
  })

  it('knows when a thread is stale', () => {
    const r = repo()
    expect(r.threadIsStale(TopicId(900), 1)).toBe(true)
    r.storeThread(TopicId(900), [S.Entry.parse(entry())], 's')
    expect(r.threadIsStale(TopicId(900), 1)).toBe(false)
    expect(r.threadIsStale(TopicId(900), 2)).toBe(true)
  })
})

describe('Repo events', () => {
  const ev = (id: number, starts_at: string) =>
    S.CalendarEvent.parse({ id, title: `e${id}`, starts_at, ends_at: starts_at, calendar: { id: 3 } })

  it('replaces events inside the window only', () => {
    const r = repo()
    r.replaceEvents('2026-09-01T00:00:00Z', '2026-12-31T00:00:00Z', [
      ev(1, '2026-09-20T09:00:00Z'),
      ev(2, '2026-09-25T09:00:00Z'),
      ev(3, '2026-10-10T09:00:00Z'),
    ])
    r.replaceEvents('2026-09-20T00:00:00Z', '2026-09-27T00:00:00Z', [ev(2, '2026-09-25T09:00:00Z')])
    expect(r.events('2026-01-01T00:00:00Z', '2027-01-01T00:00:00Z').map((e) => e.id)).toEqual([2, 3])
  })
})

describe('timestamps', () => {
  it('treats zone-less CLI times as UTC', () => {
    expect(normalizeUtc('2026-08-13T07:21')).toBe('2026-08-13T07:21:00Z')
    expect(normalizeUtc('2026-08-13T07:21:14.5')).toBe('2026-08-13T07:21:14.5Z')
    expect(normalizeUtc('2026-08-13T07:21:14.564656Z')).toBe('2026-08-13T07:21:14.564656Z')
    expect(normalizeUtc('2026-08-13T11:21:00+04:00')).toBe('2026-08-13T11:21:00+04:00')
    expect(normalizeUtc('not a date')).toBe('not a date')
  })

  it('stores entry times with their zone and fixes older rows on read', () => {
    const r = repo()
    r.storeThread(TopicId(900), [S.Entry.parse(entry({ created_at: '2026-08-13T07:21' }))], 's')
    expect(r.thread(TopicId(900))!.entries[0]!.createdAt).toBe('2026-08-13T07:21:00Z')
    r.db.prepare("UPDATE entries SET created_at = '2026-08-13T07:22'").run()
    expect(r.thread(TopicId(900))!.entries[0]!.createdAt).toBe('2026-08-13T07:22:00Z')
  })
})
