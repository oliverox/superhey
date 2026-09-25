// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AiSettings, AiStatus, AiTestResult, ApiEvent, ProviderId } from '@shared/api'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** A stand-in for the main process: holds the settings and key, and says what changed. */
const REGISTRY = [
  { id: 'claude', name: 'Claude', company: 'Anthropic', blurb: 'Anthropic’s models.', keyUrl: 'https://console.anthropic.com/settings/keys', keyPlaceholder: 'sk-ant-…', prefix: 'sk-ant-', defaults: { cheap: 'claude-haiku-4-5', quality: 'claude-sonnet-5' } },
  { id: 'openai', name: 'OpenAI', company: 'OpenAI', blurb: 'OpenAI’s GPT models.', keyUrl: 'https://platform.openai.com/api-keys', keyPlaceholder: 'sk-…', prefix: 'sk-', defaults: { cheap: 'gpt-6-luna', quality: 'gpt-6-sol' } },
  { id: 'grok', name: 'Grok', company: 'xAI', blurb: 'xAI’s Grok models.', keyUrl: 'https://console.x.ai', keyPlaceholder: 'xai-…', prefix: 'xai-', defaults: { cheap: 'grok-4.3', quality: 'grok-4.7' } },
] as const
const MODELS: AiStatus['models'] = [
  { id: 'claude-haiku-4-5', provider: 'claude', name: 'Claude Haiku 4.5', price: { input: 1, output: 5 } },
  { id: 'claude-sonnet-5', provider: 'claude', name: 'Claude Sonnet 5', price: { input: 2, output: 10 } },
  { id: 'claude-fable-5-1', provider: 'claude', name: 'Claude Fable 5.1', price: { input: 10, output: 50 } },
  { id: 'gpt-6-luna', provider: 'openai', name: 'GPT-6 Luna', price: { input: 0.1, output: 0.5 } },
  { id: 'gpt-6-sol', provider: 'openai', name: 'GPT-6 Sol', price: { input: 2, output: 10 } },
  { id: 'grok-4.3', provider: 'grok', name: 'Grok 4.3', price: { input: 1.25, output: 2.5 } },
  { id: 'grok-4.7', provider: 'grok', name: 'Grok 4.7', price: { input: 2, output: 6 } },
]

