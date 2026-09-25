import { z } from 'zod'
import { CLOUD_MODELS, cloudModel, PROVIDER_IDS, PROVIDERS, type ProviderId, type Tier } from './providers'

/**
 * AI settings: which providers are on and in what order, which engine each task uses, and
 * the monthly budget. API keys are not here: they live in the OS keychain, held by the main
 * process. Whether a provider is "connected" is whether a key is stored for it.
 */

/** Everything the app asks a model to do, and how demanding it is. */
export const AI_TASKS = {
  summary: { label: 'Thread summaries', tier: 'cheap' },
  classify: { label: 'Needs reply, sorting', tier: 'cheap' },
  extract: { label: 'Dates, bookings, receipts', tier: 'cheap' },
  draft: { label: 'Reply drafts in your voice', tier: 'quality' },
  agent: { label: 'Requests in the command bar', tier: 'quality' },
  insights: { label: 'Insights and weekly review', tier: 'quality' },
} as const satisfies Record<string, { label: string; tier: Tier }>

export type AiTask = keyof typeof AI_TASKS
export type Engine = ProviderId | 'local'
export const AI_TASK_IDS = Object.keys(AI_TASKS) as AiTask[]

const providerId = z.enum(PROVIDER_IDS as [ProviderId, ...ProviderId[]])
const modelId = z.enum(CLOUD_MODELS.map((m) => m.id) as [string, ...string[]])

const TaskSettings = z.object({
  enabled: z.boolean().default(true),
  /** `auto` follows the setup: with a local model too, quick tasks go local and the rest to the cloud. */
  engine: z.union([z.literal('auto'), z.literal('local'), providerId]).default('auto'),
  /** A cloud model for this task (used when the task runs on that model's provider). */
  model: modelId.optional(),
})

const ProviderSettings = z.object({
  enabled: z.boolean().default(true),
  /** This provider's models for quick and main tasks, when not its defaults. */
  models: z.object({ cheap: modelId.optional(), quality: modelId.optional() }).default({}),
})

export const AiSettings = z.object({
  providers: z.partialRecord(providerId, ProviderSettings).default({}),
  /** Automatic tasks use the first provider in this order that's connected and on. */
  order: z
    .array(providerId)
    .default([...PROVIDER_IDS])
    // Every provider exactly once, whatever was saved.
    .transform((o) => [...new Set([...o, ...PROVIDER_IDS])]),
  local: z
    .object({
      enabled: z.boolean().default(false),
      /** An OpenAI-compatible endpoint: Ollama (…:11434/v1) or LM Studio (…:1234/v1). */
      baseUrl: z.url({ protocol: /^https?$/ }).default('http://localhost:11434/v1'),
      model: z.string().max(200).default(''),
    })
    .default({ enabled: false, baseUrl: 'http://localhost:11434/v1', model: '' }),
  tasks: z.partialRecord(z.enum(AI_TASK_IDS as [AiTask, ...AiTask[]]), TaskSettings).default({}),
  /** A hard stop on cloud spending (all providers together) per calendar month, in USD; null for none. */
  monthlyBudgetUsd: z.number().min(0).max(10_000).nullable().default(5),
})
export type AiSettings = z.infer<typeof AiSettings>

export const defaultAiSettings = (): AiSettings => AiSettings.parse({})

/** Settings read from disk: an earlier shape is brought forward; whatever doesn't parse falls back to the defaults. */
export function readAiSettings(raw: unknown): AiSettings {
  const parsed = AiSettings.safeParse(upgrade(raw))
  return parsed.success ? parsed.data : defaultAiSettings()
}

/** Settings saved before the provider list ({ claude, openai, preferredCloud }). */
function upgrade(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || 'providers' in raw) return raw
  const r = raw as Record<string, unknown>
  const providers: Record<string, unknown> = {}
  for (const id of ['claude', 'openai']) if (r[id] && typeof r[id] === 'object') providers[id] = r[id]
  const { claude: _c, openai: _o, preferredCloud, ...rest } = r
  return { ...rest, providers, ...(preferredCloud === 'openai' ? { order: ['openai', 'claude'] } : {}) }
}

export function taskSettings(s: AiSettings, task: AiTask) {
  return TaskSettings.parse(s.tasks[task] ?? {})
}

export function providerSettings(s: AiSettings, provider: ProviderId) {
  return ProviderSettings.parse(s.providers[provider] ?? {})
}

/** A provider's model for a tier: its own choice if it made one, else its default. */
export function providerModel(s: AiSettings, provider: ProviderId, tier: Tier): string {
  const own = providerSettings(s, provider).models[tier]
  return own && cloudModel(own)?.provider === provider ? own : PROVIDERS[provider].defaults[tier]
}

/** Which providers have a key stored. */
export type KeysStored = Record<ProviderId, boolean>

export type Route = { engine: ProviderId; model: string } | { engine: 'local'; model: string; baseUrl: string } | { engine: null; reason: string }

export type TestTask = `test-${Engine}`

/** The providers that can run now (a key stored and on), in priority order. */
export function readyProviders(s: AiSettings, keys: KeysStored): ProviderId[] {
  return s.order.filter((p) => keys[p] && providerSettings(s, p).enabled)
}

/**
 * Which engine and model a task runs on. A provider counts as set up with a key stored and
 * turned on; the local model with a model chosen and turned on.
 */
export function route(s: AiSettings, task: AiTask | TestTask, keys: KeysStored): Route {
  const ready = readyProviders(s, keys)
  const localReady = s.local.enabled && !!s.local.model
  const local: Route = { engine: 'local', model: s.local.model, baseUrl: s.local.baseUrl }
  const cloud = (p: ProviderId, tier: Tier, model?: string): Route => ({
    engine: p,
    // A task's model only counts on its own provider.
    model: model && cloudModel(model)?.provider === p ? model : providerModel(s, p, tier),
  })

  // The connection tests in Settings name their engine.
  if (task === 'test-local') return localReady ? local : { engine: null, reason: 'Choose a local model first.' }
  if (task.startsWith('test-')) {
    const p = task.slice(5) as ProviderId
    return ready.includes(p) ? cloud(p, 'cheap') : { engine: null, reason: `Add ${article(PROVIDERS[p].company)} ${PROVIDERS[p].company} API key first.` }
  }

  const t = taskSettings(s, task as AiTask)
  const { tier, label } = AI_TASKS[task as AiTask]
  if (!t.enabled) return { engine: null, reason: `${label} are turned off.` }
  if (t.engine === 'local') return localReady ? local : { engine: null, reason: 'This task uses the local model, which isn’t set up.' }
  if (t.engine !== 'auto') return ready.includes(t.engine) ? cloud(t.engine, tier, t.model) : { engine: null, reason: `This task uses ${PROVIDERS[t.engine].name}, which isn’t set up.` }
  const first = ready[0]
  if (first && localReady) return tier === 'cheap' ? local : cloud(first, tier, t.model)
  if (first) return cloud(first, tier, t.model)
  if (localReady) return local
  return { engine: null, reason: 'Add an AI provider or a local model in Settings.' }
}

const article = (word: string) => (/^[aeioux]/i.test(word) ? 'an' : 'a') // "an xAI", "an OpenAI", "an Anthropic"

/**
 * How Settings describes the setup: which provider runs automatic tasks (if any), and
 * whether a local model takes the quick ones.
 */
export function aiMode(s: AiSettings, keys: KeysStored): { cloud: ProviderId | null; local: boolean } {
  return { cloud: readyProviders(s, keys)[0] ?? null, local: s.local.enabled && !!s.local.model }
}
