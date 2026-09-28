import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { ActionItem, ComingUpItem, Money, PostingRow, TaskKind, ThreadItem, TodayView, TodoItem } from '@shared/api'
import { replyWith } from '../outbox'
import { AddToCalendar } from './AddToCalendar'
import { Tag } from './Tag'
import { MarkRead } from './MarkRead'
import { api } from '../api'
import { clock, dayName, shortDate } from '../format'
import { stripSubjectPrefixes } from '../mail/forwarded'
import { withShortcut } from '../shortcuts'
import { Avatar } from './Avatar'

export type TodayData = TodayView & { screener: number }

/** A few per section; the rest behind "Show all". */
const SHOWN = 5

// Why each item is here, in a few words.
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
export const why = {
  todo: (t: TodoItem) => (t.daysLate === 0 ? 'Due today' : `${plural(t.daysLate, 'day')} late`),
  bubbled: () => 'Bubbled up',
  action: (a: ActionItem) => (a.daysLate === 0 ? 'Due today' : `${plural(a.daysLate, 'day')} late`),
  needsReply: (i: ThreadItem) => (i.reason ? capitalise(i.reason) : 'Waiting on your reply'),
  replyLater: (i: ThreadItem) => (i.days === 0 ? 'Waiting on your reply' : `Waiting on your reply · ${plural(i.days, 'day')}`),
  waiting: (i: ThreadItem) => `No reply for ${plural(i.days, 'day')}`,
}

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/**
 * "Done" for a thread on Today, meaning what it should for where the thread is listed:
 * bubbled up → the bubble is cancelled in HEY; Reply Later → back to the Imbox in HEY;
 * needs your reply, waiting on others, a deadline from mail → handled (you dealt with it,
 * perhaps outside HEY). Null when the thread isn't on Today.
 */
export function doneFor(t: TodayData | null, postingId: number): (() => Promise<unknown>) | null {
  if (!t) return null
  const on = (items: Array<{ posting: PostingRow }>) => items.find((i) => i.posting.id === postingId)?.posting
  const handled = on(t.due.actions) ?? on(t.needsReply) ?? on(t.waiting)
  if (handled?.topicId != null) return () => api.markHandled(handled.topicId!)
  if (on(t.due.bubbled)) return () => api.runAction({ type: 'unbubble', postingId })
  if (on(t.replyLater)) return () => api.runAction({ type: 'move', postingId, to: 'imbox' })
  return null
}

/** The threads on Today, in the order they're listed (for j / k), each once. */
/** Everything on Today in order, new mail last: what j/k move through. */
export function todayRows(t: TodayData | null): PostingRow[] {
  const all = [...todayThreads(t), ...(t?.newSince.boxes.flatMap((b) => b.threads) ?? [])]
  return all.filter((p, i) => all.findIndex((q) => q.id === p.id) === i)
}

export function todayThreads(t: TodayData | null): PostingRow[] {
  if (!t) return []
  const all = [...t.due.actions.map((a) => a.posting), ...t.due.bubbled.map((i) => i.posting), ...[...t.needsReply, ...t.replyLater, ...t.waiting].map((i) => i.posting)]
  return all.filter((p, i) => all.findIndex((q) => q.id === p.id) === i)
}

/**
 * Today's queue, in the list pane: what's due, what you meant to reply to, and who you're
 * waiting on. Each item leaves once handled in HEY; "Not now" puts a thread off until it
 * changes.
 */
