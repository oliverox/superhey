import { Tag } from './Tag'
import { MarkRead } from './MarkRead'
import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { DUR, motionOff } from '../motion'
import type { PostingRow } from '@shared/api'
import { shortDate } from '../format'
import { listTags, stripSubjectPrefixes, tagKind, tagMatchesLabel } from '../mail/forwarded'
import { splitMatches } from '../mail/search'
import { Avatar } from './Avatar'
import { quietName } from '../today/comingUp'
import { api } from '../api'

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
  /** The just-opened email kept in New for you (see groupOf). */
  heldNew?: number | null
  /** The Feed: rows read as headlines, without the bold of unread. */
  feed?: boolean
  /** The Column style: rows written like the Briefing's (the subject, then who and what it's about), The Feed's too. */
  clean?: boolean
}

/**
 * Groups rows the way HEY does: Bubbled up, New for you, Previously seen. `heldNew` is the
 * email you just opened while it was new: it stays in New for you (no longer bold) until
 * you open another, so it doesn't jump away under the pointer.
 */
export function groupOf(p: PostingRow, heldNew: number | null = null) {
  if (p.bubbledUp) return 'Bubbled up'
  return p.seen && p.id !== heldNew ? 'Previously seen' : 'New for you'
}

/** The rows in group order (as the cache sorts them), with `heldNew` kept among the new. */
export function inGroupOrder(postings: PostingRow[], heldNew: number | null): PostingRow[] {
  if (heldNew == null || !postings.some((p) => p.id === heldNew)) return postings
  const rank = (p: PostingRow) => (p.bubbledUp ? 0 : groupOf(p, heldNew) === 'New for you' ? 1 : 2)
  return postings
    .map((p, i) => ({ p, i }))
    .sort((a, b) => rank(a.p) - rank(b.p) || (b.p.activeAt ?? '').localeCompare(a.p.activeAt ?? '') || a.i - b.i)
    .map(({ p }) => p)
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

export function PostingList({ postings, loading, selectedId, onOpen, search, collapsed, onToggleGroup, heldNew = null, feed = false, clean = false }: ListProps) {
  const listRef = useRef<HTMLUListElement>(null)
  // Rows that just left the box stay a moment, folding shut, so the list closes the gap.
  const { rows: shown, leaving } = useLeavingRows(postings, !search)
  const picking = usePicked(postings)

  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [selectedId])

  if (loading) return <Empty>Loading…</Empty>
  if (!postings.length) return search ? <div className="scroll min-h-0 flex-1">{search.empty}</div> : <Empty>Nothing here.</Empty>
  const mark = (text: string) => (search ? <Highlighted text={text} terms={search.highlight} /> : text)
  const counts = new Map<string, number>()
  if (!search) for (const p of postings) counts.set(groupOf(p, heldNew), (counts.get(groupOf(p, heldNew)) ?? 0) + 1)
  const rows = shown

  return (
    <ul ref={listRef} role="listbox" aria-label="Threads" className="scroll min-h-0 flex-1">
      {rows.map((p, i) => {
        const group = groupOf(p, heldNew)
        const showHeader = !search && (i === 0 || groupOf(rows[i - 1]!, heldNew) !== group)
        const selected = p.id === selectedId
        const gone = leaving.has(p.id)
        const folded = !search && !!collapsed?.has(group)
        // In Previously seen, a quiet heading where the day changes (Today, Yesterday…).
        const bucket = group === 'Previously seen' ? dayBucket(p.activeAt) : null
        const prevBucket = i > 0 && groupOf(rows[i - 1]!, heldNew) === group && group === 'Previously seen' ? dayBucket(rows[i - 1]!.activeAt) : null
        const day = bucket && bucket !== prevBucket && !(showHeader && bucket === 'Today') ? bucket : null
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
            {!folded && !search && day && <li aria-hidden className="px-5 pt-3 pb-1 text-[11px] font-medium text-ink-faint">{day}</li>}
            {!folded && <li
              ref={gone ? foldShut : undefined}
              role={gone ? undefined : 'option'}
              aria-hidden={gone || undefined}
              aria-selected={gone ? undefined : selected}
              onClick={gone ? undefined : (e) => (picking.active || e.metaKey || e.ctrlKey || e.shiftKey ? picking.click(p, e.shiftKey, rows) : onOpen(p))}
              className={`group/row relative mx-2 flex cursor-default items-center gap-3 rounded-ui py-2 pr-3 pl-3 transition-colors duration-(--dur-1) ${
                gone ? 'row-leave pointer-events-none' : 'rise'
              } ${(selected || picking.has(p.id)) && !gone ? 'bg-selection' : 'hover:bg-pane-sunk'}`}
              style={{ animationDelay: `${Math.min(i, 12) * 18}ms`, '--row-bg': selected || picking.has(p.id) ? 'var(--selection)' : 'var(--pane-sunk)' } as React.CSSProperties}
            >
              {!gone && !search && !picking.active && <MarkRead posting={p} />}
              {clean ? (
                // Like the Briefing's rows: the subject leads (heavier while unread), and one
                // faint line under it says who and what it's about.
                <>
                  <span className="self-start pt-[2px]">
                    <PickAvatar posting={p} size={32} picking={picking} rows={rows} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      {!p.isBundle && <SubjectTags subject={p.subject} sender={senderLabel(p)} labels={p.labels} />}
                      {p.labels.filter((label) => tagKind(label, senderLabel(p)) !== 'sender').map((label) => (
                        <Tag key={label} kind="label">
                          {label}
                        </Tag>
                      ))}
                      <span className={`min-w-0 flex-1 truncate text-[15px] ${p.seen ? 'text-ink-soft' : 'font-medium text-ink'}`}>
                        {p.subject ? mark(quietName(stripSubjectPrefixes(p.isBundle ? p.subject.split(' • ')[0]! : p.subject))) : '(no subject)'}
                      </span>
                      <span className="flex shrink-0 items-center gap-2 pl-2 text-ink-faint">
                        {p.ai?.needsReply && (
                          <span title={p.ai.replyReason ? `Needs your reply: ${p.ai.replyReason}` : 'Needs your reply'} aria-label="Needs your reply" className="text-accent">
                            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                              <path d="M6.5 3.5 2.5 7.5l4 4" />
                              <path d="M2.5 7.5h7a4 4 0 0 1 4 4V13" />
                            </svg>
                          </span>
                        )}
                        {p.hasAttachments && <Paperclip />}
                        <span className="text-[12px] tabular-nums">{search ? shortDate(p.activeAt) : rowTime(p.activeAt, p.seen)}</span>
                      </span>
                    </div>
                    <div className="mt-0.5 truncate text-[13px] text-ink-faint">
                      {search?.boxNames[p.boxId] && <span>{search.boxNames[p.boxId]} · </span>}
                      <span className={p.seen ? '' : 'text-ink-soft'}>{mark(senderLabel(p))}</span>
                      {(p.isBundle ? bundleSize(p) : (p.entryCount ?? 0)) > 1 && <span className="tabular-nums"> · {p.isBundle ? bundleSize(p) : p.entryCount}</span>}
                      {!p.isBundle && feedPreview(p) && <span> · {mark(feedPreview(p)!)}</span>}
                    </div>
                  </div>
                </>
              ) : feed ? (
                // The Feed reads like a newspaper's index: the headline first, the byline and
                // what it's about under it, no bold (in the Feed, unread is the usual state).
                <>
                  <span className="self-start pt-[3px]">
                    <PickAvatar posting={p} size={24} picking={picking} rows={rows} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-3">
                      <span className={`min-w-0 flex-1 truncate font-title text-[15px] ${p.seen ? 'text-ink-faint' : 'text-ink'}`}>
                        {p.subject ? mark(quietName(stripSubjectPrefixes(p.isBundle ? p.subject.split(' • ')[0]! : p.subject))) : '(no subject)'}
                      </span>
                      <span className="shrink-0 font-meta text-[12px] text-ink-faint tabular-nums">{search ? shortDate(p.activeAt) : rowTime(p.activeAt, p.seen)}</span>
                    </div>
                    <div className="mt-0.5 truncate text-[13px] text-ink-faint">
                      <span className={p.seen ? '' : 'text-ink-soft'}>{mark(senderLabel(p))}</span>
                      {p.isBundle && bundleSize(p) > 1 && <span className="tabular-nums"> · {bundleSize(p)}</span>}
                      {!p.isBundle && feedPreview(p) && <span> · {mark(feedPreview(p)!)}</span>}
                    </div>
                  </div>
                </>
              ) : (
                <>
                <span>
                  <PickAvatar posting={p} size={32} picking={picking} rows={rows} />
                </span>
                <div className="min-w-0 flex-1">
                  {/* Who, then when (and whether it wants a reply). */}
                  <div className="flex items-center gap-2">
                    {!p.seen && <span className="size-1.5 shrink-0 rounded-full bg-new" aria-label="Unseen" />}
                    <span className={`min-w-0 truncate text-[14px] ${p.seen ? 'text-ink-soft' : 'font-semibold text-ink'}`}>{mark(senderLabel(p))}</span>
                    {(p.isBundle ? bundleSize(p) : (p.entryCount ?? 0)) > 1 && (
                      <span className="shrink-0 text-[12px] text-ink-faint tabular-nums" title={p.isBundle ? 'Emails in this bundle' : 'Messages in this thread'}>
                        {p.isBundle ? bundleSize(p) : p.entryCount}
                      </span>
                    )}
                    <span className="ml-auto flex shrink-0 items-center gap-2 pl-2">
                      {p.ai?.needsReply && (
                        <span className="text-accent" title={p.ai.replyReason ? `Needs your reply: ${p.ai.replyReason}` : 'Needs your reply'} aria-label="Needs your reply">
                          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                            <path d="M6.5 3.5 2.5 7.5l4 4" />
                            <path d="M2.5 7.5h7a4 4 0 0 1 4 4V13" />
                          </svg>
                        </span>
                      )}
                      {p.hasAttachments && <Paperclip />}
                      <span className={`text-[12px] tabular-nums ${p.seen ? 'text-ink-faint' : 'font-medium text-ink-soft'}`}>{search ? shortDate(p.activeAt) : rowTime(p.activeAt, p.seen)}</span>
                    </span>
                  </div>
                  {/* What: tags, the subject, and the AI's line (or HEY's opening words). A bundle: its latest subject. */}
                  <div className="mt-px flex min-w-0 items-baseline gap-1.5 text-[13px]">
                    {search?.boxNames[p.boxId] && <span className="shrink-0 text-[12px] font-medium text-ink-faint">{search.boxNames[p.boxId]}</span>}
                    {!p.isBundle && <SubjectTags subject={p.subject} sender={senderLabel(p)} labels={p.labels} />}
                    {p.labels.filter((label) => tagKind(label, senderLabel(p)) !== 'sender').map((label) => (
                      <Tag key={label} kind="label">
                        {label}
                      </Tag>
                    ))}
                    <span className="min-w-0 truncate">
                      <span className={`row-subject ${p.seen ? 'text-ink-soft' : 'font-medium text-ink'}`}>
                        {p.subject ? mark(stripSubjectPrefixes(p.isBundle ? p.subject.split(' • ')[0]! : p.subject)) : '(no subject)'}
                      </span>
                      {!p.isBundle && (p.ai?.summary ?? p.summary) && <span className="text-ink-faint"> – {mark((p.ai?.summary ?? p.summary)!)}</span>}
                    </span>
                  </div>
                </div>
                </>
              )}
            </li>}
          </Fragment>
        )
      })}
      {search?.footer && <li>{search.footer}</li>}
      {picking.active && <PickedBar picking={picking} postings={postings} />}
    </ul>
  )
}

