/**
 * The Claude models the app offers, with Anthropic's list prices (USD per million tokens,
 * from platform.claude.com/docs/en/about-claude/pricing, September 2026). Local models
 * cost nothing to run, so they aren't priced.
 */
export interface ClaudeModel {
  id: string
  name: string
  /** Per million tokens. */
  price: { input: number; cacheWrite: number; cacheRead: number; output: number }
}

export const CLAUDE_MODELS: readonly ClaudeModel[] = [
  { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5', price: { input: 1, cacheWrite: 1.25, cacheRead: 0.1, output: 5 } },
  { id: 'claude-sonnet-5', name: 'Claude Sonnet 5', price: { input: 2, cacheWrite: 2.5, cacheRead: 0.2, output: 10 } },
  { id: 'claude-opus-5-5', name: 'Claude Opus 5.5', price: { input: 4, cacheWrite: 5, cacheRead: 0.2, output: 20 } },
]

export const claudeModel = (id: string) => CLAUDE_MODELS.find((m) => m.id === id)

export interface TokenUsage {
  /** All input tokens, including cached ones. */
  input: number
  cacheRead: number
  cacheWrite: number
  output: number
}

/** What a call cost, in USD. Unknown models (and local ones) cost nothing we can price. */
export function costOf(modelId: string, u: TokenUsage): number {
  const m = claudeModel(modelId)
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
