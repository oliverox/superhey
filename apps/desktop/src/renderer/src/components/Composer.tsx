import { useEffect, useMemo, useRef, useState } from 'react'
import type { OutgoingKind, OutgoingMessage } from '@shared/api'
import { api, useLive } from '../api'
import { keyLabel } from '../shortcuts'
import { isEmail, RecipientField } from './RecipientField'
import { Spinner } from './Spinner'
import { DraftSuggestions } from './DraftReply'

export interface ComposeRequest {
  kind: OutgoingKind
  /** Prefilled message; a reply carries `threadId`. */
  message: OutgoingMessage
  /** The thread being forwarded. */
  forwardOf?: number | null
  /** Shown above the form, e.g. "Reply to Ana". */
  context?: string
  /** Start from `message` even if unsent text was kept for this thread (a draft chosen on purpose). */
  fresh?: boolean
  /** The earlier message a reply answers (not the thread's latest); its unsent text is kept apart. */
  replyTo?: number
  /** The message a draft in your voice answers (the thread's latest, or `replyTo`). */
  draftFrom?: number
}

const TITLES: Record<OutgoingKind, string> = { new: 'New message', reply: 'Reply', 'reply-all': 'Reply all', forward: 'Forward' }

/** Unsent text survives closing the composer, per thread and kind, on this device. */
function storageKey(req: ComposeRequest) {
  return `compose:${req.kind}:${req.message.threadId ?? req.forwardOf ?? 'new'}${req.replyTo != null ? `:${req.replyTo}` : ''}`
}
function loadSaved(req: ComposeRequest): Partial<OutgoingMessage> | null {
  try {
    return JSON.parse(localStorage.getItem(storageKey(req)) ?? 'null') as Partial<OutgoingMessage> | null
  } catch {
    return null
  }
}
function save(req: ComposeRequest, msg: OutgoingMessage | null) {
  try {
    if (msg) localStorage.setItem(storageKey(req), JSON.stringify(msg))
    else localStorage.removeItem(storageKey(req))
  } catch {
    // unsaved on this device; still works
  }
}

/**
 * Writing a message: reply, reply all, forward or new. Send (⌘↵) queues it with a few
 * seconds to undo; Save draft puts it in HEY's drafts; Discard throws it away. Nothing is
 * sent without pressing Send.
 */
