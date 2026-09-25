import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { fuzzyMatch } from '../commands/fuzzy'
import { loadRecent, rank, remember, type Command, type Ranked } from '../commands/model'
import { shortcutCommands } from '../commands/sources'
import { keyLabel } from '../shortcuts'

/**
 * ⌘K: every command that works right now, the boxes, labels for the open thread, and
 * emails from the cache, in one fuzzy-searched list. Each row shows its shortcut so it gets
 * learned. ↑/↓ (or ⌃N/⌃P) move, ↵ runs, Esc closes. In M2 the same bar takes requests.
 *
 * `commands` are the app's own (boxes, labels…); the shortcut commands are read when the
 * bar opens, so they reflect what's on screen. `findEmails` is asked as the query changes.
 */
export function CommandBar({
  commands,
  findEmails,
  onClose,
}: {
  commands: Command[]
  findEmails?: (query: string) => Promise<Command[]>
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [emails, setEmails] = useState<{ query: string; commands: Command[] }>({ query: '', commands: [] })
  const [recent] = useState(loadRecent)
  // What the keys do right now, captured as the bar opens (before it takes the focus).
  const [fromKeys] = useState(() => shortcutCommands())
  const listId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const returnFocus = useRef<Element | null>(typeof document === 'undefined' ? null : document.activeElement)

  // Emails for the query, after a short pause in typing; late answers are dropped.
  useEffect(() => {
    const q = query.trim()
    if (!findEmails || q.length < 2) return
    let stale = false
    const t = setTimeout(() => {
      findEmails(q).then(
        (found) => !stale && setEmails({ query: q, commands: found }),
        () => {},
      )
    }, 90)
    return () => {
      stale = true
      clearTimeout(t)
    }
  }, [query, findEmails])

  const all = useMemo(() => [...fromKeys, ...commands], [fromKeys, commands])
  const results = useMemo(() => {
    const q = query.trim()
    const found = q.length >= 2 && emails.query === q ? emails.commands : []
    const ranked = rank(query, all, recent)
    // Emails come after the commands, as their own group: they're for jumping, not doing. The
    // cache already matched them; they keep its order, newest first, with the letters marked.
    const mail = found.map((command) => ({ command, indices: fuzzyMatch(q, command.title)?.indices ?? [], score: 0 }))
    return [...ranked, ...mail]
  }, [query, all, recent, emails])

  // A new query starts at the top.
  useEffect(() => setActive(0), [query])
  const current = results[Math.min(active, results.length - 1)]

  // Keep the active row in view.
  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [active, results])

  const close = () => {
    onClose()
    // Give the focus back to where it was (unless that's gone), before anything runs.
    if (returnFocus.current instanceof HTMLElement && returnFocus.current.isConnected) returnFocus.current.focus()
  }
  const run = (command: Command) => {
    remember(command.id, recent)
    close()
    // After the bar is gone, so a menu the command opens keeps its focus.
    setTimeout(command.run, 0)
  }

  const onKeyDown = (e: ReactKeyboardEvent) => {
    const move = (d: number) => {
      e.preventDefault()
      if (results.length) setActive((i) => (Math.min(i, results.length - 1) + d + results.length) % results.length)
    }
    if (e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'n')) move(1)
    else if (e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'p')) move(-1)
    else if (e.key === 'Enter') {
      e.preventDefault()
      if (current) run(current.command)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      close()
    } else if (e.key === 'Tab') e.preventDefault() // the focus stays in the bar
  }

  let lastSection = ''
  return (
    <div
      className="fixed inset-0 z-[75] flex items-start justify-center bg-ink/20 px-4 pt-[12vh]"
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <div role="dialog" aria-label="Command bar" className="command-bar rise flex max-h-[min(560px,76vh)] w-full max-w-[600px] flex-col overflow-hidden rounded-ui-lg border border-rule-strong bg-pane">
        <div className="flex items-center gap-2.5 border-b border-rule px-4">
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden className="shrink-0 text-ink-faint">
            <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5" />
            <path d="m10.5 10.5 3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <input
            ref={inputRef}
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Type a command, a box, or an email…"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={current ? `${listId}-${current.command.id}` : undefined}
            aria-autocomplete="list"
            spellCheck={false}
            className="h-12 min-w-0 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-ink-faint"
          />
        </div>

        <div ref={listRef} id={listId} role="listbox" aria-label="Commands" className="scroll min-h-0 flex-1 py-1.5">
          {results.length === 0 && <p className="px-4 py-6 text-center text-[13px] text-ink-faint">Nothing matches “{query.trim()}”.</p>}
          {results.map((r, i) => {
            const header = r.command.section !== lastSection ? r.command.section : null
            lastSection = r.command.section
            return (
              <div key={r.command.id} role="presentation">
                {header && (!query.trim() || header === 'Emails') && <div className="eyebrow px-4 pt-2.5 pb-1">{header}</div>}
                <Row result={r} id={`${listId}-${r.command.id}`} selected={r === current} onHover={() => setActive(i)} onRun={() => run(r.command)} />
              </div>
            )
          })}
        </div>

        <footer className="flex items-center gap-3 border-t border-rule px-4 py-2 text-[11.5px] text-ink-faint">
          <span>
            <kbd>↑</kbd> <kbd>↓</kbd> to move
          </span>
          <span>
            <kbd>↵</kbd> to run
          </span>
          <span className="ml-auto">
            <kbd>esc</kbd> to close
          </span>
        </footer>
      </div>
    </div>
  )
}

function Row({ result, id, selected, onHover, onRun }: { result: Ranked; id: string; selected: boolean; onHover: () => void; onRun: () => void }) {
  const { command, indices } = result
  return (
    <div
      id={id}
      role="option"
      aria-selected={selected}
      // Moving the pointer (not the list scrolling under it) picks a row.
      onMouseMove={selected ? undefined : onHover}
      onMouseDown={(e) => e.preventDefault()} // keep the focus in the input
      onClick={onRun}
      className={`mx-1.5 flex cursor-default items-center gap-3 rounded-ui px-2.5 py-[7px] text-[13.5px] ${selected ? 'bg-selection text-ink' : 'text-ink-soft'}`}
    >
      <span className="min-w-0 flex-1 truncate">
        <Highlighted text={command.title} indices={indices} />
        {command.detail && <span className="ml-2 text-[12.5px] text-ink-faint">{command.detail}</span>}
      </span>
      {command.keys?.length ? (
        <span className="flex shrink-0 gap-1">
          {command.keys.map((k) => (
            <kbd key={k}>{keyLabel(k)}</kbd>
          ))}
        </span>
      ) : null}
    </div>
  )
}

/** The title, with the characters the query matched in the heavier weight. */
function Highlighted({ text, indices }: { text: string; indices: number[] }) {
  if (!indices.length) return <span className="text-ink">{text}</span>
  const hit = new Set(indices)
  const parts: Array<{ text: string; hit: boolean }> = []
  for (let i = 0; i < text.length; i++) {
    const h = hit.has(i)
    const last = parts.at(-1)
    if (last && last.hit === h) last.text += text[i]
    else parts.push({ text: text[i]!, hit: h })
  }
  return (
    <span className="text-ink">
      {parts.map((p, i) =>
        p.hit ? (
          <mark key={i} className="bg-transparent font-semibold text-ink">
            {p.text}
          </mark>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </span>
  )
}
