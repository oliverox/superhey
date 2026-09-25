// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AiSettings, AiStatus, AiTestResult, ApiEvent } from '@shared/api'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** A stand-in for the main process: holds the settings and key, and says what changed. */
function fakeBackend() {
  const listeners = new Set<(e: ApiEvent) => void>()
  const state = {
    settings: { claude: { enabled: true }, local: { enabled: false, baseUrl: 'http://localhost:11434/v1', model: '' }, tasks: {}, monthlyBudgetUsd: 5 } as AiSettings,
    key: null as string | null,
    spent: 0.42,
    localModels: ['llama3.2', 'qwen3:8b'] as string[] | Error,
    test: { ok: true, engine: 'claude', model: 'claude-haiku-4-5-20251001', ms: 812, reply: 'OK', costUsd: 0.0001 } as AiTestResult,
  }
  const status = (): AiStatus => {
    const claude = !!state.key && state.settings.claude.enabled
    const local = state.settings.local.enabled && !!state.settings.local.model
    return {
      settings: structuredClone(state.settings),
      mode: claude && local ? 'mixed' : claude ? 'claude' : local ? 'local' : 'off',
      claude: { keyHint: state.key ? `${state.key.slice(0, 7)}…${state.key.slice(-4)}` : null, canStoreKey: true },
      tasks: [
        { id: 'summary', label: 'Thread summaries', tier: 'cheap', runsOn: claude ? { engine: 'claude', model: 'claude-haiku-4-5-20251001' } : { engine: null, reason: 'Set up Claude or a local model in Settings.' } },
        { id: 'draft', label: 'Reply drafts in your voice', tier: 'quality', runsOn: claude ? { engine: 'claude', model: 'claude-sonnet-5' } : { engine: null, reason: 'Set up Claude or a local model in Settings.' } },
      ],
      models: [
        { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5', price: { input: 1, output: 5 } },
        { id: 'claude-sonnet-5', name: 'Claude Sonnet 5', price: { input: 2, output: 10 } },
      ],
      month: {
        since: new Date(2026, 8, 1).toISOString(),
        spentUsd: state.spent,
        budgetUsd: state.settings.monthlyBudgetUsd,
        calls: 3,
        byTask: [{ task: 'summary', engine: 'claude', model: 'claude-haiku-4-5-20251001', calls: 3, input: 12_300, output: 812, costUsd: 0.42 }],
      },
    }
  }
  const changed = () => listeners.forEach((l) => l({ type: 'ai' }))
  const calls: Array<[string, unknown[]]> = []
  const methods: Record<string, (...a: never[]) => unknown> = {
    aiStatus: () => status(),
    setAiSettings: (s: AiSettings) => ((state.settings = s), changed(), status()),
    setClaudeKey: (k: string | null) => {
      if (k !== null && !k.startsWith('sk-ant-')) throw new Error('That doesn’t look like a Claude API key (they start with “sk-ant-”).')
      state.key = k
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

describe('Settings: Claude', () => {
  it('asks for a key when none is stored, saves it, then shows only a hint', async () => {
    await open()
    expect(text()).toContain('AI is off until you add a Claude key')
    const input = byLabel<HTMLInputElement>('Claude API key')
    expect(input.type).toBe('password')
    expect(button('Save').disabled).toBe(true)
    await typeInto(input, 'sk-ant-api03-secretsecretsecret-WXYZ')
    await click(button('Save'))
    expect(backend.called('setClaudeKey')).toEqual([['sk-ant-api03-secretsecretsecret-WXYZ']])
    expect(byLabel('Stored key').textContent).toBe('sk-ant-…WXYZ')
    expect(host.querySelector('[aria-label="Claude API key"]')).toBeNull()
    expect(text()).not.toContain('secretsecret')
    expect(text()).toContain('Everything runs on Claude.')
  })

  it('shows why a key was refused, and keeps what was typed', async () => {
    await open()
    await typeInto(byLabel<HTMLInputElement>('Claude API key'), 'sk-proj-nope')
    await click(button('Save'))
    expect(text()).toContain('doesn’t look like a Claude API key')
    expect(byLabel<HTMLInputElement>('Claude API key').value).toBe('sk-proj-nope')
  })

  it('replaces or removes a stored key, and turns Claude off without forgetting it', async () => {
    backend.state.key = 'sk-ant-api03-old-old-old-old-ABCD'
    await open()
    await click(button('Replace'))
    expect(document.activeElement).toBe(byLabel('Claude API key'))
    await click(button('Cancel'))
    await click(sw('Use Claude'))
    expect(backend.called('setAiSettings').at(-1)![0]).toMatchObject({ claude: { enabled: false } })
    await click(button('Remove'))
    expect(backend.called('setClaudeKey').at(-1)).toEqual([null])
    expect(byLabel('Claude API key')).not.toBeNull()
  })

  it('tests the connection and says how it went', async () => {
    backend.state.key = 'sk-ant-api03-old-old-old-old-ABCD'
    await open()
    await click(button('Test connection'))
    expect(text()).toContain('claude-haiku-4-5-20251001 answered in 0.8 s · $0.0001')
    backend.state.test = { ok: false, code: 'auth', message: 'Claude didn’t accept the API key. Check it in Settings.' }
    await click(button('Test connection'))
    expect(text()).toContain('Claude didn’t accept the API key')
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
  it('pins a task to an engine or model, or turns it off', async () => {
    backend.state.key = 'sk-ant-api03-old-old-old-old-ABCD'
    await open()
    expect(text()).toContain('Haiku 4.5') // what summaries run on
    await typeInto(byLabel<HTMLSelectElement>('Reply drafts in your voice: engine'), 'local')
    expect(backend.called('setAiSettings').at(-1)![0]).toMatchObject({ tasks: { draft: { engine: 'local', enabled: true } } })
    await typeInto(byLabel<HTMLSelectElement>('Thread summaries: Claude model'), 'claude-sonnet-5')
    expect(backend.called('setAiSettings').at(-1)![0]).toMatchObject({ tasks: { summary: { claudeModel: 'claude-sonnet-5' } } })
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
    expect(money(1.5)).toBe('$1.50')
  })
  it('writes token counts compactly', () => {
    expect([tokens(812), tokens(12_345), tokens(123_456), tokens(1_234_567)]).toEqual(['812', '12.3k', '123k', '1.2M'])
  })
})
