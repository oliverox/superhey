import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import Markdown, { type Components } from 'react-markdown'
import type { EntryRow, OutgoingMessage, PostingRow, ThreadView } from '@shared/api'
import { api, useLive } from '../api'
import { dayAndTime, longDate } from '../format'
import { listTags, parseForwardedDate, sameSubject, splitForwarded, stripSubjectPrefixes, tagKind, type ForwardedHeader, unwrapHardBreaks } from '../mail/forwarded'
import { displayName, replyRecipients } from '../mail/people'
import { isDesigned } from '../mail/html'
import { splitQuoted, type QuotedSplit } from '../mail/quoted'
import { repeatedSignatures } from '../mail/signature'
import { AttachmentStrip, stripAttachmentLines, visibleAttachments } from './Attachments'
import { ActionBar } from './ActionBar'
import { BundleView } from './BundleView'
import { ContextPanel } from './ContextPanel'
import { usePresence } from '../motion'
import { useShortcut, withShortcut } from '../shortcuts'
import { HtmlBody } from './HtmlBody'
import { Composer, type ComposeRequest } from './Composer'
import { PersonChip, RecipientsButton } from './People'
import { ReplyArea } from './ReplyArea'

export interface ReaderTarget {
  postingId: number | null
  topicId: number | null
  entryCount: number | null
  subject: string
  appUrl: string | null
  isBundle: boolean
  /** Who a bundle is from, for its heading. */
  sender?: string | null
  /** Set while reading a first-time sender's email in The Screener (clearance ID). */
  screeningId?: number | null
}

// Email is untrusted: react-markdown drops raw HTML, and remote images are not loaded
// (they can be trackers). Links open in the system browser via the main process.
const mdComponents: Components = {
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer noopener">
      {children}
    </a>
  ),
  img: ({ alt }) => <span className="text-[13px] text-ink-faint">[image{alt ? `: ${alt}` : ''}]</span>,
  table: ({ children }) => (
    <div className="table-scroll">
      <table>{children}</table>
    </div>
  ),
}

/** Collapsed messages beyond this many fold into a "N earlier messages" row. */
const MAX_VISIBLE_COLLAPSED = 3

interface ReaderProps {
  target: ReaderTarget | null
  active: boolean
  onOpenThread: (p: PostingRow) => void
  /** Called when an action takes the open thread out of the box being viewed. */
  onLeaveBox: () => void
}

export function Reader({ target, active, onOpenThread, onLeaveBox }: ReaderProps) {
  if (!target) {
    return (
      <main className="pane flex flex-col bg-pane-alt" data-active={active}>
        <div className="drag h-[52px] shrink-0" />
        <div className="flex flex-1 flex-col items-center justify-center text-ink-faint">
          <p className="font-app text-[17px] font-medium text-ink-soft">Pick a thread to read.</p>
          <p className="mt-2 text-[13px]">
            <kbd>j</kbd> / <kbd>k</kbd> to move · <kbd>/</kbd> to search · <kbd>1</kbd>–<kbd>6</kbd> to switch boxes
          </p>
        </div>
      </main>
    )
  }
  return <ThreadReader key={`${target.postingId}-${target.topicId}`} target={target} active={active} onOpenThread={onOpenThread} onLeaveBox={onLeaveBox} />
}

