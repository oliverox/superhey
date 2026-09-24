import { useEffect, useState } from 'react'
import type { Action, PostingRow } from '@shared/api'
import { api, useLive } from '../api'
import { useShortcut, withShortcut } from '../shortcuts'
import { Menu, MenuItem, MenuSeparator, ToolbarButton } from './Menu'

/**
 * Actions for the open thread, in the reader's top bar. Each runs through the action
 * layer (verified, logged, undoable); `onLeaveBox` lets the list move on to the next thread
 * when this one leaves the box being viewed.
 */
export function ActionBar({ postingId, onLeaveBox }: { postingId: number; onLeaveBox: () => void }) {
  const posting = useLive(
    () => api.posting(postingId),
    [postingId],
    (e) => e.type === 'change' && e.change.kind === 'postings',
  )
  const boxes = useLive(() => api.boxes(), [])
  const labels = useLive(() => api.labels(), [])
  const [confirmTrash, setConfirmTrash] = useState(false)

  // Esc backs out of the Trash confirmation (before anything else sees the key).
  useEffect(() => {
    if (!confirmTrash) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      setConfirmTrash(false)
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [confirmTrash])

  const p = posting.data
  const ready = !!p && !p.isBundle
  const kind = boxes.data?.find((b) => b.id === p?.boxId)?.kind ?? ''

  // Keys for the open thread; menus (b, m, l) register their own.
  useShortcut('replyLater', () => p && move(kind === 'laterbox' ? 'imbox' : 'laterbox'), ready)
  useShortcut('setAside', () => p && move(kind === 'asidebox' ? 'imbox' : 'asidebox'), ready)
  useShortcut('toFeed', () => kind !== 'feedbox' && move('feedbox'), ready)
  useShortcut('toTrail', () => kind !== 'trailbox' && move('trailbox'), ready)
  useShortcut('toggleSeen', () => p && run({ type: 'seen', postingId: p.id, seen: !p.seen }), ready)
  useShortcut('trash', () => setConfirmTrash(true), ready)

  if (!p || !ready) return null
  function run(action: Action, leaves = false) {
    if (leaves) onLeaveBox()
    void api.runAction(action)
  }
  function move(to: Extract<Action, { type: 'move' }>['to']) {
    if (p) run({ type: 'move', postingId: p.id, to }, true)
  }
  const bubble = (when: Extract<Action, { type: 'bubble' }>['when']) => run({ type: 'bubble', postingId: p.id, when }, when.kind !== 'now')

  return (
    <div className="no-drag flex items-center gap-0.5" role="toolbar" aria-label="Thread actions">
      <ToolbarButton
        label={withShortcut(kind === 'laterbox' ? 'Remove from Reply Later' : 'Reply Later', 'replyLater')}
        pressed={kind === 'laterbox'}
        onClick={() => move(kind === 'laterbox' ? 'imbox' : 'laterbox')}
      >
        <ReplyLaterIcon />
      </ToolbarButton>
      <ToolbarButton
        label={withShortcut(kind === 'asidebox' ? 'Remove from Set Aside' : 'Set Aside', 'setAside')}
        pressed={kind === 'asidebox'}
        onClick={() => move(kind === 'asidebox' ? 'imbox' : 'asidebox')}
      >
        <SetAsideIcon />
      </ToolbarButton>

      <Menu label="Bubble Up" icon={<BubbleIcon />} shortcut="bubbleMenu">
        {(close) => (
          <>
            <MenuItem onSelect={() => (close(), bubble({ kind: 'now' }))}>Now</MenuItem>
            <MenuItem onSelect={() => (close(), bubble({ kind: 'tomorrow' }))} hint="morning">
              Tomorrow
            </MenuItem>
            <MenuItem onSelect={() => (close(), bubble({ kind: 'weekend' }))} hint="Saturday">
              This weekend
            </MenuItem>
            <MenuItem onSelect={() => (close(), bubble({ kind: 'next-week' }))} hint="Monday">
              Next week
            </MenuItem>
            <label className="flex items-center gap-2 rounded-ui px-2.5 py-1.5 hover:bg-pane-alt">
              <span className="flex-1">On a date…</span>
              <input
                type="date"
                min={new Date().toISOString().slice(0, 10)}
                onChange={(e) => {
                  if (!e.target.value) return
                  close()
                  bubble({ kind: 'on', date: e.target.value })
                }}
                className="rounded-[4px] border border-rule-strong bg-pane px-1 text-[12px] text-ink"
              />
            </label>
            {(p.bubbledUp || kind === 'bubblebox') && (
              <>
                <MenuSeparator />
                <MenuItem onSelect={() => (close(), run({ type: 'unbubble', postingId: p.id }))}>Cancel bubble up</MenuItem>
              </>
            )}
          </>
        )}
      </Menu>

      <Menu label="Move to…" icon={<MoveIcon />} shortcut="moveMenu">
        {(close) => (
          <>
            {(
              [
                ['imbox', 'Imbox'],
                ['feedbox', 'The Feed'],
                ['trailbox', 'Paper Trail'],
              ] as const
            )
              .filter(([k]) => k !== kind)
              .map(([k, name]) => (
                <MenuItem key={k} onSelect={() => (close(), move(k))}>
                  {name}
                </MenuItem>
              ))}
          </>
        )}
      </Menu>

      <Menu label="Labels" icon={<LabelIcon />} shortcut="labelsMenu">
        {() =>
          (labels.data ?? []).length === 0 ? (
            <p className="px-2.5 py-1.5 text-ink-faint">No labels yet. Create them in HEY.</p>
          ) : (
            <div className="scroll max-h-[320px]">
              {(labels.data ?? []).map((l) => {
                const on = p.labels.includes(l.name)
                return (
                  <MenuItem key={l.id} checked={on} onSelect={() => run({ type: 'label', postingId: p.id, labelId: l.id, add: !on })}>
                    {l.name}
                  </MenuItem>
                )
              })}
            </div>
          )
        }
      </Menu>

      <ToolbarButton label={withShortcut(p.seen ? 'Mark unseen' : 'Mark seen', 'toggleSeen')} onClick={() => run({ type: 'seen', postingId: p.id, seen: !p.seen })}>
        <SeenIcon seen={p.seen} />
      </ToolbarButton>

      <div className="relative">
        <ToolbarButton label={withShortcut('Move to Trash', 'trash')} pressed={confirmTrash} onClick={() => setConfirmTrash(!confirmTrash)}>
          <TrashIcon />
        </ToolbarButton>
        {confirmTrash && (
          <div
            role="alertdialog"
            aria-label="Confirm trash"
            className="absolute top-full right-0 z-50 mt-1.5 w-[248px] rounded-ui-lg border border-rule-strong bg-pane p-3 text-[12.5px] shadow-[0_12px_32px_-12px_rgba(0,0,0,0.28)]"
          >
            <p className="text-ink">Move this thread to Trash?</p>
            <p className="mt-1 text-ink-faint">You can restore it from Trash in HEY, but not from here.</p>
            <div className="mt-3 flex justify-end gap-1.5">
              <button onClick={() => setConfirmTrash(false)} className="rounded-ui px-2.5 py-1 text-ink-soft hover:bg-pane-alt">
                Cancel
              </button>
              <button
                autoFocus
                onClick={() => {
                  setConfirmTrash(false)
                  run({ type: 'trash', postingId: p.id }, true)
                }}
                className="rounded-ui bg-danger px-2.5 py-1 font-medium text-white hover:opacity-90"
              >
                Move to Trash
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// 16px line icons, drawn to match the rest of the UI.
const icon = (d: React.ReactNode) => (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {d}
  </svg>
)
const ReplyLaterIcon = () => icon(<><circle cx="8" cy="8" r="5.75" /><path d="M8 5v3l2 1.5" /></>)
const SetAsideIcon = () => icon(<path d="M4.5 2.5h7v11L8 11l-3.5 2.5z" />)
const BubbleIcon = () => icon(<><path d="M8 12.5v-8" /><path d="m4.5 7.5 3.5-3.5 3.5 3.5" /><path d="M3.5 14h9" /></>)
const MoveIcon = () => icon(<><path d="M2.5 5.5h11v7a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1z" /><path d="M2.5 5.5 4 2.5h8l1.5 3" /><path d="M8 7.5v4M6 9.5l2 2 2-2" /></>)
const LabelIcon = () => icon(<><path d="M2.5 3.5v4l6 6 5-5-6-6h-4a1 1 0 0 0-1 1z" /><circle cx="5.5" cy="5.5" r=".8" fill="currentColor" /></>)
const TrashIcon = () => icon(<><path d="M3 4.5h10" /><path d="M6 4.5v-2h4v2" /><path d="M4.5 4.5l.6 8.6a1 1 0 0 0 1 .9h3.8a1 1 0 0 0 1-.9l.6-8.6" /></>)
const SeenIcon = ({ seen }: { seen: boolean }) =>
  icon(seen ? <><circle cx="8" cy="8" r="3" fill="currentColor" stroke="none" /><circle cx="8" cy="8" r="5.75" /></> : <circle cx="8" cy="8" r="5.75" />)
