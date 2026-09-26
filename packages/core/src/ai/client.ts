import { EventEmitter } from 'node:events'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { APICallError, generateText, Output, type LanguageModel, type SystemModelMessage } from 'ai'
import type { z } from 'zod'
import type { Repo } from '../cache/repo'
import { costOf, maxCostOf } from './models'
import { PROVIDER_IDS, PROVIDERS, type ProviderId } from './providers'
import { route, type AiSettings, type AiTask, type Route, type TestTask } from './settings'

export type AiErrorCode = 'not-set-up' | 'budget' | 'auth' | 'unreachable' | 'rate-limited' | 'failed'

/** A model call that didn't happen or didn't work, with a message fit to show. */
export class AiError extends Error {
  constructor(
    readonly code: AiErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'AiError'
  }
}

export interface AiRequest<S extends z.ZodType | undefined = undefined> {
  task: AiTask | TestTask
  /** Instructions. Email content never goes here: it goes in `prompt`, as data. */
  system: string
  prompt: string
  /** For structured answers (summaries, classifications): the result is parsed to it. */
  schema?: S
  maxOutputTokens?: number
  signal?: AbortSignal
}

export interface AiResult<T> {
  output: T
  engine: ProviderId | 'local'
  model: string
  usage: { input: number; output: number; costUsd: number }
  ms: number
}

type Resolved = Exclude<Route, { engine: null }>

export interface AiClientOptions {
  settings: () => AiSettings
  /** A provider's API key, read from the keychain when needed; null when none is stored. */
  apiKey: (provider: ProviderId) => string | null
  repo: Repo
  now?: () => Date
  /** Builds the model for a route; tests pass fakes. */
  model?: (route: Resolved, apiKey: string | null) => LanguageModel
}

/**
 * Every model call in the app goes through here: it picks the engine for the task, stops a
 * cloud call that could cross the monthly budget, runs it, and logs what it used.
 */
export class AiClient extends EventEmitter<{ usage: [] }> {
  constructor(private readonly opts: AiClientOptions) {
    super()
  }

  private now() {
    return this.opts.now?.() ?? new Date()
  }

  /** The start of the current calendar month (local time), as the budget counts it. */
  monthStart(): string {
    const d = this.now()
    return new Date(d.getFullYear(), d.getMonth(), 1).toISOString()
  }

  /** Whether a task has somewhere to run (a provider or local model set up for it). */
  canRun(task: AiTask | TestTask): boolean {
    const has = Object.fromEntries(PROVIDER_IDS.map((p) => [p, !!this.opts.apiKey(p)])) as Record<ProviderId, boolean>
    return route(this.opts.settings(), task, has).engine != null
  }

  spentThisMonth(): number {
    return this.opts.repo.aiSpentSince(this.monthStart())
  }

  async run<S extends z.ZodType | undefined = undefined>(req: AiRequest<S>): Promise<AiResult<S extends z.ZodType ? z.infer<S> : string>> {
    const settings = this.opts.settings()
    const keys = Object.fromEntries(PROVIDER_IDS.map((p) => [p, this.opts.apiKey(p)])) as Record<ProviderId, string | null>
    const r = route(settings, req.task, Object.fromEntries(PROVIDER_IDS.map((p) => [p, !!keys[p]])) as Record<ProviderId, boolean>)
    if (!r.engine) throw new AiError('not-set-up', r.reason)
    const key = r.engine === 'local' ? null : keys[r.engine]

    const maxOutputTokens = req.maxOutputTokens ?? 1024
    if (r.engine !== 'local' && settings.monthlyBudgetUsd != null) {
      const spent = this.spentThisMonth()
      const ceiling = maxCostOf(r.model, req.system.length + req.prompt.length, maxOutputTokens)
      if (spent + ceiling > settings.monthlyBudgetUsd) {
        throw new AiError('budget', `This month’s AI budget ($${settings.monthlyBudgetUsd.toFixed(2)}) is used up: $${spent.toFixed(2)} spent. Raise it in Settings, or use a local model.`)
      }
    }

    const model = (this.opts.model ?? defaultModel)(r, key)
    const started = Date.now()
    let result
    try {
      result = await generateText({
        model,
        instructions: cachedInstructions(req.system),
        prompt: req.prompt,
        maxOutputTokens,
        maxRetries: 2,
        abortSignal: req.signal ?? AbortSignal.timeout(90_000),
        ...(req.schema ? { output: Output.object({ schema: req.schema }) } : {}),
      })
    } catch (e) {
      throw explain(e, r)
    }

    const u = result.usage
    const tokens = {
      input: u.inputTokens ?? 0,
      cacheRead: u.inputTokenDetails?.cacheReadTokens ?? 0,
      cacheWrite: u.inputTokenDetails?.cacheWriteTokens ?? 0,
      output: u.outputTokens ?? 0,
    }
    const costUsd = r.engine === 'local' ? 0 : costOf(r.model, tokens)
    this.opts.repo.recordAiUsage({ at: this.now().toISOString(), task: req.task, engine: r.engine, model: r.model, ...tokens, costUsd })
    this.emit('usage')

    return {
      output: (req.schema ? result.output : result.text) as S extends z.ZodType ? z.infer<S> : string,
      engine: r.engine,
      model: r.model,
      usage: { input: tokens.input, output: tokens.output, costUsd },
      ms: Date.now() - started,
    }
  }
}