function ThreadReader({ target, active, onOpenThread, onLeaveBox }: ReaderProps & { target: ReaderTarget }) {
  const { topicId } = target
  const thread = useLive<ThreadView | null>(
    () => (topicId == null ? Promise.resolve(null) : api.thread(topicId, target.entryCount)),
    [topicId, target.entryCount],
    (e) => e.type === 'change' && e.change.kind === 'thread' && e.change.topicId === topicId,
  )
  const subject = thread.data?.subject ?? target.subject
  // Original HTML for designed emails: one CLI call once the thread is cached, then kept.
  const html = useLive<Record<number, string>>(
    () => (topicId == null || !thread.data ? Promise.resolve({}) : api.threadHtml(topicId)),
    [topicId, thread.data?.fetchedAt],
  )
  const title = stripSubjectPrefixes(target.isBundle ? (target.sender ?? subject) : subject)
  const mainRef = useRef<HTMLElement>(null)
  const panel = useContextPanel(mainRef)
  const showPanel = panel.open && !!thread.data && !target.isBundle

  return (
    <main ref={mainRef} className="pane flex min-h-0 flex-col bg-pane-alt" data-active={active}>
      <header className="drag flex h-[52px] shrink-0 items-center justify-end gap-1 border-b border-rule bg-pane px-4">
        <div className="mr-auto">{target.postingId != null && <ActionBar postingId={target.postingId} onLeaveBox={onLeaveBox} />}</div>
        {target.appUrl && (
          <a
            href={target.appUrl}
            target="_blank"
            rel="noreferrer"
            className="no-drag rounded-ui px-2 py-1 text-[12px] text-ink-soft hover:bg-pane-sunk hover:text-ink"
          >
            Open in HEY ↗
          </a>
        )}
        <button
          onClick={panel.toggle}
          aria-pressed={panel.open}
          title={withShortcut(panel.open ? 'Hide details' : 'Show details', 'details')}
          className={`no-drag flex size-7 items-center justify-center rounded-ui ${
            panel.open ? 'bg-pane-sunk text-ink' : 'text-ink-faint hover:bg-pane-sunk hover:text-ink'
          }`}
        >
          <PanelIcon />
        </button>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="scroll min-h-0 min-w-0 flex-1 [container-type:inline-size]">
          <article className="reading-column mx-auto px-10 pt-9 pb-24">
            {/* A bundle draws its own heading (the sender, with their avatar). */}
          {!target.isBundle && listTags(subject).tags.some((t) => tagKind(t, target.sender ?? null) !== 'sender') && (
            <div className="rise mb-2 flex flex-wrap gap-1.5" aria-label="Subject tags">
              {listTags(subject)
                .tags.filter((t) => tagKind(t, target.sender ?? null) !== 'sender')
                .map((tag) =>
                  tagKind(tag, target.sender ?? null) === 'action' ? (
                    <span key={tag} className="rounded-[4px] bg-attn-wash px-1.5 text-[12px] leading-[20px] font-semibold text-attn">
                      {tag}
                    </span>
                  ) : (
                    <span key={tag} title="Mailing list" className="rounded-[4px] border border-dashed border-rule-strong px-1.5 text-[12px] leading-[18px] font-medium text-ink-faint">
                      {tag}
                    </span>
                  ),
                )}
            </div>
          )}
          {!target.isBundle && <h1 className="rise font-app text-[26px] leading-[1.2] font-semibold tracking-[-0.02em] text-balance">{title}</h1>}

            {target.isBundle ? (
              target.postingId != null && <BundleView bundleId={target.postingId} sender={target.sender ?? 'this sender'} onLeaveBox={onLeaveBox} />
            ) : topicId == null ? (
              // Not a thread (a HEY World post, say): nothing the CLI can read.
              <p className="mt-6 text-ink-soft">
                This isn't an email thread, so SuperHey can't show it.{' '}
                {target.appUrl && (
                  <a href={target.appUrl} target="_blank" rel="noreferrer" className="font-medium text-accent hover:underline">
                    Open it in HEY ↗
                  </a>
                )}
              </p>
            ) : thread.error ? (
              <p className="mt-6 text-danger">Couldn't load this thread: {thread.error}</p>
            ) : !thread.data ? (
              <ReaderSkeleton />
            ) : (
              <>
                <ThreadTopic.Provider value={thread.data.topicId}>
                  <Conversation entries={thread.data.entries} subject={subject} htmlByEntry={html.data ?? {}} canReply={target.screeningId == null} />
                </ThreadTopic.Provider>
                {/* No replying to someone who hasn't been let in yet. */}
                {target.screeningId == null && <ReplyArea key={thread.data.topicId} thread={thread.data} />}
              </>
            )}
          </article>
        </div>
        <PanelSlot show={showPanel}>{thread.data && <ContextPanel thread={thread.data} onOpenThread={onOpenThread} />}</PanelSlot>
      </div>
    </main>
  )
}

