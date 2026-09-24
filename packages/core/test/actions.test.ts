import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { ActionRunner } from '../src/actions/runner'
import { openDb } from '../src/cache/db'
import { Repo } from '../src/cache/repo'
import { HeyClient } from '../src/cli/client'
import { HeyRunner, type Exec } from '../src/cli/runner'
import * as S from '../src/cli/schemas'
import { PostingId } from '../src/ids'
import { SyncEngine } from '../src/sync/engine'
import { posting } from './fixtures'

const BOXES = { imbox: 1, feedbox: 2, trailbox: 3, laterbox: 4, asidebox: 5, bubblebox: 6 } as const
type Kind = keyof typeof BOXES

interface Thread {
  id: number
  topic_id: number
  box: Kind
  seen: boolean
  bubbled: boolean
  scheduled: boolean
  labels: number[]
}

/**
 * A tiny in-memory HEY behind the CLI's command surface, with HEY's real quirks: moving
 * marks a thread seen, and `seen` can silently do nothing (see `ignoreSeen`).
 */
function fakeHey(threads: Thread[]) {
  const state = new Map(threads.map((t) => [t.id, t]))
  const opts = { ignoreSeen: false, failTrash: false }
  const ok = (data: unknown) => ({ stdout: JSON.stringify({ ok: true, data }), stderr: '', exitCode: 0 })
  const toPosting = (t: Thread) => ({
    ...posting({ id: t.id, topic_id: t.topic_id, box_id: BOXES[t.box] }),
    ...(t.seen ? { seen: true } : {}),
    bubbled_up: t.bubbled,
    folders: t.labels.map((id) => ({ id, name: `L${id}` })),
  })
  const kindOf = (ref: string): Kind => (ref in BOXES ? (ref as Kind) : (Object.entries(BOXES).find(([, id]) => String(id) === ref)![0] as Kind))

  const exec: Exec = async (_bin, raw) => {
    const a = raw.filter((x) => x !== '--json')
    const t = state.get(Number(a[a[0] === 'bubble' || a[0] === 'label' ? 2 : 1]))
    switch (`${a[0]} ${a[0] === 'bubble' || a[0] === 'label' || a[0] === 'box' ? a[1] : ''}`.trim()) {
      case 'box view': {
        const kind = kindOf(a[2]!)
        return ok({ id: BOXES[kind], kind, name: kind, next_page: null, postings: [...state.values()].filter((x) => x.box === kind).map(toPosting) })
      }
      case 'seen':
      case 'unseen':
        if (!opts.ignoreSeen && t) t.seen = a[0] === 'seen'
        return ok({})
      case 'move':
        t!.box = a[3] as Kind
        t!.seen = true
        return ok({})
      case 'bubble up':
        if (a.includes('--now')) t!.bubbled = true
        else Object.assign(t!, { scheduled: true, box: 'bubblebox' })
        return ok({})
      case 'bubble pop':
        Object.assign(t!, { scheduled: false, bubbled: false })
        return ok({})
      case 'bubble list':
        return ok({
          scheduled: [...state.values()].filter((x) => x.scheduled).map(toPosting),
          bubbled_up: [...state.values()].filter((x) => x.bubbled).map(toPosting),
        })
      case 'label add':
        t!.labels = [...new Set([...t!.labels, Number(a[4])])]
        return ok({})
      case 'label remove':
        t!.labels = t!.labels.filter((l) => l !== Number(a[4]))
        return ok({})
      case 'trash':
        if (opts.failTrash) return { stdout: JSON.stringify({ ok: false, code: 'api', error: 'server error' }), stderr: '', exitCode: 1 }
        state.delete(t!.id)
        return ok({})
    }
    throw new Error(`unexpected: hey ${a.join(' ')}`)
  }
  return { exec, state, opts }
}

function setup(thread: Partial<Thread> = {}) {
  const t: Thread = { id: 100, topic_id: 900, box: 'imbox', seen: false, bubbled: false, scheduled: false, labels: [], ...thread }
  const hey = fakeHey([t])
  const runner = new HeyRunner({ binary: 'hey', exec: hey.exec })
  const client = new HeyClient(runner)
  const repo = new Repo(openDb(':memory:'))
  const engine = new SyncEngine(client, repo, runner, { attachmentsDir: mkdtempSync(join(tmpdir(), 'att-')) })
  vi.spyOn(engine, 'requestBoxRefresh').mockImplementation(() => {})
  repo.replaceBoxes(Object.entries(BOXES).map(([kind, id]) => ({ id, kind, name: kind })))
  repo.replaceNamed('labels', [
    { id: 7, name: 'Travel' },
    { id: 8, name: 'Receipts' },
  ])
  repo.upsertPostings([
    S.Posting.parse({
      ...posting({ id: t.id, topic_id: t.topic_id, box_id: BOXES[t.box], name: 'Lunch' }),
      ...(t.seen ? { seen: true } : {}),
      folders: t.labels.map((id) => ({ id, name: id === 7 ? 'Travel' : 'Receipts' })),
    }),
  ])
  const actions = new ActionRunner(client, repo, engine)
  const cached = () => repo.posting(PostingId(t.id))
  return { actions, repo, hey, heyThread: () => hey.state.get(t.id), cached }
}

