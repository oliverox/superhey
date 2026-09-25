/**
 * The cloud models the app offers, with list prices (USD per million tokens, Standard tier,
 * September 2026): Anthropic's from platform.claude.com/docs/en/about-claude/pricing,
 * OpenAI's from developers.openai.com/api/docs/pricing. Local models cost nothing to run,
 * so they aren't priced.
 */
export type CloudProvider = 'claude' | 'openai'
export const CLOUD_PROVIDERS: readonly CloudProvider[] = ['claude', 'openai']
export const PROVIDER_NAME: Record<CloudProvider, string> = { claude: 'Claude', openai: 'OpenAI' }

export interface CloudModel {
  id: string
  provider: CloudProvider
  name: string
  /** Per million tokens. OpenAI doesn't charge extra to write its cache: that's input. */
  price: { input: number; cacheWrite: number; cacheRead: number; output: number }
}

export const CLOUD_MODELS: readonly CloudModel[] = [
  { id: 'claude-haiku-4-5-20251001', provider: 'claude', name: 'Claude Haiku 4.5', price: { input: 1, cacheWrite: 1.25, cacheRead: 0.1, output: 5 } },
  { id: 'claude-sonnet-5', provider: 'claude', name: 'Claude Sonnet 5', price: { input: 2, cacheWrite: 2.5, cacheRead: 0.2, output: 10 } },
  { id: 'claude-opus-5-5', provider: 'claude', name: 'Claude Opus 5.5', price: { input: 4, cacheWrite: 5, cacheRead: 0.2, output: 20 } },
  { id: 'gpt-6-luna', provider: 'openai', name: 'GPT-6 Luna', price: { input: 0.1, cacheWrite: 0.1, cacheRead: 0.01, output: 0.5 } },
  { id: 'gpt-6-sol', provider: 'openai', name: 'GPT-6 Sol', price: { input: 2, cacheWrite: 2, cacheRead: 0.2, output: 10 } },
  { id: 'gpt-6-astra', provider: 'openai', name: 'GPT-6 Astra', price: { input: 10, cacheWrite: 10, cacheRead: 1, output: 50 } },
]

export const cloudModel = (id: string) => CLOUD_MODELS.find((m) => m.id === id)

export interface TokenUsage {
  /** All input tokens, including cached ones. */
  input: number
  cacheRead: number
  cacheWrite: number
  output: number
}

/** What a call cost, in USD. Unknown models (and local ones) cost nothing we can price. */
export function costOf(modelId: string, u: TokenUsage): number {
  const m = cloudModel(modelId)
  if (!m) return 0
  const fresh = Math.max(0, u.input - u.cacheRead - u.cacheWrite)
  const p = m.price
  return (fresh * p.input + u.cacheWrite * p.cacheWrite + u.cacheRead * p.cacheRead + u.output * p.output) / 1_000_000
}

/**
 * A ceiling on what a call may cost before it's made: every prompt character as a token
 * (tokenizers average 3–4 characters a token, so this overestimates) and the full output
 * allowance. Used to stop a call that could cross the budget.
 */
export function maxCostOf(modelId: string, promptChars: number, maxOutputTokens: number): number {
  return costOf(modelId, { input: promptChars, cacheRead: 0, cacheWrite: 0, output: maxOutputTokens })
}
