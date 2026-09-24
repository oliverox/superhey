import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// HEY serves a real logo or photo as PNG/JPEG, and a generated initials SVG for everyone
// else. Only real images are worth caching; initials are drawn by the app from the colour
// and letters HEY already sends.

const ALLOWED = /^https:\/\/app\.hey\.com\/avatars\/[\w\-=%.]+(\?v=[\w]+)?$/
const IMAGE_TYPES: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' }
const MAX_BYTES = 1_000_000
const MAX_CONCURRENT = 4

export type AvatarFetch = (url: string) => Promise<{ ok: boolean; contentType: string; body: Uint8Array }>

const defaultFetch: AvatarFetch = async (url) => {
  const res = await fetch(url, { redirect: 'error' })
  return { ok: res.ok, contentType: (res.headers.get('content-type') ?? '').split(';')[0]!.trim(), body: new Uint8Array(await res.arrayBuffer()) }
}

export interface AvatarFile {
  path: string
  contentType: string
}

/**
 * Downloads HEY avatars once and keeps them on disk. `get` answers null for anything that
 * isn't a real image (initials SVGs, errors, other hosts), and remembers that answer.
 */
export class AvatarCache {
  private readonly inFlight = new Map<string, Promise<AvatarFile | null>>()
  private active = 0
  private readonly queue: Array<() => void> = []

  constructor(
    private readonly dir: string,
    private readonly fetchImpl: AvatarFetch = defaultFetch,
  ) {
    mkdirSync(dir, { recursive: true })
  }

  static isAllowed(url: string) {
    return ALLOWED.test(url)
  }

  async get(url: string): Promise<AvatarFile | null> {
    if (!AvatarCache.isAllowed(url)) return null
    const key = createHash('sha256').update(url).digest('hex').slice(0, 32)
    for (const [type, ext] of Object.entries(IMAGE_TYPES)) {
      const path = join(this.dir, `${key}.${ext}`)
      if (existsSync(path)) return { path, contentType: type }
    }
    if (existsSync(join(this.dir, `${key}.none`))) return null

    const pending = this.inFlight.get(key)
    if (pending) return pending
    const job = this.limit(() => this.download(url, key)).finally(() => this.inFlight.delete(key))
    this.inFlight.set(key, job)
    return job
  }

  private async download(url: string, key: string): Promise<AvatarFile | null> {
    try {
      const res = await this.fetchImpl(url)
      const ext = IMAGE_TYPES[res.contentType]
      if (!res.ok || !ext || res.body.byteLength > MAX_BYTES) {
        // Initials SVG or unusable: remember so it isn't fetched again.
        if (res.ok) writeFileSync(join(this.dir, `${key}.none`), '')
        return null
      }
      const path = join(this.dir, `${key}.${ext}`)
      writeFileSync(path, res.body)
      return { path, contentType: res.contentType }
    } catch {
      return null // offline or refused: try again next time
    }
  }

  private async limit<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= MAX_CONCURRENT) await new Promise<void>((r) => this.queue.push(r))
    this.active++
    try {
      return await fn()
    } finally {
      this.active--
      this.queue.shift()?.()
    }
  }
}
