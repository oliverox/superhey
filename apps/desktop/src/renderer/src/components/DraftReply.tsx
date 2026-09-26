import { Fragment, useEffect, useRef, useState } from 'react'
import type { ReplyDraftRow, ThreadView } from '@shared/api'
import { api, useLive } from '../api'
import { Spinner } from './Spinner'
import { motionOff } from '../motion'
import { clockOf } from '../calendar/model'

/** The thread's draft reply, kept current as drafts are written and discarded. */
export function useDraft(topicId: number) {
  return useLive<ReplyDraftRow | null>(
    () => api.replyDraft(topicId),
    [topicId],
    (e) => e.type === 'draft' && e.topicId === topicId,
  )
}

/**
 * A reply drafted in the user's voice, waiting above the reply buttons: read it, use it (it
 * opens in the composer to edit and send), have it redrafted with an instruction, or
 * discard it. Nothing here sends anything.
 */
const TYPED_KEY = 'drafts:typed'
const typedBefore = (key: string) => {
  try {
    return (JSON.parse(localStorage.getItem(TYPED_KEY) ?? '[]') as string[]).includes(key)
  } catch {
    return true // no memory: don't replay it every time
  }
}
const rememberTyped = (key: string) => {
  try {
    const seen = (JSON.parse(localStorage.getItem(TYPED_KEY) ?? '[]') as string[]).filter((k) => k !== key)
    localStorage.setItem(TYPED_KEY, JSON.stringify([...seen, key].slice(-60)))
  } catch {
    // typed again next time
  }
}

/**
 * The first time a draft is shown, it's typed out (about 1.5–2 s, however long it is);
 * after that, and with reduced motion or Omarchy, it's simply there. `skip` finishes it.
 */