describe('ActionRunner', () => {
  it('marks seen, verifies it, and undoes it', async () => {
    const { actions, heyThread, cached } = setup()
    const done = await actions.run({ type: 'seen', postingId: 100, seen: true })
    expect(done).toMatchObject({ status: 'done', verified: true, canUndo: true, summary: 'Marked “Lunch” as seen' })
    expect(heyThread()!.seen).toBe(true)
    expect(cached()!.seen).toBe(true)

    const undone = await actions.undo(done.id)
    expect(undone.status).toBe('undone')
    expect(heyThread()!.seen).toBe(false)
    expect(cached()!.seen).toBe(false)
    await expect(actions.undo(done.id)).rejects.toThrow(/can't be undone/)
  })

  it('rolls the cache back when HEY silently ignores the change', async () => {
    const { actions, hey, cached } = setup()
    hey.opts.ignoreSeen = true
    const r = await actions.run({ type: 'seen', postingId: 100, seen: true })
    expect(r).toMatchObject({ status: 'failed', error: "HEY didn't apply the change", canUndo: false })
    expect(cached()!.seen).toBe(false)
  })

  it('has nothing to undo when the thread was already in that state', async () => {
    const { actions } = setup({ seen: true })
    expect((await actions.run({ type: 'seen', postingId: 100, seen: true })).canUndo).toBe(false)
  })

  it('moves a thread, and undo restores both its box and its unseen state', async () => {
    const { actions, heyThread, cached } = setup()
    const r = await actions.run({ type: 'move', postingId: 100, to: 'trailbox' })
    expect(r).toMatchObject({ status: 'done', verified: true, summary: 'Moved “Lunch” to Paper Trail' })
    expect(heyThread()).toMatchObject({ box: 'trailbox', seen: true }) // HEY marks moved threads seen
    expect(cached()!.boxId).toBe(BOXES.trailbox)

    await actions.undo(r.id)
    expect(heyThread()).toMatchObject({ box: 'imbox', seen: false })
  })

  it('moves and undoes even when the cached thread has lost its topic ID', async () => {
    const { actions, repo, heyThread } = setup()
    repo.db.prepare('UPDATE postings SET topic_id = NULL').run()
    const r = await actions.run({ type: 'move', postingId: 100, to: 'feedbox' })
    expect(r).toMatchObject({ status: 'done', verified: true })
    await actions.undo(r.id)
    expect(heyThread()).toMatchObject({ box: 'imbox', seen: false })
  })

  it('schedules a bubble up and undoes it back into the original box', async () => {
    const { actions, heyThread } = setup()
    const r = await actions.run({ type: 'bubble', postingId: 100, when: { kind: 'tomorrow' } })
    expect(r).toMatchObject({ status: 'done', verified: true, summary: 'Bubble up “Lunch” tomorrow' })
    expect(heyThread()).toMatchObject({ scheduled: true, box: 'bubblebox' })

    await actions.undo(r.id)
    expect(heyThread()).toMatchObject({ scheduled: false, box: 'imbox', seen: false })
  })

  it('adds and removes labels, with undo only when something changed', async () => {
    const { actions, heyThread, repo } = setup({ labels: [8] })
    const add = await actions.run({ type: 'label', postingId: 100, labelId: 7, add: true })
    expect(add).toMatchObject({ status: 'done', canUndo: true, summary: 'Labelled “Lunch” Travel' })
    expect(heyThread()!.labels).toEqual([8, 7])
    expect(repo.posting(PostingId(100))!.labels).toEqual(['Receipts', 'Travel'])

    await actions.undo(add.id)
    expect(heyThread()!.labels).toEqual([8])
    expect((await actions.run({ type: 'label', postingId: 100, labelId: 8, add: true })).canUndo).toBe(false)
  })

  it('trashes without an undo, and restores the cache if trashing fails', async () => {
    const ok = setup()
    const r = await ok.actions.run({ type: 'trash', postingId: 100 })
    expect(r).toMatchObject({ status: 'done', canUndo: false })
    expect(ok.cached()).toBeNull()

    const bad = setup()
    bad.hey.opts.failTrash = true
    const f = await bad.actions.run({ type: 'trash', postingId: 100 })
    expect(f).toMatchObject({ status: 'failed', error: 'server error' })
    expect(bad.cached()).not.toBeNull()
  })

  it('reports each step as it happens and keeps automatic actions out of the log', async () => {
    const { actions } = setup()
    const seen: string[] = []
    actions.on('action', (a) => seen.push(a.status))
    await actions.run({ type: 'seen', postingId: 100, seen: true }, 'auto')
    await actions.run({ type: 'move', postingId: 100, to: 'feedbox' })
    expect(seen).toEqual(['running', 'done', 'running', 'done'])
    expect(actions.recent().map((a) => a.type)).toEqual(['move'])
    expect(actions.recent(50, true)).toHaveLength(2)
  })

  it('refuses threads that are not in the cache', async () => {
    const { actions } = setup()
    await expect(actions.run({ type: 'seen', postingId: 999, seen: true })).rejects.toThrow(/not in the cache/)
  })
})