/** A stand-in for the main process: holds the settings and keys, and says what changed. */
function fakeBackend() {
  const listeners = new Set<(e: ApiEvent) => void>()
  const state = {
    settings: {
      providers: {},
      order: ['claude', 'openai', 'grok'],
      local: { enabled: false, baseUrl: 'http://localhost:11434/v1', model: '' },
      tasks: {},
      monthlyBudgetUsd: 5,
    } as AiSettings,
    keys: { claude: null, openai: null, grok: null } as Record<ProviderId, string | null>,
    spent: 0.42,
    localModels: ['llama3.2', 'qwen3:8b'] as string[] | Error,
    test: { ok: true, engine: 'claude', model: 'claude-haiku-4-5', ms: 812, reply: 'OK', costUsd: 0.0001 } as AiTestResult,
  }
  const def = (id: ProviderId) => REGISTRY.find((r) => r.id === id)!
  const on = (id: ProviderId) => state.settings.providers[id]?.enabled ?? true
  const modelFor = (id: ProviderId, tier: 'cheap' | 'quality') => state.settings.providers[id]?.models?.[tier] ?? def(id).defaults[tier]
  const status = (): AiStatus => {
    const s = state.settings
    const ready = s.order.filter((id) => state.keys[id] && on(id))
    const cloud = ready[0] ?? null
    const local = s.local.enabled && !!s.local.model
    const runsOn = (tier: 'cheap' | 'quality') =>
      cloud ? { engine: cloud, model: modelFor(cloud, tier) } : local ? { engine: 'local' as const, model: s.local.model } : { engine: null, reason: 'Add an AI provider or a local model in Settings.' }
    return {
      settings: structuredClone(s),
      mode: { cloud, local },
      providers: s.order.map((id) => {
        const { prefix: _p, defaults: _d, ...info } = def(id)
        const k = state.keys[id]
        return { ...info, hint: k ? `${def(id).prefix}…${k.slice(-4)}` : null, enabled: on(id), models: { cheap: modelFor(id, 'cheap'), quality: modelFor(id, 'quality') } }
      }),
      canStoreKey: true,
      tasks: [
        { id: 'summary', label: 'Thread summaries', tier: 'cheap', runsOn: runsOn('cheap') },
        { id: 'draft', label: 'Reply drafts in your voice', tier: 'quality', runsOn: runsOn('quality') },
      ],
      models: MODELS,
      month: {
        since: new Date(2026, 8, 1).toISOString(),
        spentUsd: state.spent,
        budgetUsd: s.monthlyBudgetUsd,
        calls: 3,
        byTask: [{ task: 'summary', engine: 'claude', model: 'claude-haiku-4-5', calls: 3, input: 12_300, output: 812, costUsd: 0.42 }],
      },
    }
  }
  const changed = () => listeners.forEach((l) => l({ type: 'ai' }))
  const calls: Array<[string, unknown[]]> = []
  const methods: Record<string, (...a: never[]) => unknown> = {
    aiStatus: () => status(),
    setAiSettings: (s: AiSettings) => ((state.settings = s), changed(), status()),
    setApiKey: (provider: ProviderId, k: string | null) => {
      if (k !== null && !k.startsWith(def(provider).prefix)) throw new Error(`That doesn’t look like an ${def(provider).company} API key.`)
      if (k !== null && provider !== 'claude' && k.startsWith('sk-ant-')) throw new Error(`That looks like a Claude key, not ${provider === 'openai' ? 'an' : 'a'} ${def(provider).name} one.`)
      state.keys[provider] = k
      changed()
      return status()
    },
    localModels: () => {
      if (state.localModels instanceof Error) throw state.localModels
      return state.localModels
    },
    testAi: () => state.test,
  }
  const bridge = {
    call: async (method: string, args: unknown[]) => {
      calls.push([method, args])
      return (methods[method] as (...a: unknown[]) => unknown)(...args)
    },
    onEvent: (cb: (e: ApiEvent) => void) => (listeners.add(cb), () => listeners.delete(cb)),
  }
  return { state, calls, bridge, called: (m: string) => calls.filter(([name]) => name === m).map(([, a]) => a) }
}

let backend: ReturnType<typeof fakeBackend>
let Settings: typeof import('./Settings').Settings
let money: typeof import('./Settings').money
let tokens: typeof import('./Settings').tokens
let root: Root
let host: HTMLElement

beforeAll(async () => {
  // The page picks its bridge when it loads; this one forwards to the current fake backend.
  window.bridge = { call: (m, a) => backend.bridge.call(m, a), onEvent: (cb) => backend.bridge.onEvent(cb) }
  ;({ Settings, money, tokens } = await import('./Settings'))
})
beforeEach(() => {
  // Only the timers: the page reloads 150 ms after a change event, and the tests step past it.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  backend = fakeBackend()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.useRealTimers()
})

/** Lets calls answer, change events arrive, and the page reload (twice over, for chains). */
const flush = () =>
  act(async () => {
    for (let round = 0; round < 2; round++) {
      for (let i = 0; i < 5; i++) await Promise.resolve()
      vi.advanceTimersByTime(200)
    }
    for (let i = 0; i < 5; i++) await Promise.resolve()
  })
async function open(onClose = vi.fn()) {
  act(() => root.render(createElement(Settings, { onClose })))
  await flush()
  return onClose
}
const text = () => host.textContent ?? ''
const byLabel = <T extends HTMLElement>(label: string) => host.querySelector<T>(`[aria-label="${label}"]`)!
const button = (name: string) => [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === name)!
const sw = (label: string) => [...host.querySelectorAll('[role=switch]')].find((b) => b.closest('label')?.textContent?.includes(label) || b.getAttribute('aria-label') === label) as HTMLButtonElement
async function click(el: Element) {
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await flush()
}
async function typeInto(el: HTMLInputElement | HTMLSelectElement, value: string) {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype
  act(() => {
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value)
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
  })
  await flush()
}
async function key(el: Element, k: string) {
  act(() => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }))
  })
  await flush()
}