type Picking = ReturnType<typeof usePicked>

/**
 * Rows picked for acting on together. Picking starts from a row's avatar (or ⌘/⇧-click);
 * while it's on, a click picks a row instead of opening it, ⇧ picks the run from the last
 * one, ⌘A picks them all, and Esc or a click elsewhere lets go. Rows that leave the box leave the pick.
 */
function usePicked(postings: PostingRow[]) {
  const [picked, setPicked] = useState<ReadonlySet<number>>(() => new Set())
  const anchor = useRef<number | null>(null)
  const present = new Set<number>(postings.map((p) => p.id))
  const live = [...picked].filter((id) => present.has(id))
  if (live.length !== picked.size) setPicked(new Set(live))
  const active = live.length > 0

  const clear = useCallback(() => {
    setPicked(new Set())
    anchor.current = null
  }, [])
  const all = useCallback(() => setPicked(new Set(postings.filter((p) => p.id > 0).map((p) => p.id))), [postings])

  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof Element && e.target.closest('input, textarea, [contenteditable="true"]')) return
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopImmediatePropagation()
        clear()
      } else if (e.key === 'a' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        all()
      }
    }
    // A click anywhere but a row or the bar lets go.
    const onDown = (e: PointerEvent) => {
      if (e.target instanceof Element && e.target.closest('[role="option"], [aria-label="Selected emails"]')) return
      clear()
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('pointerdown', onDown, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('pointerdown', onDown, true)
    }
  }, [active, clear, all])

  return {
    active,
    count: live.length,
    ids: live,
    has: (id: number) => picked.has(id),
    clear,
    all,
    /** Picks or lets go of a row; with `range`, every row from the last one picked to it. */
    click(p: PostingRow, range: boolean, rows: PostingRow[]) {
      if (p.id <= 0) return
      const from = anchor.current != null ? rows.findIndex((r) => r.id === anchor.current) : -1
      const to = rows.findIndex((r) => r.id === p.id)
      setPicked((s) => {
        const next = new Set(s)
        if (range && from >= 0 && to >= 0) {
          for (const r of rows.slice(Math.min(from, to), Math.max(from, to) + 1)) if (r.id > 0) next.add(r.id)
        } else if (next.has(p.id)) next.delete(p.id)
        else next.add(p.id)
        return next
      })
      anchor.current = p.id
    },
  }
}