export function TodayList({
  today,
  selectedId,
  onOpen,
  onGoToBox,
}: {
  today: TodayData | null
  selectedId: number | null
  onOpen: (p: PostingRow) => void
  onGoToBox: (boxId: number) => void
}) {
  const listRef = useRef<HTMLDivElement>(null)
  // The row you clicked: an email can appear in several sections, and only that one is
  // highlighted; the others get a thin mark (see `pick`).
  const [clicked, setClicked] = useState<string | null>(null)
  // The new email you opened stays in "New since you last looked" (no longer bold) until you
  // open another, instead of vanishing as it's marked seen.
  const [held, setHeld] = useState<{ posting: PostingRow; box: { boxId: number; kind: string; name: string } } | null>(null)
  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [selectedId])

  if (!today) return <p className="px-5 py-10 text-center text-ink-faint">Loading…</p>
  const { due, needsReply, replyLater, waiting, comingUp } = today
  const boxes = today.newSince.boxes
  const fresh =
    held && !boxes.some((b) => b.boxId === held.box.boxId)
      ? [...boxes, { ...held.box, count: 1, threads: [{ ...held.posting, seen: true }] }]
      : boxes.map((b) => {
          if (!held || held.box.boxId !== b.boxId || b.threads.some((p) => p.id === held.posting.id)) return b
          const threads = [...b.threads, { ...held.posting, seen: true }].sort((x, y) => (y.activeAt ?? '').localeCompare(x.activeAt ?? ''))
          return { ...b, threads, count: b.count + 1 }
        })
  // Every row of the open email, in the order they're drawn; the one to highlight is the
  // one clicked, else the first.
  const rowsOfOpen = [
    ...due.actions.map((a) => [a.key, a.posting.id] as const),
    ...[...due.bubbled, ...needsReply, ...replyLater, ...waiting].map((i) => [i.key, i.posting.id] as const),
    ...comingUp.map((c) => [c.key, c.posting.id] as const),
    ...fresh.flatMap((b) => b.threads.map((p) => [`new:${p.id}`, p.id] as const)),
  ]
    .filter(([, id]) => id === selectedId)
    .map(([key]) => key)
  const primary = clicked && rowsOfOpen.includes(clicked) ? clicked : (rowsOfOpen[0] ?? null)
  /** 'on' for the highlighted row, 'echo' for the open email's other rows. */
  const pick = (key: string, postingId: number): Mark => (postingId !== selectedId ? null : key === primary ? 'on' : 'echo')
  const openFrom = (key: string, p: PostingRow) => {
    setClicked(key)
    const box = key.startsWith('new:') ? fresh.find((b) => b.threads.some((t) => t.id === p.id)) : undefined
    setHeld(box ? { posting: p, box: { boxId: box.boxId, kind: box.kind, name: box.name } } : null)
    onOpen(p)
  }

  const done = (p: PostingRow) => {
    const run = doneFor(today, p.id)
    return run ? () => void run() : undefined
  }
  const row = (i: ThreadItem, reason: string) => <ThreadRow key={i.key} item={i} reason={reason} mark={pick(i.key, i.posting.id)} onOpen={() => openFrom(i.key, i.posting)} onDone={done(i.posting)} />
  return (
    <div ref={listRef} className="scroll min-h-0 flex-1 pb-6">
      {/* Full width when nothing's open: kept to a readable measure. */}
      <div className="mx-auto w-full max-w-[760px]">
      {due.todos.length + due.actions.length + due.bubbled.length > 0 && (
        <Section title="Due" count={due.todos.length + due.actions.length + due.bubbled.length}>
          {(limit) => (
            <>
              {due.todos.slice(0, limit).map((t) => (
                <TodoRow key={t.key} item={t} />
              ))}
              {due.actions.slice(0, Math.max(0, limit - due.todos.length)).map((a) => (
                <ActionRow key={a.key} item={a} mark={pick(a.key, a.posting.id)} onOpen={() => openFrom(a.key, a.posting)} onDone={() => void api.markItemDone(a.posting.topicId!, a.text)} />
              ))}
              {due.bubbled.slice(0, Math.max(0, limit - due.todos.length - due.actions.length)).map((i) => row(i, why.bubbled()))}
            </>
          )}
        </Section>
      )}
      {needsReply.length > 0 && <Section title="Needs your reply" count={needsReply.length}>{(limit) => needsReply.slice(0, limit).map((i) => row(i, why.needsReply(i)))}</Section>}
      {replyLater.length > 0 && <Section title="Reply Later" count={replyLater.length}>{(limit) => replyLater.slice(0, limit).map((i) => row(i, why.replyLater(i)))}</Section>}
      {waiting.length > 0 && <Section title="Waiting on others" count={waiting.length}>{(limit) => waiting.slice(0, limit).map((i) => row(i, why.waiting(i)))}</Section>}
      {/* The state first, then what's ahead. */}
      {today.toHandle === 0 && (
        <div className="px-5 pt-8 pb-4 text-center">
          <p className="font-app text-[17px] font-medium text-ink">You’re caught up.</p>
          <p className="mt-1 text-[13px] text-ink-faint">Nothing due, nothing waiting on your reply, nobody to chase.</p>
        </div>
      )}
      {comingUp.length > 0 && <ComingUp items={comingUp} pick={pick} onOpen={openFrom} />}
      {fresh.length > 0 && (
        <section aria-label="New">
          <h2 className="eyebrow px-5 pt-5 pb-1">{today.newSince.since ? 'New since you last looked' : 'New today'}</h2>
          {fresh.map((b) => (
            <div key={b.boxId} className="pb-2">
              <h3 className="px-5 pt-2 pb-1 text-[13px] font-medium text-ink-soft">
                {b.name} <span className="text-ink-faint tabular-nums">· {b.count}</span>
              </h3>
              <ul>
                {b.threads.map((p) => (
                  <NewRow key={p.id} posting={p} mark={pick(`new:${p.id}`, p.id)} onOpen={() => openFrom(`new:${p.id}`, p)} />
                ))}
              </ul>
              {b.count > b.threads.length && (
                <button onClick={() => onGoToBox(b.boxId)} className="mx-2 rounded-ui px-3 py-1 text-[13px] font-medium text-ink-faint hover:bg-pane-sunk hover:text-ink-soft">
                  {b.count - b.threads.length} more in {b.name}
                </button>
              )}
            </div>
          ))}
        </section>
      )}
      </div>
    </div>
  )
}