/** The details panel's place: it opens to the panel's width and closes to nothing. */
function PanelSlot({ show, children }: { show: boolean; children: React.ReactNode }) {
  const { mounted, shown } = usePresence(show)
  if (!mounted) return null
  return (
    <div className="panel-slot flex shrink-0 justify-end" style={{ width: shown ? 296 : 0 }}>
      {children}
    </div>
  )
}

/** The newest message is open; earlier ones are one line each until clicked. */
export function Conversation({
  entries,
  subject,
  htmlByEntry,
  keys = true,
  canReply = false,
}: {
  entries: EntryRow[]
  subject: string
  /** Original HTML by entry ID; arrives shortly after the thread, then cached. */
  htmlByEntry: Record<number, string>
  /** Whether `;` / `:` act on this conversation (off inside a bundle, where they act on the bundle). */
  keys?: boolean
  /** Whether earlier messages offer their own Reply (the latest has the buttons under the thread). */
  canReply?: boolean
}) {
  const [open, setOpen] = useState<Set<number>>(() => new Set(entries.length ? [entries.at(-1)!.id] : []))
  const [showAll, setShowAll] = useState(false)
  const expand = (id: number) => setOpen((s) => new Set(s).add(id))
  const collapse = (id: number) =>
    setOpen((s) => {
      const next = new Set(s)
      next.delete(id)
      return next
    })
  const multiple = entries.length > 1
  const expandAll = () => {
    setOpen(new Set(entries.map((e) => e.id)))
    setShowAll(true)
  }
  useShortcut('expandAll', expandAll, keys && multiple)
  useShortcut('collapseAll', () => setOpen(new Set()), keys && multiple)
  const allOpen = multiple && entries.every((e) => open.has(e.id))
  // Signatures the same person repeats under their messages fold away (forwards keep theirs).
  const signatures = useMemo(
    () =>
      repeatedSignatures(
        entries.flatMap((e, i) => {
          const { body, forwarded } = messageParts(e, i)
          return forwarded ? [] : [{ id: e.id, sender: e.from?.email ?? null, text: body }]
        }),
      ),
    [entries],
  )
  const openCount = entries.filter((e) => open.has(e.id)).length

  const earlier = entries.slice(0, -1)
  const hidden = !showAll && earlier.length > MAX_VISIBLE_COLLAPSED ? earlier.slice(1, -(MAX_VISIBLE_COLLAPSED - 1)) : []
  const hiddenIds = new Set(hidden.map((e) => e.id))

  return (
    <>
      {multiple && (
        <div className="mt-1.5 flex items-center gap-1.5 text-[12px] text-ink-faint">
          <span>{entries.length} messages</span>
          {!allOpen && (
            <>
              <span aria-hidden>·</span>
              <button
                onClick={expandAll}
                title={withShortcut('Expand all', 'expandAll')}
                className="rounded-[3px] font-medium text-ink-soft hover:text-ink"
              >
                Expand all
              </button>
            </>
          )}
          {openCount >= 2 && (
            <>
              <span aria-hidden>·</span>
              <button
                onClick={() => setOpen(new Set())}
                title={withShortcut('Collapse all', 'collapseAll')}
                className="rounded-[3px] font-medium text-ink-soft hover:text-ink"
              >
                Collapse all
              </button>
            </>
          )}
        </div>
      )}
      <ol className="mt-4 space-y-2.5">
        {entries.map((entry, i) => {
          if (hiddenIds.has(entry.id) && !open.has(entry.id)) {
            return entry.id === hidden[0]!.id ? (
              <li key="more">
                <button
                  onClick={() => setShowAll(true)}
                  className="flex w-full items-center gap-3 py-1 text-[12px] font-medium text-ink-faint hover:text-ink-soft"
                >
                  <span className="h-px flex-1 bg-rule" />
                  {hidden.length} earlier messages
                  <span className="h-px flex-1 bg-rule" />
                </button>
              </li>
            ) : null
          }
          return (
            <Message
              key={entry.id}
              entry={entry}
              subject={subject}
              expanded={open.has(entry.id)}
              onExpand={() => expand(entry.id)}
              onCollapse={multiple ? () => collapse(entry.id) : undefined}
              signatureAt={signatures.get(entry.id)}
            entryHtml={htmlByEntry[entry.id]}
              index={i}
              canReply={canReply && i < entries.length - 1}
            />
          )
        })}
      </ol>
    </>
  )
}

