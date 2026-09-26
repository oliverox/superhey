import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import { OPERATORS, operatorValue, withOperator, type Operator } from '@superhey/core/search/query'
import type { HeySearchPage, PostingRow } from '@shared/api'
import { api, useLive } from '../api'
import { accept, clearSearches, completing, forgetSearch, mergeResults, OPERATOR_HELP, recentSearches, suggestions, type Suggestion } from '../mail/search'
import { Menu, MenuItem, MenuSeparator } from './Menu'
import { PostingList } from './Lists'

/** `value`, once it has stopped changing for `ms`. */
export function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return settled
}

/**
 * The search box: grows to the width of the list while in use, completes operators as you
 * type (from: suggests people, has: the kinds of file…) and lists them when empty.
 * ↓ or Enter moves on to the results.
 */
export function SearchField({
  value,
  onChange,
  inputRef,
  expanded,
  onFocusChange,
  onLeave,
}: {
  value: string
  onChange: (text: string) => void
  inputRef: RefObject<HTMLInputElement | null>
  expanded: boolean
  onFocusChange: (focused: boolean) => void
  /** Leave the box for the results (↓, Enter). */
  onLeave: () => void
}) {
  const [focused, setFocused] = useState(false)
  const [active, setActive] = useState(-1)
  const [dismissed, setDismissed] = useState(false)
  const [atEnd, setAtEnd] = useState(true)
  const c = atEnd ? completing(value) : null
  const people = usePeople(c)
  const labels = useLabels(focused)
  // Read again each time the box is focused (a search may have been used since).
  const [recent, setRecent] = useState<string[]>([])
  useEffect(() => {
    if (focused) setRecent(recentSearches())
  }, [focused])

  const items: Suggestion[] = useMemo(() => {
    if (!value.trim()) {
      return [
        ...recent.map((q) => ({ label: q, insert: q, recent: true })),
        ...OPERATORS.map((o) => ({ label: OPERATOR_HELP[o].example, hint: OPERATOR_HELP[o].hint, insert: `${o}:` })),
      ]
    }
    return suggestions(c, people, labels)
  }, [value, recent, c?.kind, c?.start, c && 'op' in c ? c.op : null, c && 'value' in c ? c.value : null, people, labels]) // eslint-disable-line react-hooks/exhaustive-deps
  const open = focused && !dismissed && items.length > 0
  useEffect(() => setActive(-1), [value])

  const take = (s: Suggestion) => {
    // A recent search runs as it was, ready to refine.
    const next = value.trim() ? accept(value, c!, s) : s.recent ? `${s.insert} ` : s.insert
    onChange(next)
    setDismissed(false)
    setAtEnd(true)
    inputRef.current?.focus()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (open) setActive((i) => Math.min(i + 1, items.length - 1))
      else onLeave()
    } else if (e.key === 'ArrowUp' && open) {
      e.preventDefault()
      setActive((i) => Math.max(i - 1, -1))
    } else if (e.key === 'Tab' && open && value.trim()) {
      e.preventDefault()
      take(items[Math.max(active, 0)]!)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (open && active >= 0) take(items[active]!)
      else if (value.trim()) onLeave()
    } else if (e.key === 'Escape' && open && value.trim()) {
      // First Esc closes the suggestions; the next leaves search.
      e.preventDefault()
      setDismissed(true)
    }
  }

  return (
    <div
      className={`no-drag relative ml-auto flex h-7 items-center rounded-ui bg-pane-sunk px-2 text-ink-faint transition-[width] duration-200 ease-out focus-within:ring-1 focus-within:ring-rule-strong ${
        expanded ? 'w-full' : 'w-44'
      }`}
    >
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden className="shrink-0">
        <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5" />
        <path d="m10.5 10.5 3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => {
          onChange(e.target.value)
          setDismissed(false)
          setAtEnd(e.target.selectionStart === e.target.value.length)
        }}
        onSelect={(e) => setAtEnd(e.currentTarget.selectionStart === e.currentTarget.value.length)}
        onFocus={() => {
          setFocused(true)
          onFocusChange(true)
        }}
        onBlur={() => {
          setFocused(false)
          setDismissed(false)
          onFocusChange(false)
        }}
        onKeyDown={onKeyDown}
        placeholder={expanded ? 'Search all mail: words, "a phrase", from:, has:pdf…' : 'Search'}
        aria-label="Search mail"
        role="combobox"
        aria-expanded={open}
        aria-controls="search-suggestions"
        aria-activedescendant={open && active >= 0 ? `search-suggestion-${active}` : undefined}
        spellCheck={false}
        className="ml-1.5 w-full min-w-0 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-faint"
      />
      {value ? (
        <button
          type="button"
          aria-label="Clear search"
          title="Clear (Esc)"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            onChange('')
            inputRef.current?.focus()
          }}
          className="shrink-0 rounded-full px-1 text-[13px] leading-none text-ink-faint hover:text-ink"
        >
          ×
        </button>
      ) : (
        !focused && <kbd className="text-[11px] text-ink-faint">/</kbd>
      )}
      {open && (
        <ul
          id="search-suggestions"
          role="listbox"
          aria-label={value.trim() ? 'Suggestions' : 'Search with'}
          className="pop-in absolute top-full right-0 left-0 z-50 mt-1.5 max-h-[340px] overflow-y-auto rounded-ui-lg border border-rule-strong bg-pane p-1 text-[13px] shadow-[0_12px_32px_-12px_rgba(0,0,0,0.28)]"
        >
          {items.map((s, i) => (
            <Fragment key={s.insert + s.label + (s.recent ? ':recent' : '')}>
            {!value.trim() && i === 0 && s.recent && (
              <li className="flex items-baseline px-2.5 pt-1 pb-1.5 text-[12px] font-medium text-ink-faint">
                Recent
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    clearSearches()
                    setRecent([])
                  }}
                  className="ml-auto rounded-ui px-1 font-normal hover:text-ink"
                >
                  Clear
                </button>
              </li>
            )}
            {!value.trim() && !s.recent && (i === 0 || items[i - 1]!.recent) && (
              <li className={`px-2.5 pb-1.5 text-[12px] font-medium text-ink-faint ${i === 0 ? 'pt-1' : 'mt-1 border-t border-rule pt-2.5'}`}>Search with</li>
            )}
            <li
              id={`search-suggestion-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => take(s)}
              onMouseEnter={() => setActive(i)}
              className={`group/opt flex cursor-default items-baseline gap-3 rounded-ui px-2.5 py-1.5 ${i === active ? 'bg-pane-alt' : ''}`}
            >
              {s.recent && (
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden className="shrink-0 self-center text-ink-faint">
                  <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M8 4.5V8l2.5 1.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
              <span className="min-w-0 truncate text-ink">{s.label}</span>
              {s.hint && <span className="ml-auto shrink-0 truncate text-[12px] text-ink-faint">{s.hint}</span>}
              {s.recent && (
                <button
                  type="button"
                  aria-label={`Remove “${s.label}” from recent searches`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={(e) => {
                    e.stopPropagation()
                    forgetSearch(s.insert)
                    setRecent((r) => r.filter((q) => q !== s.insert))
                  }}
                  className="ml-auto shrink-0 self-center rounded-ui px-1 text-ink-faint opacity-0 group-hover/opt:opacity-100 hover:text-ink"
                >
                  ×
                </button>
              )}
            </li>
            </Fragment>
          ))}
        </ul>
      )}
    </div>
  )
}

/** People for from:/to: as the name is typed. */
function usePeople(c: ReturnType<typeof completing>) {
  const text = c?.kind === 'value' && (c.op === 'from' || c.op === 'to') ? c.value : null
  const settled = useDebounced(text, 100)
  const [people, setPeople] = useState<Array<{ name: string | null; email: string }>>([])
  useEffect(() => {
    if (settled == null) return setPeople([])
    let live = true
    api.searchPeople(settled).then((p) => live && setPeople(p), () => live && setPeople([]))
    return () => {
      live = false
    }
  }, [settled])
  return text == null ? [] : people
}

/** Label names, loaded when the box is first used. */
function useLabels(focused: boolean) {
  const [labels, setLabels] = useState<string[] | null>(null)
  useEffect(() => {
    if (focused && labels == null) api.labels().then((l) => setLabels(l.map((x) => x.name)), () => setLabels([]))
  }, [focused, labels])
  return labels ?? []
}

const DATES: Array<[string, Operator, string]> = [
  ['Last 7 days', 'newer_than', '7d'],
  ['Last 30 days', 'newer_than', '30d'],
  ['Last 3 months', 'newer_than', '3m'],
  ['Last year', 'newer_than', '1y'],
  ['Older than a year', 'older_than', '1y'],
]
const BOXES: Array<[string, string]> = [['Imbox', 'imbox'], ['The Feed', 'feed'], ['Paper Trail', 'papertrail'], ['Reply Later', 'later'], ['Set Aside', 'aside'], ['Bubble Up', 'bubble'], ['Trash', 'trash']]
const FILES: Array<[string, string]> = [['Any attachment', 'attachment'], ['PDF', 'pdf'], ['Image', 'image'], ['Document', 'document'], ['Spreadsheet', 'spreadsheet'], ['Presentation', 'presentation'], ['Audio or video', 'media'], ['Zip file', 'zip'], ['Calendar invite', 'invite']]

/**
 * Quick filters under the search box, like Gmail's chips. Each edits the query text, so
 * what you see typed is always what's searched.
 */
export function SearchFilters({ text, onChange, onFrom }: { text: string; onChange: (text: string) => void; onFrom: () => void }) {
  const clearDates = (t: string) => withOperator(withOperator(withOperator(withOperator(t, 'newer_than', null), 'older_than', null), 'after', null), 'before', null)
  const newer = operatorValue(text, 'newer_than')
  const older = operatorValue(text, 'older_than')
  const dateLabel =
    DATES.find(([, op, v]) => operatorValue(text, op) === v)?.[0] ??
    (newer ? `Newer than ${newer}` : older ? `Older than ${older}` : operatorValue(text, 'after') || operatorValue(text, 'before') ? 'Custom dates' : null)
  const box = operatorValue(text, 'in')
  const file = operatorValue(text, 'has')
  const from = operatorValue(text, 'from')
  const unread = operatorValue(text, 'is')?.toLowerCase() === 'unread'

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-rule px-4 py-2" aria-label="Filters">
      {from ? (
        <Chip on onClear={() => onChange(withOperator(text, 'from', null))}>From {from}</Chip>
      ) : (
        <Chip onClick={onFrom}>From</Chip>
      )}
      <ChipMenu label={dateLabel ?? 'Any time'} on={!!dateLabel} onClear={() => onChange(clearDates(text))}>
        {(close) =>
          DATES.map(([label, op, v]) => (
            <MenuItem key={label} onSelect={() => (onChange(withOperator(clearDates(text), op, v)), close())}>
              {label}
            </MenuItem>
          ))
        }
      </ChipMenu>
      <ChipMenu label={BOXES.find(([, v]) => v === box?.toLowerCase())?.[0] ?? (box ? `In ${box}` : 'Any box')} on={!!box} onClear={() => onChange(withOperator(text, 'in', null))}>
        {(close) =>
          BOXES.map(([label, v]) => (
            <MenuItem key={v} onSelect={() => (onChange(withOperator(text, 'in', v)), close())}>
              {label}
            </MenuItem>
          ))
        }
      </ChipMenu>
      <ChipMenu label={FILES.find(([, v]) => v === file?.toLowerCase())?.[0] ?? (file ? `Has ${file}` : 'Attachment')} on={!!file} onClear={() => onChange(withOperator(text, 'has', null))}>
        {(close) => (
          <>
            {FILES.slice(0, 1).map(([label, v]) => (
              <MenuItem key={v} onSelect={() => (onChange(withOperator(text, 'has', v)), close())}>
                {label}
              </MenuItem>
            ))}
            <MenuSeparator />
            {FILES.slice(1).map(([label, v]) => (
              <MenuItem key={v} onSelect={() => (onChange(withOperator(text, 'has', v)), close())}>
                {label}
              </MenuItem>
            ))}
          </>
        )}
      </ChipMenu>
      <Chip on={unread} onClick={() => onChange(withOperator(text, 'is', unread ? null : 'unread'))} pressed={unread}>
        Unread
      </Chip>
    </div>
  )
}

const chipClass = (on: boolean) =>
  `no-drag flex h-6 items-center gap-1 rounded-full border px-2.5 text-[12px] whitespace-nowrap transition-colors ${
    on ? 'border-accent/40 bg-accent-wash text-ink' : 'border-rule-strong text-ink-soft hover:bg-pane-sunk hover:text-ink'
  }`

function Chip({ children, on = false, onClick, onClear, pressed }: { children: ReactNode; on?: boolean; onClick?: () => void; onClear?: () => void; pressed?: boolean }) {
  if (onClear) {
    return (
      <span className={chipClass(true)}>
        {children}
        <button type="button" aria-label="Remove filter" onClick={onClear} className="-mr-1 px-0.5 text-ink-faint hover:text-ink">
          ×
        </button>
      </span>
    )
  }
  return (
    <button type="button" className={chipClass(on)} onClick={onClick} aria-pressed={pressed}>
      {children}
    </button>
  )
}

function ChipMenu({ label, on, onClear, children }: { label: string; on: boolean; onClear: () => void; children: (close: () => void) => ReactNode }) {
  if (on) return <Chip onClear={onClear}>{label}</Chip>
  return (
    <Menu label={label} align="left" button={(open, toggle) => (
      <button type="button" className={chipClass(open)} onClick={toggle} aria-haspopup="menu" aria-expanded={open}>
        {label}
        <svg width="9" height="9" viewBox="0 0 16 16" fill="none" aria-hidden className="text-ink-faint">
          <path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    )}>
      {children}
    </Menu>
  )
}

interface HeyState {
  text: string
  rows: PostingRow[]
  page: number
  more: boolean
  loading: boolean
  error: string | null
  unsupported: boolean
}
const noHey = (text: string): HeyState => ({ text, rows: [], page: 0, more: false, loading: false, error: null, unsupported: false })

/**
 * Results: the cache's at once, HEY's (the whole mailbox) as they come, merged by thread,
 * newest first. HEY answers 10 at a time; "More results" asks for the next 10.
 */
export function SearchResults({
  text,
  selectedId,
  onOpen,
  onRows,
  boxNames,
}: {
  text: string
  selectedId: number | null
  onOpen: (p: PostingRow) => void
  /** The rows shown, for j/k. */
  onRows: (rows: PostingRow[]) => void
  boxNames: Record<number, string>
}) {
  const localText = useDebounced(text, 120)
  const local = useLive(
    () => api.search(localText),
    [localText],
    (e) => e.type === 'analysis' || (e.type === 'change' && e.change.kind === 'postings'),
  )
  const heyText = useDebounced(text.trim(), 450)
  const [hey, setHey] = useState<HeyState>(() => noHey(''))
  const request = useRef(0)

  const fetchPage = useCallback((forText: string, page: number) => {
    const id = ++request.current
    setHey((h) => ({ ...(page === 1 ? noHey(forText) : h), loading: true, error: null }))
    api.searchHey(forText, page).then(
      (res: HeySearchPage) =>
        id === request.current &&
        setHey((h) => ({ ...h, rows: page === 1 ? res.rows : [...h.rows, ...res.rows], page, more: res.more, loading: false, unsupported: res.unsupported })),
      (e: unknown) => id === request.current && setHey((h) => ({ ...h, loading: false, error: e instanceof Error ? e.message : String(e) })),
    )
  }, [])

  useEffect(() => {
    if (heyText) fetchPage(heyText, 1)
    else {
      request.current++
      setHey(noHey(''))
    }
  }, [heyText, fetchPage])

  const rows = useMemo(() => mergeResults(local.data?.rows ?? [], hey.text === heyText ? hey.rows : []), [local.data, hey, heyText])
  useEffect(() => onRows(rows), [rows, onRows])

  const settling = text.trim() !== heyText || localText !== text
  const busy = settling || local.loading || hey.loading
  const problems = local.data?.problems ?? []

  return (
    <>
      <div className="flex shrink-0 items-center gap-2 px-5 pt-2.5 pb-1 text-[12px] text-ink-faint" role="status">
        {problems.length > 0 && <span className="text-danger">Not understood: {problems.join(', ')}</span>}
        {!problems.length && <span>{busy && !rows.length ? 'Searching…' : `${rows.length}${hey.more ? '+' : ''} result${rows.length === 1 ? '' : 's'}`}</span>}
        <span className="ml-auto flex items-center gap-1.5">
          {hey.loading || settling ? (
            <>
              <span className="pulse size-1.5 rounded-full bg-accent" aria-hidden />
              Searching all mail
            </>
          ) : hey.error ? (
            <>
              <span className="text-danger">Couldn’t reach HEY: cached mail only</span>
              <button type="button" onClick={() => fetchPage(heyText, Math.max(hey.page, 1))} className="font-medium text-ink-soft hover:text-ink">
                Retry
              </button>
            </>
          ) : hey.unsupported ? (
            <span title="HEY’s search can’t filter by read state or by Reply Later, Set Aside and Bubble Up">Cached mail only</span>
          ) : heyText ? (
            'All mail'
          ) : null}
        </span>
      </div>
      <PostingList
        postings={rows}
        loading={false}
        selectedId={selectedId}
        onOpen={onOpen}
        search={{
          highlight: local.data?.highlight ?? [],
          boxNames,
          empty: <p className="px-5 py-10 text-center text-[13px] text-ink-faint">{busy ? 'Searching…' : 'No mail matches.'}</p>,
          footer:
            hey.more && !hey.error ? (
              <div className="px-4 py-3">
                <button
                  type="button"
                  disabled={hey.loading}
                  onClick={() => fetchPage(heyText, hey.page + 1)}
                  className="w-full rounded-ui border border-rule-strong py-1.5 text-[13px] font-medium text-ink-soft hover:bg-pane-sunk hover:text-ink disabled:opacity-60"
                >
                  {hey.loading ? 'Loading…' : 'More results'}
                </button>
              </div>
            ) : null,
        }}
      />
    </>
  )
}
