import { useEffect, useRef, useState, type ReactNode } from 'react'

/**
 * A button that opens a small menu below it. Closes on outside click, Escape, or when an
 * item calls `close`.
 */
export function Menu({
  label,
  icon,
  children,
  align = 'right',
}: {
  label: string
  icon: ReactNode
  children: (close: () => void) => ReactNode
  align?: 'left' | 'right'
}) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setOpen(false)
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  return (
    <div ref={root} className="no-drag relative">
      <ToolbarButton label={label} pressed={open} onClick={() => setOpen(!open)} aria-haspopup="menu">
        {icon}
      </ToolbarButton>
      {open && (
        <div
          role="menu"
          aria-label={label}
          className={`absolute top-full z-50 mt-1.5 min-w-[200px] rounded-ui-lg border border-rule-strong bg-pane p-1 text-[13px] shadow-[0_12px_32px_-12px_rgba(0,0,0,0.28)] ${
            align === 'right' ? 'right-0' : 'left-0'
          }`}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  )
}

export function MenuItem({
  children,
  onSelect,
  checked,
  hint,
  danger,
}: {
  children: ReactNode
  onSelect: () => void
  checked?: boolean
  hint?: string
  danger?: boolean
}) {
  return (
    <button
      role={checked == null ? 'menuitem' : 'menuitemcheckbox'}
      aria-checked={checked}
      onClick={onSelect}
      className={`flex w-full items-center gap-2 rounded-ui px-2.5 py-1.5 text-left hover:bg-pane-alt ${danger ? 'text-danger' : 'text-ink'}`}
    >
      {checked != null && (
        <span className={`flex size-3.5 shrink-0 items-center justify-center rounded-[3px] border ${checked ? 'border-accent bg-accent text-accent-ink' : 'border-rule-strong'}`}>
          {checked && (
            <svg width="9" height="9" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path d="m3.5 8.5 3 3 6-7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </span>
      )}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {hint && <span className="shrink-0 text-[11.5px] text-ink-faint">{hint}</span>}
    </button>
  )
}

export function MenuSeparator() {
  return <div className="my-1 h-px bg-rule" />
}

export function ToolbarButton({
  label,
  pressed,
  children,
  onClick,
  ...rest
}: {
  label: string
  pressed?: boolean
  children: ReactNode
  onClick: () => void
  'aria-haspopup'?: 'menu'
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      className={`no-drag flex size-7 items-center justify-center rounded-ui transition-colors ${
        pressed ? 'bg-pane-sunk text-ink' : 'text-ink-faint hover:bg-pane-sunk hover:text-ink'
      }`}
      {...rest}
    >
      {children}
    </button>
  )
}