function Message({
  entry,
  subject,
  expanded,
  onExpand,
  onCollapse,
  entryHtml,
  index,
  signatureAt,
  canReply = false,
}: {
  entry: EntryRow
  subject: string
  expanded: boolean
  onExpand: () => void
  /** Absent when the message is the thread's only one. */
  onCollapse?: () => void
  entryHtml?: string
  index: number
  /** Where a signature repeated across the thread starts in the body (folded). */
  signatureAt?: number
  /** Offers Reply / Reply all to this message itself, not the thread's latest. */
  canReply?: boolean
}) {
  const { designed, showOriginal, toggle } = useDesignedView(entryHtml)
  const topicId = useContext(ThreadTopic)
  const [reply, setReply] = useState<ComposeRequest | null>(null)
  const replyable = canReply && topicId != null && topicId > 0
  const others = [entry.from, ...entry.to, ...entry.cc].filter((p) => p && !p.isMe).length
  const replyTo = (kind: 'reply' | 'reply-all') => {
    const whose = entry.from ? (entry.from.isMe ? 'your' : `${displayName(entry.from)}’s`) : 'the'
    const { to, cc } = replyRecipients(entry, kind)
    const context = `to ${whose} message of ${dayAndTime(entry.createdAt).day}`
    setReply({ kind, message: { to, cc, body: '', threadId: topicId as OutgoingMessage['threadId'] & number }, replyTo: entry.id, context })
  }
  // Everyone's messages sit on the same paper; the header says who wrote it.
  const surface = 'bg-pane'
  const time = <Time iso={entry.createdAt} />

  if (!expanded) {
    // Two lines: who and when, then what they wrote (without the history they quoted).
    const preview = snippet(splitQuoted(entry.bodyMd, index > 0)?.fresh ?? entry.bodyMd)
    return (
      <li className={`rise overflow-hidden rounded-ui-lg border border-rule ${surface}`} style={{ animationDelay: `${Math.min(index, 6) * 30}ms` }}>
        <button onClick={onExpand} className="block w-full px-6 py-3 text-left hover:bg-pane-sunk/50">
          <span className="flex items-center gap-3">
            <span className="min-w-0 flex-1 truncate font-semibold">
              {entry.from?.isMe ? 'You' : entry.from ? displayName(entry.from) : 'Unknown'}
            </span>
            {entry.attachments.length > 0 && <span className="shrink-0 text-[12px] text-ink-faint">📎 {entry.attachments.length}</span>}
            {time}
          </span>
          {preview && <span className="mt-0.5 block truncate text-[13px] text-ink-faint">{preview}</span>}
        </button>
      </li>
    )
  }

  const { forwarded } = messageParts(entry, index)

  return (
    // The header sits outside the card, under the subject (or the message before); the card
    // holds only what was written.
    <li className={`rise ${index > 0 ? 'pt-4' : ''}`} style={{ animationDelay: `${Math.min(index, 6) * 30}ms` }}>
      <header
        className={`group/header mb-3 ${onCollapse ? 'cursor-pointer' : ''}`}
        // Clicking the header's empty space folds the message; names and buttons keep their own clicks.
        onClick={(e) => {
          if (onCollapse && !(e.target as HTMLElement).closest('button, a, [role=dialog]')) onCollapse()
        }}
      >
        <div className="flex items-baseline gap-2">
          <div className="flex min-w-0 flex-1 items-baseline gap-2">
            {entry.from ? <PersonChip person={entry.from} className="font-semibold" /> : <span className="font-semibold">Unknown</span>}
            <RecipientsButton to={entry.to} cc={entry.cc} className="text-[13px]" />
          </div>
          {designed && (
            <button
              onClick={toggle}
              title={showOriginal ? 'Show as plain text in the app’s style' : 'Show as the sender designed it'}
              className="shrink-0 self-center rounded-ui px-1.5 py-0.5 text-[12px] font-medium text-ink-faint hover:bg-pane-sunk hover:text-ink"
            >
              {showOriginal ? 'Simplified' : 'Original'}
            </button>
          )}
          {time}
          {onCollapse && (
            <button
              onClick={onCollapse}
              aria-label="Collapse message"
              title="Collapse message"
              className="flex size-5 shrink-0 items-center justify-center self-center rounded-ui text-ink-faint opacity-0 group-hover/header:opacity-100 hover:bg-pane-sunk hover:text-ink focus-visible:opacity-100"
            >
              <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden>
                <path d="m4 10 4-4 4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )}
        </div>
        {forwarded && <ForwardedLine header={forwarded.header} threadSubject={subject} />}
      </header>

      <MessageCard
        entry={entry}
        index={index}
        entryHtml={entryHtml}
        showOriginal={showOriginal}
        surface={surface}
        signatureAt={signatureAt}
        corner={
          replyable &&
          !reply && (
            <>
              <CornerButton onClick={() => replyTo('reply')} label="Reply to this message only">
                <path d="M6.5 4 2.5 8l4 4M3 8h6.5a4 4 0 0 1 4 4v.5" />
              </CornerButton>
              {others > 1 && (
                <CornerButton onClick={() => replyTo('reply-all')} label="Reply all to this message">
                  <path d="M8.5 4 4.5 8l4 4M5 8h4.5a4 4 0 0 1 4 4v.5M5 4 1 8l4 4" />
                </CornerButton>
              )}
            </>
          )
        }
      />
      {reply && (
        <div className="mt-3">
          <Composer request={reply} variant="inline" onClose={() => setReply(null)} />
        </div>
      )}
    </li>
  )
}

function CornerButton({ children, onClick, label }: { children: React.ReactNode; onClick: () => void; label: string }) {
  return (
    <button onClick={onClick} aria-label={label} title={label} className="flex size-7 items-center justify-center rounded-ui text-ink-soft hover:bg-pane-sunk hover:text-ink">
      <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {children}
      </svg>
    </button>
  )
}

/** A message's body split for display: what it adds, the history it quotes, any forward. */
function messageParts(entry: EntryRow, index: number) {
  // Mail written at a fixed width reads as prose again (its hard breaks mid-sentence go).
  const full = unwrapHardBreaks(stripAttachmentLines(entry.bodyMd, entry.attachments))
  // Replies carry the conversation below them; show only what this message adds.
  const quote = splitQuoted(full, index > 0)
  const body = quote ? quote.fresh : full
  return { quote, body, forwarded: splitForwarded(body) }
}

/**
 * The body of one message: the sender's design (for designed mail, when `showOriginal`) or
 * the clean view with quote folding and forwards tidied; attachments underneath. Used by
 * threads and bundles alike.
 */
export function MessageCard({
  entry,
  index,
  entryHtml,
  showOriginal,
  surface = 'bg-pane',
  signatureAt,
  corner,
}: {
  entry: EntryRow
  /** Position in its thread; a reply's quoted history is only folded after the first. */
  index: number
  entryHtml?: string
  showOriginal: boolean
  surface?: string
  signatureAt?: number
  /** Actions shown in the card's bottom-right corner while the message is hovered. */
  corner?: React.ReactNode
}) {
  const { quote, body, forwarded } = messageParts(entry, index)
  const actions = corner ? (
    <div className="absolute right-3 bottom-3 flex gap-0.5 rounded-ui-lg border border-rule bg-pane p-0.5 opacity-0 shadow-[0_4px_12px_-6px_rgba(0,0,0,0.2)] transition-opacity duration-[var(--dur-1)] group-hover/card:opacity-100 focus-within:opacity-100">
      {corner}
    </div>
  ) : null
  return showOriginal ? (
      // Designed mail assumes a white page, so it gets one in every theme. It's built for
      // ~600–700px, so its card may grow past the text measure (centred, within the pane).
      <div className={`group/card email-wide relative overflow-hidden rounded-ui-lg border border-rule ${surface}`}>
        <div className="bg-white p-3">
          <HtmlBody entryHtml={entryHtml!} />
        </div>
        {visibleAttachments(entry.attachments).length > 0 && (
          <div className="px-6 pb-4">
            <AttachmentStrip attachments={visibleAttachments(entry.attachments)} />
          </div>
        )}
        {actions}
      </div>
    ) : (
      <div className={`group/card relative rounded-ui-lg border border-rule px-7 pt-6 pb-4 ${surface}`}>
        <div className="prose-mail">
          {forwarded ? (
            <>
              {forwarded.before && <Markdown components={mdComponents}>{forwarded.before}</Markdown>}
              <Markdown components={mdComponents}>{forwarded.after}</Markdown>
            </>
          ) : signatureAt != null ? (
            <>
              <Markdown components={mdComponents}>{body.slice(0, signatureAt)}</Markdown>
              <SignatureFold text={body.slice(signatureAt)} />
            </>
          ) : (
            <Markdown components={mdComponents}>{body}</Markdown>
          )}
          {quote && <QuotedHistory quote={quote} />}
        </div>
        <AttachmentStrip attachments={visibleAttachments(entry.attachments)} />
        {actions}
      </div>
    )
}

/** Whether a message is designed, and which view to show (Original / Simplified). */
export function useDesignedView(entryHtml: string | undefined) {
  const [view, setView] = useState<'original' | 'simplified'>('original')
  const designed = useMemo(() => entryHtml != null && isDesigned(entryHtml), [entryHtml])
  const showOriginal = designed && view === 'original'
  return { designed, showOriginal, toggle: () => setView(showOriginal ? 'simplified' : 'original') }
}

/**
 * The forward's origin, as a quiet second line of the header. The original "to" is
 * dropped: it names the forwarder, who is already the sender above.
 */
/** The thread being read, for what inside it needs to know (a forward's original isn't it). */
export const ThreadTopic = createContext<number | null>(null)

function ForwardedLine({ header, threadSubject }: { header: ForwardedHeader; threadSubject: string }) {
  const topicId = useContext(ThreadTopic)
  const date = parseForwardedDate(header.date)
  // The email you forwarded is its own thread in HEY; find it, to open it from here.
  const fromEmail = header.from?.email ?? null
  const original = useLive(
    () => (fromEmail ? api.forwardedOriginal(fromEmail, header.subject ?? threadSubject, date?.toISOString() ?? null, topicId ?? null) : Promise.resolve(null)),
    [fromEmail, header.subject, threadSubject, date?.getTime(), topicId],
  ).data
  const subject = header.subject && !sameSubject(header.subject, threadSubject) ? stripSubjectPrefixes(header.subject) : null
  return (
    <div className="mt-1 flex min-w-0 items-baseline gap-1.5 text-[13px] text-ink-faint">
      <span className="shrink-0">Forwarded from</span>
      {header.from && <PersonChip person={header.from} className="font-medium text-ink-soft" />}
      {date ? (
        <>
          <span aria-hidden>·</span>
          <time dateTime={date.toISOString()} title={longDate(date.toISOString())} className="shrink-0 text-[12px]">
            {(({ day, time }) => `${day}, ${time}`)(dayAndTime(date.toISOString()))}
          </time>
        </>
      ) : header.date ? (
        <>
          <span aria-hidden>·</span>
          <span className="shrink-0">{header.date}</span>
        </>
      ) : null}
      {subject && (
        <>
          <span aria-hidden>·</span>
          <span className="min-w-0 truncate">{subject}</span>
        </>
      )}
      {original && (
        <>
          <span aria-hidden>·</span>
          <button
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent('superhey:open-thread', { detail: original }))}
            title={`Open the email you forwarded, in ${original.boxId ? 'its box' : 'HEY'}`}
            className="shrink-0 font-medium text-ink-soft hover:text-ink hover:underline"
          >
            Open original
          </button>
        </>
      )}
    </div>
  )
}