function Section({ title, count, children }: { title: string; count: number; children: (limit: number) => ReactNode }) {
  const [all, setAll] = useState(false)
  return (
    <section aria-label={title}>
      <h2 className="eyebrow flex items-baseline gap-2 px-5 pt-4 pb-1.5">
        {title}
        <span className="font-normal tabular-nums normal-case">{count}</span>
      </h2>
      <ul>{children(all ? Infinity : SHOWN)}</ul>
      {count > SHOWN && (
        <button onClick={() => setAll(!all)} className="mx-5 mt-0.5 text-[12px] font-medium text-ink-faint hover:text-ink">
          {all ? 'Show fewer' : `Show all ${count}`}
        </button>
      )}
    </section>
  )
}

function ThreadRow({ item, reason, mark, onOpen, onDone }: { item: ThreadItem; reason: string; mark: Mark; onOpen: () => void; onDone?: () => void }) {
  const selected = mark === 'on'
  const p = item.posting
  // Waiting on others: the thread is about who you wrote to, not you (you sent the last message).
  const other = item.people?.[0]
  const avatar = other?.avatar ?? p.avatar
  const who = other ? `${other.name ?? other.email}${item.people!.length > 1 ? ` +${item.people!.length - 1}` : ''}` : (p.senderName ?? p.senderEmail)
  return (
    <li
      role="option"
      aria-selected={selected}
      onClick={onOpen}
      className={`group relative mx-2 flex cursor-default items-center gap-3 rounded-ui py-2.5 pr-3 pl-4 ${markClass(mark)}`}
      style={{ '--row-bg': selected ? 'var(--selection)' : 'var(--pane-sunk)' } as React.CSSProperties}
    >
      <Avatar avatar={avatar} size={32} seed={other?.email ?? p.senderEmail ?? undefined} />
      {/* The text has the whole row; Done and Not now float over its end on hover. */}
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-ink">{p.subject ? stripSubjectPrefixes(p.subject) : '(no subject)'}</div>
        <div className="mt-0.5 line-clamp-2 text-[13px] leading-snug text-ink-faint">
          <span className="text-ink-soft">{who}</span> · {reason}
        </div>
      </div>
      <RowActions
        onDone={onDone}
        onNotNow={() => void api.hideFromToday(item.key, p.activeAt ?? '')}
      />
    </li>
  )
}

