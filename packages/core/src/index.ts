export * from './ids'
export * from './cli/errors'
export { HeyRunner, locateCli, MIN_CLI_VERSION, type Exec, type ExecResult } from './cli/runner'
export { HeyClient, type BoxPage, type Verified } from './cli/client'
export * as schemas from './cli/schemas'
export { openDb, type Db } from './cache/db'
export * from './cache/repo'
export { Watcher, type WatchStatus } from './sync/watcher'
export { SyncEngine, type AttachmentFile, type CacheChange, type SyncStatus } from './sync/engine'

import { HeyClient } from './cli/client'
import { HeyRunner, locateCli } from './cli/runner'
import { dirname, join } from 'node:path'
import { openDb } from './cache/db'
import { Repo } from './cache/repo'
import { SyncEngine } from './sync/engine'

/** Wires the core together: finds the CLI, opens the cache, builds the sync engine. */
export async function createCore(opts: { dbPath: string; cliPath?: string; account?: string }) {
  const cli = await locateCli(opts.cliPath)
  const runner = new HeyRunner({ binary: cli.path, account: opts.account })
  const client = new HeyClient(runner)
  const repo = new Repo(openDb(opts.dbPath))
  const engine = new SyncEngine(client, repo, runner, {
    attachmentsDir: join(dirname(opts.dbPath), 'attachments'),
  })
  return { cli, runner, client, repo, engine }
}

export type Core = Awaited<ReturnType<typeof createCore>>
