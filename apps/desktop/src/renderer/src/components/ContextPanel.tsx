import { useState } from 'react'
import type { AttachmentRow, PostingRow, ThreadView } from '@shared/api'
import { api, useLive } from '../api'
import { dayName, shortDate } from '../format'
import { dedupe, shortName, type Addr } from '../mail/people'
import { extension, formatBytes, visibleAttachments } from './Attachments'
import { AddressRow } from './People'

const PEOPLE_PREVIEW = 6

/**
 * Beside the email when the window is wide: what the AI made of the thread (when it has),
 * who is involved, what else they've sent, and every file in the thread.
 */
export function ContextPanel({ thread, onOpenThread }: { thread: ThreadView; onOpenThread: (p: PostingRow) => void }) {
  const entries = thread.entries
  // Latest sender who isn't you: the person this thread is "with".
  const counterpart = [...entries].reverse().find((e) => e.from && !e.from.isMe)?.from ?? null
  const files = entries.flatMap((e) => visibleAttachments(e.attachments))

  return (
    <aside aria-label="Thread details" className="scroll w-[296px] shrink-0 border-l border-rule bg-pane px-4 pt-6 pb-10 text-[13px]">
      <Understanding topicId={thread.topicId} />
      <People thread={thread} />
      {counterpart && <MoreFrom person={counterpart} topicId={thread.topicId} onOpen={onOpenThread} />}
      {files.length > 0 && <Files files={files} />}
    </aside>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-7">
      <h2 className="eyebrow mb-1.5 px-2">{title}</h2>
      {children}
    </section>
  )
}

function People({ thread }: { thread: ThreadView }) {
  const [all, setAll] = useState(false)
  // Senders first (newest first), then everyone else they wrote to. You're left out.
  const senders = [...thread.entries].reverse().flatMap((e) => (e.from ? [e.from] : []))
  const others = thread.entries.flatMap((e) => [...e.to, ...e.cc])
  const people = dedupe([...senders, ...others] as Addr[]).filter((p) => !p.isMe)
  if (!people.length) return null
  const shown = all ? people : people.slice(0, PEOPLE_PREVIEW)

  return (
    <Section title={`People · ${people.length}`}>
      {shown.map((p) => (
        <AddressRow key={p.email} person={p} />
      ))}
      {people.length > PEOPLE_PREVIEW && (
        <button onClick={() => setAll(!all)} className="mt-0.5 px-2 text-[12px] font-medium text-ink-faint hover:text-ink-soft">
          {all ? 'Show fewer' : `Show all ${people.length}`}
        </button>
      )}
    </Section>
  )
}

function MoreFrom({ person, topicId, onOpen }: { person: Addr; topicId: number; onOpen: (p: PostingRow) => void }) {
  const threads = useLive(
    () => api.senderThreads(person.email, topicId),
    [person.email, topicId],
    (e) => e.type === 'change' && e.change.kind === 'postings',
  )
  if (!threads.data?.length) return null

  return (
    <Section title={`More from ${shortName(person)}`}>
      <ul>
        {threads.data.map((p) => (
          <li key={p.id}>
            <button onClick={() => onOpen(p)} className="flex w-full items-baseline gap-2 rounded-ui px-2 py-1.5 text-left hover:bg-pane-alt">
              <span className="min-w-0 flex-1 truncate text-ink">{p.subject || '(no subject)'}</span>
              <span className="shrink-0 text-[11.5px] text-ink-faint">{shortDate(p.activeAt)}</span>
            </button>
          </li>
        ))}
      </ul>
    </Section>
  )
}

function Files({ files }: { files: AttachmentRow[] }) {
  return (
    <Section title={`Files · ${files.length}`}>
      <ul>
        {files.map((f) => (
          <li key={f.id}>
            <FileRow file={f} />
          </li>
        ))}
      </ul>
    </Section>
  )
}

function FileRow({ file }: { file: AttachmentRow }) {
  const [failed, setFailed] = useState(false)
  return (
    <button
      onClick={() => api.openAttachment(file.id).then(() => setFailed(false), () => setFailed(true))}
      title={failed ? "Couldn't open" : `Open ${file.filename}`}
      className="flex w-full items-center gap-2.5 rounded-ui px-2 py-1.5 text-left hover:bg-pane-alt"
    >
      <span className="flex h-6 w-8 shrink-0 items-center justify-center rounded-[3px] bg-pane-sunk text-[9px] font-semibold tracking-wide text-ink-soft uppercase">
        {extension(file.filename) || 'file'}
      </span>
      <span className="min-w-0 flex-1 truncate text-ink">{file.filename}</span>
      <span className={`shrink-0 text-[11.5px] ${failed ? 'text-danger' : 'text-ink-faint'}`}>{failed ? 'Failed' : formatBytes(file.byteSize)}</span>
    </button>
  )
}

function money(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount)
  } catch {
    return `${amount} ${currency}` // not an ISO code ("points")
  }
}
const isPast = (ymd: string) => {
  const [y, m, d] = ymd.split('-').map(Number) as [number, number, number]
  const t = new Date()
  return new Date(y, m - 1, d) < new Date(t.getFullYear(), t.getMonth(), t.getDate())
}

/** The AI's reading of the thread: what it's about, whether it needs you, what to do and when. */
export function Understanding({ topicId }: { topicId: number }) {
  const a = useLive(() => api.analysis(topicId), [topicId], (e) => e.type === 'analysis' && e.topicId === topicId).data
  if (!a) return null
  return (
    <Section title="Summary">
      <div className="space-y-3 px-2">
        <p className="leading-snug text-ink">{a.summary}</p>
        {a.needsReply && (
          <p className="flex items-baseline gap-1.5 text-[12.5px] font-medium text-accent">
            <ReplyGlyph />
            <span>Needs your reply{a.replyReason ? `: ${a.replyReason}` : ''}</span>
          </p>
        )}
        {a.expectsReply && <p className="text-[12.5px] text-ink-soft">You asked; waiting on their answer.</p>}
        {a.actionItems.length > 0 && (
          <ul className="space-y-1.5" aria-label="Action items">
            {a.actionItems.map((item, i) => (
              <li key={i} className="flex gap-2 text-[12.5px] leading-snug">
                <span aria-hidden className="mt-[3px] size-[11px] shrink-0 rounded-[3px] border-[1.5px] border-rule-strong" />
                <span className="min-w-0 flex-1 text-ink">
                  {item.text}
                  {item.due && <span className={`ml-1.5 whitespace-nowrap ${isPast(item.due) ? 'text-danger' : 'text-ink-faint'}`}>{dayName(item.due)}</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
        {(a.dates.length > 0 || a.amounts.length > 0) && (
          <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-[12.5px]">
            {a.dates.map((d, i) => (
              <Fact key={`d${i}`} label={d.label} value={`${dayName(d.date)}${d.time ? `, ${d.time}` : ''}`} />
            ))}
            {a.amounts.map((m, i) => (
              <Fact key={`m${i}`} label={m.label} value={money(m.amount, m.currency)} />
            ))}
          </dl>
        )}
      </div>
    </Section>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <>
      {/* The label wraps; the value (a date, a sum) stays on one line. */}
      <dt className="min-w-0 text-ink-faint">{label}</dt>
      <dd className="text-right whitespace-nowrap text-ink tabular-nums">{value}</dd>
    </>
  )
}

function ReplyGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0 translate-y-[1px]">
      <path d="M6.5 3.5 2.5 7.5l4 4" />
      <path d="M2.5 7.5h7a4 4 0 0 1 4 4V13" />
    </svg>
  )
}
