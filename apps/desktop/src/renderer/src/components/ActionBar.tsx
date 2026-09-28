import { BubblePicker } from './BubblePicker'
import { BubbleIcon, icon, LabelIcon, MoveIcon, ReplyLaterIcon, SetAsideIcon, TrashIcon } from './icons'
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
export function ActionBar({
  postingId,
  onLeaveBox,
  keys = true,
}: {
  postingId: number
  onLeaveBox: () => void
  /** Whether the keyboard acts on this thread (in a bundle, only the email in focus). */
  keys?: boolean
}) {
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
  const live = ready && keys
  const kind = boxes.data?.find((b) => b.id === p?.boxId)?.kind ?? ''

  // Keys for the open thread; menus (b, m, l) register their own.
  useShortcut('replyLater', () => p && move(kind === 'laterbox' ? 'imbox' : 'laterbox'), live)
  useShortcut('setAside', () => p && move(kind === 'asidebox' ? 'imbox' : 'asidebox'), live)
  useShortcut('toFeed', () => kind !== 'feedbox' && move('feedbox'), live)
  useShortcut('toTrail', () => kind !== 'trailbox' && move('trailbox'), live)
  useShortcut('toggleSeen', () => p && run({ type: 'seen', postingId: p.id, seen: !p.seen }), live)
  useShortcut('trash', () => setConfirmTrash(true), live)

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

      <Menu label="Bubble Up" icon={<BubbleIcon />} shortcut={keys ? 'bubbleMenu' : undefined}>
        {(close) => (
          <>
            <BubblePicker onPick={(when) => (close(), bubble(when))} />
            {(p.bubbledUp || kind === 'bubblebox') && (
              <>
                <MenuSeparator />
                <MenuItem onSelect={() => (close(), run({ type: 'unbubble', postingId: p.id }))}>Cancel bubble up</MenuItem>
              </>
            )}
          </>
        )}
      </Menu>

      <Menu label="Move to…" icon={<MoveIcon />} shortcut={keys ? 'moveMenu' : undefined}>
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

      <Menu label="Labels" icon={<LabelIcon />} shortcut={keys ? 'labelsMenu' : undefined}>
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
            className="pop-in absolute top-full right-0 z-50 mt-1.5 w-[248px] rounded-ui-lg border border-rule-strong bg-pane p-3 text-[13px] shadow-[0_12px_32px_-12px_rgba(0,0,0,0.28)]"
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

const SeenIcon = ({ seen }: { seen: boolean }) =>
  icon(seen ? <><circle cx="8" cy="8" r="3" fill="currentColor" stroke="none" /><circle cx="8" cy="8" r="5.75" /></> : <circle cx="8" cy="8" r="5.75" />)

/** What a bundle-wide action does, waiting for a yes. */
interface Pending {
  /** The question, with `{all}` for which emails: "Set Aside {all}?" */
  question: string
  /** The confirm button: "Set Aside". */
  button: string
  actions: Action[]
  leaves: boolean
  danger?: boolean
}

/**
 * The top bar's actions for a bundle: the same icons as a thread's, acting on every email
 * the bundle holds. Each asks first (it can be many emails), then runs as one batch, so
 * a single undo (z) brings them all back. Keys stay with the email in focus inside.
 */
export function BundleActionBar({ members, sender, onLeaveBox }: { members: PostingRow[]; sender: string; onLeaveBox: () => void }) {
  const boxes = useLive(() => api.boxes(), [])
  const labels = useLive(() => api.labels(), [])
  const [pending, setPending] = useState<Pending | null>(null)

  useEffect(() => {
    if (!pending) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      setPending(null)
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [pending])

  if (!members.length) return null
  const kind = boxes.data?.find((b) => b.id === members[0]!.boxId)?.kind ?? ''
  const n = members.length
  const each = (make: (postingId: number) => Action) => members.map((m) => make(m.id))
  const ask = (question: string, button: string, actions: Action[], leaves: boolean, danger = false) => actions.length && setPending({ question, button, actions, leaves, danger })
  const move = (to: Extract<Action, { type: 'move' }>['to'], question: string, button: string) => ask(question, button, each((postingId) => ({ type: 'move', postingId, to })), true)
  const allSeen = members.every((m) => m.seen)
  const bubbled = members.some((m) => m.bubbledUp) || kind === 'bubblebox'

  const confirm = () => {
    if (!pending) return
    setPending(null)
    if (pending.leaves) onLeaveBox()
    void api.runActions(pending.actions)
  }

  return (
    <div className="no-drag relative flex items-center gap-0.5" role="toolbar" aria-label="Bundle actions">
      {/* Says these act on the bundle, not the open email (which has the same icons). */}
      <span className="mr-1 pl-1 text-[12px] font-medium text-ink-faint tabular-nums" title={`These act on all ${n} emails from ${sender}`}>
        All {n}
      </span>
      <ToolbarButton
        label={kind === 'laterbox' ? 'Remove the whole bundle from Reply Later' : 'Reply Later: the whole bundle'}
        pressed={kind === 'laterbox'}
        onClick={() => (kind === 'laterbox' ? move('imbox', 'Take {all} out of Reply Later?', 'Take out') : move('laterbox', 'Put {all} in Reply Later?', 'Reply Later'))}
      >
        <ReplyLaterIcon />
      </ToolbarButton>
      <ToolbarButton
        label={kind === 'asidebox' ? 'Remove the whole bundle from Set Aside' : 'Set Aside: the whole bundle'}
        pressed={kind === 'asidebox'}
        onClick={() => (kind === 'asidebox' ? move('imbox', 'Take {all} out of Set Aside?', 'Take out') : move('asidebox', 'Set Aside {all}?', 'Set Aside'))}
      >
        <SetAsideIcon />
      </ToolbarButton>

      <Menu label="Bubble Up: the whole bundle" icon={<BubbleIcon />}>
        {(close) => (
          <>
            <BubblePicker
              onPick={(when) => {
                close()
                ask('Bubble up {all}?', 'Bubble up', each((postingId) => ({ type: 'bubble', postingId, when })), when.kind !== 'now')
              }}
            />
            {bubbled && (
              <>
                <MenuSeparator />
                <MenuItem onSelect={() => (close(), ask('Cancel bubbling up {all}?', 'Cancel bubble up', each((postingId) => ({ type: 'unbubble', postingId })), false))}>Cancel bubble up</MenuItem>
              </>
            )}
          </>
        )}
      </Menu>

      <Menu label="Move the whole bundle to…" icon={<MoveIcon />}>
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
                <MenuItem key={k} onSelect={() => (close(), move(k, `Move {all} to ${name}?`, 'Move'))}>
                  {name}
                </MenuItem>
              ))}
          </>
        )}
      </Menu>

      <Menu label="Labels: the whole bundle" icon={<LabelIcon />}>
        {(close) =>
          (labels.data ?? []).length === 0 ? (
            <p className="px-2.5 py-1.5 text-ink-faint">No labels yet. Create them in HEY.</p>
          ) : (
            <div className="scroll max-h-[320px]">
              {(labels.data ?? []).map((l) => {
                // On when every email has it; choosing it again takes it off them all.
                const on = members.every((m) => m.labels.includes(l.name))
                const targets = members.filter((m) => m.labels.includes(l.name) === on)
                return (
                  <MenuItem
                    key={l.id}
                    checked={on}
                    onSelect={() => {
                      close()
                      ask(on ? `Remove “${l.name}” from {all}?` : `Label {all} “${l.name}”?`, on ? 'Remove label' : 'Label', targets.map((m) => ({ type: 'label', postingId: m.id, labelId: l.id, add: !on })), false)
                    }}
                  >
                    {l.name}
                  </MenuItem>
                )
              })}
            </div>
          )
        }
      </Menu>

      <ToolbarButton
        label={allSeen ? 'Mark the whole bundle unseen' : 'Mark the whole bundle seen'}
        onClick={() => ask(allSeen ? 'Mark {all} unseen?' : 'Mark {all} seen?', allSeen ? 'Mark unseen' : 'Mark seen', members.filter((m) => m.seen === allSeen).map((m) => ({ type: 'seen', postingId: m.id, seen: !allSeen })), false)}
      >
        <SeenIcon seen={allSeen} />
      </ToolbarButton>

      <ToolbarButton label="Move the whole bundle to Trash" pressed={pending?.danger} onClick={() => ask('Move {all} to Trash?', 'Move to Trash', each((postingId) => ({ type: 'trash', postingId })), true, true)}>
        <TrashIcon />
      </ToolbarButton>

      {pending && (
        <div
          role="alertdialog"
          aria-label="Confirm for the whole bundle"
          className="pop-in absolute top-full left-0 z-50 mt-1.5 w-[268px] rounded-ui-lg border border-rule-strong bg-pane p-3 text-[13px] shadow-[0_12px_32px_-12px_rgba(0,0,0,0.28)]"
        >
          <p className="text-ink">{pending.question.replace('{all}', `${pending.actions.length === 1 ? 'the 1 email' : `all ${pending.actions.length} emails`} from ${sender}`)}</p>
          <p className="mt-1 text-ink-faint">
            {pending.danger
              ? 'This applies to every email in the bundle. You can restore them from Trash in HEY, but not from here.'
              : `This applies to every email in the bundle${pending.actions.length < n ? ' that needs it' : ''}. Undo (z) brings them all back.`}
          </p>
          <div className="mt-3 flex justify-end gap-1.5">
            <button onClick={() => setPending(null)} className="rounded-ui px-2.5 py-1 text-ink-soft hover:bg-pane-alt">
              Cancel
            </button>
            <button
              autoFocus
              onClick={confirm}
              className={`rounded-ui px-2.5 py-1 font-medium hover:opacity-90 ${pending.danger ? 'bg-danger text-white' : 'bg-accent text-accent-ink'}`}
            >
              {pending.button}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
