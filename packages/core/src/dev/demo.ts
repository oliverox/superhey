// End-to-end check against the real HEY account: pnpm demo [--watch seconds]
import { createCore, TopicId } from '../index'

const dbPath = new URL('../../.data/dev.db', import.meta.url).pathname
const watchSecs = Number(process.argv[process.argv.indexOf('--watch') + 1]) || 0

const t0 = Date.now()
const { cli, repo, engine } = await createCore({ dbPath })
console.log(`HEY CLI ${cli.version} at ${cli.path}`)

await engine.initialSync()
console.log(`initial sync: ${Date.now() - t0} ms`, repo.counts())

const imbox = repo.boxByKind('imbox')!
console.log('\nImbox (top 8):')
for (const p of repo.postings(imbox.id, 8))
  console.log(` ${p.seen ? ' ' : '•'} ${(p.senderName ?? '').padEnd(28).slice(0, 28)} ${p.subject.slice(0, 60)}`)

const first = repo.postings(imbox.id, 20).find((p) => p.topicId && (p.entryCount ?? 0) > 1)
if (first?.topicId) {
  const t1 = Date.now()
  const thread = await engine.ensureThread(TopicId(first.topicId), first.entryCount)
  console.log(`\nthread "${thread?.subject}": ${thread?.entries.length} entries in ${Date.now() - t1} ms`)
  const word = thread?.entries[0]?.bodyMd.split(/\W+/).find((w) => w.length > 6)
  if (word) console.log(`search "${word}":`, repo.search(word, 3).map((h) => h.snippet))
}

const t2 = Date.now()
const pages = await engine.backfillBox(imbox.id, { maxPages: 2, delayMs: 0 })
console.log(`\nbackfill: ${pages} pages in ${Date.now() - t2} ms; imbox now ${repo.postingCount(imbox.id)} postings`)

if (watchSecs) {
  engine.on('status', (s) => console.log('status', s.watch))
  engine.on('change', (c) => console.log('change', c))
  engine.on('error', (e) => console.error('error', e.message))
  await engine.start()
  await new Promise((r) => setTimeout(r, watchSecs * 1000))
}
engine.stop()
