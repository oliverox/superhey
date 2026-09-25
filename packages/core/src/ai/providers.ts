import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'
import { createXai } from '@ai-sdk/xai'
import type { LanguageModel } from 'ai'

/**
 * Every cloud AI provider the app can use, in one place: how its keys look, where to get
 * one, how to connect, its models and their list prices, and which models it uses by
 * default. Settings, key storage, routing, the budget and the usage meter all read this;
 * adding a provider is adding an entry (and checking its prices on its own site).
 *
 * Prices are USD per million tokens, Standard tier, checked September 2026:
 * Anthropic platform.claude.com/docs/en/about-claude/pricing (and models/overview),
 * OpenAI developers.openai.com/api/docs/pricing, xAI docs.x.ai/docs/models.
 */

export type Tier = 'cheap' | 'quality'

export interface CloudModel {
  id: string
  provider: ProviderId
  name: string
  /** Per million tokens. Providers that don't charge to write their cache: cacheWrite = input. */
  price: { input: number; cacheWrite: number; cacheRead: number; output: number }
}

export interface ProviderDef {
  id: string
  /** What the app calls it ("Claude", "Grok"). */
  name: string
  /** Who bills for it ("Anthropic", "xAI"). */
  company: string
  blurb: string
  keyUrl: string
  keyPlaceholder: string
  /** A key this provider would accept (loosely, where its format isn't published). */
  keyPattern: RegExp
  /** Says what a key should look like, when one doesn't. */
  keyAdvice: string
  /** Whether its key format is its own (so a key of that shape is surely this provider's). */
  distinctiveKey: boolean
  /** Where the key is kept in the keychain store. */
  secretName: string
  connect: (apiKey: string, model: string) => LanguageModel
  models: ReadonlyArray<Omit<CloudModel, 'provider' | 'price'> & { price: Readonly<CloudModel['price']> }>
  defaults: Readonly<Record<Tier, string>>
}