const CLAUDE_KEY = 'sk-ant-api03-old-old-old-old-ABCD'
const rows = () => [...host.querySelectorAll('[aria-label="Connected providers"] > li')].map((li) => li.getAttribute('aria-label'))
const row = (name: string) => host.querySelector<HTMLElement>(`[aria-label="Connected providers"] > li[aria-label="${name}"]`)!
const within = (el: Element, name: string) => [...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === name)!
/** Opens a provider's ⋯ menu and picks an item. */
async function menu(name: string, item: string) {
  await click(byLabel(`${name} options`))
  await click([...host.querySelectorAll('[role=menuitem]')].find((i) => i.textContent === item)!)
}

describe('Settings: providers', () => {
  it('starts with none connected, and adds one from the list with its key', async () => {
    await open()
    expect(text()).toContain('AI is off until you add a provider')
    expect(text()).toContain('No provider yet.')
    await click(button('+ Add provider'))
    const choices = [...host.querySelectorAll('[aria-label="Choose a provider"] button')].map((b) => b.textContent)
    expect(choices).toEqual(['ClaudeAnthropic’s models.', 'OpenAIOpenAI’s GPT models.', 'GrokxAI’s Grok models.', 'Cancel'])
    await click([...host.querySelectorAll('[aria-label="Choose a provider"] button')][2]!)
    expect(text()).toContain('Add Grok')
    const input = byLabel<HTMLInputElement>('Grok API key')
    expect(input.type).toBe('password')
    expect(document.activeElement).toBe(input)
    expect(host.querySelector('a[href="https://console.x.ai"]')?.textContent).toBe('console.x.ai')
    await typeInto(input, 'xai-secretsecretsecretsecret-MNOP')
    await click(button('Save'))
    expect(backend.called('setApiKey')).toEqual([['grok', 'xai-secretsecretsecretsecret-MNOP']])
    expect(rows()).toEqual(['Grok'])
    expect(byLabel('Stored Grok key').textContent).toBe('xai-…MNOP')
    expect(text()).not.toContain('secretsecret')
    expect(text()).toContain('Grok 4.3 for quick tasks · Grok 4.7 for the rest')
    expect(text()).toContain('Everything runs on Grok.')
    // Only the ones not yet connected are offered next.
    await click(button('+ Add provider'))
    expect([...host.querySelectorAll('[aria-label="Choose a provider"] button')].map((b) => b.textContent?.slice(0, 6))).toEqual(['Claude', 'OpenAI', 'Cancel'])
  })

  it('shows why a key was refused, and keeps what was typed', async () => {
    await open()
    await click(button('+ Add provider'))
    await click([...host.querySelectorAll('[aria-label="Choose a provider"] button')][1]!)
    await typeInto(byLabel<HTMLInputElement>('OpenAI API key'), CLAUDE_KEY)
    await click(button('Save'))
    expect(text()).toContain('That looks like a Claude key, not an OpenAI one.')
    expect(byLabel<HTMLInputElement>('OpenAI API key').value).toBe(CLAUDE_KEY)
    expect(rows()).toEqual([])
  })

  it('orders the connected providers, and automatic tasks follow the first', async () => {
    backend.state.keys = { claude: CLAUDE_KEY, openai: 'sk-proj-old-old-old-old-EFGH', grok: 'xai-old-old-old-old-IJKL' }
    await open()
    expect(rows()).toEqual(['Claude', 'OpenAI', 'Grok'])
    expect(byLabel<HTMLButtonElement>('Move Claude up').disabled).toBe(true)
    await click(byLabel('Move Grok up'))
    expect(backend.called('setAiSettings').at(-1)![0]).toMatchObject({ order: ['claude', 'grok', 'openai'] })
    expect(rows()).toEqual(['Claude', 'Grok', 'OpenAI'])
    await click(byLabel('Move Claude down'))
    expect(rows()).toEqual(['Grok', 'Claude', 'OpenAI'])
    expect(text()).toContain('Everything runs on Grok.')
  })

  it('moves among connected providers only, keeping the rest of the order', async () => {
    backend.state.keys = { claude: CLAUDE_KEY, openai: null, grok: 'xai-old-old-old-old-IJKL' }
    await open()
    await click(byLabel('Move Grok up'))
    // OpenAI (not connected) keeps its place between them.
    expect(backend.called('setAiSettings').at(-1)![0]).toMatchObject({ order: ['grok', 'openai', 'claude'] })
  })

  it('tests a provider and says how it went', async () => {
    backend.state.keys.claude = CLAUDE_KEY
    await open()
    await click(within(row('Claude'), 'Test'))
    expect(backend.called('testAi')).toEqual([['claude']])
    expect(row('Claude').textContent).toContain('Haiku 4.5 answered in 0.8 s · $0.0001')
    backend.state.test = { ok: false, code: 'auth', message: 'Claude didn’t accept the API key.' }
    await click(within(row('Claude'), 'Test'))
    expect(row('Claude').textContent).toContain('Claude didn’t accept the API key.')
  })

  it('changes a provider’s models, turns it off and on, replaces and removes its key', async () => {
    backend.state.keys.claude = CLAUDE_KEY
    await open()
    await menu('Claude', 'Change models…')
    await typeInto(byLabel<HTMLSelectElement>('Claude: model for the rest'), 'claude-fable-5-1')
    expect(backend.called('setAiSettings').at(-1)![0]).toMatchObject({ providers: { claude: { enabled: true, models: { quality: 'claude-fable-5-1' } } } })
    expect(row('Claude').textContent).toContain('Haiku 4.5 for quick tasks · Fable 5.1 for the rest')

    await menu('Claude', 'Turn off')
    expect(backend.called('setAiSettings').at(-1)![0]).toMatchObject({ providers: { claude: { enabled: false, models: { quality: 'claude-fable-5-1' } } } })
    expect(row('Claude').textContent).toContain('off')
    expect(within(row('Claude'), 'Test').disabled).toBe(true)
    await menu('Claude', 'Turn on')
    expect(backend.called('setAiSettings').at(-1)![0]).toMatchObject({ providers: { claude: { enabled: true } } })

    await menu('Claude', 'Replace key…')
    expect(document.activeElement).toBe(byLabel('Claude API key'))
    await typeInto(byLabel<HTMLInputElement>('Claude API key'), 'sk-ant-api03-new-new-new-new-WXYZ')
    await click(within(row('Claude'), 'Save'))
    expect(backend.called('setApiKey').at(-1)).toEqual(['claude', 'sk-ant-api03-new-new-new-new-WXYZ'])
    expect(byLabel('Stored Claude key').textContent).toBe('sk-ant-…WXYZ')

    await menu('Claude', 'Remove')
    expect(backend.called('setApiKey').at(-1)).toEqual(['claude', null])
    expect(rows()).toEqual([])
  })
})

