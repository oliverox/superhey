import { useEffect, useRef, useState } from 'react'
import type { ScreenerItem } from '@shared/api'
import { api, useLive } from '../api'
import { useShortcut, withShortcut } from '../shortcuts'
import { Avatar } from './Avatar'

/** Who's waiting in The Screener, kept live (new mail, window focus, and a slow poll refresh it). */
export function useScreener() {
  const list = useLive(() => api.screener(), [], (e) => e.type === 'change' && e.change.kind === 'screener')
  // Returning to the app is a good moment to check for first-time senders.
  useEffect(() => {
    const onFocus = () => void api.refreshScreener().catch(() => {})
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])
  return list.data ?? []
}

/** "Screen 1 first-time sender": only in the Imbox, only while someone is waiting. */
export function ScreenerBanner({ count, onOpen }: { count: number; onOpen: () => void }) {
  if (!count) return null
  return (
    <button onClick={onOpen} title={withShortcut('Open The Screener', 'screener')} className="screener-banner rise mx-3 mt-3 flex items-center justify-center gap-2 rounded-ui-lg px-4 py-2.5 text-[13px] font-medium">
      <ThumbsIcon />
      <span>
        Screen {count} first-time {count === 1 ? 'sender' : 'senders'}
      </span>
    </button>
  )
}

const BOXES = [
  ['imbox', 'Imbox'],
  ['feedbox', 'The Feed'],
  ['trailbox', 'Paper Trail'],
] as const

/**
 * The Screener: each first-time sender, what they sent, and Yes / No / Spam. Choosing one
 * shows their email in the reader (unread; HEY hasn't delivered it). Deciding moves on to
 * the next sender; `onEmpty` fires when nobody is left.
 */
