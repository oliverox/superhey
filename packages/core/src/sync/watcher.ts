import { EventEmitter } from 'node:events'
import { createInterface } from 'node:readline'
import type { HeyRunner } from '../cli/runner'
import { WatchLine } from '../cli/schemas'

export type WatchStatus = 'connecting' | 'live' | 'reconnecting' | 'stopped'

interface WatcherEvents {
  line: [WatchLine]
  status: [WatchStatus]
  error: [Error]
}

const MIN_BACKOFF_MS = 1_000
const MAX_BACKOFF_MS = 60_000

/**
 * Keeps one `hey watch` process running and emits each change it reports. The CLI holds
 * a websocket to HEY, so there is no polling. If the process exits it is restarted with
 * backoff, resuming from the last change seen so nothing is missed.
 */
export class Watcher extends EventEmitter<WatcherEvents> {
  private child: ReturnType<HeyRunner['spawn']> | null = null
  private stopped = true
  private backoff = MIN_BACKOFF_MS
  private timer: NodeJS.Timeout | null = null
  status: WatchStatus = 'stopped'

  constructor(
    private readonly runner: HeyRunner,
    /** Where to resume from (RFC 3339). Read on every (re)start. */
    private readonly since: () => string | null,
  ) {
    super()
  }

  start() {
    if (!this.stopped) return
    this.stopped = false
    this.spawn()
  }

  stop() {
    this.stopped = true
    if (this.timer) clearTimeout(this.timer)
    this.child?.kill('SIGTERM')
    this.child = null
    this.setStatus('stopped')
  }

  private spawn() {
    this.setStatus(this.status === 'stopped' ? 'connecting' : 'reconnecting')
    const since = this.since()
    const child = this.runner.spawn(['watch', ...(since ? ['--since', since] : [])])
    this.child = child

    let stderr = ''
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr = (stderr + d).slice(-2000)))

    createInterface({ input: child.stdout }).on('line', (raw) => {
      let line: WatchLine
      try {
        line = WatchLine.parse(JSON.parse(raw))
      } catch {
        return // not a change line
      }
      if (line.change === 'ready') {
        this.backoff = MIN_BACKOFF_MS
        this.setStatus('live')
      } else if (line.change === 'disconnected') {
        this.setStatus('reconnecting')
      }
      this.emit('line', line)
    })

    child.on('error', (err) => this.emit('error', err))
    child.on('close', (code) => {
      if (this.child !== child) return
      this.child = null
      if (this.stopped) return
      if (code) this.emit('error', new Error(`hey watch exited with ${code}: ${stderr.trim()}`))
      this.setStatus('reconnecting')
      this.timer = setTimeout(() => this.spawn(), this.backoff)
      this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF_MS)
    })
  }

  private setStatus(status: WatchStatus) {
    if (status === this.status) return
    this.status = status
    this.emit('status', status)
  }
}
