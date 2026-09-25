import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { DUR, motionOff } from '../motion'
import type { PostingRow } from '@shared/api'
import { shortDate } from '../format'
import { listTags, stripSubjectPrefixes, tagMatchesLabel } from '../mail/forwarded'
import { splitMatches } from '../mail/search'
import { Avatar } from './Avatar'

interface ListProps {
  postings: PostingRow[]
  loading: boolean
  selectedId: number | null
  onOpen: (p: PostingRow) => void
  /** Search results: no Bubbled up / New / Previously seen groups, matches highlighted, and each row's box named. */
  search?: { highlight: string[]; boxNames: Record<number, string>; empty: ReactNode; footer: ReactNode }
  /** Groups folded away (see useCollapsedGroups); their heading stays, with a count. */
  collapsed?: ReadonlySet<string>
  onToggleGroup?: (group: string) => void
}

/** Groups rows the way HEY does: Bubbled up, New for you, Previously seen. */
export function groupOf(p: PostingRow) {
  if (p.bubbledUp) return 'Bubbled up'
  return p.seen ? 'Previously seen' : 'New for you'
}

/**
 * Which of a box's groups are folded away, remembered per box on this device. A
 * convenience: without storage every group simply starts open.
 */
export function useCollapsedGroups(boxId: number | null | undefined) {
  const key = `list:collapsed:${boxId ?? 'none'}`
  const read = () => {
    try {
      const v = JSON.parse(localStorage.getItem(key) ?? '[]') as unknown
      return new Set(Array.isArray(v) ? v.filter((g): g is string => typeof g === 'string') : [])
    } catch {
      return new Set<string>()
    }
  }
  const [state, setState] = useState(() => ({ key, collapsed: read() }))
  // Another box: its own groups.
  const collapsed = state.key === key ? state.collapsed : read()
  if (state.key !== key) setState({ key, collapsed })
  const toggle = useCallback(
    (group: string) =>
      setState((s) => {
        const next = new Set(s.key === key ? s.collapsed : [])
        if (next.has(group)) next.delete(group)
        else next.add(group)
        try {
          localStorage.setItem(key, JSON.stringify([...next]))
        } catch {
          // keep working without persistence
        }
        return { key, collapsed: next }
      }),
    [key],
  )
  return { collapsed, toggle }
}

export function PostingList({ postings, loading, selectedId, onOpen, search, collapsed, onToggleGroup }: ListProps) {
  const listRef = useRef<HTMLUListElement>(null)
  // Rows that just left the box stay a moment, folding shut, so the list closes the gap.
  const { rows: shown, leaving } = useLeavingRows(postings, !search)

  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [selectedId])

  if (loading) return <Empty>Loading…</Empty>
  if (!postings.length) return search ? <div className="scroll min-h-0 flex-1">{search.empty}</div> : <Empty>Nothing here.</Empty>
  const mark = (text: string) => (search ? <Highlighted text={text} terms={search.highlight} /> : text)
  const counts = new Map<string, number>()
  if (!search) for (const p of postings) counts.set(groupOf(p), (counts.get(groupOf(p)) ?? 0) + 1)
  const rows = shown

  return (
    <ul ref={listRef} role="listbox" aria-label="Threads" className="scroll min-h-0 flex-1">
      {rows.map((p, i) => {
        const group = groupOf(p)
        const showHeader = !search && (i === 0 || groupOf(rows[i - 1]!) !== group)
        const selected = p.id === selectedId
        const gone = leaving.has(p.id)
        const folded = !search && !!collapsed?.has(group)
        return (
          <Fragment key={p.id}>
            {showHeader && (
              <li className="sticky top-0 z-10 bg-pane/95 backdrop-blur">
                {onToggleGroup ? (
                  <button
                    type="button"
                    aria-expanded={!folded}
                    onClick={() => onToggleGroup(group)}
                    title={folded ? `Show ${group.toLowerCase()}` : `Hide ${group.toLowerCase()}`}
                    className="eyebrow group flex w-full items-center gap-1.5 px-5 pt-4 pb-1.5 text-left hover:text-ink-soft"
                  >
                    <svg width="9" height="9" viewBox="0 0 16 16" fill="none" aria-hidden className={`shrink-0 transition-transform duration-150 ${folded ? '-rotate-90' : ''}`}>
                      <path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    {group}
                    {folded && <span className="font-normal tabular-nums">· {counts.get(group)}</span>}
                  </button>
                ) : (
                  <div className="eyebrow px-5 pt-4 pb-1.5">{group}</div>
                )}
              </li>
            )}
            {!folded && <li
              ref={gone ? foldShut : undefined}
              role={gone ? undefined : 'option'}
              aria-hidden={gone || undefined}
              aria-selected={gone ? undefined : selected}
              onClick={gone ? undefined : () => onOpen(p)}
              className={`relative mx-2 flex cursor-default items-center gap-3 rounded-ui py-2.5 pr-3 pl-4 transition-colors duration-(--dur-1) ${
                gone ? 'row-leave pointer-events-none' : 'rise'
              } ${selected && !gone ? 'bg-selection' : 'hover:bg-pane-sunk'}`}
              style={{ animationDelay: `${Math.min(i, 12) * 18}ms` }}
            >
              {!p.seen && <span className="absolute top-1/2 left-[5px] size-1.5 -translate-y-1/2 rounded-full bg-new" aria-label="Unseen" />}
              <Avatar avatar={p.avatar} stacked={p.isBundle} blockedTrackers={p.blockedTrackers} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className={`min-w-0 truncate ${p.seen ? 'text-ink-soft' : 'font-semibold text-ink'}`}>
                    {p.subject ? mark(stripSubjectPrefixes(p.isBundle ? p.subject.split(' • ')[0]! : p.subject)) : '(no subject)'}
                  </span>
                  {p.hasAttachments && <Paperclip />}
                  {(p.entryCount ?? 0) > 1 && <span className="shrink-0 text-[11px] text-ink-faint">{p.entryCount}</span>}
                  <span className="ml-auto shrink-0 pl-1 text-[12px] text-ink-faint">{shortDate(p.activeAt)}</span>
                </div>
                <div className="mt-0.5 flex min-w-0 items-baseline gap-1.5 text-[13px] text-ink-faint">
                  {search?.boxNames[p.boxId] && <span className="shrink-0 text-[12px] font-medium text-ink-faint">{search.boxNames[p.boxId]}</span>}
                  {!p.isBundle &&
                    listTags(p.subject).tags.filter((t) => !tagMatchesLabel(t, p.labels)).map((tag) => (
                      <span key={`tag:${tag}`} title="Mailing list" className="shrink-0 rounded-[4px] border border-dashed border-rule-strong px-1 text-[11px] leading-[15px] font-medium text-ink-faint">
                        {tag}
                      </span>
                    ))}
                  {p.labels.map((label) => (
                    <span key={label} className="shrink-0 rounded-[4px] border border-rule-strong px-1 text-[11px] leading-[15px] font-medium text-ink-soft">
                      {label}
                    </span>
                  ))}
                  {p.ai?.needsReply && (
                    <span className="shrink-0 text-[12px] font-semibold text-accent" title={p.ai.replyReason ? `Needs your reply: ${p.ai.replyReason}` : 'Needs your reply'}>
                      Reply
                    </span>
                  )}
                  <span className="min-w-0 truncate">
                    <span className="font-medium text-ink-soft">{mark(senderLabel(p))}</span>
                    {/* The AI's one-line summary when it has read the thread; HEY's opening words otherwise. */}
                    {p.isBundle ? <> · {bundleNote(p)}</> : (p.ai?.summary ?? p.summary) && <> – {mark((p.ai?.summary ?? p.summary)!)}</>}
                  </span>
                </div>
              </div>
            </li>}
          </Fragment>
        )
      })}
      {search?.footer && <li>{search.footer}</li>}
    </ul>
  )
}

