import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { dedupe, displayName, formatAddressList, hasRealName, recipientSummaries, type Addr } from '../mail/people'

// Copying works in Electron and browsers; the textarea fallback covers contexts where the
// async clipboard API is refused (e.g. an unfocused window).
async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    const ta = Object.assign(document.createElement('textarea'), { value: text })
    ta.style.cssText = 'position:fixed;opacity:0'
    document.body.append(ta)
    ta.select()
    document.execCommand('copy')
    ta.remove()
  }
}

export function CopyButton({ text, label, className = '' }: { text: string; label: string; className?: string }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 1400)
    return () => clearTimeout(t)
  }, [copied])

  return (
    <button
      type="button"
      onClick={async (e) => {
        e.stopPropagation()
        await copyText(text)
        setCopied(true)
      }}
      aria-label={copied ? 'Copied' : label}
      title={copied ? 'Copied' : label}
      className={`inline-flex size-6 shrink-0 items-center justify-center rounded-ui transition-colors ${
        copied ? 'text-accent' : 'text-ink-faint hover:bg-pane-sunk hover:text-ink'
      } ${className}`}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
      <span className="sr-only" aria-live="polite">
        {copied ? 'Copied' : ''}
      </span>
    </button>
  )
}

/**
 * Opens on hover (after a short delay, so passing the mouse over doesn't flash it) and
 * on click, which pins it open until you click elsewhere or press Escape.
 */
function HoverCard({
  trigger,
  triggerClassName,
  className = '',
  label,
  children,
}: {
  trigger: ReactNode
  triggerClassName: string
  /** Sizing of the wrapper in its flex row (the trigger fills it and truncates). */
  className?: string
  label: string
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [pinned, setPinned] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const root = useRef<HTMLSpanElement>(null)
  const card = useRef<HTMLDivElement>(null)
  const [place, setPlace] = useState<{ left: number; top?: number; bottom?: number } | null>(null)
  const id = useId()

  const schedule = (next: boolean, ms: number) => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setOpen(next), ms)
  }

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (!root.current?.contains(t) && !card.current?.contains(t)) {
        setOpen(false)
        setPinned(false)
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      setOpen(false)
      setPinned(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  useEffect(() => () => clearTimeout(timer.current), [])

  // The card lives on document.body (so later messages, which animate in their own stacking
  // contexts, can't paint over it or clip it), placed under the trigger, or above it near the bottom.
  useLayoutEffect(() => {
    if (!open) return setPlace(null)
    const measure = () => {
      const r = root.current?.getBoundingClientRect()
      if (!r) return
      const h = card.current?.offsetHeight ?? 0
      const w = card.current?.offsetWidth ?? 260
      const left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8))
      const below = window.innerHeight - r.bottom
      setPlace(below < h + 8 && r.top > below ? { left, bottom: window.innerHeight - r.top } : { left, top: r.bottom })
    }
    measure()
    // Once more with the card's real size, then follow scrolling and resizing.
    const frame = requestAnimationFrame(measure)
    window.addEventListener('resize', measure)
    document.addEventListener('scroll', measure, true)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', measure)
      document.removeEventListener('scroll', measure, true)
    }
  }, [open])

  return (
    <span
      ref={root}
      className={`relative inline-flex min-w-0 ${className}`}
      onMouseEnter={() => schedule(true, 280)}
      onMouseLeave={() => !pinned && schedule(false, 180)}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        aria-haspopup="dialog"
        onClick={(e) => {
          e.stopPropagation()
          clearTimeout(timer.current)
          setPinned(true)
          setOpen(true)
        }}
        className={triggerClassName}
      >
        {trigger}
      </button>
      {open &&
        createPortal(
          // The padding bridges the gap so the card stays open while the mouse moves onto it.
          <div
            ref={card}
            id={id}
            role="dialog"
            aria-label={label}
            className={`fixed z-50 select-text ${place?.bottom != null ? 'pb-1.5' : 'pt-1.5'}`}
            style={place ? { left: place.left, top: place.top, bottom: place.bottom } : { left: 0, top: 0, visibility: 'hidden' }}
            // Being over the card, or using something in it, keeps it open.
            onMouseEnter={() => clearTimeout(timer.current)}
            onMouseLeave={() => !pinned && schedule(false, 180)}
            onMouseDown={() => {
              clearTimeout(timer.current)
              setPinned(true)
            }}
          >
            <div className="max-h-[min(420px,calc(100vh-24px))] w-max max-w-[360px] min-w-[260px] overflow-y-auto rounded-ui-lg border border-rule-strong bg-pane p-1.5 text-[13px] font-normal text-ink shadow-[0_12px_32px_-12px_rgba(0,0,0,0.28)]">
              {children}
            </div>
          </div>,
          document.body,
        )}
    </span>
  )
}

