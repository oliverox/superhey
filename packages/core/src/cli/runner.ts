import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { access, constants } from 'node:fs/promises'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'
import { HeyAuthError, HeyBinaryError, HeyCliError, HeyNotFoundError } from './errors'

export const MIN_CLI_VERSION = '1.6.0'

export interface Envelope<T> {
  ok: boolean
  data: T
  summary?: string
  notice?: string
  error?: string
  code?: string
}

export interface ExecResult {
  stdout: string
  stderr: string
  exitCode: number | null
}

export type Exec = (binary: string, args: string[], timeoutMs: number) => Promise<ExecResult>

export interface RunnerOptions {
  binary: string
  /** Parallel CLI calls. Each call is ~0.5 s of network time. */
  maxConcurrent?: number
  timeoutMs?: number
  /** Linked mail account id, or undefined for the CLI default. */
  account?: string
  exec?: Exec
}

// No shell: arguments go straight to the process, so subjects or search terms can't inject.
const spawnExec: Exec = (binary, args, timeoutMs) =>
  new Promise((resolve, reject) => {
    const child = spawn(binary, args, { env: cliEnv(), stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs)
    child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d))
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d))
    child.on('error', (err) => {
      clearTimeout(timer)
      reject(new HeyBinaryError(`Could not run ${binary}: ${err.message}`))
    })
    child.on('close', (exitCode, signal) => {
      clearTimeout(timer)
      if (signal === 'SIGTERM') reject(new HeyCliError(`hey ${args.join(' ')} timed out`, 'timeout'))
      else resolve({ stdout, stderr, exitCode })
    })
  })

export function cliEnv(): NodeJS.ProcessEnv {
  // A missing login must fail fast instead of opening an interactive prompt.
  return { ...process.env, HEY_NONINTERACTIVE: '1', NO_COLOR: '1' }
}

class Semaphore {
  private queue: Array<() => void> = []
  private active = 0
  constructor(private readonly max: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) await new Promise<void>((r) => this.queue.push(r))
    this.active++
    try {
      return await fn()
    } finally {
      this.active--
      this.queue.shift()?.()
    }
  }
}

export class HeyRunner {
  readonly binary: string
  private readonly exec: Exec
  private readonly timeoutMs: number
  private readonly account?: string
  private readonly limiter: Semaphore

  constructor(opts: RunnerOptions) {
    this.binary = opts.binary
    this.exec = opts.exec ?? spawnExec
    this.timeoutMs = opts.timeoutMs ?? 30_000
    this.account = opts.account
    this.limiter = new Semaphore(opts.maxConcurrent ?? 3)
  }

  /** Runs a command with `--json` and returns the success envelope, or throws a typed error. */
  async json<T>(args: string[]): Promise<Envelope<T>> {
    const full = [...args, '--json', ...(this.account ? ['--account', this.account] : [])]
    const { stdout, stderr, exitCode } = await this.limiter.run(() =>
      this.exec(this.binary, full, this.timeoutMs),
    )

    let envelope: Envelope<T>
    try {
      envelope = JSON.parse(stdout) as Envelope<T>
    } catch {
      if (exitCode === 3) throw new HeyAuthError()
      throw new HeyCliError(
        `hey ${args.join(' ')} failed (exit ${exitCode}): ${stderr.trim() || 'no output'}`,
        'cli_error',
        exitCode,
        stderr,
      )
    }

    if (!envelope.ok) {
      if (envelope.code === 'auth' || exitCode === 3) throw new HeyAuthError()
      if (envelope.code === 'not_found') throw new HeyNotFoundError(envelope.error)
      throw new HeyCliError(envelope.error ?? 'unknown error', envelope.code, exitCode, stderr)
    }
    return envelope
  }

  /** Runs a command whose output isn't JSON (e.g. `--html`) and returns stdout. */
  async text(args: string[]): Promise<string> {
    const full = [...args, ...(this.account ? ['--account', this.account] : [])]
    const { stdout, stderr, exitCode } = await this.limiter.run(() => this.exec(this.binary, full, this.timeoutMs))
    if (exitCode === 3) throw new HeyAuthError()
    if (exitCode !== 0) {
      try {
        const env = JSON.parse(stdout) as Envelope<unknown>
        if (env.code === 'not_found') throw new HeyNotFoundError(env.error)
      } catch (e) {
        if (e instanceof HeyNotFoundError) throw e
      }
      throw new HeyCliError(`hey ${args.join(' ')} failed (exit ${exitCode}): ${stderr.trim() || 'no output'}`, 'cli_error', exitCode, stderr)
    }
    return stdout
  }

  /** Starts a long-running command (e.g. `hey watch`). Not subject to the concurrency limit. */
  spawn(args: string[]): ChildProcessWithoutNullStreams {
    const full = [...args, ...(this.account ? ['--account', this.account] : [])]
    return spawn(this.binary, full, { env: cliEnv() })
  }
}

export interface LocatedCli {
  path: string
  version: string
}

/**
 * Finds the HEY CLI. Apps launched from Finder get a minimal PATH, so common install
 * locations are checked explicitly. Each candidate must identify itself as the HEY CLI:
 * Homebrew's `hey` is an unrelated HTTP load generator.
 */
export async function locateCli(override?: string, exec: Exec = spawnExec): Promise<LocatedCli> {
  const home = homedir()
  const fromPath = (process.env.PATH ?? '').split(delimiter).filter(Boolean).map((d) => join(d, 'hey'))
  const candidates = [
    ...(override ? [override] : []),
    join(home, '.local/bin/hey'),
    '/opt/homebrew/bin/hey',
    '/usr/local/bin/hey',
    join(home, 'go/bin/hey'),
    ...fromPath,
  ]

  const rejected: string[] = []
  for (const path of new Set(candidates)) {
    try {
      await access(path, constants.X_OK)
    } catch {
      continue
    }
    const version = await readVersion(path, exec)
    if (!version) {
      rejected.push(path)
      continue
    }
    if (compareVersions(version, MIN_CLI_VERSION) < 0) {
      throw new HeyBinaryError(
        `HEY CLI ${version} at ${path} is too old; version ${MIN_CLI_VERSION} or newer is required.`,
      )
    }
    return { path, version }
  }

  const note = rejected.length ? ` (${rejected.join(', ')} is not the HEY CLI)` : ''
  throw new HeyBinaryError(`HEY CLI not found${note}. Install it from https://github.com/basecamp/hey-cli.`)
}

async function readVersion(path: string, exec: Exec): Promise<string | null> {
  try {
    const { stdout } = await exec(path, ['--version'], 5_000)
    return /^hey version (\d+\.\d+\.\d+)/m.exec(stdout)?.[1] ?? null
  } catch {
    return null
  }
}

export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}
