import { describe, expect, it, vi } from 'vitest'
import { openDb } from '../src/cache/db'
import { Repo } from '../src/cache/repo'
import type { HeyClient } from '../src/cli/client'
import * as S from '../src/cli/schemas'
import { TopicId } from '../src/ids'
import { parseQuery } from '../src/search/query'
import { fromHey, heyArgs, localBounds, searchHey } from '../src/search/search'
import { alice, entry, me, posting } from './fixtures'

const TODAY = new Date(2026, 8, 25, 12)
const q = (s: string) => parseQuery(s, TODAY)
const BOX = { imbox: 1, feedbox: 2, trailbox: 3, laterbox: 4 } as const
const bob = { id: 12, name: 'Bob Stone', email_address: 'bob@example.com', contactable_type: 'Person' }
const wise = { id: 13, name: 'Wise', email_address: 'noreply@wise.com', contactable_type: 'Service' }

function setup() {
  const repo = new Repo(openDb(':memory:'))
  repo.replaceBoxes(Object.entries(BOX).map(([kind, id]) => ({ id, kind, name: kind })))
  const put = (box: keyof typeof BOX, over: Record<string, unknown>) => repo.upsertPostings([S.Posting.parse(posting({ box_id: BOX[box], ...over }))])
  // A small mailbox.
  put('imbox', { id: 1, topic_id: 91, name: 'Transfer sent', summary: '120.00 EUR is now in your account', creator: wise, contacts: [wise, me], active_at: '2026-09-25T09:00:00Z', seen: true })
  put('imbox', { id: 2, topic_id: 92, name: 'Lunch on Friday?', summary: 'Are you free at the harbour?', creator: alice, contacts: [alice, me, bob], active_at: '2026-09-20T10:00:00Z' })
  put('feedbox', { id: 3, topic_id: 93, name: 'Weekly design letter', summary: 'Three new fonts', creator: bob, contacts: [bob], active_at: '2026-08-01T10:00:00Z', seen: true, folders: [{ id: 5, name: 'Reading' }] })
  put('trailbox', { id: 4, topic_id: 94, name: 'Your invoice', summary: 'Invoice attached', creator: wise, contacts: [wise], active_at: '2025-03-01T10:00:00Z', seen: true, includes_attachments: true })
  put('laterbox', { id: 5, topic_id: 95, name: 'Re: Quarterly plan', summary: 'Numbers inside', creator: bob, contacts: [bob, me], active_at: '2026-09-24T10:00:00Z', seen: true })
  return { repo, put }
}

const ids = (rows: Array<{ id: number }>) => rows.map((r) => r.id)
const local = (repo: Repo, s: string) => {
  const parsed = q(s)
  return ids(repo.searchThreads(parsed, localBounds(parsed)))
}

describe('searching the cache', () => {
  it('matches words across subject, sender and preview, newest first', () => {
    const { repo } = setup()
    expect(local(repo, 'transfer')).toEqual([1])
    expect(local(repo, 'wise')).toEqual([1, 4])
    expect(local(repo, 'harbour free')).toEqual([2])
    expect(local(repo, 'harbour nothere')).toEqual([])
  })

  it('matches phrases, exclusions and OR groups', () => {
    const { repo } = setup()
    expect(local(repo, '"now in your"')).toEqual([1])
    expect(local(repo, '"in now your"')).toEqual([])
    expect(local(repo, 'wise -invoice')).toEqual([1])
    expect(local(repo, 'fonts OR harbour')).toEqual([2, 3])
  })

  it('matches the AI summary and the messages of threads read', () => {
    const { repo } = setup()
    repo.saveAnalysis(TopicId(95), '2026-09-24T10:00:00Z', 'claude', 'm', { summary: 'Budget for Q4 needs sign-off', needsReply: false, replyReason: null, expectsReply: false, category: 'work', actionItems: [], dates: [], amounts: [] } as never, 3)
    expect(local(repo, 'sign-off')).toEqual([5])
    repo.storeThread(TopicId(92), [S.Entry.parse(entry({ body: 'Shall we try the new ramen place?' }))], 'Lunch on Friday?')
    expect(local(repo, 'ramen')).toEqual([2])
  })

  it('applies from:, to:, subject:, in:, label:, has: and is:', () => {
    const { repo } = setup()
    expect(local(repo, 'from:wise')).toEqual([1, 4])
    expect(local(repo, 'from:"Bob Stone"')).toEqual([5, 3])
    expect(local(repo, 'to:bob')).toEqual([2]) // on the thread, not the sender
    expect(local(repo, 'subject:invoice')).toEqual([4])
    expect(local(repo, 'in:feed')).toEqual([3])
    expect(local(repo, 'in:later')).toEqual([5])
    expect(local(repo, 'label:reading')).toEqual([3])
    expect(local(repo, 'has:attachment')).toEqual([4])
    expect(local(repo, 'is:unread')).toEqual([2])
    expect(local(repo, 'in:trash')).toEqual([])
  })

  it('knows specific attachment kinds only for threads whose files it has', () => {
    const { repo } = setup()
    expect(local(repo, 'has:pdf')).toEqual([])
    repo.replaceAttachments(TopicId(94), [S.Attachment.parse({ id: '1:1', message_id: 1, filename: 'Invoice-March.PDF', content_type: 'application/pdf' })])
    expect(local(repo, 'has:pdf')).toEqual([4])
    expect(local(repo, 'has:spreadsheet')).toEqual([])
  })

  it('applies dates as whole local days', () => {
    const { repo } = setup()
    expect(local(repo, 'after:2026-09-20')).toEqual([1, 5, 2])
    expect(local(repo, 'before:2026-09-20')).toEqual([3, 4])
    expect(local(repo, 'newer_than:1w')).toEqual([1, 5, 2])
    expect(local(repo, 'older_than:1y')).toEqual([4])
  })

  it('treats pattern characters literally, and an empty query as no search', () => {
    const { repo, put } = setup()
    put('imbox', { id: 6, topic_id: 96, name: '100% off', active_at: '2026-09-01T10:00:00Z' })
    expect(local(repo, '100%')).toEqual([6])
    expect(local(repo, '_')).toEqual([])
    expect(local(repo, '   ')).toEqual([])
  })

  it('suggests people by name or address, most mail first', () => {
    const { repo } = setup()
    expect(repo.correspondents('ex').map((c) => c.email)).toEqual(['bob@example.com', 'alice@example.com'])
    expect(repo.correspondents('stone')).toEqual([{ name: 'Bob Stone', email: 'bob@example.com', count: 2 }])
  })
})