export function AddressRow({ person }: { person: Addr }) {
  const showName = hasRealName(person) || person.isMe
  return (
    <div className="group/row flex items-center gap-2 rounded-ui px-2 py-1.5 hover:bg-pane-alt">
      <div className="min-w-0 flex-1">
        {showName && (
          <div className="truncate font-medium text-ink">
            {displayName(person)}
            {person.isMe && <span className="ml-1.5 text-[11px] font-normal text-ink-faint">you</span>}
          </div>
        )}
        <div className="truncate text-[13px] text-ink-soft">{person.email}</div>
      </div>
      <CopyButton
        text={person.email}
        label={`Copy ${person.email}`}
        className="opacity-60 group-hover/row:opacity-100 focus-visible:opacity-100"
      />
    </div>
  )
}

/** A person's name. Hover or click shows their address with a copy button. */
export function PersonChip({ person, className = '' }: { person: Addr; className?: string }) {
  return (
    <HoverCard
      label={`${displayName(person)}, ${person.email}`}
      className={`max-w-[65%] shrink-0 ${className}`}
      triggerClassName="min-w-0 max-w-full truncate rounded-[3px] text-left underline-offset-[3px] decoration-rule-strong hover:underline focus-visible:underline"
      trigger={person.isMe ? 'You' : displayName(person)}
    >
      <AddressRow person={person} />
    </HoverCard>
  )
}

/** "to you, Barender and 3 others". Hover or click lists everyone, each copyable. */
export function RecipientsButton({ to, cc, className = '' }: { to: Addr[]; cc: Addr[]; className?: string }) {
  const summaries = recipientSummaries(to, cc)
  if (!summaries.length) return null
  const everyone = dedupe([...to, ...cc])
  const meFirst = (list: Addr[]) => [...list.filter((p) => p.isMe), ...list.filter((p) => !p.isMe)]
  const groups: Array<[string, Addr[]]> = [
    ['To', meFirst(to)],
    ['Cc', meFirst(cc)],
  ]

  return (
    <HoverCard
      label="Recipients"
      className={`shrink ${className}`}
      triggerClassName="min-w-0 max-w-full truncate rounded-[3px] text-left text-ink-faint hover:text-ink-soft"
      trigger={<FitText variants={summaries} />}
    >
      <div className="scroll max-h-[320px]">
        {groups.map(([label, list]) =>
          list.length ? (
            <section key={label} className="pb-1">
              <h3 className="eyebrow px-2 pt-1.5 pb-0.5">{label}</h3>
              {list.map((p) => (
                <AddressRow key={`${label}-${p.email}`} person={p} />
              ))}
            </section>
          ) : null,
        )}
      </div>
      {everyone.length > 1 && (
        <div className="mt-1 flex items-center justify-between border-t border-rule px-2 pt-1.5 pb-0.5">
          <span className="text-[12px] text-ink-faint">{everyone.length} people</span>
          <CopyAllButton text={formatAddressList(everyone)} />
        </div>
      )}
    </HoverCard>
  )
}

/**
 * The longest of `variants` that fits its truncating parent without being cut ("to you,
 * Dana and 3 others" → "to you +4"); the last is shown cut if nothing fits. Rechecked when
 * the row changes size.
 */
export function FitText({ variants }: { variants: string[] }) {
  const ref = useRef<HTMLSpanElement>(null)
  const [i, setI] = useState(0)
  const key = variants.join('|')
  // New text, or a new width: start again from the longest.
  useLayoutEffect(() => setI(0), [key])
  useLayoutEffect(() => {
    const box = ref.current?.parentElement
    if (box && i < variants.length - 1 && box.scrollWidth > box.clientWidth + 1) setI(i + 1)
  })
  useEffect(() => {
    const row = ref.current?.parentElement?.parentElement?.parentElement
    if (!row || typeof ResizeObserver === 'undefined') return
    let width = row.clientWidth
    const ro = new ResizeObserver(() => {
      if (row.clientWidth !== width) {
        width = row.clientWidth
        setI(0)
      }
    })
    ro.observe(row)
    return () => ro.disconnect()
  }, [])
  return (
    <span ref={ref} title={i > 0 ? variants[0] : undefined}>
      {variants[Math.min(i, variants.length - 1)]}
    </span>
  )
}

function CopyAllButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 1400)
    return () => clearTimeout(t)
  }, [copied])
  return (
    <button
      type="button"
      onClick={async (e) => {
        e.stopPropagation()
        await copyText(text)
        setCopied(true)
      }}
      className={`rounded-ui px-2 py-1 text-[12px] font-medium ${copied ? 'text-accent' : 'text-ink-soft hover:bg-pane-alt hover:text-ink'}`}
    >
      {copied ? 'Copied' : 'Copy all addresses'}
    </button>
  )
}

function CopyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.8" stroke="currentColor" strokeWidth="1.4" />
      <path d="M10.5 3.5v-.3A1.7 1.7 0 0 0 8.8 1.5H3.2a1.7 1.7 0 0 0-1.7 1.7v5.6a1.7 1.7 0 0 0 1.7 1.7h.3" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="m3.5 8.5 3 3 6-7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