/** The trimmed conversation history, one click away. */
/** A signature the thread repeats, folded to a quiet "Signature" toggle. */
function SignatureFold({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="mb-2">
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        title={open ? 'Hide signature' : 'Show signature (the same under each of their messages)'}
        className="rounded-[3px] text-[12px] font-medium text-ink-faint hover:text-ink-soft"
      >
        {open ? 'Hide signature' : 'Signature…'}
      </button>
      {open && (
        <div className="fade-in mt-1.5 text-ink-soft">
          <Markdown components={mdComponents}>{text}</Markdown>
        </div>
      )}
    </div>
  )
}

function QuotedHistory({ quote }: { quote: QuotedSplit }) {
  const [open, setOpen] = useState(false)
  const label = `${open ? 'Hide' : 'Show'} quoted text${quote.quotedName ? ` from ${quote.quotedName}` : ''}`
  return (
    <div className="mb-1">
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-label={label}
        title={label}
        className={`inline-flex h-[18px] w-8 items-center justify-center rounded-full transition-colors ${
          open ? 'bg-rule-strong text-ink' : 'bg-pane-sunk text-ink-soft hover:bg-rule-strong hover:text-ink'
        }`}
      >
        <svg width="16" height="4" viewBox="0 0 16 4" aria-hidden fill="currentColor">
          <circle cx="2" cy="2" r="1.6" />
          <circle cx="8" cy="2" r="1.6" />
          <circle cx="14" cy="2" r="1.6" />
        </svg>
      </button>
      {open && (
        <div className="fade-in mt-3 border-l-2 border-rule-strong pl-4 text-ink-soft">
          <Markdown components={mdComponents}>{quote.quoted}</Markdown>
        </div>
      )}
    </div>
  )
}