describe('asking HEY', () => {
  it('turns a query into hey search flags', () => {
    expect(heyArgs(q('deposit "sweet rate" "paid daily" -spam {eur usd} from:wise to:me subject:transfer label:BnB in:feed has:pdf'), 1, TODAY)).toEqual([
      'deposit "paid daily"', '--exact', 'sweet rate', '--none', 'spam', '--any', 'eur usd', '--from', 'wise', '--to', 'me',
      '--subject', 'transfer', '--label', 'BnB', '--in', 'feed', '--attachment', 'pdfs',
    ])
    expect(heyArgs(q('invoice'), 3, TODAY)).toEqual(['invoice', '--page', '3'])
  })

  it('picks the narrowest of HEY’s date ranges', () => {
    const date = (s: string) => heyArgs(q(`x ${s}`), 1, TODAY)!.slice(1)
    expect(date('newer_than:5d')).toEqual(['--date', 'last_7_days'])
    expect(date('after:2026-09-01')).toEqual(['--date', 'last_30_days'])
    expect(date('newer_than:2m')).toEqual(['--date', 'last_90_days'])
    expect(date('after:2024-01-01 before:2025-01-01')).toEqual(['--date', '2024'])
    expect(date('after:2024-03-01 before:2024-06-01')).toEqual(['--date', '2024'])
    expect(date('after:2024-03-01')).toEqual([])
    expect(date('before:2024-03-01')).toEqual([])
  })

  it('leaves to the cache what HEY can’t answer', () => {
    expect(heyArgs(q('is:unread invoice'), 1, TODAY)).toBeNull()
    expect(heyArgs(q('in:later plan'), 1, TODAY)).toBeNull()
    expect(heyArgs(q(''), 1, TODAY)).toBeNull()
  })

  const result = (id: number, topic: number, at: string, subject = 's') =>
    S.SearchResult.parse({
      id, topic_id: topic, subject, updated_at: at,
      messages: [{ id: 1, summary: 'Hello there', alternative_sender_name: 'Northwind', app_url: `https://app.hey.com/topics/${topic}`, creator: { name: 'N', email_address: 'NoReply@northwind.com', avatar_background_color: '#f0f', initials: 'N' } }],
    })

  it('shows a result as a list row, or as the cache has it', async () => {
    const { repo } = setup()
    expect(fromHey(result(700, 7000, '2026-09-25T14:54:10Z', 'Money added'))).toMatchObject({
      id: 700, topicId: 7000, subject: 'Money added', senderName: 'Northwind', senderEmail: 'noreply@northwind.com', summary: 'Hello there', seen: true, boxId: 0,
      avatar: { url: null, color: '#f0f', initials: 'N' },
    })
    const search = vi.fn(async () => [result(1, 91, '2026-09-25T09:00:00Z'), result(700, 7000, '2026-01-02T10:00:00Z')])
    const page = await searchHey({ search } as unknown as HeyClient, repo, q('transfer'), 1, TODAY)
    expect(search).toHaveBeenCalledWith(['transfer'])
    expect(page.rows.map((r) => [r.id, r.boxId])).toEqual([[1, 1], [700, 0]])
    expect(page).toMatchObject({ page: 1, more: false, unsupported: false })
  })

  it('applies exact dates to HEY’s ranges, and knows when there’s more', async () => {
    const { repo } = setup()
    const ten = Array.from({ length: 10 }, (_, i) => result(800 + i, 8000 + i, `2026-09-${String(10 + i).padStart(2, '0')}T12:00:00Z`))
    const search = vi.fn(async () => ten)
    const page = await searchHey({ search } as unknown as HeyClient, repo, q('x after:2026-09-15 before:2026-09-18'), 2, TODAY)
    expect(search).toHaveBeenCalledWith(['x', '--date', 'last_30_days', '--page', '2'])
    expect(page.rows.map((r) => r.id)).toEqual([805, 806, 807])
    expect(page.more).toBe(true)
  })

  it('keeps a result that’s in no box, as a thread to read', async () => {
    const { repo } = setup()
    const noBox = S.SearchResult.parse({ topic_id: 7777, subject: 'Fizzy: New notifications', updated_at: '2026-09-24T12:42:46Z', messages: [] })
    expect(fromHey(noBox)).toMatchObject({ id: -7777, topicId: 7777, subject: 'Fizzy: New notifications' })
    const search = vi.fn(async () => [noBox, result(1, 91, '2026-09-25T09:00:00Z')])
    const page = await searchHey({ search } as unknown as HeyClient, repo, q('fizzy'), 1, TODAY)
    expect(page.rows.map((r) => r.id)).toEqual([-7777, 1])
  })

  it('doesn’t call HEY for what it can’t answer', async () => {
    const { repo } = setup()
    const search = vi.fn()
    expect(await searchHey({ search } as unknown as HeyClient, repo, q('is:unread'), 1, TODAY)).toMatchObject({ rows: [], unsupported: true })
    expect(search).not.toHaveBeenCalled()
  })
})

