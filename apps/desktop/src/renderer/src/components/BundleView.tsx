import { useEffect, useRef, useState } from 'react'
import { markSeenOnOpen } from '../prefs'
import type { PostingRow, ThreadView } from '@shared/api'
import { api, useLive } from '../api'
import { stripSubjectPrefixes } from '../mail/forwarded'
import { useShortcut, withShortcut } from '../shortcuts'
import { ActionBar } from './ActionBar'
import { Avatar } from './Avatar'
import { Conversation, OutgoingReplies, SummaryStrip, Time, ThreadTopic } from './Reader'
import { ReplyArea } from './ReplyArea'

/**
 * A bundle, read as one digest: the sender once at the top, then their emails on a quiet
 * timeline, newest first. The newest is open; the others are one line each (subject and
 * preview), so together they read as a table of contents. Opening one expands it in
 * place, drawn as the thread view draws it, with its actions and replies; its content is
 * fetched only then. `;` / `:` expand or collapse them all. The thread keys (e, r, ⇧R…)
 * act on the email in focus: the one last opened, or clicked.
 */
export function BundleView({ bundleId, sender, onLeaveBox }: { bundleId: number; sender: string; onLeaveBox: () => void }) {
  const members = useLive(() => api.bundleThreads(bundleId), [bundleId])
  // Actions change the cached rows; re-read those (not HEY's bundle) so seen, labels and
  // moves show at once. An email moved or trashed out of the box leaves the digest.
  const ids = (members.data ?? []).map((t) => t.id)
  const key = ids.join()
  const box = members.data?.[0]?.boxId
  const rows = useLive(
    async () => ({ key, rows: await Promise.all(ids.map((id) => api.posting(id))) }),
    [key],
    (e) => e.type === 'change' && e.change.kind === 'postings',
  )
  // Rows read for an earlier member list don't count (they'd look like an emptied bundle).
  const fresh = rows.data?.key === key ? rows.data.rows : null
  const list = (fresh ?? members.data ?? []).filter((t): t is PostingRow => !!t && t.boxId === box)

  const [open, setOpen] = useState<Set<number> | null>(null)
  const [focused, setFocused] = useState<number | null>(null)
  // Until someone chooses, the newest email is the one open (and in focus).
  const expanded = open ?? new Set(list.slice(0, 1).map((t) => t.id))
  const inFocus = list.some((t) => t.id === focused && expanded.has(t.id)) ? focused : (list.find((t) => expanded.has(t.id))?.id ?? null)
  const toggle = (id: number) => {
    const next = new Set(expanded)
    if (next.has(id)) next.delete(id)
    else {
      next.add(id)
      setFocused(id)
    }
    setOpen(next)
  }
  const many = list.length > 1
  useShortcut('toggleAll', () => setOpen(list.every((t) => expanded.has(t.id)) ? new Set() : new Set(list.map((t) => t.id))), many)

  // Everything filed away: the bundle is done, so the list moves on.
  const emptied = ids.length > 0 && fresh != null && list.length === 0
  useEffect(() => {
    if (emptied) onLeaveBox()
  }, [emptied, onLeaveBox])

  const unread = list.filter((t) => !t.seen).length
  const face = list[0]?.avatar

  return (
    <div className="rise">
      <header className="flex items-center gap-4">
        {face && <Avatar avatar={face} size={44} seed={list[0]?.senderEmail ?? sender} />}
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-app text-[26px] leading-tight font-semibold tracking-[-0.02em]">{sender}</h1>
          <p className="mt-0.5 flex items-center gap-1.5 text-[13px] text-ink-faint">
            {members.loading && !members.data ? (
              'Loading…'
            ) : (
              <>
                <span>
                  {list.length} {list.length === 1 ? 'email' : 'emails'}
                  {unread > 0 && unread !== list.length ? `, ${unread} new` : list.length && unread === list.length ? ', all new' : ''}
                </span>
                {many && (
                  <>
                    <span aria-hidden>·</span>
                    <button onClick={() => setOpen(new Set(list.map((t) => t.id)))} title={withShortcut('Expand all', 'toggleAll')} className="font-medium text-ink-soft hover:text-ink">
                      Expand all
                    </button>
                    <span aria-hidden>·</span>
                    <button onClick={() => setOpen(new Set())} title={withShortcut('Collapse all', 'toggleAll')} className="font-medium text-ink-soft hover:text-ink">
                      Collapse all
                    </button>
                  </>
                )}
              </>
            )}
          </p>
        </div>
      </header>

      {members.error && <p className="mt-6 text-danger">Couldn't load this bundle: {members.error}</p>}

      {/* The timeline hangs in the column's margin, so each email gets the thread view's full width. */}
      <ol className="bundle-timeline mt-7 -ml-9">
        {list.map((t, i) => (
          <BundleItem
            key={t.id}
            posting={t}
            index={i}
            expanded={expanded.has(t.id)}
            focused={t.id === inFocus}
            onToggle={() => toggle(t.id)}
            onFocus={() => setFocused(t.id)}
          />
        ))}
      </ol>
    </div>
  )
}

function BundleItem({
  posting: p,
  index,
  expanded,
  focused,
  onToggle,
  onFocus,
}: {
  posting: PostingRow
  index: number
  expanded: boolean
  /** The keyboard acts on this email. */
  focused: boolean
  onToggle: () => void
  onFocus: () => void
}) {
  const subject = stripSubjectPrefixes(p.subject) || '(no subject)'
  // HEY's summary often opens with the subject again; the preview is what follows it.
  const preview = p.ai?.summary ?? afterSubject(p.summary, subject)
  return (
    <li
      className="bundle-item rise relative pb-7 pl-9 last:pb-2"
      data-focused={expanded && focused}
      style={{ animationDelay: `${Math.min(index, 8) * 35}ms` }}
      // Clicking into an open email (to read, select or act) gives it the keys.
      onMouseDownCapture={expanded ? onFocus : undefined}
    >
      {/* The node on the timeline: filled while unread. */}
      <span aria-hidden className={`bundle-node absolute top-[7px] left-[3px] size-[11px] rounded-full border-2 ${p.seen ? 'border-rule-strong bg-pane-alt' : 'border-accent bg-accent'}`} />
      <div className="flex items-start gap-3">
        <button onClick={onToggle} aria-expanded={expanded} className="group min-w-0 flex-1 text-left">
          <span className={`block text-[17px] leading-snug font-semibold tracking-[-0.01em] ${expanded ? 'text-ink' : 'text-ink-soft group-hover:text-ink'}`}>{subject}</span>
          {!expanded && preview && <span className="mt-1 line-clamp-2 text-[13px] leading-relaxed text-ink-faint">{preview}</span>}
        </button>
        {/* Open, the email's actions take the time's place (the message header carries it). */}
        {expanded ? (
          <span className="bundle-actions -mt-0.5 shrink-0">
            <ActionBar postingId={p.id} onLeaveBox={() => {}} keys={focused} />
          </span>
        ) : (
          p.activeAt && (
            <span className="mt-[3px] shrink-0">
              <Time iso={p.activeAt} />
            </span>
          )
        )}
      </div>
      {expanded && <BundleEmail posting={p} focused={focused} />}
    </li>
  )
}

/** One bundled email, read in place exactly as the thread view draws it; fetched on first open. */
function BundleEmail({ posting: p, focused }: { posting: PostingRow; focused: boolean }) {
  const thread = useLive<ThreadView | null>(
    () => (p.topicId == null ? Promise.resolve(null) : api.thread(p.topicId, p.entryCount, { analyze: false })),
    [p.topicId, p.entryCount],
    (e) => e.type === 'change' && e.change.kind === 'thread' && e.change.topicId === p.topicId,
  )
  const html = useLive<Record<number, string>>(
    () => (p.topicId == null || !thread.data ? Promise.resolve({}) : api.threadHtml(p.topicId)),
    [p.topicId, thread.data?.fetchedAt],
  )

  useSeenWhenShown(p, !!thread.data)

  if (thread.error) return <p className="mt-3 text-danger">Couldn't load this email: {thread.error}</p>
  if (!thread.data)
    return (
      <div className="mt-4 space-y-2.5 rounded-ui-lg border border-rule bg-pane px-7 py-6" aria-label="Loading email">
        {[94, 100, 78].map((w, i) => (
          <div key={i} className="pulse h-2.5 rounded bg-pane-sunk" style={{ width: `${w}%`, animationDelay: `${i * 90}ms` }} />
        ))}
      </div>
    )
  return (
    <>
      {/* What the AI made of it, as under a thread's title (a bundle has no details panel). */}
      <div className="mt-3">
        <SummaryStrip topicId={thread.data.topicId} />
      </div>
      <ThreadTopic.Provider value={thread.data.topicId}>
        <Conversation entries={thread.data.entries} subject={thread.data.subject ?? p.subject ?? ''} htmlByEntry={html.data ?? {}} keys={false} canReply />
        <OutgoingReplies topicId={thread.data.topicId} entries={thread.data.entries} />
      </ThreadTopic.Provider>
      <ReplyArea thread={thread.data} keys={focused} />
    </>
  )
}

/**
 * A bundled email counts as opened once it's expanded and showing: marked seen then, as a
 * single email is when opened (unless Settings leaves seen to you). Once per email shown, so
 * marking it unseen again (U) sticks while it stays open.
 */
export function useSeenWhenShown(p: PostingRow, shown: boolean) {
  const done = useRef<number | null>(null)
  useEffect(() => {
    if (!shown || done.current === p.id) return
    done.current = p.id
    if (!p.seen && markSeenOnOpen()) api.runAction({ type: 'seen', postingId: p.id, seen: true }, 'auto').catch(() => {})
  }, [shown, p.id, p.seen])
}

/** The summary without a leading copy of the subject (compared ignoring spacing, which HEY varies). */
function afterSubject(summary: string | null, subject: string): string | null {
  if (!summary) return null
  const squash = (s: string) => s.replace(/\s+/gu, '')
  const target = squash(subject)
  let seen = ''
  for (let i = 0; i < summary.length && seen.length < target.length; i++) {
    seen += squash(summary[i]!)
    if (seen === target) return summary.slice(i + 1).trim() || null
  }
  return summary
}