/** A new email: subject, then who and what it's about (the AI's line, or HEY's opening words). */
function NewRow({ posting: p, mark, onOpen }: { posting: PostingRow; mark: Mark; onOpen: () => void }) {
  const selected = mark === 'on'
  const line = p.ai?.summary ?? p.summary
  return (
    <li
      role="option"
      aria-selected={selected}
      onClick={onOpen}
      className={`group/row relative mx-2 flex cursor-default items-center gap-3 rounded-ui py-2 pr-3 pl-4 transition-colors duration-(--dur-1) ${markClass(mark)}`}
      style={{ '--row-bg': selected ? 'var(--selection)' : 'var(--pane-sunk)' } as React.CSSProperties}
    >
      <MarkRead posting={p} />
      <Avatar avatar={p.avatar} size={32} seed={p.senderEmail ?? undefined} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="min-w-0 truncate font-semibold text-ink">{p.subject ? stripSubjectPrefixes(p.subject) : '(no subject)'}</span>
          <span className="ml-auto shrink-0 pl-1 text-[12px] text-ink-faint">{shortDate(p.activeAt)}</span>
        </div>
        <div className="mt-0.5 truncate text-[13px] text-ink-faint">
          <span className="font-medium text-ink-soft">{p.senderName ?? p.senderEmail}</span>
          {line && <> – {line}</>}
        </div>
      </div>
    </li>
  )
}

/** A deadline found in mail: what to do, from which thread, and how late. */
function ActionRow({ item, mark, onOpen, onDone }: { item: ActionItem; mark: Mark; onOpen: () => void; onDone: () => void }) {
  const selected = mark === 'on'
  const p = item.posting
  return (
    <li
      role="option"
      aria-selected={selected}
      onClick={onOpen}
      className={`group relative mx-2 flex cursor-default items-center gap-3 rounded-ui py-2.5 pr-3 pl-4 ${markClass(mark)}`}
      style={{ '--row-bg': selected ? 'var(--selection)' : 'var(--pane-sunk)' } as React.CSSProperties}
    >
      <Avatar avatar={p.avatar} size={32} seed={p.senderEmail ?? undefined} />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          {item.kind !== 'task' && <KindTag kind={item.kind} amount={item.amount} />}
          <span className="truncate font-medium text-ink">{item.text}</span>
        </div>
        <div className="mt-0.5 truncate text-[13px] text-ink-faint">
          <span className={item.daysLate > 0 ? 'text-danger' : 'text-ink-soft'}>{why.action(item)}</span> · {p.subject ? stripSubjectPrefixes(p.subject) : p.senderName}
        </div>
      </div>
      <RowActions onDone={onDone} />
    </li>
  )
}

/** Done and Not now, shown on hover (or keyboard focus), without opening the row. */
function RowActions({ onDone, onNotNow }: { onDone?: () => void; onNotNow?: () => void }) {
  const button = (label: string, title: string, run: () => void, strong = false) => (
    <button
      onClick={(e) => {
        e.stopPropagation()
        run()
      }}
      title={title}
      className={`shrink-0 rounded-ui px-2 py-1 text-[12px] font-medium hover:bg-pane ${strong ? 'text-ink-soft hover:text-ok' : 'text-ink-faint hover:text-ink'}`}
    >
      {label}
    </button>
  )
  return (
    <span className="row-actions pointer-events-none absolute inset-y-0 right-0 flex items-center rounded-r-ui pr-2 pl-8 opacity-0 transition-opacity duration-(--dur-1) group-hover:pointer-events-auto group-hover:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100">
      {onDone && button('Done', withShortcut('Done: you’ve dealt with it', 'done'), onDone, true)}
      {onNotNow && button('Not now', 'Not now: off Today until tomorrow, or until something new arrives', onNotNow)}
    </span>
  )
}