export function Composer({ request, onClose, variant }: { request: ComposeRequest; onClose: () => void; variant: 'inline' | 'dialog' }) {
  const saved = useMemo(() => (request.fresh ? null : loadSaved(request)), [request])
  const [to, setTo] = useState<string[]>(saved?.to ?? request.message.to)
  const [cc, setCc] = useState<string[]>(saved?.cc ?? request.message.cc ?? [])
  const [bcc, setBcc] = useState<string[]>(saved?.bcc ?? request.message.bcc ?? [])
  const [showCopies, setShowCopies] = useState((saved?.cc?.length ?? 0) + (saved?.bcc?.length ?? 0) + cc.length > 0)
  const [subject, setSubject] = useState(saved?.subject ?? request.message.subject ?? '')
  const [body, setBody] = useState(saved?.body ?? request.message.body)
  const [attach, setAttach] = useState<string[]>(saved?.attach ?? request.message.attach ?? [])
  const [from, setFrom] = useState<string | undefined>(saved?.from ?? request.message.from)
  const [busy, setBusy] = useState<null | 'send' | 'draft'>(null)
  const [error, setError] = useState<string | null>(null)
  const [draftSaved, setDraftSaved] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const senders = useLive(() => api.senders(), [])
  const isNew = request.kind === 'new'
  const canAttach = request.kind !== 'forward' && !!window.bridge
  // A reply to an earlier message can be drafted in the user's voice, right here.
  const draftFrom = request.replyTo ?? request.draftFrom
  const canDraft = draftFrom != null && request.message.threadId != null
  const [drafting, setDrafting] = useState(false)
  /** What the box held before a draft replaced it, until the user edits it. */
  const [beforeDraft, setBeforeDraft] = useState<string | null>(null)

  const message: OutgoingMessage = {
    ...request.message,
    to,
    cc,
    bcc,
    subject: isNew ? subject : request.message.subject,
    body,
    attach,
    from: isNew ? from : request.message.from,
  }

  // Keep unsent work on this device.
  useEffect(() => {
    const t = setTimeout(() => save(request, message), 400)
    return () => clearTimeout(t)
  })

  // Replies start in the body; new messages start at To.
  useEffect(() => {
    if (!isNew && request.kind !== 'forward') bodyRef.current?.focus()
  }, [isNew, request.kind])

  const invalid = [...to, ...cc, ...bcc].filter((a) => !isEmail(a))
  const problem =
    invalid.length > 0
      ? `Not an email address: ${invalid[0]}`
      : to.length + cc.length + bcc.length === 0
        ? 'Add a recipient'
        : isNew && !subject.trim()
          ? 'Add a subject'
          : null

  const send = async () => {
    if (problem || busy) return setError(problem)
    setBusy('send')
    setError(null)
    try {
      await api.sendMessage(message, request.kind, request.forwardOf ?? null)
      save(request, null)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(null)
    }
  }

  const saveDraft = async () => {
    if (busy) return
    setBusy('draft')
    setError(null)
    try {
      await api.saveDraft(message)
      save(request, null)
      setDraftSaved(true)
      setTimeout(onClose, 900)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  // What's in the box is the instruction ("say yes, Monday works"); the draft replaces it.
  const writeDraft = async (instruction?: string) => {
    if (!canDraft || drafting) return
    setDrafting(true)
    setError(null)
    try {
      // Redrafting follows the same instruction, not the draft now in the box.
      const asked = instruction ?? beforeDraft ?? body
      const draft = await api.draftReplyTo(request.message.threadId!, draftFrom!, asked.trim() || null)
      setBeforeDraft(asked)
      setBody(draft.body)
      setNote(draft.placeholders.length ? `Fill in before sending: ${draft.placeholders.join(', ')}` : null)
      bodyRef.current?.focus()
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e))
    } finally {
      setDrafting(false)
    }
  }

  const undoDraft = () => {
    setBody(beforeDraft ?? '')
    setBeforeDraft(null)
    setNote(null)
    bodyRef.current?.focus()
  }

  const discard = () => {
    save(request, null)
    onClose()
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        void send()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault()
          void send()
        } else if (canDraft && e.key.toLowerCase() === 'j' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault()
          void writeDraft()
        } else if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          onClose() // the text is kept; reopening brings it back
        }
      }}
      aria-label={TITLES[request.kind]}
      className={`overflow-hidden rounded-ui-lg border bg-pane ${
        variant === 'dialog' ? 'border-rule-strong shadow-[0_24px_64px_-24px_rgba(0,0,0,0.45)]' : 'border-rule-strong shadow-[0_8px_24px_-16px_rgba(0,0,0,0.3)]'
      }`}
    >
      <header className="flex items-center gap-2 border-b border-rule bg-pane px-4 py-2 text-[13px]">
        <span className="font-semibold text-ink">{TITLES[request.kind]}</span>
        {request.context && <span className="min-w-0 truncate text-ink-faint">{request.context}</span>}
        {!showCopies && (
          <button type="button" onClick={() => setShowCopies(true)} className="ml-auto text-ink-soft hover:text-ink">
            Cc / Bcc
          </button>
        )}
      </header>

      {isNew && (senders.data?.length ?? 0) > 1 && (
        <label className="flex items-center gap-1.5 border-b border-rule px-4 py-1.5 text-[13px]">
          <span className="w-12 shrink-0 text-ink-faint">From</span>
          <select
            value={from ?? ''}
            onChange={(e) => setFrom(e.target.value || undefined)}
            aria-label="From"
            className="flex-1 bg-transparent py-0.5 text-ink outline-none"
          >
            {/* Without a choice, HEY picks the sender (none is marked default here). */}
            <option value="">HEY's default{senders.data!.some((s) => s.default) ? ` (${senders.data!.find((s) => s.default)!.email})` : ''}</option>
            {senders.data!.map((s) => (
              <option key={s.id} value={s.email}>
                {s.email}
              </option>
            ))}
          </select>
        </label>
      )}
      <RecipientField label="To" value={to} onChange={setTo} autoFocus={isNew || request.kind === 'forward'} />
      {showCopies && (
        <>
          <RecipientField label="Cc" value={cc} onChange={setCc} />
          <RecipientField label="Bcc" value={bcc} onChange={setBcc} />
        </>
      )}
      {isNew && (
        <input
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="Subject"
          aria-label="Subject"
          className="w-full border-b border-rule bg-transparent px-4 py-2 text-[14px] font-medium text-ink outline-none placeholder:text-ink-faint"
        />
      )}

      {canDraft && !body.trim() && beforeDraft == null && <DraftSuggestions topicId={request.message.threadId!} disabled={drafting} onPick={(o) => void writeDraft(o)} />}
      <textarea
        ref={bodyRef}
        value={body}
        onChange={(e) => {
          setBody(e.target.value)
          setBeforeDraft(null)
          if (note && !/\[[^\]]+\]/.test(e.target.value)) setNote(null)
        }}
        readOnly={drafting}
        placeholder={
          request.kind === 'forward'
            ? 'Add a note (optional)'
            : canDraft
              ? `Write your message… Markdown works.\nOr say what it should say, e.g. “yes, Monday works”, and press ${keyLabel('mod+j')} to draft it in your voice.`
              : 'Write your message… Markdown works.'
        }
        aria-label="Message"
        // Grows with the text (up to most of the window) instead of a resize grip; starts at
        // about 7 lines inline, 12 in the dialog.
        className={`block max-h-[60vh] w-full resize-none [field-sizing:content] bg-transparent ${variant === 'dialog' ? 'min-h-[19.5em]' : 'min-h-[11.5em]'} px-4 py-3 font-body text-[15px] leading-relaxed text-ink outline-none placeholder:text-ink-faint ${drafting ? 'opacity-50' : ''}`}
      />

      {attach.length > 0 && (
        <ul className="flex flex-wrap gap-1.5 px-4 pb-2">
          {attach.map((path) => (
            <li key={path} className="inline-flex items-center gap-1 rounded-ui bg-pane-sunk py-0.5 pr-1 pl-2 text-[12px] text-ink" title={path}>
              📎 {path.split('/').pop()}
              <button type="button" aria-label="Remove attachment" onClick={() => setAttach(attach.filter((a) => a !== path))} className="px-0.5 text-ink-faint hover:text-ink">
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      <footer className="@container flex items-center gap-2 border-t border-rule px-3 py-2 [&>button]:shrink-0 [&>button]:whitespace-nowrap">
        <button
          type="submit"
          disabled={!!busy}
          title={`Send (${keyLabel('mod+enter')})`}
          className="rounded-ui bg-accent px-3.5 py-1.5 text-[13px] font-semibold text-accent-ink hover:opacity-90 disabled:opacity-60"
        >
          {busy === 'send' ? 'Sending…' : 'Send'}
        </button>
        {request.kind !== 'forward' && (
          <button type="button" onClick={() => void saveDraft()} disabled={!!busy} className="rounded-ui px-2.5 py-1.5 text-[13px] text-ink-soft hover:bg-pane-sunk hover:text-ink disabled:opacity-60">
            {draftSaved ? 'Saved to HEY drafts' : busy === 'draft' ? 'Saving…' : 'Save draft'}
          </button>
        )}
        {canAttach && (
          <button
            type="button"
            onClick={async () => setAttach([...new Set([...attach, ...(await api.pickFiles())])])}
            className="rounded-ui px-2.5 py-1.5 text-[13px] text-ink-soft hover:bg-pane-sunk hover:text-ink"
          >
            Attach…
          </button>
        )}
        <span className={`min-w-0 flex-1 truncate text-[12px] ${error ? 'text-danger' : note ? 'text-attn' : 'text-ink-faint'}`}>
          {error ?? note ?? (problem && to.length ? problem : '')}
        </span>
        {canDraft && beforeDraft != null && !drafting && (
          <button type="button" onClick={undoDraft} className="rounded-ui px-2.5 py-1.5 text-[13px] text-ink-soft hover:bg-pane-sunk hover:text-ink">
            Undo
          </button>
        )}
        {canDraft && (
          <button
            type="button"
            onClick={() => void writeDraft()}
            disabled={drafting}
            title={body.trim() ? 'Draft a reply in your voice, following what’s written in the box' : 'Draft a reply in your voice'}
            className="inline-flex items-center gap-1.5 rounded-ui px-2.5 py-1.5 text-[13px] text-ink-soft hover:bg-pane-sunk hover:text-ink disabled:opacity-70"
          >
            {drafting ? <Spinner size={12} /> : <span aria-hidden>✦</span>}
            {drafting ? 'Drafting…' : beforeDraft != null ? 'Redraft' : body.trim() ? 'Draft this' : 'Draft in my voice'}
            {!drafting && <kbd className="font-sans text-[11px] text-ink-faint @max-xl:hidden">{keyLabel('mod+j')}</kbd>}
          </button>
        )}
        <button type="button" onClick={discard} className="rounded-ui px-2.5 py-1.5 text-[13px] text-ink-soft hover:bg-pane-sunk hover:text-danger">
          Discard
        </button>
      </footer>
    </form>
  )
}