export function useTyped(text: string, key: string) {
  const [shown, setShown] = useState(() => (motionOff() || typedBefore(key) ? text.length : 0))
  useEffect(() => {
    if (shown >= text.length) return
    const duration = Math.min(2200, 700 + text.length * 7)
    const start = performance.now() - (shown / text.length) * duration
    let frame = 0
    const tick = (t: number) => {
      // Ease out: quick at first, settling at the end.
      const k = Math.min(1, (t - start) / duration)
      const n = Math.round((1 - (1 - k) ** 2) * text.length)
      setShown(n)
      if (n < text.length) frame = requestAnimationFrame(tick)
      else rememberTyped(key)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  const done = shown >= text.length
  return {
    text: done ? text : text.slice(0, shown),
    typing: !done,
    skip: () => {
      setShown(text.length)
      rememberTyped(key)
    },
  }
}

export function DraftCard({
  draft,
  sendTo,
  onSend,
  onUse,
  onRedraft,
  onDiscard,
}: {
  draft: ReplyDraftRow
  /** Who Send replies to ("Eon"), when it can be sent from here. */
  sendTo?: string
  onSend?: (body: string) => Promise<void>
  onUse: (body: string) => void
  onRedraft: () => void
  onDiscard: () => void
}) {
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [all, setAll] = useState(false)
  const typed = useTyped(draft.body, `${draft.topicId}:${draft.createdAt}`)
  // Read-only here: Use draft takes it to the composer, where it's edited and sent.
  const body = draft.body
  const placeholders = draft.placeholders
  const long = body.split('\n').length > 8 || body.length > 520
  return (
    // A draft waiting for you: its border shimmers until you use it or throw it away, so it
    // never passes for mail that's been sent.
    <section aria-label="Draft reply, not sent" className="ai-draft rise mt-5 rounded-ui-lg px-5 pt-4 pb-3">
      <header className="flex items-center gap-2">
        <h3 className="text-[13px] font-semibold text-ink">Draft reply</h3>
        <span className="min-w-0 truncate text-[12px] text-ink-faint">{draft.stale ? 'written before the latest message' : draft.instruction ? `“${draft.instruction}”` : 'in your voice'}</span>
      </header>
      <div
        onClick={typed.typing ? typed.skip : undefined}
        title={typed.typing ? 'Show it all' : undefined}
        className={`relative mt-2 overflow-hidden text-[15px] leading-relaxed whitespace-pre-wrap text-ink ${long && !all ? 'max-h-[12.5em]' : ''}`}
      >
        <WithPlaceholders text={typed.typing ? typed.text : body} placeholders={placeholders} />
        {typed.typing && <span aria-hidden className="type-caret" />}
        {long && !all && <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-pane" />}
      </div>
      {long && (
        <button type="button" onClick={() => setAll(!all)} className="mt-1 text-[12px] font-medium text-ink-faint hover:text-ink-soft">
          {all ? 'Show less' : 'Show all'}
        </button>
      )}
      {placeholders.length > 0 && (
        <p className="mt-2 text-[12px] text-ink-faint">
          Fill in before sending: {placeholders.join(', ')}{onSend ? ' (Edit to fill them in)' : ''}
        </p>
      )}
      {sendError && <p className="mt-2 text-[12px] text-danger">{sendError}</p>}
      <div className="mt-3 flex items-center gap-2">
        {onSend && (
          <button
            type="button"
            disabled={sending || typed.typing || placeholders.length > 0}
            title={placeholders.length ? 'Fill in the gaps first: Edit' : `Send this reply${sendTo ? ` to ${sendTo}` : ''} (you’ll have a few seconds to undo)`}
            onClick={async () => {
              setSending(true)
              setSendError(null)
              try {
                await onSend(body)
              } catch (e) {
                setSendError(e instanceof Error ? e.message : String(e))
                setSending(false)
              }
            }}
            className="btn-primary inline-flex items-center gap-1.5 disabled:opacity-50"
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M2.5 8 13.5 2.5 10 13.5 7.5 9 2.5 8Z" />
              <path d="M7.5 9 13.5 2.5" />
            </svg>
            {sending ? 'Sending…' : sendTo ? `Send to ${sendTo}` : 'Send'}
          </button>
        )}
        <button type="button" onClick={() => onUse(body)} className={onSend ? 'rounded-ui px-2.5 py-1.5 text-[13px] font-medium text-ink-soft hover:bg-pane-sunk hover:text-ink' : 'btn-primary'}>
          {onSend ? 'Edit' : 'Use draft'}
        </button>
        <button type="button" onClick={onRedraft} className="rounded-ui px-2.5 py-1.5 text-[13px] text-ink-soft hover:bg-pane-sunk hover:text-ink">
          Redraft…
        </button>
        <button type="button" onClick={onDiscard} className="ml-auto rounded-ui px-2.5 py-1.5 text-[13px] text-ink-faint hover:bg-pane-sunk hover:text-ink">
          Discard
        </button>
      </div>
    </section>
  )
}

/** The draft's [placeholders] marked, so they aren't sent as they are. */
function WithPlaceholders({ text, placeholders }: { text: string; placeholders: string[] }) {
  if (!placeholders.length) return <>{text}</>
  const escaped = placeholders.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const parts = text.split(new RegExp(`(${escaped.join('|')})`, 'g'))
  return (
    <>
      {parts.map((part, i) =>
        placeholders.includes(part) ? (
          <mark key={i} className="rounded-[3px] bg-attn-wash px-0.5 text-attn">
            {part}
          </mark>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  )
}

/**
 * Asking for a draft: what it should say, in a few words (optional). Drafting takes a few
 * seconds on the quality model; errors (no AI, budget) show in place.
 */
export function DraftRequest({ thread, initial = '', onDone, onCancel }: { thread: ThreadView; initial?: string; onDone: () => void; onCancel: () => void }) {
  const [text, setText] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => input.current?.focus(), [])

  // What the AI made of the thread: replies that fit it, and the dates it proposes.
  const analysis = useLive(() => api.analysis(thread.topicId), [thread.topicId], (e) => e.type === 'analysis' && e.topicId === thread.topicId).data
  const options = analysis?.replyOptions ?? []
  const when = nextTimedDate(analysis?.dates ?? [])

  const go = async (instruction = text) => {
    setBusy(true)
    setError(null)
    try {
      await api.draftReply(thread.topicId, instruction.trim() || null)
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rise mt-5 rounded-ui-lg border border-rule bg-pane px-4 py-3">
      {when && <Availability date={when} />}
      {options.length > 0 && (
        <div className="mb-2.5 flex flex-wrap gap-1.5" role="group" aria-label="Suggested replies">
          {options.map((o) => (
            <button
              key={o}
              type="button"
              disabled={busy}
              onClick={() => {
                setText(o)
                void go(o)
              }}
              className="rounded-full border border-rule px-3 py-1 text-[13px] text-ink-soft transition-colors hover:border-accent hover:bg-accent-wash hover:text-accent disabled:opacity-50"
            >
              {o}
            </button>
          ))}
        </div>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!busy) void go()
        }}
        className="flex items-center gap-2"
      >
        <input
          ref={input}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault()
              onCancel()
            }
          }}
          disabled={busy}
          maxLength={500}
          placeholder={options.length ? 'Or say it your way…' : 'What should it say? Optional, e.g. yes, but Friday instead'}
          aria-label="What the reply should say"
          className="field min-w-0 flex-1"
        />
        <button type="submit" disabled={busy} className="btn-primary inline-flex items-center gap-2 disabled:opacity-60">
          {busy && <Spinner size={12} />}
          {busy ? 'Drafting…' : 'Draft'}
        </button>
        <button type="button" onClick={onCancel} disabled={busy} className="rounded-ui px-2 py-1.5 text-[13px] text-ink-faint hover:bg-pane-sunk hover:text-ink">
          Cancel
        </button>
      </form>
      {busy && <p className="mt-2 text-[12px] text-ink-faint">Writing it in your voice. This takes a few seconds.</p>}
      {error && <p className="mt-2 text-[13px] text-danger">{error}</p>}
    </div>
  )
}

type MailDateLike = { label: string; date: string; time: string | null; endTime?: string | null }

/** The first date in the email with a time that hasn't passed: the one a reply is likely about. */
function nextTimedDate(dates: MailDateLike[]): MailDateLike | null {
  const now = new Date()
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  return dates.filter((d) => d.time && d.date >= today).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))[0] ?? null
}

const whenFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

/** Whether you're free when the email proposes: checked against your HEY calendar. */
function Availability({ date: d }: { date: MailDateLike }) {
  const range = useLive(() => api.calendarRange(d.date, d.date), [d.date], (e) => e.type === 'change' && e.change.kind === 'calendar')
  const start = new Date(`${d.date}T${d.time}:00`)
  const end = d.endTime ? new Date(`${d.date}T${d.endTime}:00`) : new Date(start.getTime() + 60 * 60_000)
  const clash = (range.data?.events ?? []).find((e) => !e.allDay && e.endsAt && new Date(e.startsAt) < end && new Date(e.endsAt) > start)
  if (!range.data) return null
  return (
    <p className="mb-2.5 flex items-center gap-2 text-[13px]">
      <span className={`size-2 shrink-0 rounded-full ${clash ? 'bg-danger' : 'bg-ok'}`} />
      <span className="text-ink-soft">{whenFmt.format(start)}</span>
      <span className={clash ? 'text-danger' : 'text-ok'}>
        {clash ? `clashes with ${clash.title} (${clockOf(clash.startsAt)}–${clockOf(clash.endsAt!)})` : 'you’re free'}
      </span>
    </p>
  )
}
