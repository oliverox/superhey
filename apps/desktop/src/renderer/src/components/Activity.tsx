import { useCallback, useEffect, useRef, useState } from 'react'
import type { ActionRecord, OutgoingRecord } from '@shared/api'
import { api, onApiEvent, useLive } from '../api'
import { dayAndTime } from '../format'

const TOAST_MS = 6000
const FAILED_TOAST_MS = 9000

/** A note's height in the stack, and the gap between notes when it's fanned out. */
const NOTE_H = 44
const NOTE_GAP = 8
/** Notes kept at once; the stack shows the newest and two peeking behind it. */
const KEPT = 5
const PEEKING = 2
const LEAVE_MS = 200

/**
 * Bottom-centre notes for actions you take: what happened, with Undo; or why it didn't.
 * Automatic actions (seen-on-open) stay silent. Several stack into one: the newest in front,
 * two older ones peeking behind it, and hovering fans them all out (and holds them there).
 */
export function Toasts() {
  const [toasts, setToasts] = useState<ActionRecord[]>([])
  const [outgoing, setOutgoing] = useState<OutgoingRecord[]>([])
  const [leaving, setLeaving] = useState<ReadonlySet<string>>(() => new Set())
  const [open, setOpen] = useState(false)
  const hovered = useRef(false)
  const order = useRef(new Map<string, number>())
  const seq = useRef(0)
  const arrive = (key: string) => {
    if (!order.current.has(key)) order.current.set(key, ++seq.current)
  }

  // Fades a note out, then drops it.
  const dismiss = useCallback((key: string) => {
    setLeaving((l) => new Set([...l, key]))
    setTimeout(() => {
      if (key.startsWith('out-')) setOutgoing((list) => list.filter((o) => `out-${o.id}` !== key))
      else setToasts((list) => list.filter((t) => `act-${t.id}` !== key))
      setLeaving((l) => new Set([...l].filter((k) => k !== key)))
      order.current.delete(key)
    }, LEAVE_MS)
  }, [])
  // Its time is up, unless you're reading the stack: then a little later.
  const expire = useCallback(
    (key: string, ms: number) => {
      const tick = () => (hovered.current ? setTimeout(tick, 1500) : dismiss(key))
      setTimeout(tick, ms)
    },
    [dismiss],
  )

  // Messages in their undo window, then "Sent" or the reason they failed.
  useEffect(
    () =>
      onApiEvent((e) => {
        if (e.type !== 'outgoing') return
        const r = e.record
        arrive(`out-${r.id}`)
        setOutgoing((list) => [...list.filter((o) => o.id !== r.id), r].filter((o) => o.status !== 'cancelled').slice(-KEPT))
        if (r.status === 'sent') expire(`out-${r.id}`, 4000)
      }),
    [expire],
  )

  useEffect(
    () =>
      onApiEvent((e) => {
        if (e.type !== 'action') return
        const a = e.action
        if (a.source === 'auto' || a.status === 'running') return
        // An undo's own steps are summarised by the "undone" update of the original.
        if (a.source === 'undo') return
        arrive(`act-${a.id}`)
        setToasts((list) => [...list.filter((t) => t.id !== a.id), a].slice(-KEPT))
        expire(`act-${a.id}`, a.status === 'failed' ? FAILED_TOAST_MS : TOAST_MS)
      }),
    [expire],
  )

  const notes = [
    ...outgoing.map((o) => ({ key: `out-${o.id}`, node: <OutgoingToast record={o} onClose={() => dismiss(`out-${o.id}`)} /> })),
    ...toasts.map((t) => ({ key: `act-${t.id}`, node: <Toast record={t} onClose={() => dismiss(`act-${t.id}`)} /> })),
  ]
    // Newest first: it's the one in front.
    .sort((a, b) => (order.current.get(b.key) ?? 0) - (order.current.get(a.key) ?? 0))
  if (!notes.length) return null
  const fanned = open && notes.length > 1
  const height = fanned ? notes.length * NOTE_H + (notes.length - 1) * NOTE_GAP : NOTE_H + Math.min(notes.length - 1, PEEKING) * NOTE_GAP
  return (
    <section
      aria-live="polite"
      aria-label="Notifications"
      onMouseEnter={() => ((hovered.current = true), setOpen(true))}
      onMouseLeave={() => ((hovered.current = false), setOpen(false))}
      className="fixed bottom-5 left-1/2 z-[60] w-[min(480px,calc(100vw-32px))] -translate-x-1/2 transition-[height] duration-(--dur-2) ease-out"
      style={{ height }}
    >
      {notes.map((n, i) => {
        const gone = leaving.has(n.key)
        const hidden = !fanned && i > PEEKING
        const y = fanned ? -i * (NOTE_H + NOTE_GAP) : -i * NOTE_GAP
        const scale = fanned ? 1 : 1 - i * 0.04
        return (
          <div
            key={n.key}
            className="absolute inset-x-0 bottom-0 transition-[transform,opacity] duration-(--dur-2) ease-out"
            style={{
              height: NOTE_H,
              zIndex: notes.length - i,
              transform: `translateY(${gone ? y + 10 : y}px) scale(${scale})`,
              transformOrigin: 'bottom center',
              opacity: gone || hidden ? 0 : 1,
              pointerEvents: gone || hidden ? 'none' : undefined,
            }}
          >
            {/* Behind the front note, only its edge shows: no text to read through. */}
            <div className={`toast-in h-full transition-opacity duration-(--dur-1) ${!fanned && i > 0 ? '[&>*>*]:opacity-0' : ''}`}>{n.node}</div>
          </div>
        )
      })}
    </section>
  )
}