const KIND_LABEL: Record<TaskKind, string> = { form: 'Form', bill: 'Bill', rsvp: 'RSVP', appointment: 'Appointment', task: 'To do' }
const money = (m: Money) => {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: m.currency, maximumFractionDigits: m.amount % 1 ? 2 : 0 }).format(m.amount)
  } catch {
    return `${m.amount} ${m.currency}`
  }
}
/** What sort of to-do: FORM, BILL · €40, RSVP… (a deadline says DUE when it's a plain task). */
function KindTag({ kind, amount, due }: { kind: TaskKind; amount?: Money | null; due?: boolean }) {
  return (
    <Tag kind={due && kind === 'task' ? 'reply' : 'action'}>
      {due && kind === 'task' ? 'Due' : KIND_LABEL[kind]}
      {amount ? ` · ${money(amount)}` : ''}
    </Tag>
  )
}

function HoverButton({ onClick, title, children }: { onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      title={title}
      className="h-7 shrink-0 rounded-ui bg-pane px-2.5 text-[12px] font-medium text-ink-soft shadow-[0_0_0_1px_var(--rule-strong)] hover:text-ink"
    >
      {children}
    </button>
  )
}

type Mark = 'on' | 'echo' | null
/** The open email's row is highlighted; its other rows on Today get a thin bar at the edge. */
const markClass = (m: Mark) =>
  m === 'on'
    ? 'bg-selection'
    : m === 'echo'
      ? "hover:bg-pane-sunk before:absolute before:top-2.5 before:bottom-2.5 before:left-[5px] before:w-[2px] before:rounded-full before:bg-accent/60 before:content-['']"
      : 'hover:bg-pane-sunk'

