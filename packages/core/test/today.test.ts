import { describe, expect, it } from 'vitest'
import { ANALYSIS_VERSION } from '../src/ai/analysis'
import { openDb } from '../src/cache/db'
import { Repo } from '../src/cache/repo'
import * as S from '../src/cli/schemas'
import { buildToday, clashWith, itemKey, type TodayInput } from '../src/today/today'
import { alice, me, posting } from './fixtures'
import { PostingId, TopicId } from '../src/ids'

/** Records what the AI made of a thread, as of its latest activity. */
function analyse(repo: Repo, topicId: number, activeAt: string, a: Record<string, unknown> = {}, version = ANALYSIS_VERSION) {
  const full = { summary: 's', needsReply: false, replyReason: null, expectsReply: false, category: 'personal', actionItems: [], dates: [], amounts: [], ...a }
  repo.saveAnalysis(TopicId(topicId), activeAt, 'claude', 'claude-haiku-4-5', full as never, version)
}

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

  it('lists waiting on others only where your last message asked for something', () => {
    const { repo, put } = setup()
    const fromMe = { creator: me, contacts: [me, alice], seen: true }
    put('imbox', { id: 10, topic_id: 910, active_at: daysAgo(5), ...fromMe }) // you asked: waiting
    put('imbox', { id: 11, topic_id: 911, active_at: daysAgo(6), ...fromMe }) // you sent files: not
    put('imbox', { id: 12, topic_id: 912, active_at: daysAgo(7), ...fromMe }) // not read yet
    put('imbox', { id: 13, topic_id: 913, active_at: daysAgo(1), ...fromMe }) // too recent to chase
    put('imbox', { id: 14, topic_id: 914, active_at: daysAgo(6), creator: me, contacts: [me], seen: true }) // a note to yourself
    put('imbox', { id: 16, topic_id: 916, active_at: daysAgo(8), creator: { ...me, email_address: 'ME@HEY.example' }, contacts: [me, bob], seen: true }) // case
    analyse(repo, 910, daysAgo(5), { expectsReply: true })
    analyse(repo, 911, daysAgo(6), { expectsReply: false })
    analyse(repo, 913, daysAgo(1), { expectsReply: true })
    analyse(repo, 916, daysAgo(8), { expectsReply: true })
    const t = buildToday(repo, input())
    expect(ids(t.waiting)).toEqual([16, 10])
    expect(t.waiting.map((i) => i.people!.map((p) => p.email))).toEqual([['bob@example.com'], ['alice@example.com']])
    // The one not read yet is handed back to be analysed.
    expect(t.needsAnalysis).toEqual([912])
    // Pure forwards aren't candidates at all.
    put('imbox', { id: 17, topic_id: 917, active_at: daysAgo(5), name: 'Fwd: The report', visible_entry_count: 1, ...fromMe })
    expect(buildToday(repo, input()).needsAnalysis).toEqual([912])
  })

  it('lists what needs your reply, with why, unless you parked it or it changed since', () => {
    const { repo, put } = setup()
    put('imbox', { id: 60, topic_id: 960, active_at: daysAgo(1) })
    put('imbox', { id: 61, topic_id: 961, active_at: daysAgo(2) })
    put('laterbox', { id: 62, topic_id: 962, active_at: daysAgo(3), seen: true })
    put('imbox', { id: 63, topic_id: 963, active_at: daysAgo(0, 1) })
    analyse(repo, 960, daysAgo(1), { needsReply: true, replyReason: 'asks about early check-in' })
    analyse(repo, 961, daysAgo(2), { needsReply: false })
    analyse(repo, 962, daysAgo(3), { needsReply: true, replyReason: 'parked' }) // in Reply Later: listed there
    analyse(repo, 963, daysAgo(0, 5), { needsReply: true }) // something new since: judged again first
    const t = buildToday(repo, input())
    expect(ids(t.needsReply)).toEqual([60])
    expect(t.needsReply[0]!.reason).toBe('asks about early check-in')
    expect(ids(t.replyLater)).toEqual([62])
  })

  it('drops what an email asked about a meeting that has already happened today', () => {
    const { repo, put } = setup()
    put('imbox', { id: 74, topic_id: 974, active_at: daysAgo(1) })
    analyse(repo, 974, daysAgo(1), {
      needsReply: true,
      replyReason: 'Confirm attendance',
      actionItems: [{ text: 'Respond to the meeting invitation', due: '2026-09-25', event: false }],
      dates: [{ label: 'Cockpit Design', date: '2026-09-25', time: '08:45', endTime: '10:45' }],
    })
    const at = (h: number) => buildToday(repo, { ...input(), now: new Date(2026, 8, 25, h, 0) })
    expect(at(8).due.actions.map((a) => a.text)).toEqual(['Respond to the meeting invitation'])
    expect(at(12).due.actions).toEqual([])
    expect(at(12).needsReply).toEqual([])
  })

  it('knows forms, bills and RSVPs, and lets them go once done', () => {
    const { repo, put } = setup()
    put('imbox', { id: 75, topic_id: 975, active_at: daysAgo(1) })
    analyse(repo, 975, daysAgo(1), {
      actionItems: [
        { text: 'Pay the school trip', due: '2026-09-25', event: false, kind: 'bill', amount: { amount: 40, currency: 'EUR' }, done: false },
        { text: 'Return the signed form', due: '2026-09-26', event: false, kind: 'form', amount: null, done: false },
        { text: 'Pay the old invoice', due: '2026-09-25', event: false, kind: 'bill', amount: null, done: true },
      ],
    })
    const t = buildToday(repo, input())
    expect(t.due.actions.map((a) => [a.text, a.kind, a.amount?.amount ?? null])).toEqual([['Pay the school trip', 'bill', 40]])
    expect(t.comingUp.map((c) => [c.label, c.kind, c.soon])).toEqual([['Return the signed form', 'form', true]])
    // Ticked Done: gone.
    const done = new Set([itemKey(975, 'Pay the school trip'), itemKey(975, 'return the  signed form')])
    const after = buildToday(repo, input({ done }))
    expect(after.due.actions).toEqual([])
    expect(after.comingUp).toEqual([])
  })

  it('keeps the date when its to-do is done', () => {
    const { repo, put } = setup()
    put('imbox', { id: 80, topic_id: 980, active_at: daysAgo(1) })
    analyse(repo, 980, daysAgo(1), {
      category: 'booking',
      actionItems: [{ text: 'Check in for flight MK 288', due: '2026-09-28', event: true, kind: 'appointment', amount: null, done: false }],
      dates: [{ label: 'Flight to Antananarivo', date: '2026-09-28', time: '14:20' }],
    })
    // A check-in is a to-do, even when the model calls it an appointment.
    expect(buildToday(repo, input()).comingUp.map((c) => [c.label, c.task ?? null, c.kind])).toEqual([['Flight to Antananarivo', 'Check in for flight MK 288', 'task']])
    const done = new Set([itemKey(980, 'Check in for flight MK 288')])
    analyse(repo, 980, daysAgo(1), {
      actionItems: [
        { text: 'Prepare for guest check-in', due: '2026-09-28', event: true, kind: 'appointment', amount: null, done: false },
        { text: 'Confirm the dentist appointment', due: '2026-09-29', event: false, kind: 'appointment', amount: null, done: false },
      ],
    })
    expect(buildToday(repo, input()).comingUp.map((c) => c.kind)).toEqual(['task', 'appointment'])
    analyse(repo, 980, daysAgo(1), {
      category: 'booking',
      actionItems: [{ text: 'Check in for flight MK 288', due: '2026-09-28', event: true, kind: 'appointment', amount: null, done: false }],
      dates: [{ label: 'Flight to Antananarivo', date: '2026-09-28', time: '14:20' }],
    })
    expect(buildToday(repo, input({ done })).comingUp.map((c) => [c.label, c.task ?? null])).toEqual([['Flight to Antananarivo', null]])
  })

  it('shows a sum only on a bill, and nothing from marketing', () => {
    const { repo, put } = setup()
    put('imbox', { id: 76, topic_id: 976, active_at: daysAgo(1) })
    put('imbox', { id: 77, topic_id: 977, active_at: daysAgo(1) })
    const offer = { text: 'Pre-invest up to $11,326.13', due: '2026-09-25', event: false, kind: 'task', amount: { amount: 11326.13, currency: 'USD' }, done: false }
    analyse(repo, 976, daysAgo(1), { category: 'notification', actionItems: [offer] })
    analyse(repo, 977, daysAgo(1), { category: 'promotion', actionItems: [{ ...offer, text: 'Claim your offer' }] })
    const t = buildToday(repo, input())
    expect(t.due.actions.map((a) => [a.text, a.amount])).toEqual([['Pre-invest up to $11,326.13', null]])
  })

  it('has what it shows from older readings read again', () => {
    const { repo, put } = setup()
    put('imbox', { id: 78, topic_id: 978, active_at: daysAgo(1) })
    put('imbox', { id: 79, topic_id: 979, active_at: daysAgo(1) })
    const offer = { actionItems: [{ text: 'Pre-invest', due: '2026-09-27', event: false, kind: 'task', amount: null, done: false }] }
    analyse(repo, 978, daysAgo(1), offer, ANALYSIS_VERSION - 1)
    analyse(repo, 979, daysAgo(1), { ...offer, actionItems: [{ ...offer.actionItems[0], text: 'Send the form' }] })
    const t = buildToday(repo, input())
    expect(t.comingUp.map((c) => c.label)).toEqual(['Pre-invest', 'Send the form'])
    expect(t.needsAnalysis).toEqual([978])
  })

  it('says when a date clashes with the calendar, but not with itself once added', () => {
    const at = (day: string, hm: string) => new Date(`${day}T${hm}:00`).toISOString()
    const ev = (title: string, s: string, e: string) => ({ key: title, id: 1, calendarId: null, title, startsAt: at('2026-10-03', s), endsAt: at('2026-10-03', e), allDay: false, location: null, color: null, calendarName: null, recurring: false, joinUrl: null, appUrl: null })
    const date = { label: 'MDA event', date: '2026-10-03', time: '09:00' }
    expect(clashWith(date, [ev('Gym', '08:30', '10:00')])?.title).toBe('Gym')
    expect(clashWith(date, [ev('MDA event', '09:00', '10:00')])).toBeNull()
    expect(clashWith(date, [ev('Lunch', '12:00', '13:00')])).toBeNull()
  })

  it('lets a call or meeting that has passed go, rather than calling it late', () => {
    const { repo, put } = setup()
    put('imbox', { id: 72, topic_id: 972, active_at: daysAgo(5) })
    analyse(repo, 972, daysAgo(5), {
      actionItems: [
        { text: 'Join the Africa call', due: '2026-09-21', event: true },
        { text: 'Attend the dinner', due: '2026-09-23' }, // an older analysis: read from the wording
        { text: 'Go to the dentist', due: '2026-09-25', event: true },
        { text: 'Send the report', due: '2026-09-24', event: false },
      ],
    })
    expect(buildToday(repo, input()).due.actions.map((a) => [a.text, a.daysLate])).toEqual([
      ['Send the report', 1],
      ['Go to the dentist', 0],
    ])
  })

  it('shows a task due on the day of one of the same email’s dates with that date, in one row', () => {
    const { repo, put } = setup()
    put('imbox', { id: 73, topic_id: 973, active_at: daysAgo(1) })
    analyse(repo, 973, daysAgo(1), {
      dates: [{ label: 'MDA event', date: '2026-09-27', time: '09:00' }],
      actionItems: [{ text: 'Confirm attendance at MDA event', due: '2026-09-27', event: false }],
    })
    expect(buildToday(repo, input()).comingUp.map((c) => [c.label, c.task ?? null, c.isDeadline])).toEqual([['MDA event', 'Confirm attendance at MDA event', false]])
  })

  it('puts deadlines from mail that have come in Due, and later ones in Coming up', () => {
    const { repo, put } = setup()
    put('imbox', { id: 70, topic_id: 970, active_at: daysAgo(2) })
    put('imbox', { id: 71, topic_id: 971, active_at: daysAgo(1) })
    analyse(repo, 970, daysAgo(2), {
      needsReply: true,
      actionItems: [
        { text: 'Send the signed form', due: '2026-09-24' },
        { text: 'Pay the deposit', due: '2026-09-25' },
        { text: 'Confirm numbers', due: '2026-09-28' },
        { text: 'Think about it', due: null },
      ],
    })
    analyse(repo, 971, daysAgo(1), {
      dates: [
        { label: 'Check-in', date: '2026-09-27', time: '14:00' },
        { label: 'Check-in', date: '2026-09-27', time: '14:00' }, // said twice
        { label: 'Last week', date: '2026-09-20', time: null },
        { label: 'Next month', date: '2026-10-20', time: null },
      ],
    })
    const t = buildToday(repo, input())
    expect(t.due.actions.map((a) => [a.text, a.daysLate])).toEqual([
      ['Send the signed form', 1],
      ['Pay the deposit', 0],
    ])
    expect(t.needsReply).toEqual([]) // claimed by Due
    expect(t.comingUp.map((c) => [c.label, c.date, c.time, c.isDeadline])).toEqual([
      ['Check-in', '2026-09-27', '14:00', false],
      ['Confirm numbers', '2026-09-28', null, true],
    ])
    expect(t.toHandle).toBe(2) // dates aren't tasks
  })

  it('shows each thread once, in the first section that claims it', () => {
    const { repo, put } = setup()
    // Parked in Reply Later, sent by you a week ago, and bubbled up: it's due.
    put('laterbox', { id: 20, topic_id: 920, active_at: daysAgo(7), creator: me, contacts: [me, alice], bubbled_up: true, seen: true })
    analyse(repo, 920, daysAgo(7), { expectsReply: true, needsReply: true })
    const t = buildToday(repo, input())
    expect(ids(t.due.bubbled)).toEqual([20])
    expect(t.needsReply).toEqual([])
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

  it('lists the new mail itself, newest first, a few per box', () => {
    const { repo, put } = setup()
    for (let i = 0; i < 7; i++) put('feedbox', { id: 40 + i, topic_id: 940 + i, name: `Letter ${i}`, active_at: daysAgo(0, i + 0.5) })
    put('feedbox', { id: 50, topic_id: 950, name: 'Old read one', active_at: daysAgo(0, 1), seen: true })
    const feed = buildToday(repo, input({ since: daysAgo(0, 10) })).newSince.boxes.find((b) => b.kind === 'feedbox')!
    expect(feed.count).toBe(7)
    expect(feed.threads.map((t) => t.subject)).toEqual(['Letter 0', 'Letter 1', 'Letter 2', 'Letter 3', 'Letter 4'])
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

  it('keeps Coming up to your own dates: no newsletters or promotions, nothing already over today', () => {
    const { repo, put } = setup()
    put('imbox', { id: 90, topic_id: 990, active_at: daysAgo(1) })
    put('imbox', { id: 91, topic_id: 991, active_at: daysAgo(1) })
    put('imbox', { id: 92, topic_id: 992, active_at: daysAgo(1) })
    analyse(repo, 990, daysAgo(1), { category: 'booking', dates: [
      { label: 'Morning call', date: '2026-09-25', time: '10:00' }, // NOW is 12:00: over
      { label: 'Evening call', date: '2026-09-25', time: '18:00' },
      { label: 'All-day thing', date: '2026-09-25', time: null },
    ] })
    analyse(repo, 991, daysAgo(1), { category: 'promotion', dates: [{ label: 'Livestream', date: '2026-09-26', time: null }] })
    analyse(repo, 992, daysAgo(1), { category: 'newsletter', dates: [{ label: 'Webinar', date: '2026-09-27', time: null }] })
    expect(buildToday(repo, input()).comingUp.map((c) => c.label)).toEqual(['All-day thing', 'Evening call'])
  })

  it('snoozes with "not now" until the time comes, or the thread changes', () => {
    const { repo, put } = setup()
    put('laterbox', { id: 41, topic_id: 941, active_at: daysAgo(4), seen: true })
    const hidden = { 'thread:41': { at: daysAgo(4), until: new Date(2026, 8, 26).toISOString() } }
    expect(buildToday(repo, input({ hidden })).replyLater).toEqual([])
    expect(ids(buildToday(repo, input({ hidden, now: new Date(2026, 8, 26, 8) })).replyLater)).toEqual([41])
  })

  it('drops a thread you marked handled from needs-reply, waiting and due, until it has something new', () => {
    const { repo, put } = setup()
    put('imbox', { id: 80, topic_id: 980, active_at: daysAgo(1) })
    analyse(repo, 980, daysAgo(1), { needsReply: true, replyReason: 'asks about check-in', actionItems: [{ text: 'Answer', due: '2026-09-24' }], dates: [{ label: 'Check-in', date: '2026-09-27', time: null }] })
    expect(buildToday(repo, input()).due.actions).toHaveLength(1)
    expect(repo.markHandled(TopicId(980))).toBe(true)
    const t = buildToday(repo, input())
    expect(t.needsReply).toEqual([])
    expect(t.due.actions).toEqual([])
    expect(t.comingUp.map((c) => c.label)).toEqual(['Check-in']) // dates still stand
    expect(repo.posting(PostingId(80))!.ai).toMatchObject({ needsReply: false, replyReason: null })
    expect(repo.markHandled(TopicId(999))).toBe(false) // never analysed
  })

  it('counts what’s yours to handle', () => {
    const { repo, put } = setup()
    put('laterbox', { id: 50, topic_id: 950, active_at: daysAgo(3), seen: true })
    put('imbox', { id: 51, topic_id: 951, active_at: daysAgo(4), creator: me, contacts: [me, alice], seen: true })
    analyse(repo, 951, daysAgo(4), { expectsReply: true })
    repo.replaceTodos([{ id: 9, title: 'Call Bob', starts_at: '2026-09-24T00:00:00Z' }])
    expect(buildToday(repo, input()).toHandle).toBe(3)
  })
})
