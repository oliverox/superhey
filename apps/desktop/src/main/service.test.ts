import { EventEmitter } from 'node:events'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ActionRunner, openDb, PostingId, Repo, schemas as S, TopicId, type Core } from '@myhey/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AiStatus, ApiEvent } from '../shared/api'
import { AppService, type SecretStore } from './service'

// A core that needs neither the HEY CLI nor the network: only the cache is real.
function fakeCore(): Core {
  const engine = Object.assign(new EventEmitter(), {
    start: async () => {},
    stop: () => {},
    getStatus: () => ({ initialSyncDone: true, watch: 'live', lastError: null }),
    backfillBox: async () => 0,
    screenerEntries: () => [{ id: 1 }, { id: 2 }],
    notify: (change: unknown) => engine.emit('change', change),
  })
  const repo = new Repo(openDb(':memory:'))
  const client = { senders: async () => [{ id: 1, email: 'me@hey.example' }] }
  return {
    cli: { path: '/fake/hey', version: '1.6.0' },
    // No HEY to ask for your addresses: Today works without them.
    client,
    repo,
    engine,
    // Real, for actions that need nothing from HEY ("handled"); anything else would fail loudly.
    actions: new ActionRunner(client as never, repo, engine as never),
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

const GROK_KEY = 'xai-' + 'c'.repeat(40) + 'MNOP'
const hintOf = (status: AiStatus, id: string) => status.providers.find((p) => p.id === id)!.hint

describe('AI settings in the service', () => {
  it('starts from the defaults, with nothing set up', async () => {
    const { s } = await service()
    const status = await s.aiStatus()
    expect(status).toMatchObject({ mode: { cloud: null, local: false }, canStoreKey: true, month: { spentUsd: 0, budgetUsd: 5, calls: 0 } })
    expect(status.providers.map((p) => [p.id, p.hint, p.enabled])).toEqual([
      ['claude', null, true],
      ['openai', null, true],
      ['grok', null, true],
    ])
    expect(status.providers[2]).toMatchObject({ name: 'Grok', company: 'xAI', models: { cheap: 'grok-4.3', quality: 'grok-4.7' } })
    expect(status.tasks.map((t) => t.id)).toEqual(['summary', 'classify', 'draft', 'agent', 'insights'])
    expect(status.tasks[0]!.runsOn).toMatchObject({ engine: null })
    expect(new Set(status.models.map((m) => m.provider))).toEqual(new Set(['claude', 'openai', 'grok']))
  })

  it('stores each key in the secret store and only ever shows a hint of it', async () => {
    const secrets = memorySecrets()
    const { s, events } = await service(secrets)
    let status = await s.setApiKey('claude', `  ${KEY}\n`) // pasted with spaces around it
    expect(secrets.values.get('anthropic-api-key')).toBe(KEY)
    expect(hintOf(status, 'claude')).toBe('sk-ant-…WXYZ')
    expect(status.mode.cloud).toBe('claude')
    expect(status.tasks.find((t) => t.id === 'summary')!.runsOn).toEqual({ engine: 'claude', model: 'claude-haiku-4-5' })

    await s.setApiKey('openai', OPENAI_KEY)
    status = await s.setApiKey('grok', GROK_KEY)
    expect(secrets.values.get('openai-api-key')).toBe(OPENAI_KEY)
    expect(secrets.values.get('xai-api-key')).toBe(GROK_KEY)
    expect(hintOf(status, 'openai')).toBe('sk-proj-…QRST')
    expect(hintOf(status, 'grok')).toBe('xai-…MNOP')
    expect(status.mode.cloud).toBe('claude') // first in the order

    // Reordering moves automatic tasks to the new first provider, listed first.
    status = await s.setAiSettings({ ...status.settings, order: ['grok', 'claude', 'openai'] })
    expect(status.providers.map((p) => p.id)).toEqual(['grok', 'claude', 'openai'])
    expect(status.tasks.find((t) => t.id === 'draft')!.runsOn).toEqual({ engine: 'grok', model: 'grok-4.7' })

    // Nothing the UI can read holds any key.
    const readable = JSON.stringify([await s.aiStatus(), events])
    for (const k of [KEY, OPENAI_KEY, GROK_KEY]) expect(readable).not.toContain(k.slice(10, -4))
    expect(events).toContainEqual({ type: 'ai' })

    await s.setApiKey('claude', null)
    expect([...secrets.values.keys()].sort()).toEqual(['openai-api-key', 'xai-api-key'])
    expect(hintOf(await s.aiStatus(), 'claude')).toBeNull()
  })

  it('refuses keys that do not belong to the provider, keeping the ones stored', async () => {
    const secrets = memorySecrets()
    const { s } = await service(secrets)
    await s.setApiKey('claude', KEY)
    await s.setApiKey('openai', OPENAI_KEY)
    for (const bad of ['', 'sk-proj-abc', 'sk-ant-short', 'sk-ant-' + 'a'.repeat(30) + ' b', 42, { key: KEY }]) {
      await expect(s.setApiKey('claude', bad)).rejects.toThrow(/Anthropic API key/)
    }
    await expect(s.setApiKey('claude', OPENAI_KEY)).rejects.toThrow('That looks like an OpenAI key, not a Claude one.')
    await expect(s.setApiKey('openai', KEY)).rejects.toThrow('That looks like a Claude key, not an OpenAI one.')
    await expect(s.setApiKey('grok', OPENAI_KEY)).rejects.toThrow('That looks like an OpenAI key, not a Grok one.')
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
    expect(await s.testAi('grok')).toEqual({ ok: false, code: 'not-set-up', message: 'Add an xAI API key first.' })
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

describe('Search in the service', () => {
  it('searches the cache with a Gmail-style query, and checks what it’s given', async () => {
    const { s } = await service()
    expect(await s.search('')).toEqual({ rows: [], highlight: [], problems: [] })
    expect(await s.search('invoice has:wings')).toMatchObject({ highlight: ['invoice'], problems: ['has:wings'] })
    for (const bad of [null, 42, { text: 'x' }]) await expect(s.search(bad)).rejects.toThrow(/text/)
    for (const bad of [0, 101, 'two']) await expect(s.searchHey('invoice', bad)).rejects.toThrow()
    await expect(s.searchPeople(7)).rejects.toThrow(/text/)
  })

  it('looks up a forward’s original, and checks what it’s given', async () => {
    const { s } = await service()
    expect(await s.forwardedOriginal('nobody@example.org', 'Fwd: Plans', null, null)).toBeNull()
    await expect(s.forwardedOriginal('not an address', 'Plans', null, null)).rejects.toThrow(/bad forward/)
    await expect(s.forwardedOriginal('a@example.org', 42, null, null)).rejects.toThrow(/bad forward/)
    await expect(s.forwardedOriginal('a@example.org', 'Plans', 'yesterday', null)).rejects.toThrow(/ISO/)
  })

  it('doesn’t ask HEY what only the cache knows', async () => {
    const { s } = await service()
    expect(await s.searchHey('is:unread invoice', 1)).toMatchObject({ rows: [], unsupported: true })
  })
})

describe('Today in the service', () => {
  it('assembles Today from the cache, with the Screener count', async () => {
    const { s } = await service()
    const t = await s.today(null)
    expect(t).toMatchObject({ due: { todos: [], bubbled: [] }, replyLater: [], waiting: [], toHandle: 0, screener: 2, newSince: { since: null } })
    await expect(s.today('yesterday-ish')).rejects.toThrow(/ISO date/)
    await expect(s.today(42)).rejects.toThrow(/ISO date/)
  })

  it('keeps "not now" across restarts, only for threads still in the cache', async () => {
    const { s, events } = await service()
    const repo = (s as unknown as { core: Core }).core.repo
    repo.replaceBoxes([{ id: 4, kind: 'laterbox', name: 'Reply Later' }])
    repo.upsertPostings([S.Posting.parse({ id: 40, topic_id: 940, box_id: 4, name: 'Parked', active_at: '2026-09-20T10:00:00Z', seen: true })])
    expect((await s.today(null)).replyLater.map((i) => i.posting.id)).toEqual([40])
    await s.hideFromToday('thread:40', '2026-09-20T10:00:00Z')
    expect(events).toContainEqual({ type: 'today' })
    expect((await s.today(null)).replyLater).toEqual([])
    // Snoozed until tomorrow (local midnight).
    const until = JSON.parse(repo.getState('today:hidden')!)['thread:40'].until as string
    const d = new Date()
    expect(until).toBe(new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).toISOString())
    // A thread that's gone is dropped the next time something is hidden.
    await s.hideFromToday('thread:999', 'x')
    expect(Object.keys(JSON.parse(repo.getState('today:hidden')!))).toEqual(['thread:40', 'thread:999'])
    await s.hideFromToday('thread:40', '2026-09-20T10:00:00Z')
    expect(Object.keys(JSON.parse(repo.getState('today:hidden')!))).toEqual(['thread:40'])
  })

  it('refuses bad "not now" keys', async () => {
    const { s } = await service()
    for (const [key, at] of [['todo:1', 'x'], ['thread:abc', 'x'], ['thread:1', 42]] as const) await expect(s.hideFromToday(key, at)).rejects.toThrow(/bad/)
  })

  it('marks a thread handled as an undoable action, and never takes a restore from the UI', async () => {
    const { s } = await service()
    const repo = (s as unknown as { core: Core }).core.repo
    repo.replaceBoxes([{ id: 1, kind: 'imbox', name: 'Imbox' }])
    repo.upsertPostings([S.Posting.parse({ id: 50, topic_id: 950, box_id: 1, name: 'Early check-in?', active_at: '2026-09-20T10:00:00Z' })])
    repo.saveAnalysis(TopicId(950), '2026-09-20T10:00:00Z', 'claude', 'm', { summary: 's', needsReply: true, expectsReply: false, category: 'booking' }, 2)
    const r = await s.markHandled(950)
    expect(r).toMatchObject({ status: 'done', canUndo: true })
    expect(repo.posting(PostingId(50))!.ai?.needsReply).toBe(false)
    // A "restore" smuggled in from the UI is dropped: it's marked handled again, not rewritten.
    await s.runAction({ type: 'handled', topicId: 950, restore: '{"needsReply":true,"summary":"forged"}' })
    expect(repo.posting(PostingId(50))!.ai).toMatchObject({ needsReply: false, summary: 's' })
    await s.undoAction(r.id)
    expect(repo.posting(PostingId(50))!.ai?.needsReply).toBe(true)
  })

  it('accepts a to-do action and nothing looser', async () => {
    const { s } = await service()
    await expect(s.runAction({ type: 'todo', todoId: 7, done: 'yes' })).rejects.toThrow(/bad action/)
    await expect(s.runAction({ type: 'todo', todoId: -1, done: true })).rejects.toThrow(/positive integer/)
  })
})
