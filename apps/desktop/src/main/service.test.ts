import { EventEmitter } from 'node:events'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, Repo, type Core } from '@myhey/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiEvent } from '../shared/api'
import { AppService, type SecretStore } from './service'

// A core that needs neither the HEY CLI nor the network: only the cache is real.
function fakeCore(): Core {
  const engine = Object.assign(new EventEmitter(), {
    start: async () => {},
    stop: () => {},
    getStatus: () => ({ initialSyncDone: true, watch: 'live', lastError: null }),
    backfillBox: async () => 0,
  })
  return {
    cli: { path: '/fake/hey', version: '1.6.0' },
    repo: new Repo(openDb(':memory:')),
    engine,
    actions: new EventEmitter(),
    outbox: new EventEmitter(),
  } as unknown as Core
}

function memorySecrets(available = true): SecretStore & { values: Map<string, string> } {
  const values = new Map<string, string>()
  return {
    values,
    available: () => available,
    get: (name) => values.get(name) ?? null,
    set: (name, value) => (value == null ? values.delete(name) : values.set(name, value)) && undefined,
  }
}

const KEY = 'sk-ant-api03-' + 'a'.repeat(40) + 'WXYZ'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'myhey-service-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

/** `secrets: null` for none, as in browser dev mode. */
async function service(secrets: SecretStore | null = memorySecrets()) {
  const s = new AppService({ dbPath: join(dir, 'cache.db'), openFile: async () => {}, secrets: secrets ?? undefined, createCore: async () => fakeCore() })
  await s.boot()
  const events: ApiEvent[] = []
  s.on('event', (e) => events.push(e))
  return { s, events }
}

const OPENAI_KEY = 'sk-proj-' + 'b'.repeat(40) + 'QRST'