describe('Settings: local model', () => {
  it('turns on, lists the server’s models, and saves the one chosen', async () => {
    await open()
    await click(sw('Use a local model'))
    expect(backend.called('setAiSettings').at(-1)![0]).toMatchObject({ local: { enabled: true } })
    expect(backend.called('localModels').at(-1)).toEqual(['http://localhost:11434/v1'])
    const select = byLabel<HTMLSelectElement>('Local model')
    expect([...select.options].map((o) => o.value)).toEqual(['', 'llama3.2', 'qwen3:8b'])
    await typeInto(select, 'qwen3:8b')
    expect(backend.called('setAiSettings').at(-1)![0]).toMatchObject({ local: { enabled: true, model: 'qwen3:8b' } })
    expect(text()).toContain('Everything runs on qwen3:8b, on this Mac.')
  })

  it('switches servers with the presets, and says when one isn’t running', async () => {
    backend.state.settings.local.enabled = true
    backend.state.localModels = new Error('Can’t reach http://localhost:1234/v1. Is Ollama or LM Studio running?')
    await open()
    await click(button('LM Studio'))
    expect(backend.called('setAiSettings').at(-1)![0]).toMatchObject({ local: { baseUrl: 'http://localhost:1234/v1' } })
    expect(text()).toContain('Is Ollama or LM Studio running?')
    expect(byLabel<HTMLSelectElement>('Local model').disabled).toBe(true)
  })

  it('saves a typed address on Enter', async () => {
    backend.state.settings.local.enabled = true
    await open()
    const input = byLabel<HTMLInputElement>('Local server address')
    await typeInto(input, 'http://192.168.1.20:11434/v1')
    await key(input, 'Enter')
    expect(backend.called('setAiSettings').at(-1)![0]).toMatchObject({ local: { baseUrl: 'http://192.168.1.20:11434/v1' } })
  })
})

