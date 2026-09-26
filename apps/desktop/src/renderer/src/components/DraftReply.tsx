import { Fragment, useEffect, useRef, useState } from 'react'
import type { ReplyDraftRow, ThreadView } from '@shared/api'
import { api, useLive } from '../api'
import { Spinner } from './Spinner'
import { motionOff } from '../motion'

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

export function DraftCard({ draft, onUse, onRedraft, onDiscard }: { draft: ReplyDraftRow; onUse: (body: string) => void; onRedraft: () => void; onDiscard: () => void }) {
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
          Fill in before sending: {placeholders.join(', ')}
        </p>
      )}
      <div className="mt-3 flex items-center gap-2">
        <button type="button" onClick={() => onUse(body)} className="btn-primary">
          Use draft
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

  const go = async () => {
    setBusy(true)
    setError(null)
    try {
      await api.draftReply(thread.topicId, text.trim() || null)
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rise mt-5 rounded-ui-lg border border-rule bg-pane px-4 py-3">
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
          placeholder="What should it say? Optional, e.g. yes, but Friday instead"
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
