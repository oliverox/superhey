// Finds where a reply's quoted history begins ("On … wrote:", Outlook's From/Sent block,
// "-----Original Message-----"), so the reader can show only what's new.

export interface QuotedSplit {
  /** What this message adds. */
  fresh: string
  /** The quoted history, from its intro line onward. */
  quoted: string
  /** Who is being quoted, when the intro line names them. */
  quotedName: string | null
}

// "On Tue, 22 Sep 2026 at 21:44, Rachel <r@x.fr> wrote:" in the languages seen in the wild.
// The intro can wrap onto a second line.
const WROTE =
  /^[ \t>]*(?:On|Le|Am|El|Il|Em|Op|Den|Dne)\s[^\n]{4,300}?(?:\n[^\n]{1,200}?)?\s(?:wrote|a écrit|schrieb|escribió|ha scritto|escreveu|schreef|skrev|napsal)\s?:[ \t]*$/im

// Outlook: "From: X" followed by "Sent:" on the next line or the same one. HEY bolds the labels.
const OUTLOOK = /^[ \t>]*(?:\*\*|__)?From:(?:\*\*|__)?[ \t]+[^\n]+?(?:\n[ \t>]*(?:\*\*|__)?(?:Sent|Date):|\s(?:\*\*|__)?Sent:)/im

const ORIGINAL = /^[ \t>]*\\?-{2,}\s*Original Message\s*-{2,}[ \t]*$/im

// A forward's header is content, never quoted history.
const FORWARD = /^[ \t]*\\?-{2,}\s*Forwarded message\s*-{2,}[ \t]*$|^[ \t]*Begin forwarded message:[ \t]*$/im

/**
 * `laterInThread`: an Outlook From/Sent block in the first message of a thread is usually
 * a forward, so it only counts as a quote in a later message.
 */
export function splitQuoted(markdown: string, laterInThread: boolean): QuotedSplit | null {
  const forwardAt = FORWARD.exec(markdown)?.index ?? Infinity
  const candidates = [WROTE, ORIGINAL, ...(laterInThread ? [OUTLOOK] : [])]
    .map((re) => re.exec(markdown))
    .filter((m): m is RegExpExecArray => m != null && m.index < forwardAt)
    .sort((a, b) => a.index - b.index)
  const first = candidates[0]
  if (!first) return null

  const fresh = markdown.slice(0, first.index).trimEnd()
  // Nothing new above the quote (an inline reply, or a forward-like message): show it all.
  if (!visibleText(fresh)) return null
  const quoted = markdown.slice(first.index).trim()
  return { fresh, quoted, quotedName: quotedName(first[0]) }
}

function visibleText(md: string) {
  return md.replace(/[\s*_\\>#-]+/g, '')
}

/** The name in an intro line: the text before "<email>" after the last comma, or Outlook's From. */
function quotedName(intro: string): string | null {
  const clean = intro.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\\([<>_*])/g, '$1').replace(/\*\*|__/g, '')
  const outlook = /From:\s*([^\n<]+?)\s*(?:<|\bSent:|\n|$)/i.exec(clean)
  if (outlook && /From:/i.test(clean.slice(0, 12))) return tidy(outlook[1]!)
  const beforeEmail = /,\s*([^,<\n]+?)\s*<[^>]+>/.exec(clean.split(/\s(?:wrote|a écrit|schrieb|escribió|ha scritto|escreveu|schreef|skrev|napsal)/i)[0] ?? '')
  return beforeEmail ? tidy(beforeEmail[1]!) : null
}

function tidy(name: string) {
  const t = name.replace(/^["'\s]+|["'\s]+$/g, '').trim()
  return t && t.length <= 80 ? t : null
}