describe('Settings: tasks, budget and usage', () => {
  it('pins a task to a connected provider or model, or turns it off', async () => {
    backend.state.keys = { claude: CLAUDE_KEY, openai: null, grok: 'xai-old-old-old-old-IJKL' }
    await open()
    expect(text()).toContain('Haiku 4.5') // what summaries run on
    const engines = [...byLabel<HTMLSelectElement>('Reply drafts in your voice: engine').options].map((o) => o.textContent)
    expect(engines).toEqual(['Automatic', 'Claude', 'Grok', 'Local model']) // OpenAI isn't connected
    const models = () => [...byLabel<HTMLSelectElement>('Reply drafts in your voice: model').options].map((o) => o.textContent)
    expect(models()).toEqual(['Sonnet 5 (default)', 'Haiku 4.5 · $1/$5', 'Sonnet 5 · $2/$10', 'Fable 5.1 · $10/$50'])
    await typeInto(byLabel<HTMLSelectElement>('Reply drafts in your voice: engine'), 'grok')
    expect(backend.called('setAiSettings').at(-1)![0]).toMatchObject({ tasks: { draft: { engine: 'grok', enabled: true } } })
    expect(models()).toEqual(['Grok 4.7 (default)', 'Grok 4.3 · $1.25/$2.5', 'Grok 4.7 · $2/$6'])
    await typeInto(byLabel<HTMLSelectElement>('Thread summaries: model'), 'claude-sonnet-5')
    expect(backend.called('setAiSettings').at(-1)![0]).toMatchObject({ tasks: { summary: { model: 'claude-sonnet-5' } } })
    await click(sw('Thread summaries: on'))
    expect(backend.called('setAiSettings').at(-1)![0]).toMatchObject({ tasks: { summary: { enabled: false } } })
  })

  it('shows the month’s spend against the budget, and the calls behind it', async () => {
    await open()
    expect(text()).toContain('$0.42 of $5.00 in September')
    expect(byLabel('Spent this month').getAttribute('aria-valuenow')).toBe('0.42')
    const row = [...host.querySelectorAll('tbody tr')].at(-1)!.textContent
    expect(row).toBe('Thread summariesHaiku 4.5312.3k / 812$0.42')
  })

  it('changes the budget on Enter, and can lift it', async () => {
    await open()
    const input = byLabel<HTMLInputElement>('Monthly budget in dollars')
    await typeInto(input, '12.345')
    await key(input, 'Enter')
    expect(backend.called('setAiSettings').at(-1)![0]).toMatchObject({ monthlyBudgetUsd: 12.35 })
    await typeInto(input, 'lots')
    await key(input, 'Enter')
    expect(backend.called('setAiSettings')).toHaveLength(1) // nonsense isn't saved
    expect(input.value).toBe('12.35')
    await click(sw('No limit'))
    expect(backend.called('setAiSettings').at(-1)![0]).toMatchObject({ monthlyBudgetUsd: null })
    expect(host.querySelector('[role=meter]')).toBeNull()
  })

  it('warns when the budget is used up', async () => {
    backend.state.spent = 5.01
    await open()
    expect(text()).toContain('The budget is used up')
  })

  it('closes on Esc', async () => {
    const onClose = await open()
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }))
    })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('formatting', () => {
  it('writes money with enough digits to see small amounts', () => {
    expect(money(0)).toBe('$0.00')
    expect(money(0.0031)).toBe('$0.0031')
    expect(money(0.00004)).toBe('<$0.0001') // a connection test: never shown as $0.0000
    expect(money(1.5)).toBe('$1.50')
  })
  it('writes token counts compactly', () => {
    expect([tokens(812), tokens(12_345), tokens(123_456), tokens(1_234_567)]).toEqual(['812', '12.3k', '123k', '1.2M'])
  })
})
