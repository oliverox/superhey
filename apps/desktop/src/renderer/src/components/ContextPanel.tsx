import { useState } from 'react'
import type { AttachmentRow, PostingRow, ThreadView } from '@shared/api'
import { api, useLive } from '../api'
import { AddToCalendar } from './AddToCalendar'
import { dayName, shortDate } from '../format'
import { dedupe, displayName, hasRealName, shortName, type Addr } from '../mail/people'
import { extension, formatBytes, visibleAttachments } from './Attachments'
import { CopyButton } from './People'
import { Avatar } from './Avatar'
import { Tag } from './Tag'

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
    <aside aria-label="Thread details" className="scroll w-[var(--panel-w)] shrink-0 border-l border-rule bg-pane px-5 pt-6 pb-10 text-[13px]">
      <Understanding topicId={thread.topicId} subject={thread.subject ?? undefined} />
      <People thread={thread} />
      {counterpart && <MoreFrom person={counterpart} topicId={thread.topicId} onOpen={onOpenThread} />}
      {files.length > 0 && <Files files={files} />}
    </aside>
  )
}

/** A calm section: a small heading (and count), then its rows; sections are ruled apart. */
function Section({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <section className="border-t border-rule pt-4 pb-5 first:border-t-0 first:pt-0">
      <h2 className="eyebrow mb-2 flex items-baseline px-2">
        {title}
        {count != null && <span className="ml-auto font-normal tabular-nums">{count}</span>}
      </h2>
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
    <Section title="People" count={people.length}>
      {shown.map((p) => (
        <PersonRow key={p.email} person={p} />
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
            <button onClick={() => onOpen(p)} className="flex w-full items-baseline gap-3 rounded-ui px-2 py-1.5 text-left text-ink-soft hover:bg-pane-alt hover:text-ink">
              <span className="min-w-0 flex-1 truncate">{p.subject || '(no subject)'}</span>
              <span className="shrink-0 text-[12px] text-ink-faint tabular-nums">{shortDate(p.activeAt)}</span>
            </button>
          </li>
        ))}
      </ul>
    </Section>
  )
}

function Files({ files }: { files: AttachmentRow[] }) {
  return (
    <Section title="Files" count={files.length}>
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
      <span className="flex h-6 min-w-9 shrink-0 items-center justify-center rounded-[3px] bg-pane-sunk px-1 text-[11px] font-semibold text-ink-soft uppercase">
        {extension(file.filename) || 'file'}
      </span>
      <span className="min-w-0 flex-1 truncate text-ink">{file.filename}</span>
      <span className={`shrink-0 text-[12px] ${failed ? 'text-danger' : 'text-ink-faint'}`}>{failed ? 'Failed' : formatBytes(file.byteSize)}</span>
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

/**
 * What the thread asks of you, from the AI's reading (its one-line summary is under the
 * title already): whether it needs your reply, what to do, the dates with Add to calendar,
 * and the sums. Nothing when there's nothing to act on.
 */
export function Understanding({ topicId, subject }: { topicId: number; subject?: string }) {
  const a = useLive(() => api.analysis(topicId), [topicId], (e) => e.type === 'analysis' && e.topicId === topicId).data
  if (!a) return null
  const dates = a.dates
  if (!a.needsReply && !a.expectsReply && !a.actionItems.length && !dates.length && !a.amounts.length) return null
  return (
    <Section title="For you">
      <div className="space-y-4 px-2">
        {(a.needsReply || a.expectsReply) && (
          <div className="flex items-start gap-2.5">
            <Tag kind={a.needsReply ? 'reply' : 'label'}>{a.needsReply ? 'Needs reply' : 'Waiting'}</Tag>
            <span className="min-w-0 leading-snug text-ink-soft">{a.needsReply ? (a.replyReason ?? 'They’re waiting on you.') : 'You asked; waiting on their answer.'}</span>
          </div>
        )}
        {a.actionItems.length > 0 && (
          <ul className="space-y-2" aria-label="To do">
            {a.actionItems.map((item, i) => (
              <li key={i} className="flex gap-2.5 leading-snug">
                <span aria-hidden className="mt-[2px] size-[13px] shrink-0 rounded-[4px] border-[1.5px] border-rule-strong" />
                <span className="min-w-0 flex-1 text-ink">
                  {item.text}
                  {item.due && <span className={`ml-2 whitespace-nowrap text-[12px] ${isPast(item.due) ? 'text-danger' : 'text-ink-faint'}`}>{dayName(item.due)}</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
        {dates.length > 0 && (
          <ul className="-mx-2" aria-label="Dates">
            {dates.map((d, i) => (
              <li key={`d${i}`} className="flex items-center gap-3 rounded-ui px-2 py-1.5">
                <DateBadge ymd={d.date} past={isPast(d.endDate ?? d.date)} />
                <span className="min-w-0 flex-1 leading-snug">
                  <span className="block truncate text-ink">{d.label}</span>
                  <span className="block text-[12px] text-ink-faint tabular-nums">
                    {dayName(d.date)}
                    {d.time ? ` · ${d.time}${d.endTime ? `–${d.endTime}` : ''}` : ''}
                    {d.endDate ? ` → ${dayName(d.endDate)}` : ''}
                  </span>
                </span>
                {!isPast(d.endDate ?? d.date) && <AddToCalendar item={d} source={subject} />}
              </li>
            ))}
          </ul>
        )}
        {a.amounts.length > 0 && (
          <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1.5">
            {a.amounts.map((m, i) => (
              <Fact key={`m${i}`} label={m.label} value={money(m.amount, m.currency)} />
            ))}
          </dl>
        )}
      </div>
    </Section>
  )
}

const badgeMonth = new Intl.DateTimeFormat(undefined, { month: 'short' })
/** A date as a small calendar leaf: the month over the day. */
function DateBadge({ ymd, past }: { ymd: string; past: boolean }) {
  const [y, m, d] = ymd.split('-').map(Number) as [number, number, number]
  return (
    <span aria-hidden className={`flex w-9 shrink-0 flex-col items-center rounded-ui border border-rule py-0.5 leading-none ${past ? 'opacity-50' : ''}`}>
      <span className="text-[10px] font-semibold tracking-[0.05em] text-danger uppercase">{badgeMonth.format(new Date(y, m - 1, d)).replace('.', '')}</span>
      <span className="mt-0.5 text-[15px] font-semibold text-ink tabular-nums">{d}</span>
    </span>
  )
}

/** Someone in the thread: their avatar, name and address; copy the address on hover. */
function PersonRow({ person }: { person: Addr }) {
  const initials = (displayName(person).match(/\b\p{L}/gu) ?? [person.email[0] ?? '?']).slice(0, 2).join('').toUpperCase()
  return (
    <div className="group/row flex items-center gap-2.5 rounded-ui px-2 py-1.5 hover:bg-pane-alt">
      <Avatar avatar={{ url: null, color: null, initials }} size={28} seed={person.email} />
      <div className="min-w-0 flex-1 leading-tight">
        <div className="truncate font-medium text-ink">{hasRealName(person) ? displayName(person) : person.email}</div>
        {hasRealName(person) && <div className="truncate text-[12px] text-ink-faint">{person.email}</div>}
      </div>
      <CopyButton text={person.email} label={`Copy ${person.email}`} className="opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100" />
    </div>
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

