import type { PostingRow, Repo } from '../cache/repo'
import type { HeyClient } from '../cli/client'
import type * as S from '../cli/schemas'
import { PostingId, TopicId } from '../ids'
import { isEmptyQuery, type SearchQuery } from './query'

/**
 * Search runs twice: at once against the cache (every thread's subject, sender, preview and
 * AI summary, and the bodies of threads read), and against HEY's own search, which reaches
 * the whole mailbox, bodies included, a page of 10 at a time. The two are merged by thread.
 */

/** HEY's search returns this many threads a page. */
export const HEY_PAGE_SIZE = 10

/** HEY's box names for `--in`; the other boxes it can't search. */
const HEY_BOXES: Partial<Record<string, string>> = { imbox: 'imbox', feedbox: 'feed', trailbox: 'papertrail', trash: 'trash' }

/**
 * The `hey search` arguments for a query, or null when HEY can't answer it (read state and
 * Reply Later, Set Aside and Bubble Up are known only here). Dates HEY takes as ranges
 * ("last 30 days", "2025"); the exact bounds are applied to what comes back.
 */
export function heyArgs(q: SearchQuery, page: number, today = new Date()): string[] | null {
  if (isEmptyQuery(q) || q.read != null) return null
  if (q.box && !HEY_BOXES[q.box]) return null
  const args: string[] = []
  const free = [...q.words, ...q.phrases.slice(1).map((p) => `"${p}"`)].join(' ')
  if (free) args.push(free)
  const flag = (name: string, value: string | null | undefined) => value && args.push(`--${name}`, value)
  flag('exact', q.phrases[0])
  flag('none', q.excluded.join(' '))
  flag('any', q.anyOf[0]?.join(' '))
  flag('from', q.from)
  flag('to', q.to)
  flag('subject', q.subject)
  flag('label', q.label)
  flag('in', q.box ? HEY_BOXES[q.box] : null)
  flag('attachment', q.attachment)
  flag('date', dateRange(q, today))
  if (page > 1) args.push('--page', String(page))
  return args
}

/** The narrowest of HEY's date ranges that holds after…before. */
function dateRange(q: SearchQuery, today: Date): string | null {
  if (!q.after) return null
  const days = (Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) - Date.parse(`${q.after}T00:00:00Z`)) / 86_400_000
  if (days <= 7) return 'last_7_days'
  if (days <= 30) return 'last_30_days'
  if (days <= 90) return 'last_90_days'
  const year = q.after.slice(0, 4)
  // One calendar year: after 1 Jan and before the next (or within it).
  if (q.before && (q.before.slice(0, 4) === year || q.before === `${Number(year) + 1}-01-01`)) return year
  return null
}

/** A HEY search result as a list row (read state and box unknown: it isn't in the cache). */
export function fromHey(r: S.SearchResult): PostingRow {
  const m = r.messages.at(-1)
  const c = m?.creator
  const name = m?.alternative_sender_name ?? c?.name ?? null
  return {
    id: PostingId(r.id),
    topicId: TopicId(r.topic_id),
    boxId: 0,
    subject: r.subject,
    summary: m?.summary ?? null,
    senderName: name,
    senderEmail: c?.email_address?.toLowerCase() ?? null,
    seen: true,
    bubbledUp: false,
    entryCount: null,
    hasAttachments: false,
    isBundle: false,
    activeAt: r.updated_at,
    appUrl: m?.app_url ?? `https://app.hey.com/topics/${r.topic_id}`,
    labels: [],
    avatar: { url: c?.avatar_url ?? null, color: c?.avatar_background_color ?? null, initials: c?.initials ?? initials(name ?? c?.email_address ?? '') },
    blockedTrackers: false,
    bundleCount: null,
    ai: null,
  }
}

const initials = (s: string) =>
  s.replace(/[^\p{L}\p{N} ]/gu, ' ').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?'

export interface HeySearchPage {
  rows: PostingRow[]
  page: number
  /** HEY has another page. */
  more: boolean
  /** HEY can't answer this query (see heyArgs); only the cache's results count. */
  unsupported: boolean
}

/** One page of HEY's search, with threads the cache knows shown as the cache has them. */
export async function searchHey(client: HeyClient, repo: Repo, q: SearchQuery, page: number, today = new Date()): Promise<HeySearchPage> {
  const args = heyArgs(q, page, today)
  if (!args) return { rows: [], page, more: false, unsupported: true }
  const found = await client.search(args)
  const bounds = localBounds(q)
  const rows = found
    .filter((r) => {
      const t = Date.parse(r.updated_at)
      return (!bounds.after || t >= Date.parse(bounds.after)) && (!bounds.before || t < Date.parse(bounds.before))
    })
    .map((r) => repo.threadRow(TopicId(r.topic_id)) ?? fromHey(r))
  return { rows, page, more: found.length >= HEY_PAGE_SIZE, unsupported: false }
}

/** The query's dates as instants: local midnight of each day. */
export function localBounds(q: SearchQuery): { after: string | null; before: string | null } {
  const at = (d: string | null) => {
    if (!d) return null
    const [y, m, day] = d.split('-').map(Number) as [number, number, number]
    return new Date(y, m - 1, day).toISOString()
  }
  return { after: at(q.after), before: at(q.before) }
}
