import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openDb } from '../src/cache/db'
import { Repo } from '../src/cache/repo'
import { HeyClient } from '../src/cli/client'
import { HeyRunner } from '../src/cli/runner'
import * as S from '../src/cli/schemas'
import { PostingId, TopicId } from '../src/ids'
import { SyncEngine, type CacheChange } from '../src/sync/engine'
import { entry, fakeExec, ok, posting } from './fixtures'

function setup(routes: Parameters<typeof fakeExec>[0] = []) {
  const fake = fakeExec(routes)
  const runner = new HeyRunner({ binary: 'hey', exec: fake.exec })
  const repo = new Repo(openDb(':memory:'))
  const attachmentsDir = mkdtempSync(join(tmpdir(), 'att-'))
  const engine = new SyncEngine(new HeyClient(runner), repo, runner, { attachmentsDir })
  const changes: CacheChange[] = []
  engine.on('change', (c) => changes.push(c))
  engine.on('error', () => {})
  // The watch process is not started in tests; feed lines straight in.
  const feed = (line: Record<string, unknown>) =>
    (engine as unknown as { onWatchLine(l: S.WatchLine): void }).onWatchLine(S.WatchLine.parse(line))
  return { engine, repo, changes, feed, calls: fake.calls, attachmentsDir }
}

const imbox = { id: 1, kind: 'imbox', name: 'Imbox' }

afterEach(() => vi.useRealTimers())

describe('SyncEngine watch handling', () => {
  it('applies added postings and remembers where to resume', () => {
    const { repo, changes, feed } = setup()
    feed({ change: 'added', at: '2026-09-24T10:00:00Z', box: imbox, posting_id: 100, posting: posting() })
    expect(repo.posting(PostingId(100))?.subject).toBe('Lunch on Friday?')
    expect(repo.getState('watch_since')).toBe('2026-09-24T10:00:00Z')
    expect(changes).toEqual([{ kind: 'postings', boxId: 1 }])
  })

  it('takes the thread ID from the watch line, since watch postings omit it', () => {
    const { repo, feed } = setup()
    const { topic_id: _omit, ...withoutTopic } = posting()
    feed({ change: 'added', box: imbox, posting_id: 100, thread_id: 900, posting: withoutTopic })
    expect(repo.posting(PostingId(100))).toMatchObject({ topicId: 900, isBundle: false })
    // A later update that lacks both keeps the known thread ID.
    feed({ change: 'updated', box: imbox, posting_id: 100, posting: { ...withoutTopic, name: 'Renamed' } })
    expect(repo.posting(PostingId(100))).toMatchObject({ topicId: 900, isBundle: false, subject: 'Renamed' })
  })

  it('removes deleted postings', () => {
    const { repo, feed } = setup()
    feed({ change: 'added', box: imbox, posting: posting() })
    feed({ change: 'deleted', box: imbox, posting_id: 100 })
    expect(repo.posting(PostingId(100))).toBeNull()
  })

  it('re-reads a box once for a burst of content-less updates', async () => {
    vi.useFakeTimers()
    const { feed, calls, repo } = setup([
      ['box view 1', ok({ ...imbox, next_page: null, postings: [posting({ seen: true })] })],
    ])
    feed({ change: 'updated', box: imbox, posting_id: 100 })
    feed({ change: 'updated', box: imbox, posting_id: 101 })
    feed({ change: 'resync', box: imbox })
    await vi.runAllTimersAsync()
    expect(calls.filter((c) => c[0] === 'box')).toHaveLength(1)
    expect(repo.posting(PostingId(100))?.seen).toBe(true)
  })

  it('refreshes the calendar on calendar changes', async () => {
    vi.useFakeTimers()
    const { feed, calls } = setup([
      ['calendar list', ok([{ id: 3, name: 'Personal', kind: 'normal' }])],
      ['event week', ok([])],
      ['todo list', ok([])],
    ])
    feed({ change: 'recording_updated' })
    feed({ change: 'calendar_updated' })
    await vi.runAllTimersAsync()
    expect(calls.filter((c) => c[0] === 'calendar')).toHaveLength(1)
  })
})