export function ScreenerList({
  items,
  selectedId,
  onSelect,
  onEmpty,
}: {
  items: ScreenerItem[]
  selectedId: number | null
  onSelect: (item: ScreenerItem) => void
  onEmpty: () => void
}) {
  const [busy, setBusy] = useState<number | null>(null)
  const [confirmSpam, setConfirmSpam] = useState<number | null>(null)
  const [error, setError] = useState<{ id: number; message: string } | null>(null)
  const spamButton = useRef<HTMLButtonElement>(null)

  // Opened from the keyboard (!), the confirmation takes focus so Enter confirms.
  useEffect(() => {
    if (confirmSpam != null) spamButton.current?.focus()
  }, [confirmSpam])
  const index = Math.max(0, items.findIndex((i) => i.id === selectedId))
  const selected = items[index] ?? null

  // Keep something selected so the reader shows an email and the keys have a target.
  useEffect(() => {
    if (!items.length) onEmpty()
    else if (!items.some((i) => i.id === selectedId)) onSelect(items[Math.min(index, items.length - 1)]!)
  }, [items, selectedId, index, onEmpty, onSelect])

  const decide = async (item: ScreenerItem, decision: 'approve' | 'deny' | 'spam', box?: (typeof BOXES)[number][0]) => {
    setBusy(item.id)
    setConfirmSpam(null)
    setError(null)
    try {
      const r = await api.runAction({ type: 'screen', clearanceId: item.id, decision, box, name: item.name ?? item.email })
      if (r.status === 'failed') setError({ id: item.id, message: r.error ?? 'HEY refused the decision' })
    } catch (e) {
      // Refused before reaching HEY (e.g. invalid, or decisions switched off in a test instance).
      setError({ id: item.id, message: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(null)
    }
  }

  const step = (d: number) => {
    const next = items[Math.min(Math.max(index + d, 0), items.length - 1)]
    if (next) onSelect(next)
  }
  useShortcut('nextThread', () => step(1), items.length > 0)
  useShortcut('prevThread', () => step(-1), items.length > 0)
  useShortcut('screenYes', () => selected && void decide(selected, 'approve'), !!selected && busy == null)
  useShortcut('screenNo', () => selected && void decide(selected, 'deny'), !!selected && busy == null)
  useShortcut('screenSpam', () => selected && setConfirmSpam(selected.id), !!selected && busy == null)

  return (
    <div className="scroll min-h-0 flex-1">
      <p className="px-5 pt-4 pb-2 text-[12.5px] leading-snug text-ink-faint">These people are emailing you for the first time. Decide whether you want to hear from them.</p>
      <ul>
        {items.map((item) => {
          const active = item.id === selected?.id
          return (
            <li key={item.id} className={`mx-2 rounded-ui ${active ? 'bg-selection' : 'hover:bg-pane-sunk'}`}>
              <button onClick={() => onSelect(item)} className="flex w-full items-center gap-3 py-2.5 pr-3 pl-4 text-left" aria-current={active}>
                <Avatar avatar={{ url: null, color: null, initials: initials(item.name ?? item.email) }} seed={item.email} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-1.5">
                    <span className="truncate font-semibold text-ink">{item.name ?? item.email}</span>
                    {item.name && <span className="truncate text-[12px] text-ink-faint">{item.email}</span>}
                  </span>
                  <span className="mt-0.5 block truncate text-[12.5px] text-ink-soft">
                    {item.subject ?? '(no subject)'}
                    {item.summary && <span className="text-ink-faint"> – {item.summary}</span>}
                  </span>
                </span>
              </button>
              {active && (
                <div className="flex flex-wrap items-center gap-1.5 px-4 pb-3 pl-[64px]">
                  {confirmSpam === item.id ? (
                    <>
                      <span className="mr-1 text-[12px] text-ink-soft">Mark as spam? This also trains HEY's filter.</span>
                      <DecisionButton onClick={() => void decide(item, 'spam')} tone="danger" buttonRef={spamButton}>
                        Mark as spam
                      </DecisionButton>
                      <DecisionButton onClick={() => setConfirmSpam(null)}>Cancel</DecisionButton>
                    </>
                  ) : (
                    <>
                      <YesButton disabled={busy === item.id} onYes={(box) => void decide(item, 'approve', box)} />
                      <DecisionButton onClick={() => void decide(item, 'deny')} disabled={busy === item.id} title={withShortcut('No', 'screenNo')}>
                        No
                      </DecisionButton>
                      <DecisionButton onClick={() => setConfirmSpam(item.id)} disabled={busy === item.id} tone="danger" title={withShortcut('Spam', 'screenSpam')}>
                        Spam
                      </DecisionButton>
                    </>
                  )}
                  {error?.id === item.id && <p className="basis-full pt-1 text-[12px] text-danger">Couldn't do that: {error.message.replace(/^Error invoking remote method 'api': Error: /, '')}</p>}
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/** Yes, with a small menu for where their mail should go. */
function YesButton({ onYes, disabled }: { onYes: (box: (typeof BOXES)[number][0]) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <span className="relative inline-flex">
      <DecisionButton onClick={() => onYes('imbox')} disabled={disabled} tone="accent" title={withShortcut('Yes (to the Imbox)', 'screenYes')} joined="left">
        Yes
      </DecisionButton>
      <DecisionButton onClick={() => setOpen(!open)} disabled={disabled} tone="accent" joined="right" title="Yes, into…">
        ▾
      </DecisionButton>
      {open && (
        <span role="menu" className="absolute top-full left-0 z-40 mt-1 min-w-[160px] rounded-ui-lg border border-rule-strong bg-pane p-1 shadow-[0_12px_32px_-12px_rgba(0,0,0,0.28)]">
          {BOXES.map(([box, name]) => (
            <button
              key={box}
              role="menuitem"
              onClick={() => {
                setOpen(false)
                onYes(box)
              }}
              className="block w-full rounded-ui px-2.5 py-1.5 text-left text-[13px] text-ink hover:bg-pane-alt"
            >
              Yes, into {name}
            </button>
          ))}
        </span>
      )}
    </span>
  )
}

function DecisionButton({
  children,
  onClick,
  disabled,
  tone,
  title,
  joined,
  buttonRef,
}: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
  tone?: 'accent' | 'danger'
  title?: string
  joined?: 'left' | 'right'
  buttonRef?: React.RefObject<HTMLButtonElement | null>
}) {
  const colors =
    tone === 'accent' ? 'bg-accent-wash text-accent hover:bg-accent hover:text-accent-ink' : tone === 'danger' ? 'bg-danger/10 text-danger hover:bg-danger hover:text-white' : 'bg-pane-sunk text-ink-soft hover:text-ink'
  const shape = joined === 'left' ? 'rounded-l-ui rounded-r-none' : joined === 'right' ? 'rounded-r-ui rounded-l-none border-l border-pane px-2' : 'rounded-ui'
  return (
    <button ref={buttonRef} onClick={onClick} disabled={disabled} title={title} className={`px-3 py-1 text-[12.5px] font-semibold transition-colors disabled:opacity-50 ${colors} ${shape}`}>
      {children}
    </button>
  )
}

const initials = (s: string) =>
  s
    .replace(/[^\p{L}\p{N} ]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('') || '?'

function ThumbsIcon() {
  return (
    <svg width="26" height="14" viewBox="0 0 26 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M2 6.5h2.2v6H2zM4.2 6.8 6.8 2.4a1.1 1.1 0 0 1 2 .7L8.3 5.8h3a1.2 1.2 0 0 1 1.2 1.4l-.8 4.3a1.3 1.3 0 0 1-1.3 1H4.2" />
      <path d="M24 7.5h-2.2v-6H24zM21.8 7.2l-2.6 4.4a1.1 1.1 0 0 1-2-.7l.5-2.7h-3a1.2 1.2 0 0 1-1.2-1.4l.8-4.3a1.3 1.3 0 0 1 1.3-1h6.2" />
    </svg>
  )
}