/** Dates found in mail over the next week, each a click from its thread. Information, not tasks. */
function ComingUp({ items, pick, onOpen }: { items: ComingUpItem[]; pick: (key: string, postingId: number) => Mark; onOpen: (key: string, p: PostingRow) => void }) {
  return (
    <section aria-label="Coming up" className="@container">
      <h2 className="eyebrow px-5 pt-4 pb-1.5">Coming up</h2>
      <ul>
        {items.map((c) => (
          <li key={c.key} className="group/cu relative" style={{ '--row-bg': pick(c.key, c.posting.id) === 'on' ? 'var(--selection)' : 'var(--pane-sunk)' } as React.CSSProperties}>
            <button
              onClick={() => onOpen(c.key, c.posting)}
              aria-current={pick(c.key, c.posting.id) === 'on' || undefined}
              className={`relative mx-2 flex w-[calc(100%-1rem)] items-baseline gap-3 rounded-ui py-2 pl-4 text-left pr-3 ${markClass(pick(c.key, c.posting.id)).replaceAll('hover:bg-pane-sunk', 'group-hover/cu:bg-pane-sunk')}`}
            >
              <span className={`w-[76px] shrink-0 text-[12px] tabular-nums ${c.soon && (c.isDeadline || c.task) ? 'font-medium text-attn' : 'text-ink-faint'}`}>
                {dayName(c.date)}
                {c.time && <span className="block">{c.time}</span>}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex min-w-0 items-center gap-1.5 text-ink">
                  {c.isDeadline && <KindTag kind={c.kind ?? 'task'} amount={c.amount} due />}
                  <span className="truncate">{c.label}</span>
                </span>
                {c.task && (
                  <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[13px] text-ink-soft">
                    <KindTag kind={c.kind ?? 'task'} amount={c.amount} />
                    <span className="truncate">{c.task}</span>
                  </span>
                )}
                {c.clash && (
                  <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[12px] text-attn">
                    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0">
                      <path d="M8 2.5 14 13H2L8 2.5ZM8 6.5v3M8 11.5v.01" />
                    </svg>
                    <span className="truncate">
                      Clashes with {c.clash.title} · {clock(c.clash.startsAt)}
                      {c.clash.endsAt ? `–${clock(c.clash.endsAt)}` : ''}
                    </span>
                  </span>
                )}
                <span className="block truncate text-[12px] text-ink-faint">{c.posting.subject ? stripSubjectPrefixes(c.posting.subject) : c.posting.senderName}</span>
              </span>
            </button>
            {/* On hover, over the end of the row: reply (an RSVP, or to move a clash), Done, Add. Added · Undo stays. */}
            <span className="row-actions absolute top-1 right-2 flex items-center gap-1 rounded-r-ui pr-3 pl-8 opacity-0 transition-opacity duration-(--dur-1) group-hover/cu:opacity-100 focus-within:opacity-100 has-[.keep-visible]:opacity-100">
              {(c.clash || c.kind === 'rsvp' || c.kind === 'appointment') && (
                <HoverButton
                  onClick={() => {
                    replyWith(c.posting.topicId!, c.clash ? `Ask to move it: it clashes with ${c.clash.title} at ${clock(c.clash.startsAt)}` : c.kind === 'rsvp' ? 'Yes, I’ll be there' : 'Confirm the appointment')
                    onOpen(c.key, c.posting)
                  }}
                  title={c.clash ? 'Reply asking to move it (drafted in your voice with ⌘J)' : 'Reply (drafted in your voice with ⌘J)'}
                >
                  {c.clash ? 'Ask to move' : 'Reply'}
                </HoverButton>
              )}
              {(c.task || c.isDeadline) && (
                <HoverButton onClick={() => void api.markItemDone(c.posting.topicId!, c.task ?? c.label)} title="Done: you’ve dealt with it (it leaves Today)">
                  Done
                </HoverButton>
              )}
              {!c.isDeadline && <AddToCalendar item={c} source={c.posting.subject ? stripSubjectPrefixes(c.posting.subject) : undefined} />}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

function TodoRow({ item }: { item: TodoItem }) {
  const [busy, setBusy] = useState(false)
  const complete = async () => {
    setBusy(true)
    try {
      await api.runAction({ type: 'todo', todoId: item.todo.id, done: true })
    } finally {
      setBusy(false)
    }
  }
  return (
    <li className="mx-2 flex items-center gap-3 rounded-ui py-2.5 pr-3 pl-4 hover:bg-pane-sunk">
      <button
        role="checkbox"
        aria-checked={false}
        aria-label={`Complete “${item.todo.title}”`}
        title="Complete (in HEY)"
        onClick={() => void complete()}
        disabled={busy}
        className="flex size-[18px] shrink-0 items-center justify-center rounded-full border-[1.5px] border-rule-strong text-transparent hover:border-ok hover:text-ok disabled:opacity-50"
      >
        <svg width="10" height="10" viewBox="0 0 16 16" fill="none" aria-hidden>
          <path d="m3 8.5 3.25 3.25L13 5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <div className="min-w-0 flex-1 pl-[7px]">
        <div className="truncate text-ink">{item.todo.title}</div>
        <div className={`mt-0.5 text-[13px] ${item.daysLate > 0 ? 'text-danger' : 'text-ink-faint'}`}>{why.todo(item)} · To-do</div>
      </div>
    </li>
  )
}

/** The date for Today's header: "Fri 25 Sep". */
export const todayLabel = (d = new Date()) => new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' }).format(d)