/**
 * A row's avatar, which is also its checkbox: on hover a ring round it shows it can be
 * picked (the avatar itself unchanged), and a picked row's avatar turns into a check.
 */
function PickAvatar({ posting: p, size, picking, rows }: { posting: PostingRow; size: number; picking: Picking; rows: PostingRow[] }) {
  const on = picking.has(p.id)
  if (p.id <= 0) return <Avatar avatar={p.avatar} size={size} />
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={on}
      aria-label={on ? 'Unselect' : 'Select'}
      title={on ? 'Unselect' : 'Select (⇧-click for a range)'}
      onClick={(e) => {
        e.stopPropagation()
        picking.click(p, e.shiftKey, rows)
      }}
      className="group/pick relative block rounded-full"
      style={{ width: size, height: size }}
    >
      <span className={`block transition-opacity duration-(--dur-1) ${on ? 'opacity-0' : ''}`}>
        <Avatar avatar={p.avatar} size={size} />
      </span>
      <span
        aria-hidden
        className={`absolute inset-0 flex items-center justify-center rounded-full transition-opacity duration-(--dur-1) ${
          // Unpicked: only a ring around the avatar (which stays as it is); over the avatar itself, a check shows what a click does.
          on ? 'bg-ink text-pane opacity-100' : `border-[1.5px] border-ink-soft text-transparent group-hover/pick:bg-ink/45 group-hover/pick:text-white ${picking.active ? 'opacity-100' : 'opacity-0 group-hover/row:opacity-100'}`
        }`}
      >
        <svg width={size * 0.45} height={size * 0.45} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m3 8.5 3.25 3.25L13 5" />
        </svg>
      </span>
    </button>
  )
}

