import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { ActionItem, ComingUpItem, PostingRow, ThreadItem, TodayView, TodoItem } from '@shared/api'
import { AddToCalendar } from './AddToCalendar'
import { api } from '../api'
import { dayName, shortDate } from '../format'
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
  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [selectedId])

  if (!today) return <p className="px-5 py-10 text-center text-ink-faint">Loading…</p>
  const { due, needsReply, replyLater, waiting, comingUp } = today
  const fresh = today.newSince.boxes

  const done = (p: PostingRow) => {
    const run = doneFor(today, p.id)
    return run ? () => void run() : undefined
  }
  const row = (i: ThreadItem, reason: string) => <ThreadRow key={i.key} item={i} reason={reason} selected={i.posting.id === selectedId} onOpen={() => onOpen(i.posting)} onDone={done(i.posting)} />
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
                <ActionRow key={a.key} item={a} selected={a.posting.id === selectedId} onOpen={() => onOpen(a.posting)} onDone={() => void api.markHandled(a.posting.topicId!)} />
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
      {comingUp.length > 0 && <ComingUp items={comingUp} selectedId={selectedId} onOpen={onOpen} />}
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
                  <NewRow key={p.id} posting={p} selected={p.id === selectedId} onOpen={() => onOpen(p)} />
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

function ThreadRow({ item, reason, selected, onOpen, onDone }: { item: ThreadItem; reason: string; selected: boolean; onOpen: () => void; onDone?: () => void }) {
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
      className={`group relative mx-2 flex cursor-default items-center gap-3 rounded-ui py-2.5 pr-3 pl-4 ${selected ? 'bg-selection' : 'hover:bg-pane-sunk'}`}
    >
      <Avatar avatar={avatar} size={32} seed={other?.email ?? p.senderEmail ?? undefined} />
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-ink">{p.subject ? stripSubjectPrefixes(p.subject) : '(no subject)'}</div>
        <div className="mt-0.5 truncate text-[13px] text-ink-faint">
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
function NewRow({ posting: p, selected, onOpen }: { posting: PostingRow; selected: boolean; onOpen: () => void }) {
  const line = p.ai?.summary ?? p.summary
  return (
    <li
      role="option"
      aria-selected={selected}
      onClick={onOpen}
      className={`mx-2 flex cursor-default items-center gap-3 rounded-ui py-2 pr-3 pl-4 transition-colors duration-(--dur-1) ${selected ? 'bg-selection' : 'hover:bg-pane-sunk'}`}
    >
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
function ActionRow({ item, selected, onOpen, onDone }: { item: ActionItem; selected: boolean; onOpen: () => void; onDone: () => void }) {
  const p = item.posting
  return (
    <li
      role="option"
      aria-selected={selected}
      onClick={onOpen}
      className={`group mx-2 flex cursor-default items-center gap-3 rounded-ui py-2.5 pr-3 pl-4 ${selected ? 'bg-selection' : 'hover:bg-pane-sunk'}`}
    >
      <Avatar avatar={p.avatar} size={32} seed={p.senderEmail ?? undefined} />
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-ink">{item.text}</div>
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
      className={`shrink-0 rounded-ui px-2 py-1 text-[12px] font-medium opacity-0 group-hover:opacity-100 hover:bg-pane focus-visible:opacity-100 ${strong ? 'text-ink-soft hover:text-ok' : 'text-ink-faint hover:text-ink'}`}
    >
      {label}
    </button>
  )
  return (
    <span className="flex shrink-0">
      {onDone && button('Done', withShortcut('Done: you’ve dealt with it', 'done'), onDone, true)}
      {onNotNow && button('Not now', 'Not now: off Today until tomorrow, or until something new arrives', onNotNow)}
    </span>
  )
}

/** Dates found in mail over the next week, each a click from its thread. Information, not tasks. */
function ComingUp({ items, selectedId, onOpen }: { items: ComingUpItem[]; selectedId: number | null; onOpen: (p: PostingRow) => void }) {
  return (
    <section aria-label="Coming up" className="@container">
      <h2 className="eyebrow px-5 pt-4 pb-1.5">Coming up</h2>
      <ul>
        {items.map((c) => (
          <li key={c.key} className="relative">
            <button
              onClick={() => onOpen(c.posting)}
              aria-current={c.posting.id === selectedId || undefined}
              className={`mx-2 flex w-[calc(100%-1rem)] items-baseline gap-3 rounded-ui py-2 pl-4 text-left ${c.isDeadline ? 'pr-3' : 'pr-[92px] @max-[28rem]:pr-[52px]'} ${c.posting.id === selectedId ? 'bg-selection' : 'hover:bg-pane-sunk'}`}
            >
              <span className="w-[76px] shrink-0 text-[12px] text-ink-faint tabular-nums">
                {dayName(c.date)}
                {c.time && <span className="block">{c.time}</span>}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-ink">
                  {c.isDeadline && <span className="font-medium text-danger">Due: </span>}
                  {c.label}
                </span>
                {c.task && (
                  <span className="block truncate text-[13px] text-ink-soft">
                    <span className="font-medium text-danger">To do: </span>
                    {c.task}
                  </span>
                )}
                <span className="block truncate text-[12px] text-ink-faint">{c.posting.subject ? stripSubjectPrefixes(c.posting.subject) : c.posting.senderName}</span>
              </span>
            </button>
            {!c.isDeadline && (
              <span className="absolute top-1/2 right-5 -translate-y-1/2">
                <AddToCalendar item={c} source={c.posting.subject ? stripSubjectPrefixes(c.posting.subject) : undefined} />
              </span>
            )}
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

