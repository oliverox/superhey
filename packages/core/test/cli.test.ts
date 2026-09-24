import { chmod, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { HeyClient } from '../src/cli/client'
import { HeyAuthError, HeyBinaryError, HeyCliError, HeyNotFoundError } from '../src/cli/errors'
import { compareVersions, HeyRunner, locateCli } from '../src/cli/runner'
import { PostingId } from '../src/ids'
import { fakeExec, ok, posting } from './fixtures'

const runnerWith = (routes: Parameters<typeof fakeExec>[0]) => {
  const fake = fakeExec(routes)
  return { runner: new HeyRunner({ binary: 'hey', exec: fake.exec }), calls: fake.calls }
}

describe('HeyRunner', () => {
  it('adds --json and returns the envelope', async () => {
    const { runner, calls } = runnerWith([['box list', ok([{ id: 1, kind: 'imbox', name: 'Imbox' }])]])
    const env = await runner.json(['box', 'list'])
    expect(env.data).toEqual([{ id: 1, kind: 'imbox', name: 'Imbox' }])
    expect(calls[0]).toEqual(['box', 'list', '--json'])
  })

  it('maps error envelopes to typed errors', async () => {
    const { runner } = runnerWith([
      ['auth', { stdout: '{"ok":false,"code":"auth","error":"no login"}', stderr: '', exitCode: 3 }],
      ['missing', { stdout: '{"ok":false,"code":"not_found","error":"resource not found"}', stderr: '', exitCode: 1 }],
      ['other', { stdout: '{"ok":false,"code":"usage","error":"bad flag"}', stderr: '', exitCode: 2 }],
      ['garbage', { stdout: 'panic', stderr: 'boom', exitCode: 1 }],
      ['noauth', { stdout: '', stderr: 'not signed in', exitCode: 3 }],
    ])
    await expect(runner.json(['auth'])).rejects.toBeInstanceOf(HeyAuthError)
    await expect(runner.json(['missing'])).rejects.toBeInstanceOf(HeyNotFoundError)
    await expect(runner.json(['other'])).rejects.toMatchObject({ code: 'usage', message: 'bad flag' })
    await expect(runner.json(['garbage'])).rejects.toBeInstanceOf(HeyCliError)
    await expect(runner.json(['noauth'])).rejects.toBeInstanceOf(HeyAuthError)
  })

  it('passes the account flag when set', async () => {
    const fake = fakeExec([['box list', ok([])]])
    const runner = new HeyRunner({ binary: 'hey', exec: fake.exec, account: '42' })
    await runner.json(['box', 'list'])
    expect(fake.calls[0]).toEqual(['box', 'list', '--json', '--account', '42'])
  })

  it('limits concurrent calls', async () => {
    let active = 0
    let peak = 0
    const runner = new HeyRunner({
      binary: 'hey',
      maxConcurrent: 2,
      exec: async () => {
        peak = Math.max(peak, ++active)
        await new Promise((r) => setTimeout(r, 10))
        active--
        return ok([])
      },
    })
    await Promise.all(Array.from({ length: 6 }, () => runner.json(['box', 'list'])))
    expect(peak).toBe(2)
  })
})

describe('locateCli', () => {
  async function script(dir: string, name: string, output: string) {
    const path = join(dir, name)
    await writeFile(path, `#!/bin/sh\necho "${output}"\n`)
    await chmod(path, 0o755)
    return path
  }

  it('accepts the HEY CLI', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hey-'))
    const path = await script(dir, 'hey', 'hey version 1.6.0')
    await expect(locateCli(path)).resolves.toMatchObject({ path, version: '1.6.0' })
  })

  it('rejects an unrelated binary named hey and an old version', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hey-'))
    const loadTester = await script(dir, 'hey', 'Usage: hey [options...] <url>')
    const originalPath = process.env.PATH
    process.env.PATH = dir
    try {
      // Other install locations may hold the real CLI on a dev machine; only assert when none does.
      const result = await locateCli(loadTester).catch((e: unknown) => e)
      if (result instanceof HeyBinaryError) expect(result.message).not.toMatch(/too old/)
      else expect((result as { path: string }).path).not.toBe(loadTester)
    } finally {
      process.env.PATH = originalPath
    }
    const old = await script(dir, 'old-hey', 'hey version 1.2.0')
    await expect(locateCli(old)).rejects.toThrow(/too old/)
  })

  it('compares versions numerically', () => {
    expect(compareVersions('1.10.0', '1.6.0')).toBeGreaterThan(0)
    expect(compareVersions('1.6.0', '1.6.0')).toBe(0)
    expect(compareVersions('0.9.9', '1.0.0')).toBeLessThan(0)
  })
})

describe('HeyClient', () => {
  const box = (postings: unknown[], next_page: string | null = null) =>
    ok({ id: 1, kind: 'imbox', name: 'Imbox', next_page, postings })

  it('splits a box page into box, postings and cursor', async () => {
    const { runner } = runnerWith([['box view imbox', box([posting()], 'abc')]])
    const page = await new HeyClient(runner).boxPage('imbox')
    expect(page.box).toMatchObject({ id: 1, kind: 'imbox' })
    expect(page.postings).toHaveLength(1)
    expect(page.nextPage).toBe('abc')
  })

  it('confirms a seen mark by re-reading the box', async () => {
    const { runner, calls } = runnerWith([
      ['seen 100', ok({})],
      ['box view 1', box([posting({ seen: true })])],
    ])
    await expect(new HeyClient(runner).markSeen(PostingId(100), 1)).resolves.toEqual({ verified: true })
    expect(calls.map((c) => c[0])).toEqual(['seen', 'box'])
  })

  it('reports a seen mark that did not take', async () => {
    const { runner } = runnerWith([
      ['seen 100', ok({})],
      ['box view 1', box([posting()])], // seen absent = still unseen
    ])
    await expect(new HeyClient(runner).markSeen(PostingId(100), 1)).resolves.toEqual({ verified: false })
  })

  it('reports an unverifiable mark when the posting is not found', async () => {
    const { runner } = runnerWith([
      ['seen 999', ok({})],
      ['box view 1', box([posting()])],
    ])
    await expect(new HeyClient(runner).markSeen(PostingId(999), 1)).resolves.toEqual({ verified: null })
  })

  it('confirms a move by finding the same box item in the destination', async () => {
    const { runner } = runnerWith([
      ['move 100 --to feedbox', ok({})],
      ['box view feedbox', box([posting({ id: 100 })])],
    ])
    expect(await new HeyClient(runner).move(PostingId(100), 'feedbox', 1)).toEqual({ verified: true })
  })

  it('reports a move that did not happen when the thread is still in its old box', async () => {
    const { runner } = runnerWith([
      ['move 100 --to feedbox', ok({})],
      ['box view feedbox', box([])],
      ['box view 1', box([posting({ id: 100 })])],
    ])
    expect(await new HeyClient(runner).move(PostingId(100), 'feedbox', 1)).toEqual({ verified: false })
  })

  it("can't confirm a move when the thread is in neither box", async () => {
    const { runner } = runnerWith([
      ['move 100 --to feedbox', ok({})],
      ['box view feedbox', box([])],
      ['box view 1', box([])],
    ])
    expect(await new HeyClient(runner).move(PostingId(100), 'feedbox', 1)).toEqual({ verified: null })
  })
})