describe('matching people', () => {
  it('matches from:, to: and suggestions at the start of a word, not inside one', () => {
    const { repo, put } = setup()
    const tailwind = { id: 20, name: 'Adam Wathan', email_address: 'news@tailwindcss.com', contactable_type: 'Person' }
    put('feedbox', { id: 7, topic_id: 97, name: 'Tailwind news', creator: tailwind, contacts: [tailwind, bob], active_at: '2026-09-02T10:00:00Z' })
    expect(local(repo, 'from:wi')).toEqual([1, 4])
    expect(local(repo, 'from:noreply@wise.com')).toEqual([1, 4])
    expect(local(repo, 'from:tailwindcss')).toEqual([7])
    expect(local(repo, 'from:ind')).toEqual([])
    expect(local(repo, 'to:stone')).toEqual([2, 7])
    expect(repo.correspondents('wi').map((c) => c.email)).toEqual(['noreply@wise.com'])
    expect(repo.correspondents('adam w').map((c) => c.email)).toEqual(['news@tailwindcss.com'])
  })
})

describe('the original of a forward', () => {
  it('finds the email you forwarded: same sender and subject, closest in time, not the forward itself', () => {
    const { repo, put } = setup()
    const ext = { id: 30, name: 'External Affairs', email_address: 'externalaffaires@example.org', contactable_type: 'Person' }
    put('imbox', { id: 20, topic_id: 120, name: 'Point d’avancement – 1ere TABLE RONDE', creator: ext, contacts: [ext, me], active_at: '2026-09-08T11:28:47Z', seen: true })
    put('imbox', { id: 21, topic_id: 121, name: 'Point d’avancement – 1ere TABLE RONDE', creator: ext, contacts: [ext, me], active_at: '2025-09-08T11:28:47Z', seen: true })
    put('imbox', { id: 22, topic_id: 122, name: 'Fwd: Point d’avancement – 1ere TABLE RONDE', creator: me, contacts: [me, alice], active_at: '2026-09-21T10:25:00Z', seen: true })
    const found = repo.forwardedOriginal('ExternalAffaires@example.org', 'Fwd: [mada] Point d’avancement –  1ere TABLE RONDE', '2026-09-08T11:28:00Z', TopicId(122))
    expect(found?.topicId).toBe(120)
    expect(repo.forwardedOriginal('externalaffaires@example.org', 'Something else', null, null)).toBeNull()
    expect(repo.forwardedOriginal('nobody@example.org', 'Point d’avancement – 1ere TABLE RONDE', null, null)).toBeNull()
    // No date in the forward: the latest.
    expect(repo.forwardedOriginal('externalaffaires@example.org', 'Point d’avancement – 1ere TABLE RONDE', null, null)?.topicId).toBe(120)
  })
})
