import { fuzzyMatch } from './fuzzy'

/**
 * What the command bar lists. Sources (the shortcut table, boxes, labels, the cache, and
 * in M2 the AI) each produce commands; the bar only ranks and runs them.
 */
export interface Command {
  /** Stable across openings: used to remember recent choices. */
  id: string
  section: Section
  title: string
  /** Other words it answers to ("archive", "later"). Matched, never shown. */
  keywords?: string[]
  /** A quiet second part of the row (a sender, a date). */
  detail?: string
  /** The shortcut that does the same, shown so it gets learned. */
  keys?: readonly string[]
  run: () => void
}

export type Section = 'Recent' | 'Actions' | 'Go to' | 'Labels' | 'Emails' | 'App'

/** Order of sections when nothing is typed, and for ties. */
export const SECTION_ORDER: Section[] = ['Recent', 'Actions', 'Go to', 'Labels', 'Emails', 'App']

export interface Ranked {
  command: Command
  /** Matched character indices in the title, for highlighting. */
  indices: number[]
  score: number
}

/**
 * The commands to show for `query`. Empty: recent choices first, then every section in
 * order, leaving out the long ones (each label, each email: "Labels…" covers the first,
 * and the second need a query). Typed: the best matches of all, whatever their section (a title match beats one
 * only in the keywords or detail).
 */
export function rank(query: string, commands: Command[], recent: string[] = [], limit = 50): Ranked[] {
  if (!query.trim()) {
    const byId = new Map(commands.map((c) => [c.id, c]))
    const recents = recent.flatMap((id) => byId.get(id) ?? []).slice(0, 5)
    const recentIds = new Set(recents.map((c) => c.id))
    const rest = commands
      .filter((c) => !recentIds.has(c.id) && c.section !== 'Emails' && c.section !== 'Labels')
      .sort((a, b) => SECTION_ORDER.indexOf(a.section) - SECTION_ORDER.indexOf(b.section))
    return [...recents.map((c) => ({ command: { ...c, section: 'Recent' as const }, indices: [], score: 0 })), ...rest.map((c) => ({ command: c, indices: [], score: 0 }))].slice(0, limit)
  }

  const recentBoost = new Map(recent.map((id, i) => [id, 6 - Math.min(i, 5)]))
  const ranked: Ranked[] = []
  for (const command of commands) {
    const title = fuzzyMatch(query, command.title)
    const other = [...(command.keywords ?? []), command.detail ?? '']
      .map((k) => fuzzyMatch(query, k))
      .reduce<number | null>((best, m) => (m && (best == null || m.score > best) ? m.score : best), null)
    if (!title && other == null) continue
    const score = Math.max(title?.score ?? -Infinity, (other ?? -Infinity) - 15) + (recentBoost.get(command.id) ?? 0)
    ranked.push({ command, indices: title?.indices ?? [], score })
  }
  return ranked
    .sort((a, b) => b.score - a.score || SECTION_ORDER.indexOf(a.command.section) - SECTION_ORDER.indexOf(b.command.section))
    .slice(0, limit)
}

/** Remembered recent choices, newest first. Per device; storage may be unavailable. */
const RECENT_KEY = 'command-bar:recent'
export function loadRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as unknown
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}
export function remember(id: string, recent = loadRecent()): string[] {
  // Emails are one-off jumps; remembering them would crowd out commands.
  if (id.startsWith('email:')) return recent
  const next = [id, ...recent.filter((r) => r !== id)].slice(0, 8)
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next))
  } catch {
    // works without persistence
  }
  return next
}
