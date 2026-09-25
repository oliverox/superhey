import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { PostingRow, ThreadItem, TodayView, TodoItem } from '@shared/api'
import { api } from '../api'
import { stripSubjectPrefixes } from '../mail/forwarded'
import { Avatar } from './Avatar'

export type TodayData = TodayView & { screener: number }

/** A few per section; the rest behind "Show all". */
const SHOWN = 5

// Why each item is here, in a few words.
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
export const why = {
  todo: (t: TodoItem) => (t.daysLate === 0 ? 'Due today' : `${plural(t.daysLate, 'day')} late`),
  bubbled: () => 'Bubbled up',
  replyLater: (i: ThreadItem) => (i.days === 0 ? 'Waiting on your reply' : `Waiting on your reply · ${plural(i.days, 'day')}`),
  waiting: (i: ThreadItem) => `No reply for ${plural(i.days, 'day')}`,
}

/** The threads on Today, in the order they're listed (for j / k). */
export function todayThreads(t: TodayData | null): PostingRow[] {
  if (!t) return []
  return [...t.due.bubbled, ...t.replyLater, ...t.waiting].map((i) => i.posting)
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
  const { due, replyLater, waiting } = today
  const fresh = today.newSince.boxes

  const row = (i: ThreadItem, reason: string) => <ThreadRow key={i.key} item={i} reason={reason} selected={i.posting.id === selectedId} onOpen={() => onOpen(i.posting)} />
  return (
    <div ref={listRef} className="scroll min-h-0 flex-1 pb-6">
      {(due.todos.length > 0 || due.bubbled.length > 0) && (
        <Section title="Due" count={due.todos.length + due.bubbled.length}>
          {(limit) => (
            <>
              {due.todos.slice(0, limit).map((t) => (
                <TodoRow key={t.key} item={t} />
              ))}
              {due.bubbled.slice(0, Math.max(0, limit - due.todos.length)).map((i) => row(i, why.bubbled()))}
            </>
          )}
        </Section>
      )}
      {replyLater.length > 0 && <Section title="Reply Later" count={replyLater.length}>{(limit) => replyLater.slice(0, limit).map((i) => row(i, why.replyLater(i)))}</Section>}
      {waiting.length > 0 && <Section title="Waiting on others" count={waiting.length}>{(limit) => waiting.slice(0, limit).map((i) => row(i, why.waiting(i)))}</Section>}
      {today.toHandle === 0 && (
        <div className="px-5 pt-10 pb-4 text-center">
          <p className="font-app text-[16px] font-medium text-ink">You’re caught up.</p>
          <p className="mt-1 text-[12.5px] text-ink-faint">Nothing due, nothing waiting on your reply, nobody to chase.</p>
        </div>
      )}
      {fresh.length > 0 && (
        <section aria-label="New">
          <h2 className="eyebrow px-5 pt-5 pb-1.5">{today.newSince.since ? 'New since you last looked' : 'New today'}</h2>
          <ul className="flex flex-wrap gap-1.5 px-5">
            {fresh.map((b) => (
              <li key={b.boxId}>
                <button onClick={() => onGoToBox(b.boxId)} className="rounded-ui border border-rule px-2.5 py-1 text-[12.5px] text-ink-soft hover:border-rule-strong hover:text-ink">
                  {b.name} <span className="font-semibold text-ink tabular-nums">{b.count}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
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

function ThreadRow({ item, reason, selected, onOpen }: { item: ThreadItem; reason: string; selected: boolean; onOpen: () => void }) {
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
        <div className="mt-0.5 truncate text-[12.5px] text-ink-faint">
          <span className="text-ink-soft">{who}</span> · {reason}
        </div>
      </div>
      <button
        onClick={(e) => {
          e.stopPropagation()
          void api.hideFromToday(item.key, p.activeAt ?? '')
        }}
        title="Not now: off Today until something new arrives"
        className="shrink-0 rounded-ui px-2 py-1 text-[11.5px] font-medium text-ink-faint opacity-0 group-hover:opacity-100 hover:bg-pane hover:text-ink focus-visible:opacity-100"
      >
        Not now
      </button>
    </li>
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
        <div className={`mt-0.5 text-[12.5px] ${item.daysLate > 0 ? 'text-danger' : 'text-ink-faint'}`}>{why.todo(item)} · To-do</div>
      </div>
    </li>
  )
}

/** The date for Today's header: "Fri 25 Sep". */
export const todayLabel = (d = new Date()) => new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' }).format(d)

/** The reader on Today when there's no thread to open: nothing left to handle. */
export function TodayDone({ toDos }: { toDos: number }) {
  return (
    <main className="pane flex flex-col bg-pane-alt">
      <div className="drag h-[52px] shrink-0" />
      <div className="flex flex-1 flex-col items-center justify-center px-8 text-center text-ink-faint">
        <p className="font-app text-[17px] font-medium text-ink-soft">{toDos ? `${plural(toDos, 'to-do')} left, and no threads.` : 'You’re caught up.'}</p>
        <p className="mt-2 text-[12.5px]">
          <kbd>1</kbd>–<kbd>6</kbd> for boxes · <kbd>⌘K</kbd> for anything
        </p>
      </div>
    </main>
  )
}
