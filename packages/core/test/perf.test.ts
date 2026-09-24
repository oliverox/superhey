import { describe, expect, it } from 'vitest'
import { openDb } from '../src/cache/db'
import { Repo } from '../src/cache/repo'
import * as S from '../src/cli/schemas'
import { posting } from './fixtures'

// Guards the list queries, which run on the app's main thread and re-run on every sync
// update: a version that checked each row against its whole box took 7 s on a real cache.
describe('list query performance', () => {
  it('stays fast on a large box with bundles', () => {
    const r = new Repo(openDb(':memory:'))
    r.replaceBoxes([{ id: 1, kind: 'imbox', name: 'Imbox' }])
    const rows = Array.from({ length: 10_000 }, (_, i) =>
      S.Posting.parse(
        posting({
          id: i + 1,
          topic_id: 100_000 + i,
          kind: i % 500 === 0 ? 'bundle' : 'topic',
          seen: i % 3 === 0 ? true : undefined,
          creator: { id: i % 200, name: `Sender ${i % 200}`, email_address: `s${i % 200}@example.com` },
          active_at: new Date(Date.UTC(2026, 0, 1) + i * 60_000).toISOString(),
        }),
      ),
    )
    r.upsertPostings(rows)

    const time = (fn: () => unknown) => {
      const t = performance.now()
      for (let i = 0; i < 5; i++) fn()
      return (performance.now() - t) / 5
    }
    expect(time(() => r.boxes())).toBeLessThan(100)
    expect(time(() => r.postings(1, 200))).toBeLessThan(100)
    expect(r.postings(1, 10_000).filter((p) => p.isBundle)).toHaveLength(20)
  })
})
