import { z } from 'zod'
import { CLAUDE_MODELS } from './models'

/**
 * AI settings: which engines are set up, which one each task uses, and the monthly budget.
 * The Claude API key is not here: it lives in the OS keychain, held by the main process.
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
export const AI_TASK_IDS = Object.keys(AI_TASKS) as AiTask[]

/** Which Claude model each tier uses unless a task says otherwise. */
export const DEFAULT_CLAUDE_MODEL: Record<Tier, string> = {
  cheap: 'claude-haiku-4-5-20251001',
  quality: 'claude-sonnet-5',
}

const claudeModelId = z.enum(CLAUDE_MODELS.map((m) => m.id) as [string, ...string[]])

const TaskSettings = z.object({
  enabled: z.boolean().default(true),
  /** `auto` follows the mode: in mixed mode, cheap tasks go local and the rest to Claude. */
  engine: z.enum(['auto', 'claude', 'local']).default('auto'),
  claudeModel: claudeModelId.optional(),
})

export const AiSettings = z.object({
  claude: z.object({ enabled: z.boolean().default(true) }).default({ enabled: true }),
  local: z
    .object({
      enabled: z.boolean().default(false),
      /** An OpenAI-compatible endpoint: Ollama (…:11434/v1) or LM Studio (…:1234/v1). */
      baseUrl: z.url({ protocol: /^https?$/ }).default('http://localhost:11434/v1'),
      model: z.string().max(200).default(''),
    })
    .default({ enabled: false, baseUrl: 'http://localhost:11434/v1', model: '' }),
  tasks: z.partialRecord(z.enum(AI_TASK_IDS as [AiTask, ...AiTask[]]), TaskSettings).default({}),
  /** A hard stop on Claude spending per calendar month, in USD; null for none. */
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

export type Route =
  | { engine: 'claude'; model: string }
  | { engine: 'local'; model: string; baseUrl: string }
  | { engine: null; reason: string }

/**
 * Which engine and model a task runs on. `hasKey`: whether a Claude key is stored. Claude
 * counts as set up with a key and enabled; local with a model chosen and enabled.
 */
export function route(s: AiSettings, task: AiTask | 'test-claude' | 'test-local', hasKey: boolean): Route {
  const claudeReady = hasKey && s.claude.enabled
  const localReady = s.local.enabled && !!s.local.model
  const claude = (tier: Tier, model?: string): Route => ({ engine: 'claude', model: model ?? DEFAULT_CLAUDE_MODEL[tier] })
  const local: Route = { engine: 'local', model: s.local.model, baseUrl: s.local.baseUrl }

  // The connection tests in Settings name their engine.
  if (task === 'test-claude') return claudeReady ? claude('cheap') : { engine: null, reason: 'Add a Claude API key first.' }
  if (task === 'test-local') return localReady ? local : { engine: null, reason: 'Choose a local model first.' }

  const t = taskSettings(s, task)
  const tier = AI_TASKS[task].tier
  if (!t.enabled) return { engine: null, reason: `${AI_TASKS[task].label} are turned off.` }
  if (t.engine === 'claude') return claudeReady ? claude(tier, t.claudeModel) : { engine: null, reason: 'This task uses Claude, which isn’t set up.' }
  if (t.engine === 'local') return localReady ? local : { engine: null, reason: 'This task uses the local model, which isn’t set up.' }
  if (claudeReady && localReady) return tier === 'cheap' ? local : claude(tier, t.claudeModel)
  if (claudeReady) return claude(tier, t.claudeModel)
  if (localReady) return local
  return { engine: null, reason: 'Set up Claude or a local model in Settings.' }
}

/** Claude, local, both, or neither: how Settings describes the setup. */
export function aiMode(s: AiSettings, hasKey: boolean): 'claude' | 'local' | 'mixed' | 'off' {
  const c = hasKey && s.claude.enabled
  const l = s.local.enabled && !!s.local.model
  return c && l ? 'mixed' : c ? 'claude' : l ? 'local' : 'off'
}