/** What to do with the picked rows: mark them read or unread (one undo for all), or let go. */
function PickedBar({ picking, postings }: { picking: Picking; postings: PostingRow[] }) {
  const picked = postings.filter((p) => picking.has(p.id))
  // A bundle is many emails behind one row; it's read by opening it.
  const emails = picked.filter((p) => !p.isBundle)
  const mark = (seen: boolean) => {
    const rows = emails.filter((p) => p.seen !== seen)
    if (rows.length) void api.runActions(rows.map((p) => ({ type: 'seen', postingId: p.id, seen })))
    picking.clear()
  }
  const unread = emails.some((p) => !p.seen)
  const read = emails.some((p) => p.seen)
  const button = 'rounded-ui px-2.5 py-1 text-[13px] font-medium hover:bg-pane-sunk disabled:opacity-40 disabled:hover:bg-transparent'
  return (
    <li className="pointer-events-none sticky bottom-3 z-20 flex justify-center px-4 pt-3">
      <div role="toolbar" aria-label="Selected emails" className="rise pointer-events-auto flex items-center gap-1 rounded-ui-lg border border-rule-strong bg-pane py-1 pr-1 pl-3 shadow-[0_12px_32px_-12px_rgba(0,0,0,0.3)]">
        <span className="pr-2 text-[13px] text-ink-soft tabular-nums">{picking.count} selected</span>
        <button type="button" disabled={!unread} onClick={() => mark(true)} className={`${button} text-ink`} title="Mark them read (one undo for all)">
          Mark read
        </button>
        <button type="button" disabled={!read} onClick={() => mark(false)} className={`${button} text-ink-soft`} title="Mark them unread">
          Mark unread
        </button>
        {picking.count < postings.filter((p) => p.id > 0).length && (
          <button type="button" onClick={picking.all} className={`${button} text-ink-soft`} title="Select every email here (⌘A)">
            Select all
          </button>
        )}
        <button type="button" onClick={picking.clear} aria-label="Clear selection" title="Clear selection (Esc)" className="flex size-7 items-center justify-center rounded-ui text-ink-faint hover:bg-pane-sunk hover:text-ink">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
            <path d="m4 4 8 8M12 4l-8 8" />
          </svg>
        </button>
      </div>
    </li>
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

/**
 * The tags a subject carried: what the sender flags as needing you ("Action required") in
 * amber, ahead of everything else on the line; a mailing list's name quietly outlined. Tags
 * that only repeat the sender, or a HEY label, aren't shown.
 */
export function SubjectTags({ subject, sender, labels }: { subject: string; sender: string | null; labels: string[] }) {
  const tags = listTags(subject).tags.filter((t) => !tagMatchesLabel(t, labels))
  const action = tags.filter((t) => tagKind(t, sender) === 'action')
  const lists = tags.filter((t) => tagKind(t, sender) === 'list')
  return (
    <>
      {action.map((tag) => (
        <Tag key={`a:${tag}`} kind="action">
          {tag}
        </Tag>
      ))}
      {lists.map((tag) => (
        <Tag key={`l:${tag}`} kind="list" title="Mailing list">
          {tag}
        </Tag>
      ))}
    </>
  )
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
 * What a Feed email is about, from HEY's opening words (or the AI's line), without the
 * subject or the sender's name repeated at its start.
 */
function feedPreview(p: PostingRow): string | null {
  let text = (p.ai?.summary ?? p.summary ?? '').replace(/\s+/g, ' ').trim()
  for (const lead of [stripSubjectPrefixes(p.subject), senderLabel(p)]) {
    if (lead && text.toLowerCase().startsWith(lead.toLowerCase())) text = text.slice(lead.length).replace(/^[\s:–—-]+/, '')
  }
  return text || null
}

/**
 * How many of the sender's emails a bundle holds, from the cache. Not HEY's bundle subject:
 * that lists the sender's last five subjects, whether or not they're still in the box.
 */
function bundleSize(p: PostingRow) {
  return p.bundleCount ?? 0
}

const monthYear = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' })
const monthOnly = new Intl.DateTimeFormat(undefined, { month: 'long' })
const weekday = new Intl.DateTimeFormat(undefined, { weekday: 'short' })
const clockFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })
const dayMonth = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })
const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()

/** Which day heading a read email falls under: Today, Yesterday, This week, then its month. */
export function dayBucket(iso: string | null, now = new Date()): string {
  if (!iso) return 'Earlier'
  const d = new Date(iso)
  const days = Math.round((midnight(now) - midnight(d)) / 86_400_000)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return 'Earlier this week'
  return d.getFullYear() === now.getFullYear() ? monthOnly.format(d) : monthYear.format(d)
}

/** A row's time under its day heading: the clock today and yesterday, the weekday this week, else the date. */
function rowTime(iso: string | null, seen: boolean) {
  if (!iso) return ''
  if (!seen) return shortDate(iso)
  const d = new Date(iso)
  const days = Math.round((midnight(new Date()) - midnight(d)) / 86_400_000)
  return days <= 1 ? clockFmt.format(d) : days < 7 ? weekday.format(d) : dayMonth.format(d)
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