const PROVIDER_LIST = [
  {
    id: 'claude',
    name: 'Claude',
    company: 'Anthropic',
    blurb: 'Anthropic’s models: careful writing and reasoning.',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    keyPlaceholder: 'sk-ant-…',
    keyPattern: /^sk-ant-[A-Za-z0-9_-]{20,300}$/,
    keyAdvice: 'That doesn’t look like an Anthropic API key (they start with “sk-ant-”).',
    distinctiveKey: true,
    secretName: 'anthropic-api-key',
    connect: (apiKey, model) => createAnthropic({ apiKey })(model),
    models: [
      // The dateless alias: Haiku 4.5 retires no sooner than October 2026, and the alias follows.
      { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', price: { input: 1, cacheWrite: 1.25, cacheRead: 0.1, output: 5 } },
      { id: 'claude-sonnet-5', name: 'Claude Sonnet 5', price: { input: 2, cacheWrite: 2.5, cacheRead: 0.2, output: 10 } },
      { id: 'claude-opus-5-5', name: 'Claude Opus 5.5', price: { input: 4, cacheWrite: 5, cacheRead: 0.2, output: 20 } },
      { id: 'claude-fable-5-1', name: 'Claude Fable 5.1', price: { input: 10, cacheWrite: 12.5, cacheRead: 0.25, output: 50 } },
    ],
    defaults: { cheap: 'claude-haiku-4-5', quality: 'claude-sonnet-5' },
  },
  {
    id: 'openai',
    name: 'OpenAI',
    company: 'OpenAI',
    blurb: 'OpenAI’s GPT models.',
    keyUrl: 'https://platform.openai.com/api-keys',
    keyPlaceholder: 'sk-…',
    // "sk-" (project keys "sk-proj-"); an Anthropic key is a mistake, not an OpenAI key.
    keyPattern: /^sk-(?!ant-)[A-Za-z0-9_-]{20,300}$/,
    keyAdvice: 'That doesn’t look like an OpenAI API key (they start with “sk-”).',
    distinctiveKey: true,
    secretName: 'openai-api-key',
    connect: (apiKey, model) => createOpenAI({ apiKey })(model),
    models: [
      { id: 'gpt-6-luna', name: 'GPT-6 Luna', price: { input: 0.1, cacheWrite: 0.1, cacheRead: 0.01, output: 0.5 } },
      { id: 'gpt-6-sol', name: 'GPT-6 Sol', price: { input: 2, cacheWrite: 2, cacheRead: 0.2, output: 10 } },
      { id: 'gpt-6-astra', name: 'GPT-6 Astra', price: { input: 10, cacheWrite: 10, cacheRead: 1, output: 50 } },
    ],
    defaults: { cheap: 'gpt-6-luna', quality: 'gpt-6-sol' },
  },
  {
    id: 'grok',
    name: 'Grok',
    company: 'xAI',
    blurb: 'xAI’s Grok models.',
    keyUrl: 'https://console.x.ai',
    keyPlaceholder: 'xai-…',
    // xAI doesn't publish a key format; anything key-like that isn't another provider's.
    keyPattern: /^(?!sk-)[A-Za-z0-9_-]{20,300}$/,
    keyAdvice: 'That doesn’t look like an xAI API key. Create one at console.x.ai.',
    distinctiveKey: false,
    secretName: 'xai-api-key',
    connect: (apiKey, model) => createXai({ apiKey })(model),
    // Prompts under 200k tokens (email always is); longer ones cost double.
    models: [
      { id: 'grok-4.3', name: 'Grok 4.3', price: { input: 1.25, cacheWrite: 1.25, cacheRead: 0.2, output: 2.5 } },
      { id: 'grok-4.7', name: 'Grok 4.7', price: { input: 2, cacheWrite: 2, cacheRead: 0.5, output: 6 } },
    ],
    defaults: { cheap: 'grok-4.3', quality: 'grok-4.7' },
  },
] as const satisfies readonly ProviderDef[]

export type ProviderId = (typeof PROVIDER_LIST)[number]['id']
// Each entry is already checked against ProviderDef by `satisfies` above; fromEntries only loses the key types.
export const PROVIDERS = Object.fromEntries(PROVIDER_LIST.map((p) => [p.id, p])) as unknown as Record<ProviderId, ProviderDef>
export const PROVIDER_IDS = PROVIDER_LIST.map((p) => p.id) as ProviderId[]

export const CLOUD_MODELS: readonly CloudModel[] = PROVIDER_LIST.flatMap((p) => p.models.map((m) => ({ ...m, provider: p.id })))
export const cloudModel = (id: string) => CLOUD_MODELS.find((m) => m.id === id)

/**
 * Checks a key for a provider. A key that plainly belongs to another provider is named as
 * such ("That looks like an OpenAI key"), since pasting into the wrong field is the likely
 * mistake. Returns the trimmed key, or throws with advice.
 */
export function checkKey(provider: ProviderId, input: unknown): string {
  const def = PROVIDERS[provider]
  const key = typeof input === 'string' ? input.trim() : ''
  if (def.keyPattern.test(key)) return key
  const other = PROVIDER_LIST.find((p) => p.id !== provider && p.distinctiveKey && p.keyPattern.test(key))
  throw new Error(other ? `That looks like ${article(other.name)} ${other.name} key, not ${article(def.name)} ${def.name} one.` : def.keyAdvice)
}

const article = (name: string) => (/^[AEIOU]/.test(name) ? 'an' : 'a')

/** "sk-ant-…WXYZ": enough to recognise a key, nothing more. */
export function keyHint(key: string): string {
  // The provider's prefix ("sk-ant-", "sk-proj-", "xai-"): short lowercase words, never the key itself.
  const prefix = /^[a-z]{2,4}-(?:[a-z]{3,4}-)?/.exec(key)?.[0] ?? ''
  return `${prefix}…${key.slice(-4)}`
}