/**
 * The instructions, then the varying part (an email thread). The instructions are the same
 * on every call of a task, so they end in a cache breakpoint: Claude reads them from its
 * prompt cache for 5 minutes after a call (at a tenth of the price) instead of processing
 * them again; the thread after the breakpoint never is. (Claude only caches a prefix above
 * a minimum length per model, silently skipping shorter ones; OpenAI and Grok cache
 * repeated prefixes on their own and ignore this option.)
 */
export function cachedInstructions(system: string): SystemModelMessage {
  return { role: 'system', content: system, providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } } }
}

function defaultModel(r: Resolved, apiKey: string | null): LanguageModel {
  if (r.engine === 'local') return createOpenAICompatible({ name: 'local', baseURL: r.baseUrl, supportsStructuredOutputs: true })(r.model)
  return PROVIDERS[r.engine].connect(apiKey ?? '', r.model)
}

/** A provider's failure, said plainly. */
function explain(e: unknown, r: Resolved): AiError {
  if (e instanceof AiError) return e
  const inner = (e as { lastError?: unknown }).lastError ?? e // retries wrap the last failure
  const status = APICallError.isInstance(inner) ? inner.statusCode : undefined
  const text = inner instanceof Error ? inner.message : String(inner)
  if (r.engine !== 'local') {
    const who = PROVIDERS[r.engine].name
    // Most say 401/403; xAI says 400 "Incorrect API key provided".
    if (status === 401 || status === 403 || (status === 400 && /api key/i.test(text))) return new AiError('auth', `${who} didn’t accept the API key.`)
    if (status === 429) return new AiError('rate-limited', `${who} is rate-limiting this key. Try again in a minute.`)
    if (status === 404) return new AiError('failed', `${who} doesn’t offer the model “${r.model}” to this key.`)
  } else if (/ECONNREFUSED|fetch failed|ENOTFOUND|Cannot connect/i.test(text) || (APICallError.isInstance(inner) && status == null)) {
    return new AiError('unreachable', `Can’t reach the local model at ${r.baseUrl}. Is Ollama or LM Studio running?`)
  } else if (status === 404) {
    return new AiError('failed', `The local server doesn’t have the model “${r.model}”.`)
  }
  return new AiError('failed', text.slice(0, 300))
}

/**
 * The models a local OpenAI-compatible server offers (Ollama, LM Studio), from its
 * /models list. Throws an AiError when it can't be reached.
 */
export async function listLocalModels(baseUrl: string, fetchFn: typeof fetch = fetch): Promise<string[]> {
  let res: Response
  try {
    res = await fetchFn(`${baseUrl.replace(/\/+$/, '')}/models`, { signal: AbortSignal.timeout(4000) })
  } catch {
    throw new AiError('unreachable', `Can’t reach ${baseUrl}. Is Ollama or LM Studio running?`)
  }
  if (!res.ok) throw new AiError('failed', `${baseUrl} answered ${res.status}. Is it an OpenAI-compatible endpoint (ending in /v1)?`)
  const body = (await res.json().catch(() => null)) as { data?: Array<{ id?: unknown }> } | null
  const ids = (body?.data ?? []).map((m) => m.id).filter((id): id is string => typeof id === 'string')
  return [...new Set(ids)].sort((a, b) => a.localeCompare(b))
}
