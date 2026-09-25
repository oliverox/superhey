// Signatures that repeat across a thread (title, phone, address under every message from
// the same person) fold away; the sign-off and name stay, so each message still ends as
// written ("Best regards, / Sam").

export interface SignedBody {
  id: number
  /** Who wrote it (their address); signatures only compare within one sender. */
  sender: string | null
  /** What the message adds, as shown (quoted history already split off). */
  text: string
}

// "Best regards," "Thanks," "Cheers," "Bien à vous," …: kept in view.
const SIGN_OFF = /^(best|kind|warm|warmest|many|all the best|thanks|thank you|thx|regards|cheers|sincerely|yours|cordialement|bien (à|a) vous|salutations|merci|with (love|thanks|gratitude)|love|take care)\b/i
const MIN_LINES = 2
const MIN_CHARS = 20

const norm = (line: string) => line.replace(/\s+/g, ' ').trim().toLowerCase()

/** Lines, trailing blank lines dropped, each with where it starts in `text`. */
function lines(text: string): Array<{ line: string; at: number }> {
  const out: Array<{ line: string; at: number }> = []
  let at = 0
  for (const line of text.split('\n')) {
    out.push({ line, at })
    at += line.length + 1
  }
  while (out.length && !out.at(-1)!.line.trim()) out.pop()
  return out
}

/** A person's name on its own line under a sign-off: short, no digits, links or addresses. */
const looksLikeName = (line: string) => {
  const t = line.trim()
  return t.length > 0 && t.length <= 40 && !/[\d@]|https?:|www\./i.test(t)
}

/**
 * Where each message's repeated signature starts (an index into its text), for messages
 * whose sender ends at least two messages in the thread with the same lines.
 */
export function repeatedSignatures(bodies: SignedBody[]): Map<number, number> {
  const cuts = new Map<number, number>()
  const bySender = new Map<string, Array<{ id: number; ls: Array<{ line: string; at: number }> }>>()
  for (const b of bodies) {
    if (!b.sender) continue
    const list = bySender.get(b.sender) ?? []
    list.push({ id: b.id, ls: lines(b.text) })
    bySender.set(b.sender, list)
  }
  for (const msgs of bySender.values()) {
    if (msgs.length < 2) continue
    // The longest run of closing lines every message from this sender ends with.
    let common = 0
    for (;;) {
      const at = common + 1
      if (msgs.some((m) => m.ls.length < at)) break
      const line = norm(msgs[0]!.ls.at(-at)!.line)
      if (!msgs.every((m) => norm(m.ls.at(-at)!.line) === line)) break
      common = at
    }
    if (!common) continue
    for (const m of msgs) {
      let start = m.ls.length - common
      while (start < m.ls.length && !m.ls[start]!.line.trim()) start++
      // The sign-off and the name under it stay in view.
      if (SIGN_OFF.test(m.ls[start]!.line.trim())) {
        start++
        if (start < m.ls.length && looksLikeName(m.ls[start]!.line)) start++
      } else if (looksLikeName(m.ls[start]!.line) && start > 0 && SIGN_OFF.test(m.ls[start - 1]!.line.trim())) {
        start++
      }
      while (start < m.ls.length && !m.ls[start]!.line.trim()) start++
      const folded = m.ls.slice(start)
      const chars = folded.reduce((n, l) => n + l.line.trim().length, 0)
      // Something must remain above it, and it must be worth folding.
      const before = m.ls.slice(0, start).some((l) => l.line.trim())
      if (before && folded.filter((l) => l.line.trim()).length >= MIN_LINES && chars >= MIN_CHARS) cuts.set(m.id, m.ls[start]!.at)
    }
  }
  return cuts
}
