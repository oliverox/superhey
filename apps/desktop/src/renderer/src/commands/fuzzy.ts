/**
 * Fuzzy matching for the command bar: the query's characters must appear in order, and the
 * score rewards what people mean when they type a few letters: the start of the text, the
 * start of a word ("rl" → Reply Later), and runs of consecutive letters. Case and accents
 * don't matter ("cafe" finds "Café").
 */

export interface FuzzyMatch {
  score: number
  /** Indices into the original text of the matched characters, for highlighting. */
  indices: number[]
}

/** Lower case without accents, keeping one character per character of the original. */
function fold(s: string): string {
  let out = ''
  for (const ch of s) {
    const base = ch.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
    // Rare characters that fold to more or fewer than one (ß → ss): keep as they are, so
    // indices still line up with the text.
    out += base.length === ch.length ? base : ch.toLowerCase().length === ch.length ? ch.toLowerCase() : ch
  }
  return out
}

const isWordStart = (text: string, i: number) => i === 0 || /[\s\-_/.:·•([]/.test(text[i - 1]!) || (/[a-z]/.test(text[i - 1]!) && /[A-Z]/.test(text[i]!))

/**
 * Scores `text` against `query`, or null when it doesn't match. Tries the best alignment of
 * each query character (word starts first), so "rl" matches Reply *L*ater, not Rep*l*y.
 */
export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
  const q = fold(query.trim()).replace(/\s+/g, ' ')
  if (!q) return { score: 0, indices: [] }
  const t = fold(text)

  // A plain substring is the strongest signal; score it directly.
  const at = t.indexOf(q)
  if (at >= 0) {
    const indices = Array.from({ length: q.length }, (_, k) => at + k)
    return { score: 100 + (at === 0 ? 60 : isWordStart(text, at) ? 35 : 0) + q.length * 4 - text.length * 0.1, indices }
  }

  // Otherwise the words of the query each match, in order, preferring word starts.
  const indices: number[] = []
  let from = 0
  let score = 0
  let prev = -2
  for (const ch of q) {
    if (ch === ' ') continue
    // Prefer the next word start carrying this letter; else the next occurrence at all.
    let best = -1
    for (let i = from; i < t.length; i++) {
      if (t[i] !== ch) continue
      if (i === prev + 1) {
        best = i // continuing a run beats jumping to a word start
        break
      }
      if (isWordStart(text, i)) {
        best = i
        break
      }
      if (best < 0) best = i
    }
    if (best < 0) return null
    score += best === prev + 1 ? 8 : isWordStart(text, best) ? 10 : 1
    if (best === 0) score += 8
    indices.push(best)
    prev = best
    from = best + 1
  }
  // Tighter matches and shorter texts rank higher.
  const spread = indices.at(-1)! - indices[0]!
  return { score: score - spread * 0.2 - text.length * 0.05, indices }
}