describe('AI settings in the service', () => {
  it('starts from the defaults, with nothing set up', async () => {
    const { s } = await service()
    const status = await s.aiStatus()
    expect(status).toMatchObject({ mode: { cloud: null, local: false }, keys: { claude: { hint: null }, openai: { hint: null } }, canStoreKey: true, month: { spentUsd: 0, budgetUsd: 5, calls: 0 } })
    expect(status.tasks.map((t) => t.id)).toEqual(['summary', 'classify', 'extract', 'draft', 'agent', 'insights'])
    expect(status.tasks[0]!.runsOn).toMatchObject({ engine: null })
    expect(new Set(status.models.map((m) => m.provider))).toEqual(new Set(['claude', 'openai']))
  })

  it('stores each key in the secret store and only ever shows a hint of it', async () => {
    const secrets = memorySecrets()
    const { s, events } = await service(secrets)
    let status = await s.setApiKey('claude', `  ${KEY}\n`) // pasted with spaces around it
    expect(secrets.values.get('anthropic-api-key')).toBe(KEY)
    expect(status.keys.claude.hint).toBe('sk-ant-…WXYZ')
    expect(status.mode.cloud).toBe('claude')
    expect(status.tasks.find((t) => t.id === 'summary')!.runsOn).toEqual({ engine: 'claude', model: 'claude-haiku-4-5-20251001' })

    status = await s.setApiKey('openai', OPENAI_KEY)
    expect(secrets.values.get('openai-api-key')).toBe(OPENAI_KEY)
    expect(status.keys.openai.hint).toBe('sk-…QRST')
    expect(status.mode.cloud).toBe('claude') // still preferred
    status = await s.setAiSettings({ ...status.settings, preferredCloud: 'openai' })
    expect(status.tasks.find((t) => t.id === 'summary')!.runsOn).toEqual({ engine: 'openai', model: 'gpt-6-luna' })

    // Nothing the UI can read holds either key.
    const readable = JSON.stringify([await s.aiStatus(), events])
    expect(readable).not.toContain(KEY.slice(10, -4))
    expect(readable).not.toContain(OPENAI_KEY.slice(10, -4))
    expect(events).toContainEqual({ type: 'ai' })

    await s.setApiKey('claude', null)
    expect([...secrets.values.keys()]).toEqual(['openai-api-key'])
    expect((await s.aiStatus()).keys.claude.hint).toBeNull()
  })

  it('refuses keys that do not belong to the provider, keeping the ones stored', async () => {
    const secrets = memorySecrets()
    const { s } = await service(secrets)
    await s.setApiKey('claude', KEY)
    await s.setApiKey('openai', OPENAI_KEY)
    for (const bad of ['', 'sk-proj-abc', OPENAI_KEY, 'sk-ant-short', 'sk-ant-' + 'a'.repeat(30) + ' b', 42, { key: KEY }]) {
      await expect(s.setApiKey('claude', bad)).rejects.toThrow(/Anthropic API key/)
    }
    // An Anthropic key pasted into OpenAI's field is a mistake, not an OpenAI key.
    for (const bad of ['', 'sk-short', KEY, 'pk-' + 'a'.repeat(30)]) await expect(s.setApiKey('openai', bad)).rejects.toThrow(/OpenAI API key/)
    await expect(s.setApiKey('gemini', KEY)).rejects.toThrow(/bad provider/)
    expect(secrets.values.get('anthropic-api-key')).toBe(KEY)
    expect(secrets.values.get('openai-api-key')).toBe(OPENAI_KEY)
  })

  it('cannot store a key where there is no secret store (browser dev mode)', async () => {
    const { s } = await service(null)
    await expect(s.setApiKey('claude', KEY)).rejects.toThrow(/browser dev mode/)
    expect((await s.aiStatus()).canStoreKey).toBe(false)
  })

  it('saves settings to disk and reads them back on the next start', async () => {
    const { s } = await service()
    const next = { ...(await s.aiStatus()).settings, monthlyBudgetUsd: 12.5, local: { enabled: true, baseUrl: 'http://localhost:1234/v1', model: 'qwen3:8b' } }
    const status = await s.setAiSettings(next)
    expect(status).toMatchObject({ mode: { cloud: null, local: true }, month: { budgetUsd: 12.5 } })
    expect(JSON.parse(readFileSync(join(dir, 'ai-settings.json'), 'utf8'))).toMatchObject({ monthlyBudgetUsd: 12.5, local: { model: 'qwen3:8b' } })

    const again = await service()
    expect((await again.s.aiStatus()).settings).toEqual(status.settings)
  })

  it('refuses invalid settings and keeps the saved ones', async () => {
    const { s } = await service()
    const before = (await s.aiStatus()).settings
    await expect(s.setAiSettings({ ...before, monthlyBudgetUsd: -1 })).rejects.toThrow(/Invalid AI settings/)
    await expect(s.setAiSettings({ ...before, local: { enabled: true, baseUrl: 'javascript:alert(1)', model: 'x' } })).rejects.toThrow(/Invalid/)
    await expect(s.setAiSettings({ ...before, tasks: { summary: { engine: 'gpt' } } })).rejects.toThrow(/Invalid/)
    expect((await s.aiStatus()).settings).toEqual(before)
  })

  it('reports a connection test that cannot run, instead of throwing', async () => {
    const { s } = await service()
    expect(await s.testAi('claude')).toEqual({ ok: false, code: 'not-set-up', message: 'Add an Anthropic API key first.' })
    expect(await s.testAi('openai')).toEqual({ ok: false, code: 'not-set-up', message: 'Add an OpenAI API key first.' })
    expect(await s.testAi('local')).toEqual({ ok: false, code: 'not-set-up', message: 'Choose a local model first.' })
    await expect(s.testAi('gpt')).rejects.toThrow(/bad engine/)
  })

  it('only asks http(s) addresses for local models', async () => {
    const { s } = await service()
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    for (const bad of ['file:///etc/passwd', 'localhost:11434', '', 7]) await expect(s.localModels(bad)).rejects.toThrow(/http/)
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })
})
