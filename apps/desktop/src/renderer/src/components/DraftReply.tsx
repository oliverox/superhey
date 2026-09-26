import { Fragment, useEffect, useRef, useState } from 'react'
import type { ReplyDraftRow, ThreadView } from '@shared/api'
import { api, useLive } from '../api'
import { Spinner } from './Spinner'

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
export function DraftCard({ draft, onUse, onRedraft, onDiscard }: { draft: ReplyDraftRow; onUse: () => void; onRedraft: () => void; onDiscard: () => void }) {
  const [all, setAll] = useState(false)
  const long = draft.body.split('\n').length > 8 || draft.body.length > 520
  return (
    // A draft waiting for you: its border shimmers until you use it or throw it away, so it
    // never passes for mail that's been sent.
    <section aria-label="Draft reply, not sent" className="ai-draft rise mt-5 rounded-ui-lg px-5 pt-4 pb-3">
      <header className="flex items-center gap-2">
        <h3 className="text-[13px] font-semibold text-ink">Draft reply</h3>
        <span className="min-w-0 truncate text-[12px] text-ink-faint">{draft.stale ? 'written before the latest message' : draft.instruction ? `“${draft.instruction}”` : 'in your voice'}</span>
        <span className="ai-draft-tag ml-auto inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold">
          <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
            <path d="M8 0c.4 3.6 2.4 5.6 6 6-3.6.4-5.6 2.4-6 6-.4-3.6-2.4-5.6-6-6 3.6-.4 5.6-2.4 6-6Zm5.5 10c.2 1.6 1 2.4 2.5 2.5-1.5.2-2.3 1-2.5 2.5-.2-1.5-1-2.3-2.5-2.5 1.5-.1 2.3-.9 2.5-2.5Z" />
          </svg>
          AI draft · not sent
        </span>
      </header>
      <div className={`relative mt-2 overflow-hidden text-[15px] leading-relaxed whitespace-pre-wrap text-ink ${long && !all ? 'max-h-[12.5em]' : ''}`}>
        <WithPlaceholders text={draft.body} placeholders={draft.placeholders} />
        {long && !all && <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-pane" />}
      </div>
      {long && (
        <button type="button" onClick={() => setAll(!all)} className="mt-1 text-[12px] font-medium text-ink-faint hover:text-ink-soft">
          {all ? 'Show less' : 'Show all'}
        </button>
      )}
      {draft.placeholders.length > 0 && (
        <p className="mt-2 text-[12px] text-ink-faint">
          Fill in before sending: {draft.placeholders.join(', ')}
        </p>
      )}
      <div className="mt-3 flex items-center gap-2">
        <button type="button" onClick={onUse} className="btn-primary">
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