describe('SyncEngine threads and backfill', () => {
  it('fetches a thread once even when asked concurrently, then serves the cache', async () => {
    const { engine, calls } = setup([['thread read 900', ok([entry()])], ['attachment list 900', ok([])]])
    const [a, b] = await Promise.all([engine.ensureThread(TopicId(900), 1), engine.ensureThread(TopicId(900), 1)])
    expect(a?.entries).toHaveLength(1)
    expect(b).toEqual(a)
    await engine.ensureThread(TopicId(900), 1)
    expect(calls.filter((c) => c[0] === 'thread')).toHaveLength(1)
  })

  it('backfills page by page and resumes from the saved cursor', async () => {
    const page = (id: number, next: string | null) =>
      ok({ ...imbox, next_page: next, postings: [posting({ id, topic_id: id })] })
    const { engine, repo } = setup([
      ['box view 1 --page p2', page(2, 'p3')],
      ['box view 1 --page p3', page(3, null)],
    ])
    repo.setState('backfill:1', 'p2')
    expect(await engine.backfillBox(1, { maxPages: 1, delayMs: 0 })).toBe(1)
    expect(repo.getState('backfill:1')).toBe('p3')
    expect(await engine.backfillBox(1, { delayMs: 0 })).toBe(1)
    expect(repo.getState('backfill:1')).toBe('done')
    expect(await engine.backfillBox(1, { delayMs: 0 })).toBe(0)
    expect(repo.postingCount(1)).toBe(2)
  })
})

describe('SyncEngine thread HTML', () => {
  it('fetches message HTML once, then serves it from the cache', async () => {
    let fetches = 0
    const { engine } = setup([
      ['thread read 900 --html', () => (fetches++, { stdout: '<article id="entry-5000"><div>Hi</div></article>', stderr: '', exitCode: 0 })],
      ['thread read 900', ok([entry()])],
      ['attachment list 900', ok([])],
    ])
    await engine.ensureThread(TopicId(900), 1)
    const [a, b] = await Promise.all([engine.ensureThreadHtml(TopicId(900)), engine.ensureThreadHtml(TopicId(900))])
    expect(a).toEqual({ 5000: '<div>Hi</div>' })
    expect(b).toEqual(a)
    await engine.ensureThreadHtml(TopicId(900))
    expect(fetches).toBe(1)
  })
})

describe('SyncEngine attachments', () => {
  const pdf = { id: '5000:1', message_id: 5000, filename: 'Plan.pdf', content_type: 'application/pdf', byte_size: 1200 }

  it('lists attachments with the thread and attaches them to their entry', async () => {
    const { engine } = setup([
      ['thread read 900', ok([entry()])],
      ['attachment list 900', ok([pdf, { ...pdf, id: '5000:e-abc', filename: 'logo.png', content_type: 'image/png' }])],
    ])
    const t = await engine.ensureThread(TopicId(900), 1)
    expect(t?.entries[0]?.attachments).toEqual([
      { id: '5000:1', filename: 'Plan.pdf', contentType: 'application/pdf', byteSize: 1200, embedded: false },
      { id: '5000:e-abc', filename: 'logo.png', contentType: 'image/png', byteSize: 1200, embedded: true },
    ])
  })

  it('skips the attachment call when the posting says there are none', async () => {
    const { engine, repo, calls } = setup([['thread read 900', ok([entry()])]])
    repo.upsertPostings([S.Posting.parse(posting({ includes_attachments: false }))])
    await engine.ensureThread(TopicId(900), 1)
    expect(calls.map((c) => c[0])).toEqual(['thread'])
  })

  it('downloads a file once into its own folder, then serves the local copy', async () => {
    let saves = 0
    const { engine, attachmentsDir } = setup([
      ['thread read 900', ok([entry()])],
      ['attachment list 900', ok([pdf])],
      [
        'attachment save 5000:1',
        () => {
          saves++
          const dir = `${attachmentsDir}/5000_1`
          writeFileSync(`${dir}/Plan.pdf`, '%PDF-1.4')
          return ok({ id: '5000:1', path: `${dir}/Plan.pdf` })
        },
      ],
    ])
    await engine.ensureThread(TopicId(900), 1)
    const [a, b] = await Promise.all([engine.attachmentFile('5000:1'), engine.attachmentFile('5000:1')])
    expect(a).toEqual({ path: `${attachmentsDir}/5000_1/Plan.pdf`, filename: 'Plan.pdf', contentType: 'application/pdf' })
    expect(b).toEqual(a)
    await engine.attachmentFile('5000:1')
    expect(saves).toBe(1)
  })

  it('refuses attachment ids it has not listed', async () => {
    const { engine } = setup()
    await expect(engine.attachmentFile('../../etc/passwd')).rejects.toThrow(/unknown attachment/)
  })
})
