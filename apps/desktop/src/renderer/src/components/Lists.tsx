import { Fragment, useEffect, useRef } from 'react'
import type { PostingRow, SearchHit } from '@shared/api'
import { api, useLive } from '../api'
import { shortDate } from '../format'
import { stripSubjectPrefixes } from '../mail/forwarded'
import { Avatar } from './Avatar'

interface ListProps {
  postings: PostingRow[]
  loading: boolean
  selectedId: number | null
  onOpen: (p: PostingRow) => void
}

/** Groups rows the way HEY does: Bubbled up, New for you, Previously seen. */
function groupOf(p: PostingRow) {
  if (p.bubbledUp) return 'Bubbled up'
  return p.seen ? 'Previously seen' : 'New for you'
}

export function PostingList({ postings, loading, selectedId, onOpen }: ListProps) {
  const listRef = useRef<HTMLUListElement>(null)

  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [selectedId])

  if (loading) return <Empty>Loading…</Empty>
  if (!postings.length) return <Empty>Nothing here.</Empty>

  return (
    <ul ref={listRef} role="listbox" aria-label="Threads" className="scroll min-h-0 flex-1">
      {postings.map((p, i) => {
        const group = groupOf(p)
        const showHeader = i === 0 || groupOf(postings[i - 1]!) !== group
        const selected = p.id === selectedId
        return (
          <Fragment key={p.id}>
            {showHeader && <li className="eyebrow sticky top-0 z-10 bg-pane/95 px-5 pt-4 pb-1.5 backdrop-blur">{group}</li>}
            <li
              role="option"
              aria-selected={selected}
              onClick={() => onOpen(p)}
              className={`rise relative mx-2 flex cursor-default items-center gap-3 rounded-ui py-2.5 pr-3 pl-4 ${
                selected ? 'bg-selection' : 'hover:bg-pane-sunk'
              }`}
              style={{ animationDelay: `${Math.min(i, 12) * 18}ms` }}
            >
              {!p.seen && <span className="absolute top-1/2 left-[5px] size-1.5 -translate-y-1/2 rounded-full bg-new" aria-label="Unseen" />}
              <Avatar avatar={p.avatar} stacked={p.isBundle} blockedTrackers={p.blockedTrackers} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className={`min-w-0 truncate ${p.seen ? 'text-ink-soft' : 'font-semibold text-ink'}`}>
                    {p.subject ? stripSubjectPrefixes(p.isBundle ? p.subject.split(' • ')[0]! : p.subject) : '(no subject)'}
                  </span>
                  {p.hasAttachments && <Paperclip />}
                  {(p.entryCount ?? 0) > 1 && <span className="shrink-0 text-[11px] text-ink-faint">{p.entryCount}</span>}
                  <span className="ml-auto shrink-0 pl-1 text-[11.5px] text-ink-faint">{shortDate(p.activeAt)}</span>
                </div>
                <div className="mt-0.5 flex min-w-0 items-baseline gap-1.5 text-[12.5px] text-ink-faint">
                  {p.labels.map((label) => (
                    <span key={label} className="shrink-0 rounded-[4px] border border-rule-strong px-1 text-[10.5px] leading-[15px] font-medium text-ink-soft">
                      {label}
                    </span>
                  ))}
                  <span className="min-w-0 truncate">
                    <span className="font-medium text-ink-soft">{senderLabel(p)}</span>
                    {p.isBundle ? <> · {bundleNote(p)}</> : p.summary && <> – {p.summary}</>}
                  </span>
                </div>
              </div>
            </li>
          </Fragment>
        )
      })}
    </ul>
  )
}

export function SearchResults({
  query,
  onOpen,
  activeTopicId,
}: {
  query: string
  onOpen: (hit: SearchHit) => void
  activeTopicId: number | null
}) {
  const hits = useLive(() => api.search(query), [query])
  const results = hits.data ?? []

  return (
    <div className="scroll min-h-0 flex-1">
      <p className="px-5 pt-3 pb-2 text-[12px] text-ink-faint">
        Searching threads you've opened. Full-mailbox search arrives with background caching.
      </p>
      {results.length === 0 && !hits.loading && <Empty>No matches.</Empty>}
      <ul>
        {results.map((h) => (
          <li
            key={h.entryId}
            onClick={() => onOpen(h)}
            className={`mx-2 rounded-ui px-3 py-2.5 ${h.topicId === activeTopicId ? 'bg-selection' : 'hover:bg-pane-sunk'}`}
          >
            <div className="flex items-baseline gap-2">
              <span className="truncate font-medium">{h.senderName ?? 'Unknown'}</span>
              <span className="ml-auto shrink-0 text-[11.5px] text-ink-faint">{shortDate(h.createdAt)}</span>
            </div>
            <div className="truncate">{h.subject}</div>
            <div className="mt-0.5 line-clamp-2 text-[12.5px] text-ink-faint">
              <Snippet text={h.snippet} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Renders FTS snippet markers [like this] as highlights, without any HTML injection. */
function Snippet({ text }: { text: string }) {
  const parts = text.split(/(\[[^\]]*\])/g)
  return (
    <>
      {parts.map((part, i) =>
        part.startsWith('[') && part.endsWith(']') ? <mark key={i}>{part.slice(1, -1)}</mark> : <Fragment key={i}>{part}</Fragment>,
      )}
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
