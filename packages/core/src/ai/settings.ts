import { z } from 'zod'
import { CLOUD_MODELS, CLOUD_PROVIDERS, cloudModel, PROVIDER_NAME, type CloudProvider } from './models'

/**
 * AI settings: which engines are set up, which one each task uses, and the monthly budget.
 * API keys are not here: they live in the OS keychain, held by the main process.
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
export type Tier = 'cheap' | 'quality'
export type Engine = CloudProvider | 'local'
export const AI_TASK_IDS = Object.keys(AI_TASKS) as AiTask[]

/** Which model each provider uses for each tier unless a task says otherwise. */
export const DEFAULT_MODEL: Record<CloudProvider, Record<Tier, string>> = {
  claude: { cheap: 'claude-haiku-4-5-20251001', quality: 'claude-sonnet-5' },
  openai: { cheap: 'gpt-6-luna', quality: 'gpt-6-sol' },
}

const TaskSettings = z.object({
  enabled: z.boolean().default(true),
  /** `auto` follows the setup: with a local model too, quick tasks go local and the rest to the cloud. */
  engine: z.enum(['auto', 'claude', 'openai', 'local']).default('auto'),
  /** A cloud model for this task (used when the task runs on that model's provider). */
  model: z.enum(CLOUD_MODELS.map((m) => m.id) as [string, ...string[]]).optional(),
})

const Cloud = z.object({ enabled: z.boolean().default(true) })

export const AiSettings = z.object({
  claude: Cloud.default({ enabled: true }),
  openai: Cloud.default({ enabled: true }),
  /** Which cloud runs automatic tasks when both have keys. */
  preferredCloud: z.enum(['claude', 'openai']).default('claude'),
  local: z
    .object({
      enabled: z.boolean().default(false),
      /** An OpenAI-compatible endpoint: Ollama (…:11434/v1) or LM Studio (…:1234/v1). */
      baseUrl: z.url({ protocol: /^https?$/ }).default('http://localhost:11434/v1'),
      model: z.string().max(200).default(''),
    })
    .default({ enabled: false, baseUrl: 'http://localhost:11434/v1', model: '' }),
  tasks: z.partialRecord(z.enum(AI_TASK_IDS as [AiTask, ...AiTask[]]), TaskSettings).default({}),
  /** A hard stop on cloud spending (Claude and OpenAI together) per calendar month, in USD; null for none. */
  monthlyBudgetUsd: z.number().min(0).max(10_000).nullable().default(5),
})
export type AiSettings = z.infer<typeof AiSettings>

export const defaultAiSettings = (): AiSettings => AiSettings.parse({})

/** Settings read from disk: whatever doesn't parse falls back to the defaults. */
export function readAiSettings(raw: unknown): AiSettings {
  const parsed = AiSettings.safeParse(raw)
  return parsed.success ? parsed.data : defaultAiSettings()
}

export function taskSettings(s: AiSettings, task: AiTask) {
  return TaskSettings.parse(s.tasks[task] ?? {})
}

/** Which providers have a key stored. */
export type KeysStored = Record<CloudProvider, boolean>

export type Route =
  | { engine: CloudProvider; model: string }
  | { engine: 'local'; model: string; baseUrl: string }
  | { engine: null; reason: string }

export type TestTask = `test-${Engine}`

/** The cloud providers that can run now (a key stored and turned on), preferred first. */
export function readyClouds(s: AiSettings, keys: KeysStored): CloudProvider[] {
  const ready = CLOUD_PROVIDERS.filter((p) => keys[p] && s[p].enabled)
  return ready.sort((a, b) => Number(b === s.preferredCloud) - Number(a === s.preferredCloud))
}

/**
 * Which engine and model a task runs on. A cloud counts as set up with a key stored and
 * turned on; the local model with a model chosen and turned on.
 */
export function route(s: AiSettings, task: AiTask | TestTask, keys: KeysStored): Route {
  const clouds = readyClouds(s, keys)
  const localReady = s.local.enabled && !!s.local.model
  const local: Route = { engine: 'local', model: s.local.model, baseUrl: s.local.baseUrl }
  const cloud = (p: CloudProvider, tier: Tier, model?: string): Route => ({
    engine: p,
    // A task's model only counts on its own provider's cloud.
    model: model && cloudModel(model)?.provider === p ? model : DEFAULT_MODEL[p][tier],
  })

  // The connection tests in Settings name their engine.
  if (task === 'test-local') return localReady ? local : { engine: null, reason: 'Choose a local model first.' }
  if (task === 'test-claude' || task === 'test-openai') {
    const p = task === 'test-claude' ? 'claude' : 'openai'
    return clouds.includes(p) ? cloud(p, 'cheap') : { engine: null, reason: `Add an ${p === 'claude' ? 'Anthropic' : 'OpenAI'} API key first.` }
  }

  const t = taskSettings(s, task)
  const tier = AI_TASKS[task].tier
  if (!t.enabled) return { engine: null, reason: `${AI_TASKS[task].label} are turned off.` }
  if (t.engine === 'local') return localReady ? local : { engine: null, reason: 'This task uses the local model, which isn’t set up.' }
  if (t.engine !== 'auto') return clouds.includes(t.engine) ? cloud(t.engine, tier, t.model) : { engine: null, reason: `This task uses ${PROVIDER_NAME[t.engine]}, which isn’t set up.` }
  const first = clouds[0]
  if (first && localReady) return tier === 'cheap' ? local : cloud(first, tier, t.model)
  if (first) return cloud(first, tier, t.model)
  if (localReady) return local
  return { engine: null, reason: 'Set up Claude, OpenAI or a local model in Settings.' }
}

/**
 * How Settings describes the setup: which cloud runs automatic tasks (if any), and whether
 * a local model takes the quick ones.
 */
export function aiMode(s: AiSettings, keys: KeysStored): { cloud: CloudProvider | null; local: boolean } {
  return { cloud: readyClouds(s, keys)[0] ?? null, local: s.local.enabled && !!s.local.model }
}
