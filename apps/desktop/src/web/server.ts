// Dev only: hosts the app backend over HTTP so the UI can run in a normal browser
// (pnpm dev:web). Binds to 127.0.0.1 and requires a per-run token on every request,
// so other local processes and websites cannot read mail through it.
import { execFile } from 'node:child_process'
import { createReadStream } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileHeaders, type ApiEvent } from '../shared/api'
import { AppService } from '../main/service'

const port = Number(process.env.MYHEY_API_PORT ?? 5188)
const token = process.env.MYHEY_TOKEN
if (!token) {
  console.error('MYHEY_TOKEN is required (pnpm dev:web sets it).')
  process.exit(1)
}

const service = new AppService({
  dbPath: join(homedir(), '.myhey-dev', 'cache.db'),
  openFile: (path) =>
    new Promise((resolve, reject) => execFile('open', [path], (err) => (err ? reject(err) : resolve()))),
})
const streams = new Set<ServerResponse>()
service.on('event', (event: ApiEvent) => {
  for (const res of streams) res.write(`data: ${JSON.stringify(event)}\n\n`)
})

function authorized(req: IncomingMessage, url: URL) {
  const given = req.headers['x-api-token'] ?? url.searchParams.get('token') ?? ''
  const a = Buffer.from(String(given))
  const b = Buffer.from(token!)
  return a.length === b.length && timingSafeEqual(a, b)
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`)
  const host = req.headers.host ?? ''
  if (!/^(127\.0\.0\.1|localhost):\d+$/.test(host) || !authorized(req, url)) {
    res.writeHead(403).end()
    return
  }

  if (req.method === 'GET' && url.pathname === '/api/events') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
    streams.add(res)
    req.on('close', () => streams.delete(res))
    return
  }

  if (req.method === 'GET' && url.pathname === '/api/avatar') {
    const f = await service.avatarFile(url.searchParams.get('u') ?? '').catch(() => null)
    if (!f) {
      res.writeHead(404).end()
      return
    }
    res.writeHead(200, { 'content-type': f.contentType, 'cache-control': 'private, max-age=86400' })
    createReadStream(f.path).pipe(res)
    return
  }

  const file = /^\/api\/file\/(.+)$/.exec(url.pathname)
  if (req.method === 'GET' && file) {
    try {
      const f = await service.attachmentFile(decodeURIComponent(file[1]!))
      res.writeHead(200, fileHeaders(f.contentType, f.filename))
      createReadStream(f.path).pipe(res)
    } catch {
      res.writeHead(404).end()
    }
    return
  }

  const match = /^\/api\/(\w+)$/.exec(url.pathname)
  if (req.method !== 'POST' || !match) {
    res.writeHead(404).end()
    return
  }
  try {
    let body = ''
    for await (const chunk of req) body += chunk
    const args = body ? (JSON.parse(body) as unknown) : []
    if (!Array.isArray(args)) throw new Error('body must be an array of arguments')
    const result = await service.dispatch(match[1]!, args)
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(result ?? null))
  } catch (err) {
    res.writeHead(500, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }))
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`dev API on http://127.0.0.1:${port}`)
  void service.boot()
})

// Stop the `hey watch` child with us, or it outlives the server.
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
  process.on(signal, () => {
    service.stop()
    process.exit(0)
  })
}
