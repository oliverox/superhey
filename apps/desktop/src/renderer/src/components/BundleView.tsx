import { useState } from 'react'
import type { PostingRow, ThreadView } from '@shared/api'
import { api, useLive } from '../api'
import { stripSubjectPrefixes } from '../mail/forwarded'
import { useShortcut, withShortcut } from '../shortcuts'
import { Avatar } from './Avatar'
import { MessageCard, Time, useDesignedView } from './Reader'

/**
 * A bundle, read as one digest: the sender once at the top, then their emails on a quiet
 * timeline, newest first. The newest is open; the others are one line each (subject and
 * preview), so together they read as a table of contents. Opening one expands it in
 * place; its content is fetched only then. `;` / `:` expand or collapse them all.
 */
export function BundleView({ bundleId, sender, onOpen }: { bundleId: number; sender: string; onOpen: (p: PostingRow) => void }) {
  const threads = useLive(() => api.bundleThreads(bundleId), [bundleId])
  const list = threads.data ?? []
  const [open, setOpen] = useState<Set<number> | null>(null)
  // Until someone chooses, the newest email is the one open.
  const expanded = open ?? new Set(list.slice(0, 1).map((t) => t.id))
  const toggle = (id: number) => {
    const next = new Set(expanded)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setOpen(next)
  }
  const many = list.length > 1
  useShortcut('expandAll', () => setOpen(new Set(list.map((t) => t.id))), many)
  useShortcut('collapseAll', () => setOpen(new Set()), many)

  const unread = list.filter((t) => !t.seen).length
  const face = list[0]?.avatar

  return (
    <div className="rise">
      <header className="flex items-center gap-4">
        {face && <Avatar avatar={face} size={44} seed={list[0]?.senderEmail ?? sender} />}
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-app text-[26px] leading-tight font-semibold tracking-[-0.02em]">{sender}</h1>
          <p className="mt-0.5 flex items-center gap-1.5 text-[12.5px] text-ink-faint">
            {threads.loading && !threads.data ? (
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
                    <button onClick={() => setOpen(new Set(list.map((t) => t.id)))} title={withShortcut('Expand all', 'expandAll')} className="font-medium text-ink-soft hover:text-ink">
                      Expand all
                    </button>
                    <span aria-hidden>·</span>
                    <button onClick={() => setOpen(new Set())} title={withShortcut('Collapse all', 'collapseAll')} className="font-medium text-ink-soft hover:text-ink">
                      Collapse all
                    </button>
                  </>
                )}
              </>
            )}
          </p>
        </div>
      </header>

      {threads.error && <p className="mt-6 text-danger">Couldn't load this bundle: {threads.error}</p>}

      <ol className="bundle-timeline mt-7">
        {list.map((t, i) => (
          <BundleItem key={t.id} posting={t} index={i} expanded={expanded.has(t.id)} onToggle={() => toggle(t.id)} onOpenThread={() => onOpen(t)} />
        ))}
      </ol>
    </div>
  )
}

function BundleItem({
  posting: p,
  index,
  expanded,
  onToggle,
  onOpenThread,
}: {
  posting: PostingRow
  index: number
  expanded: boolean
  onToggle: () => void
  onOpenThread: () => void
}) {
  const subject = stripSubjectPrefixes(p.subject) || '(no subject)'
  // HEY's summary often opens with the subject again; the preview is what follows it.
  const preview = afterSubject(p.summary, subject)
  return (
    <li className="bundle-item rise relative pb-7 pl-9 last:pb-2" style={{ animationDelay: `${Math.min(index, 8) * 35}ms` }}>
      {/* The node on the timeline: filled while unread. */}
      <span aria-hidden className={`bundle-node absolute top-[7px] left-[3px] size-[11px] rounded-full border-2 ${p.seen ? 'border-rule-strong bg-pane-alt' : 'border-accent bg-accent'}`} />
      <div className="flex items-start gap-3">
        <button onClick={onToggle} aria-expanded={expanded} className="group min-w-0 flex-1 text-left">
          <span className={`block text-[17px] leading-snug font-semibold tracking-[-0.01em] ${expanded ? 'text-ink' : 'text-ink-soft group-hover:text-ink'}`}>{subject}</span>
          {!expanded && preview && <span className="mt-1 line-clamp-2 text-[13px] leading-relaxed text-ink-faint">{preview}</span>}
        </button>
        {p.activeAt && (
          <span className="mt-[3px] shrink-0">
            <Time iso={p.activeAt} />
          </span>
        )}
      </div>
      {expanded && <BundleEmail posting={p} onOpenThread={onOpenThread} />}
    </li>
  )
}

/** One bundled email, read in place: its latest message, full width, fetched on first open. */
function BundleEmail({ posting: p, onOpenThread }: { posting: PostingRow; onOpenThread: () => void }) {
  const thread = useLive<ThreadView | null>(() => (p.topicId == null ? Promise.resolve(null) : api.thread(p.topicId, p.entryCount)), [p.topicId, p.entryCount])
  const html = useLive<Record<number, string>>(
    () => (p.topicId == null || !thread.data ? Promise.resolve({}) : api.threadHtml(p.topicId)),
    [p.topicId, thread.data?.fetchedAt],
  )
  const latest = thread.data?.entries.at(-1)
  const entryHtml = latest ? html.data?.[latest.id] : undefined
  const view = useDesignedView(entryHtml)
  const count = thread.data?.entries.length ?? 0

  return (
    <div className="mt-3">
      <div className="mb-2.5 flex items-center gap-3 text-[12px] text-ink-faint">
        {count > 1 && <span>Latest of {count} messages</span>}
        <span className="ml-auto flex items-center gap-1">
          {view.designed && (
            <button onClick={view.toggle} className="rounded-ui px-1.5 py-0.5 font-medium hover:bg-pane-sunk hover:text-ink">
              {view.showOriginal ? 'Simplified' : 'Original'}
            </button>
          )}
          <button onClick={onOpenThread} className="rounded-ui px-1.5 py-0.5 font-medium hover:bg-pane-sunk hover:text-ink" title="Open as a thread, with replies and actions">
            Open thread →
          </button>
        </span>
      </div>
      {thread.error ? (
        <p className="text-danger">Couldn't load this email: {thread.error}</p>
      ) : !latest ? (
        <div className="space-y-2.5 rounded-ui-lg border border-rule bg-pane px-7 py-6" aria-label="Loading email">
          {[94, 100, 78].map((w, i) => (
            <div key={i} className="pulse h-2.5 rounded bg-pane-sunk" style={{ width: `${w}%`, animationDelay: `${i * 90}ms` }} />
          ))}
        </div>
      ) : (
        <MessageCard entry={latest} index={count - 1} entryHtml={entryHtml} showOriginal={view.showOriginal} />
      )}
    </div>
  )
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
