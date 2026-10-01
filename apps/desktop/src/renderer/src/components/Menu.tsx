import { createContext, useContext, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { splitShortcut } from './Tooltips'
import { useShortcut, withShortcut, type ShortcutId } from '../shortcuts'

/**
 * A button that opens a small menu below it. Closes on outside click, Escape, or when an
 * item calls `close`.
 */
export function Menu({
  label,
  icon,
  children,
  align = 'right',
  shortcut,
  button,
}: {
  label: string
  icon?: ReactNode
  children: (close: () => void) => ReactNode
  align?: 'left' | 'right'
  /** Key that opens (or closes) the menu. */
  shortcut?: ShortcutId
  /** Draws the opening button instead of the toolbar icon (a filter chip, say). */
  button?: (open: boolean, toggle: () => void) => ReactNode
}) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  useShortcut(shortcut ?? 'help', () => setOpen((o) => !o), shortcut != null)

  // Opened from the keyboard or not, focus goes to the first item so arrows work at once.
  useEffect(() => {
    if (open) items(menu.current)[0]?.focus()
  }, [open])

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
      {button ? (
        button(open, () => setOpen(!open))
      ) : (
        <ToolbarButton label={shortcut ? withShortcut(label, shortcut) : label} pressed={open} onClick={() => setOpen(!open)} aria-haspopup="menu">
          {icon}
        </ToolbarButton>
      )}
      {open && (
        <div
          ref={menu}
          role="menu"
          aria-label={label}
          onKeyDown={(e) => moveFocus(e, menu.current)}
          className={`pop-in absolute top-full z-50 mt-1.5 min-w-[200px] rounded-ui-lg border border-rule-strong bg-pane p-1 text-[13px] shadow-[0_12px_32px_-12px_rgba(0,0,0,0.28)] ${
            align === 'right' ? 'right-0' : 'left-0'
          }`}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  )
}

/** The focusable things in a menu, in order: items, checkboxes, and inputs like the date. */
function items(menu: HTMLElement | null): HTMLElement[] {
  return menu ? [...menu.querySelectorAll<HTMLElement>('[role^=menuitem], input')] : []
}

/** ↑/↓ move between items (wrapping); Home/End jump. Enter and Space press the button. */
function moveFocus(e: ReactKeyboardEvent, menu: HTMLElement | null) {
  const list = items(menu)
  if (!list.length || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return
  e.preventDefault()
  const i = list.indexOf(document.activeElement as HTMLElement)
  const next =
    e.key === 'Home' ? 0 : e.key === 'End' ? list.length - 1 : (i + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length
  list[next]!.focus()
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
      {hint && <span className="shrink-0 text-[12px] text-ink-faint">{hint}</span>}
    </button>
  )
}

export function MenuSeparator() {
  return <div className="my-1 h-px bg-rule" />
}

/**
 * Toolbar buttons as words ("Reply Later  L") instead of icons: the Column style's actions,
 * under the email. Menus inside take it too.
 */
export const ToolbarWords = createContext(false)

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
  const words = useContext(ToolbarWords)
  if (words) {
    const { text, key } = splitShortcut(label)
    return (
      <button
        type="button"
        onClick={onClick}
        aria-pressed={pressed}
        className={`no-drag inline-flex items-baseline gap-1.5 rounded-ui px-1.5 py-1 text-[14px] transition-colors ${pressed ? 'bg-pane-sunk text-ink' : 'text-ink-soft hover:text-ink'}`}
        {...rest}
      >
        {text}
        {key && <span className="font-meta text-[11px] text-ink-faint">{key}</span>}
      </button>
    )
  }
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
