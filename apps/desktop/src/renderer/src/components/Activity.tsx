import { useEffect, useState } from 'react'
import type { ActionRecord } from '@shared/api'
import { api, onApiEvent, useLive } from '../api'
import { dayAndTime } from '../format'

const TOAST_MS = 6000
const FAILED_TOAST_MS = 9000

/**
 * Bottom-centre notes for actions you take: what happened, with Undo; or why it didn't.
 * Automatic actions (seen-on-open) stay silent.
 */
export function Toasts() {
  const [toasts, setToasts] = useState<ActionRecord[]>([])

  useEffect(
    () =>
      onApiEvent((e) => {
        if (e.type !== 'action') return
        const a = e.action
        if (a.source === 'auto' || a.status === 'running') return
        // An undo's own steps are summarised by the "undone" update of the original.
        if (a.source === 'undo') return
        setToasts((list) => [...list.filter((t) => t.id !== a.id), a].slice(-3))
        setTimeout(() => setToasts((list) => list.filter((t) => t.id !== a.id)), a.status === 'failed' ? FAILED_TOAST_MS : TOAST_MS)
      }),
    [],
  )

  if (!toasts.length) return null
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-5 z-[60] flex flex-col items-center gap-2" aria-live="polite">
      {toasts.map((t) => (
        <Toast key={t.id} record={t} onClose={() => setToasts((list) => list.filter((x) => x.id !== t.id))} />
      ))}
    </div>
  )
}

function Toast({ record: r, onClose }: { record: ActionRecord; onClose: () => void }) {
  const [undoing, setUndoing] = useState(false)
  const [undoError, setUndoError] = useState<string | null>(null)
  const failed = r.status === 'failed'
  const text = failed ? `Couldn't do that: ${r.error ?? 'unknown error'}` : r.status === 'undone' ? `Undone: ${r.summary}` : r.summary

  return (
    <div
      role="status"
      className={`rise pointer-events-auto flex max-w-[560px] items-center gap-3 rounded-ui-lg px-4 py-2.5 text-[13px] shadow-[0_12px_32px_-12px_rgba(0,0,0,0.4)] ${
        failed ? 'bg-danger text-white' : 'bg-ink text-pane'
      }`}
    >
      <span className="min-w-0 flex-1 truncate">{undoError ?? text}</span>
      {r.verified === null && r.status === 'done' && (
        <span className="shrink-0 text-[11.5px] opacity-70" title="HEY accepted it, but the app couldn't confirm it in the box yet">
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
          className="shrink-0 rounded-ui px-2 py-0.5 font-semibold underline-offset-2 hover:underline disabled:opacity-60"
        >
          {undoing ? 'Undoing…' : 'Undo'}
        </button>
      )}
      <button onClick={onClose} aria-label="Dismiss" className="shrink-0 opacity-60 hover:opacity-100">
        ✕
      </button>
    </div>
  )
}

/** Everything you (and later, agents and rules) did, newest first, each undoable if possible. */
export function ActivityDrawer({ onClose }: { onClose: () => void }) {
  const log = useLive(() => api.recentActions(100), [], (e) => e.type === 'action')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-ink/20" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside aria-label="Activity" className="rise flex h-full w-[400px] flex-col border-l border-rule-strong bg-pane shadow-[-16px_0_40px_-24px_rgba(0,0,0,0.35)]">
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
        <p className="mt-0.5 text-[11.5px] text-ink-faint">
          {s.label}
          {a.source === 'undo' && ' · undo'}
          {a.verified === null && a.status === 'done' && ' · unconfirmed'}
          {' · '}
          {day}, {time}
        </p>
        {(a.error || error) && <p className="mt-0.5 text-[11.5px] text-danger">{error ?? a.error}</p>}
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