/** Folds a leaving row shut: from its height to nothing (the .row-leave transition). */
function foldShut(el: HTMLLIElement | null) {
  if (!el || el.dataset.leaving) return
  el.dataset.leaving = '1'
  el.style.height = `${el.offsetHeight}px`
  void el.offsetHeight // commit the start height before changing it
  Object.assign(el.style, { height: '0px', paddingTop: '0px', paddingBottom: '0px', opacity: '0' })
}

/** How many rows may leave at once and still animate; more is a different list, redrawn. */
const LEAVE_AT_ONCE = 5

/**
 * The rows to draw: `rows`, plus any that just left, kept where they were (after the row
 * that preceded them) until they've folded shut.
 */
export function useLeavingRows(rows: PostingRow[], enabled: boolean) {
  const prev = useRef(rows)
  const [leaving, setLeaving] = useState<Map<number, { row: PostingRow; after: number | null }>>(() => new Map())
  useLayoutEffect(() => {
    const before = prev.current
    prev.current = rows
    if (!enabled || motionOff()) return
    const now = new Set(rows.map((r) => r.id))
    const gone = before.filter((r) => !now.has(r.id))
    if (!gone.length || gone.length > LEAVE_AT_ONCE) return
    const entries = gone.map((row) => {
      const at = before.indexOf(row)
      const after = before.slice(0, at).reverse().find((r) => now.has(r.id))?.id ?? null
      return [row.id, { row, after }] as const
    })
    setLeaving((m) => new Map([...m, ...entries]))
    const t = setTimeout(() => setLeaving((m) => new Map([...m].filter(([id]) => !entries.some(([gid]) => gid === id)))), DUR.base + 60)
    return () => clearTimeout(t)
  }, [rows, enabled])

  if (!leaving.size) return { rows, leaving }
  const out: PostingRow[] = []
  const place = (after: number | null) => {
    for (const { row, after: a } of leaving.values()) if (a === after && !rows.some((r) => r.id === row.id)) out.push(row)
  }
  place(null)
  for (const r of rows) {
    out.push(r)
    place(r.id)
  }
  return { rows: out, leaving }
}

/** Text with the searched words marked, without any HTML injection. */
export function Highlighted({ text, terms }: { text: string; terms: string[] }) {
  return (
    <>
      {splitMatches(text, terms).map((part, i) => (part.match ? <mark key={i}>{part.text}</mark> : <Fragment key={i}>{part.text}</Fragment>))}
    </>
  )
}

/** Sender as HEY shows it, without the stray quotes some mailers put around names. */
function senderLabel(p: PostingRow) {
  const name = p.senderName?.replace(/^["'\s]+|["'\s]+$/g, '')
  return name || p.senderEmail || 'Unknown'
}

/**
 * "2 new" for a bundle: from the cache, or HEY's joined subjects when not yet loaded. A read
 * bundle keeps the subjects of what it once held, so they don't count as new.
 */
function bundleNote(p: PostingRow) {
  if (p.seen && !p.bundleCount) return 'all read'
  const n = Math.max(p.bundleCount ?? 0, p.subject.split(' • ').length)
  return n > 1 ? `${n} new` : 'new'
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="px-5 py-10 text-center text-ink-faint">{children}</div>
}

function Paperclip() {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-label="Has attachments" className="shrink-0 text-ink-faint">
      <path
        d="M10.5 4.5 5.8 9.2a1.5 1.5 0 0 0 2.1 2.1l5-5a3 3 0 0 0-4.2-4.2l-5 5a4.5 4.5 0 0 0 6.4 6.4l4.2-4.2"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  )
}
