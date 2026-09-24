import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AvatarCache, type AvatarFetch } from '../src/cache/avatars'

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47])
const url = (id: string) => `https://app.hey.com/avatars/${id}--abc123?v=def456`

function cache(responses: Record<string, { ok?: boolean; contentType: string; body?: Uint8Array } | Error>) {
  const calls: string[] = []
  const fetchImpl: AvatarFetch = async (u) => {
    calls.push(u)
    const r = responses[u]
    if (r instanceof Error) throw r
    if (!r) throw new Error(`unexpected ${u}`)
    return { ok: r.ok ?? true, contentType: r.contentType, body: r.body ?? PNG }
  }
  const dir = mkdtempSync(join(tmpdir(), 'avatars-'))
  return { avatars: new AvatarCache(dir, fetchImpl), calls, dir }
}

describe('AvatarCache', () => {
  it('downloads a real image once and serves it from disk afterwards', async () => {
    const { avatars, calls } = cache({ [url('logo')]: { contentType: 'image/png' } })
    const [a, b] = await Promise.all([avatars.get(url('logo')), avatars.get(url('logo'))])
    expect(a?.contentType).toBe('image/png')
    expect(readFileSync(a!.path)).toEqual(Buffer.from(PNG))
    expect(b).toEqual(a)
    await avatars.get(url('logo'))
    expect(calls).toHaveLength(1)
  })

  it('remembers that an avatar is only initials and never refetches it', async () => {
    const { avatars, calls, dir } = cache({ [url('initials')]: { contentType: 'image/svg+xml' } })
    expect(await avatars.get(url('initials'))).toBeNull()
    expect(await avatars.get(url('initials'))).toBeNull()
    expect(calls).toHaveLength(1)
    expect(existsSync(dir)).toBe(true)
  })

  it('retries after a network failure', async () => {
    const responses: Parameters<typeof cache>[0] = { [url('flaky')]: new Error('offline') }
    const { avatars, calls } = cache(responses)
    expect(await avatars.get(url('flaky'))).toBeNull()
    responses[url('flaky')] = { contentType: 'image/jpeg' }
    expect((await avatars.get(url('flaky')))?.contentType).toBe('image/jpeg')
    expect(calls).toHaveLength(2)
  })

  it('only fetches HEY avatar URLs', async () => {
    const { avatars, calls } = cache({})
    for (const bad of [
      'https://evil.example/avatars/x',
      'http://app.hey.com/avatars/x',
      'https://app.hey.com/avatars/../../etc',
      'https://app.hey.com/other/x',
      'file:///etc/passwd',
    ]) {
      expect(await avatars.get(bad)).toBeNull()
    }
    expect(calls).toHaveLength(0)
  })

  it('refuses oversized images', async () => {
    const { avatars } = cache({ [url('huge')]: { contentType: 'image/png', body: new Uint8Array(2_000_000) } })
    expect(await avatars.get(url('huge'))).toBeNull()
  })
})