/** The message time as a small tag: day, hairline, time. Full date on hover. */
export function Time({ iso }: { iso: string }) {
  const { day, time } = dayAndTime(iso)
  return (
    <time
      dateTime={iso}
      title={longDate(iso)}
      className="inline-flex shrink-0 items-center self-center rounded-ui bg-pane-sunk px-2 py-[3px] text-[11px] leading-none font-medium text-ink-soft"
    >
      {day}
      <span aria-hidden className="mx-1.5 h-2.5 w-px bg-rule-strong" />
      <span className="text-ink-faint">{time}</span>
    </time>
  )
}

/** A plain one-line preview of a Markdown body. */
export function snippet(markdown: string) {
  return markdown
    .replace(/^📎.*$/gmu, '')
    .replace(/^\\?-{2,}.*(Forwarded|Original).*$/gim, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\\([\\`*_{}[\]()#+\-.!<>|~])/g, '$1')
    .replace(/[*_`>#]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180)
}

/** Wide enough for the email column and the details panel side by side. */
const PANEL_AUTO_WIDTH = 1080
const PANEL_KEY = 'details-panel'
type PanelPref = 'auto' | 'open' | 'closed'

/**
 * Open automatically when the reader is wide; the toggle (or "i") overrides that and is
 * remembered on this device.
 */
function useContextPanel(ref: React.RefObject<HTMLElement | null>) {
  const [wide, setWide] = useState(false)
  const [pref, setPref] = useState<PanelPref>(() => {
    try {
      const v = localStorage.getItem(PANEL_KEY)
      return v === 'open' || v === 'closed' ? v : 'auto'
    } catch {
      return 'auto'
    }
  })

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setWide((e?.contentRect.width ?? 0) >= PANEL_AUTO_WIDTH))
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])

  const open = pref === 'open' || (pref === 'auto' && wide)
  const toggle = () => {
    const next: PanelPref = open ? 'closed' : 'open'
    setPref(next)
    try {
      localStorage.setItem(PANEL_KEY, next)
    } catch {
      // not remembered, still works
    }
  }

  useShortcut('details', toggle)

  return { open, toggle }
}

function PanelIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="2" stroke="currentColor" strokeWidth="1.4" />
      <path d="M10 3v10" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  )
}

function ReaderSkeleton() {
  return (
    <div className="mt-8 space-y-3 rounded-ui-lg border border-rule bg-pane px-7 py-6" aria-label="Loading thread">
      {[92, 100, 84, 96, 60].map((w, i) => (
        <div key={i} className="pulse h-3 rounded bg-pane-sunk" style={{ width: `${w}%`, animationDelay: `${i * 90}ms` }} />
      ))}
    </div>
  )
}
