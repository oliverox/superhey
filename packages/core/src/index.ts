export * from './ids'
export * from './cli/errors'
export { HeyRunner, locateCli, MIN_CLI_VERSION, type Exec, type ExecResult } from './cli/runner'
export { HeyClient, type BoxPage, type BubbleWhen, type NewEvent, type OutgoingMessage, type Verified } from './cli/client'
export { Outbox, UNDO_SEND_MS, type OutgoingKind, type OutgoingRecord, type OutgoingStatus } from './actions/outbox'
export { ActionRunner, type Action, type ActionRecord, type ActionSource, type ActionStatus, type MoveTarget } from './actions/runner'
export * as schemas from './cli/schemas'
export { openDb, type Db } from './cache/db'
export { AvatarCache, type AvatarFile } from './cache/avatars'
export * from './cache/repo'
export { Watcher, type WatchStatus } from './sync/watcher'
export { SyncEngine, type AttachmentFile, type CacheChange, type SyncStatus } from './sync/engine'
export { buildToday, clashWith, itemKey, WAITING_AFTER_DAYS, WAITING_UNTIL_DAYS, type ActionItem, type AlertItem, type Autopay, type CalendarItem, type Clash, type ComingUpItem, type Money, type TaskKind, type ThreadItem, type TodayInput, type TodayView, type TodoItem } from './today/today'
export { worthReading } from './today/paperTrail'
export { ANALYSIS_SYSTEM, ANALYSIS_VERSION, analysisPrompt, CATEGORIES, scrub, ThreadAnalysis, ThreadAnalyzer, type Me } from './ai/analysis'
export { AiClient, AiError, listLocalModels, type AiErrorCode, type AiRequest, type AiResult } from './ai/client'
export { costOf } from './ai/models'
export { checkKey, CLOUD_MODELS, keyHint, PROVIDER_IDS, PROVIDERS, type CloudModel, type ProviderDef, type ProviderId, type Tier } from './ai/providers'
export { AI_TASKS, AI_TASK_IDS, AiSettings, aiMode, defaultAiSettings, providerModel, providerSettings, readAiSettings, readyProviders, route, taskSettings, type AiTask, type Engine, type KeysStored, type Route, type TestTask } from './ai/settings'

import { HeyClient } from './cli/client'
import { HeyRunner, locateCli } from './cli/runner'
import { dirname, join } from 'node:path'
import { openDb } from './cache/db'
import { AvatarCache } from './cache/avatars'
import { Repo } from './cache/repo'
import { SyncEngine } from './sync/engine'
import { ActionRunner } from './actions/runner'
import { Outbox } from './actions/outbox'

/** Wires the core together: finds the CLI, opens the cache, builds the sync engine. */
export async function createCore(opts: { dbPath: string; cliPath?: string; account?: string; sendingDisabled?: boolean }) {
  const cli = await locateCli(opts.cliPath)
  const runner = new HeyRunner({ binary: cli.path, account: opts.account })
  const client = new HeyClient(runner)
  const repo = new Repo(openDb(opts.dbPath))
  const engine = new SyncEngine(client, repo, runner, {
    attachmentsDir: join(dirname(opts.dbPath), 'attachments'),
  })
  const actions = new ActionRunner(client, repo, engine)
  const avatars = new AvatarCache(join(dirname(opts.dbPath), 'avatars'))
  const outbox = new Outbox(client, undefined, opts.sendingDisabled)
  return { cli, runner, client, repo, engine, actions, avatars, outbox }
}

export type Core = Awaited<ReturnType<typeof createCore>>
export { ATTACHMENT_KINDS, OPERATORS, highlightTerms, isEmptyQuery, operatorValue, parseQuery, withOperator, type AttachmentKind, type Operator, type SearchQuery } from './search/query'
export { HEY_PAGE_SIZE, heyArgs, localBounds, searchHey, type HeySearchPage } from './search/search'
export { buildVoice, collectSamples, freshText, renderVoice, saveVoice, saveVoiceNotes, storedVoice, voiceNotes, VoiceProfile, type Sample, type StoredVoice } from './ai/voice'
export { Drafter, DRAFT_RULES, draftPrompt, draftSystem, ReplyDraft } from './ai/drafts'
