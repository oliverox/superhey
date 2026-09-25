import { cloudModel } from './providers'

/** Token counts for one call. */
export interface TokenUsage {
  /** All input tokens, including cached ones. */
  input: number
  cacheRead: number
  cacheWrite: number
  output: number
}

/** What a call cost, in USD, at the provider's list prices. Unknown (and local) models cost nothing we can price. */
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