/** A note's paper: white like the messages, with ink text; a failure says so in red. */
const noteCard = (failed: boolean) =>
  `flex h-full items-center gap-3 rounded-ui-lg border border-rule-strong pr-2 pl-4 text-[13px] shadow-[0_2px_6px_-2px_rgba(0,0,0,0.12),0_14px_32px_-14px_rgba(0,0,0,0.35)] ${failed ? 'text-danger' : 'text-ink'}`
const noteStyle = { background: 'var(--msg, var(--pane))' }
const noteButton = 'shrink-0 rounded-ui px-2 py-1 text-[13px] font-semibold text-ink hover:bg-pane-sunk disabled:opacity-60'
const closeButton = 'flex size-7 shrink-0 items-center justify-center rounded-ui text-ink-faint hover:bg-pane-sunk hover:text-ink'
const Cross = () => (
  <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
    <path d="m4 4 8 8M12 4l-8 8" />
  </svg>
)

function Toast({ record: r, onClose }: { record: ActionRecord; onClose: () => void }) {
  const [undoing, setUndoing] = useState(false)
  const [undoError, setUndoError] = useState<string | null>(null)
  const failed = r.status === 'failed'
  const text = failed ? `Couldn't do that: ${r.error ?? 'unknown error'}` : r.status === 'undone' ? `Undone: ${r.summary}` : r.summary

  return (
    <div role="status" className={noteCard(failed || undoError != null)} style={noteStyle}>
      <span className="min-w-0 flex-1 truncate" title={undoError ?? text}>{undoError ?? text}</span>
      {r.verified === null && r.status === 'done' && (
        <span className="shrink-0 text-[12px] text-ink-faint" title="HEY accepted it, but the app couldn't confirm it in the box yet">
          unconfirmed
        </span>
      )}
      {r.canUndo && (
        <button
          disabled={undoing}
          onClick={async () => {
            setUndoing(true)
            try {
              await api.undoAction(r.id)
            } catch (e) {
              setUndoError(e instanceof Error ? e.message : String(e))
            } finally {
              setUndoing(false)
            }
          }}
          className={noteButton}
        >
          {undoing ? 'Undoing…' : 'Undo'}
        </button>
      )}
      <button onClick={onClose} aria-label="Dismiss" className={closeButton}>
        <Cross />
      </button>
    </div>
  )
}

/** Everything you (and later, agents and rules) did, newest first, each undoable if possible. */
export function ActivityDrawer({ onClose }: { onClose: () => void }) {
  const log = useLive(() => api.recentActions(100), [], (e) => e.type === 'action')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-ink/20" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside aria-label="Activity" className="drawer-in flex h-full w-[400px] flex-col border-l border-rule-strong bg-pane shadow-[-16px_0_40px_-24px_rgba(0,0,0,0.35)]">
        <header className="drag flex h-[52px] shrink-0 items-center border-b border-rule px-5">
          <h2 className="text-[15px] font-semibold">Activity</h2>
          <button onClick={onClose} aria-label="Close activity" className="no-drag ml-auto rounded-ui px-2 py-1 text-ink-faint hover:bg-pane-sunk hover:text-ink">
            ✕
          </button>
        </header>
        <ol className="scroll min-h-0 flex-1 px-3 py-3">
          {log.data?.length === 0 && <p className="px-2 py-8 text-center text-ink-faint">Nothing yet. Actions you take appear here.</p>}
          {log.data?.map((a) => <ActivityRow key={a.id} record={a} />)}
        </ol>
      </aside>
    </div>
  )
}

const STATUS: Record<ActionRecord['status'], { label: string; dot: string }> = {
  running: { label: 'Working…', dot: 'bg-new pulse' },
  done: { label: 'Done', dot: 'bg-accent' },
  failed: { label: 'Failed', dot: 'bg-danger' },
  undone: { label: 'Undone', dot: 'bg-rule-strong' },
}

function ActivityRow({ record: a }: { record: ActionRecord }) {
  const [error, setError] = useState<string | null>(null)
  const { day, time } = dayAndTime(a.createdAt)
  const s = STATUS[a.status]
  return (
    <li className="group flex gap-3 rounded-ui px-2 py-2.5 hover:bg-pane-alt">
      <span className={`mt-[7px] size-1.5 shrink-0 rounded-full ${s.dot}`} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className={`text-[13px] leading-snug ${a.status === 'undone' ? 'text-ink-faint line-through' : 'text-ink'}`}>{a.summary}</p>
        <p className="mt-0.5 text-[12px] text-ink-faint">
          {s.label}
          {a.source === 'undo' && ' · undo'}
          {a.verified === null && a.status === 'done' && ' · unconfirmed'}
          {' · '}
          {day}, {time}
        </p>
        {(a.error || error) && <p className="mt-0.5 text-[12px] text-danger">{error ?? a.error}</p>}
      </div>
      {a.canUndo && (
        <button
          onClick={() => api.undoAction(a.id).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))}
          className="h-fit shrink-0 rounded-ui px-2 py-1 text-[12px] font-medium text-ink-soft hover:bg-pane-sunk hover:text-ink"
        >
          Undo
        </button>
      )}
    </li>
  )
}

const KIND_WORDS: Record<OutgoingRecord['kind'], string> = { new: 'message', reply: 'reply', 'reply-all': 'reply', forward: 'forward' }

/** "Sending your reply in 4s · Undo", then "Sent", or why it failed with a way back to edit. */
function OutgoingToast({ record: r, onClose }: { record: OutgoingRecord; onClose: () => void }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (r.status !== 'pending') return
    const t = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(t)
  }, [r.status])

  const reopen = (message = r.message) =>
    window.dispatchEvent(new CustomEvent('superhey:compose', { detail: { kind: r.kind, message, forwardOf: r.forwardOf } }))
  const failed = r.status === 'failed'
  const seconds = Math.max(0, Math.ceil((r.sendsAt - now) / 1000))
  const what = KIND_WORDS[r.kind]
  const text =
    r.status === 'pending' ? `Sending your ${what} in ${seconds}s` : r.status === 'sending' ? `Sending your ${what}…` : r.status === 'sent' ? `Your ${what} was sent` : `Couldn't send your ${what}: ${r.error ?? 'unknown error'}`

  return (
    <div role="status" className={noteCard(failed)} style={noteStyle}>
      <span className="min-w-0 flex-1 truncate" title={text}>{text}</span>
      {r.status === 'pending' && (
        <button
          onClick={async () => {
            try {
              const back = await api.cancelSend(r.id)
              reopen(back.message)
              onClose()
            } catch {
              // too late: it's already on its way
            }
          }}
          className={noteButton}
        >
          Undo
        </button>
      )}
      {failed && (
        <button onClick={() => (reopen(), onClose())} className={noteButton}>
          Edit
        </button>
      )}
      {r.status !== 'pending' && r.status !== 'sending' && (
        <button onClick={onClose} aria-label="Dismiss" className={closeButton}>
          <Cross />
        </button>
      )}
    </div>
  )
}
