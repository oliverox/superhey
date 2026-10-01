import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { motionOff } from './motion'
import type { AppStatus, BoxRow, PostingRow } from '@shared/api'
import { api, useLive } from './api'
import { useAppStatus } from './hooks'
import { Sidebar } from './components/Sidebar'
import { ColumnThread } from './components/ColumnThread'
import { ListResizer, useListWidth } from './components/ListResizer'
import { groupOf, inGroupOrder, PostingList, useCollapsedGroups } from './components/Lists'
import { SearchField, SearchFilters, SearchResults } from './components/Search'
import { ActivityDrawer, Toasts } from './components/Activity'
import { Reader, type ReaderTarget } from './components/Reader'
import { SetupScreen, StartingScreen } from './components/Setup'
import { useTheme } from './theme'
import { markSeenOnOpen } from './prefs'
import { rememberSearch } from './mail/search'
import { useShortcut } from './shortcuts'
import { ShortcutHelp } from './components/ShortcutHelp'
import { Tooltips } from './components/Tooltips'
import { CommandBar } from './components/CommandBar'
import { Settings, type SettingsTab } from './components/Settings'
import { AiSpend } from './components/AiSpend'
import { CalendarView } from './components/Calendar'
import { doneFor, TodayList, todayLabel, todayRows, todayThreads, type TodayData } from './components/Today'
import type { Command } from './commands/model'
import { boxCommands, emailCommand, labelCommands } from './commands/sources'
import { Composer, type ComposeRequest } from './components/Composer'
import { ScreenerBanner, ScreenerList, useScreener } from './components/ScreenerView'

type PaneId = 'sidebar' | 'list' | 'reader'

export function App() {
  const status = useAppStatus()
  if (!status || (status.phase === 'starting' && !status.sync?.initialSyncDone)) return <StartingScreen />
  if (status.phase === 'blocked' && status.problem) return <SetupScreen problem={status.problem} />
  return <Workspace status={status} />
}

const BOX_ORDER = ['imbox', 'feedbox', 'trailbox', 'laterbox', 'asidebox', 'bubblebox']

function Workspace({ status }: { status: AppStatus }) {
  // A test instance says so in the title bar and the Dock's window list too.
  useEffect(() => {
    document.title = status.testInstance ? 'SuperHey — TEST INSTANCE' : 'SuperHey'
  }, [status.testInstance])
  const boxes = useLive(() => api.boxes(), [], (e) => e.type === 'change')
  const ordered = useMemo(
    () => [...(boxes.data ?? [])].sort((a, b) => BOX_ORDER.indexOf(a.kind) - BOX_ORDER.indexOf(b.kind)),
    [boxes.data],
  )

  const [boxId, setBoxId] = useState<number | null>(null)
  // Today is where the app opens; a box replaces it until you come back (0).
  const [onToday, setOnToday] = useState(true)
  // The calendar takes the place of the list and reader while it's open; `focus` jumps to a day.
  const [onCalendar, setOnCalendar] = useState(false)
  const [calendarFocus, setCalendarFocus] = useState<{ day: string; nonce: number } | null>(null)
  const openCalendar = (day?: string) => {
    setOnCalendar(true)
    setScreening(false)
    if (day) setCalendarFocus({ day, nonce: Date.now() })
  }
  // "In calendar" next to a date in an email opens the calendar on that day.
  const openCalendarRef = useRef(openCalendar)
  openCalendarRef.current = openCalendar
  useEffect(() => {
    const on = (e: Event) => openCalendarRef.current((e as CustomEvent<string>).detail)
    window.addEventListener('superhey:open-calendar', on)
    return () => window.removeEventListener('superhey:open-calendar', on)
  }, [])
  const activeBox = ordered.find((b) => b.id === boxId) ?? ordered[0] ?? null
  const boxNames = useMemo(() => Object.fromEntries(ordered.map((b) => [b.id, b.name])), [ordered])
  const since = useLastLook(onToday)
  const today = useLive(
    () => api.today(since),
    [since],
    (e) => e.type === 'today' || e.type === 'action' || e.type === 'analysis' || (e.type === 'change' && ['postings', 'todos', 'calendar', 'screener'].includes(e.change.kind)),
  )
  const todayData = (today.data as TodayData | null) ?? null

  const postings = useLive(
    () => (activeBox ? api.postings(activeBox.id) : Promise.resolve([] as PostingRow[])),
    [activeBox?.id],
    (e) => (e.type === 'change' && e.change.kind === 'postings' && e.change.boxId === activeBox?.id) || e.type === 'analysis',
  )

  const [query, setQuery] = useState('')
  const [searchFocused, setSearchFocused] = useState(false)
  const [searchRows, setSearchRows] = useState<PostingRow[]>([])
  const searching = !!query.trim()
  const searchExpanded = searchFocused || !!query
  const [target, setTargetNow] = useState<ReaderTarget | null>(null)
  const targetRef = useRef(target)
  targetRef.current = target
  /**
   * Opening the reader from the list alone, or closing it, animates: the reader slides in
   * from the right as the list narrows, and back out as it widens. Moving between threads
   * doesn't.
   */
  const setTarget = useCallback((next: ReaderTarget | null) => {
    const opening = (targetRef.current == null) !== (next == null)
    if (!opening || motionOff() || !document.startViewTransition) return setTargetNow(next)
    document.startViewTransition(() => flushSync(() => setTargetNow(next)))
  }, [])
  const waiting = useScreener()
  const [screening, setScreening] = useState(false)
  const screeningRef = useRef(screening)
  screeningRef.current = screening
  const screenerTarget = target?.screeningId ?? null
  const openScreener = () => {
    setOnCalendar(false)
    setQuery('')
    setScreening(true)
  }
  const leaveScreener = useCallback(() => {
    setScreening(false)
    setTarget(null)
  }, [])
  useShortcut('screener', openScreener, waiting.length > 0 && !screening)
  const searchRef = useRef<HTMLInputElement>(null)
  const [activePane, setActivePane] = useState<PaneId>('list')
  const [showActivity, setShowActivity] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const [showCommands, setShowCommands] = useState(false)
  useShortcut('palette', () => setShowCommands((v) => !v))
  const [showSettings, setShowSettings] = useState(false)
  // Settings opened on a given tab (the AI spend in the header opens Usage).
  const [settingsTab, setSettingsTab] = useState<SettingsTab | null>(null)
  useEffect(() => {
    const on = (e: Event) => setSettingsTab((e as CustomEvent<SettingsTab>).detail)
    window.addEventListener('superhey:settings', on)
    return () => window.removeEventListener('superhey:settings', on)
  }, [])
  useShortcut('settings', () => setShowSettings((v) => !v))
  const [composing, setComposing] = useState<ComposeRequest | null>(null)
  useShortcut('compose', () => setComposing({ kind: 'new', message: { to: [], subject: '', body: '' } }), !composing)
  // An undone or failed send comes back here for editing (see the toasts).
  useEffect(() => {
    const onRestore = (e: Event) => setComposing((e as CustomEvent<ComposeRequest>).detail)
    window.addEventListener('superhey:compose', onRestore)
    return () => window.removeEventListener('superhey:compose', onRestore)
  }, [])
  // A thread opened from inside the reader (a forward's original).
  const openInBoxRef = useRef<(p: PostingRow) => void>(() => {})
  useEffect(() => {
    const onOpen = (e: Event) => openInBoxRef.current((e as CustomEvent<PostingRow>).detail)
    window.addEventListener('superhey:open-thread', onOpen)
    return () => window.removeEventListener('superhey:open-thread', onOpen)
  }, [])

  const groups = useCollapsedGroups(activeBox?.id)
  // j/k move through what's showing: rows in folded groups are skipped.
  // The email opened while new stays among the new until another is opened.
  const [heldNew, setHeldNew] = useState<number | null>(null)
  const boxList = useMemo(() => inGroupOrder(postings.data ?? [], heldNew), [postings.data, heldNew])
  const boxRows = useMemo(() => boxList.filter((p) => !groups.collapsed.has(groupOf(p, heldNew))), [boxList, groups.collapsed, heldNew])
  // With nothing open there's nothing for a reader to show: the list (a box, Today, search
  // results) takes the whole width until you open something. The Screener keeps its reader.
  const { theme, setTheme, toggle: toggleTheme, scheme, setScheme, toggleDark } = useTheme()
  // The Column style: one column, where an open email unrolls in the list (the sidebar stays,
  // faded until you point at it).
  const column = theme === 'column'
  const columnOpen = column && !!target && !screening
  const listAlone = (!screening && !target) || columnOpen
  const gridRef = useRef<HTMLDivElement>(null)
  const listWidth = useListWidth()
  const list = searching ? searchRows : onToday ? todayRows(todayData) : boxRows
  const selectedIndex = target?.postingId != null ? list.findIndex((p) => p.id === target.postingId) : -1

  /** `markSeen: false` shows a thread without reading it (Today putting its first item up). */
  const open = useCallback((p: PostingRow, markSeen = true) => {
    // Opening a thread marks it seen, as in HEY. Kept out of the activity log.
    // Unless Settings says seen is yours to mark (u).
    if (markSeen && markSeenOnOpen() && !p.seen && !p.isBundle) api.runAction({ type: 'seen', postingId: p.id, seen: true }, 'auto').catch(() => {})
    setHeldNew((held) => (p.id === held ? held : p.seen ? null : p.id))
    setTarget({
      // A search result in no box has only its thread (a negative stand-in id): read-only.
      postingId: p.id > 0 ? p.id : null,
      topicId: p.topicId,
      entryCount: p.entryCount,
      subject: p.subject,
      appUrl: p.appUrl,
      isBundle: p.isBundle,
      sender: p.senderName ?? p.senderEmail,
    })
  }, [])

  // Opening a result makes the search a recent one.
  useEffect(() => {
    if (searching && target) rememberSearch(query)
  }, [target?.topicId]) // eslint-disable-line react-hooks/exhaustive-deps

  // On Today, the reader shows the first thing to handle, so there's never an empty pane to
  // look at. It isn't marked seen: you haven't chosen to read it.
  // Unless you've closed the reader there: then Today stays a list until you open something.
  const firstOnToday = todayThreads(todayData)[0]
  const [todayClosed, setTodayClosed] = useState(false)
  useEffect(() => {
    // Not in the Column style: there Today is the list you read down, nothing opened for you.
    if (onToday && !column && !todayClosed && !screening && !query && !target && firstOnToday) open(firstOnToday, false)
  }, [onToday, column, todayClosed, screening, query, target, firstOnToday, open])
  useEffect(() => {
    if (target) setTodayClosed(false)
  }, [target])
  const closeReader = () => {
    if (onToday) setTodayClosed(true)
    setTarget(null)
    setActivePane('list')
  }
  // An action took the open thread out of the box: move on to the next one (or the previous one at the end), like HEY.
  const leaveBox = () => {
    const i = list.findIndex((p) => p.id === target?.postingId)
    const next = i < 0 ? undefined : (list[i + 1] ?? list[i - 1])
    if (next) open(next)
    else setTarget(null)
  }
  const closeReaderRef = useRef(closeReader)
  closeReaderRef.current = closeReader
  const canCloseReader = !!target && !screening
  const canCloseRef = useRef(canCloseReader)
  canCloseRef.current = canCloseReader
  const queryRef = useRef(query)
  queryRef.current = query

  // Keyboard (see shortcuts.ts for the full map).
  const step = (delta: number) => {
    const next = list[Math.min(Math.max(selectedIndex + delta, 0), list.length - 1)]
    if (next) open(next)
    setActivePane('list')
  }
  useShortcut('nextThread', () => step(1))
  useShortcut('prevThread', () => step(-1))
  useShortcut('search', () => searchRef.current?.focus())
  useShortcut('theme', toggleTheme)
  // Light and dark are the Default theme's (Omarchy is dark).
  useShortcut('appearance', toggleDark, theme !== 'omarchy')
  const showBox = (id: number) => {
    setOnCalendar(false)
    setOnToday(false)
    setScreening(false)
    setQuery('')
    setBoxId(id)
  }
  /** Opens a thread from outside its list (the command bar, a forward's original): into its box when it's one of the six, so the list shows it selected. */
  const openInBox = (p: PostingRow) => {
    if (ordered.some((b) => b.id === p.boxId)) showBox(p.boxId)
    else {
      setScreening(false)
      setQuery('')
    }
    open(p)
  }
  openInBoxRef.current = openInBox
  const goToBox = (i: number) => ordered[i] && showBox(ordered[i]!.id)
  const goToToday = () => {
    setOnCalendar(false)
    setTodayClosed(false)
    setOnToday(true)
    setScreening(false)
    setQuery('')
    setTarget(null)
  }
  useShortcut('today', goToToday)
  useShortcut('calendar', () => openCalendar())
  // e on Today: done with the open item; Today then puts up the next.
  const doneWithOpen = onToday && target?.postingId != null ? doneFor(todayData, target.postingId) : null
  useShortcut('done', () => void doneWithOpen?.().then(() => setTarget(null)), !!doneWithOpen)
  useShortcut('box1', () => goToBox(0))
  useShortcut('box2', () => goToBox(1))
  useShortcut('box3', () => goToBox(2))
  useShortcut('box4', () => goToBox(3))
  useShortcut('box5', () => goToBox(4))
  useShortcut('box6', () => goToBox(5))
  useShortcut('undo', () => {
    void api.recentActions(1).then(([last]) => {
      if (last?.canUndo) void api.undoAction(last.id)
    })
  })
  useShortcut('help', () => setShowHelp((v) => !v))

  // Esc leaves search (it isn't a shortcut: overlays and fields handle it themselves too).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      const typing = document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement
      // With nothing else to leave, Esc closes the reader: checked once every other handler
      // (an open dialog or drawer) has had its turn at the key.
      if (!typing && !queryRef.current && canCloseRef.current) {
        setTimeout(() => !e.defaultPrevented && closeReaderRef.current())
        return
      }
      setQuery('')
      searchRef.current?.blur()
      // Leaving The Screener also closes the unscreened email in the reader.
      if (!(document.activeElement instanceof HTMLInputElement) && screeningRef.current) leaveScreener()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div
      ref={gridRef}
      style={{ '--list-w': `${listWidth.width}px` } as React.CSSProperties}
      className={`tiles grid h-full ${listAlone || onCalendar ? 'grid-cols-[232px_1fr]' : 'grid-cols-[232px_var(--list-w)_1fr]'}`}
      onMouseDown={(e) => {
        const pane = (e.target as HTMLElement).closest<HTMLElement>('[data-pane]')?.dataset.pane as PaneId | undefined
        if (pane) setActivePane(pane)
      }}
    >
      <Sidebar
        boxes={ordered}
        activeBoxId={onToday || screening || onCalendar ? null : (activeBox?.id ?? null)}
        onSelectBox={showBox}
        today={{ active: onToday && !screening && !onCalendar, count: todayData?.toHandle ?? null, onSelect: goToToday }}
        calendar={{ active: onCalendar, onOpen: openCalendar }}
        status={status}
        theme={theme}
        scheme={scheme}
        onScheme={setScheme}
        onTheme={setTheme}
        active={activePane === 'sidebar'}
        onOpenActivity={() => setShowActivity(true)}
        onOpenSettings={() => setShowSettings(true)}
      />

      {onCalendar ? (
        <CalendarView focus={calendarFocus} />
      ) : (
      <>
      <section className="pane relative flex min-w-0 flex-col bg-pane [view-transition-name:list]" data-pane="list" data-active={activePane === 'list'}>
        {!listAlone && <ListResizer gridRef={gridRef} width={listWidth.width} onResize={listWidth.save} />}
        <header className="drag flex h-[52px] shrink-0 items-center border-b border-rule px-4">
          {/* The title makes way while the search box is in use. */}
          <h1
            aria-hidden={searchExpanded}
            className={`shrink-0 overflow-hidden text-[17px] font-semibold tracking-tight whitespace-nowrap transition-[max-width,opacity,margin] duration-200 ease-out ${
              searchExpanded ? 'mr-0 max-w-0 opacity-0' : 'mr-3 max-w-[70%] opacity-100'
            }`}
          >
            {screening ? (
              <span className="flex items-center gap-2">
                <button onClick={leaveScreener} aria-label="Back to the Imbox" title="Back (Esc)" className="no-drag -ml-1 rounded-ui px-1 text-ink-faint hover:bg-pane-sunk hover:text-ink">
                  ←
                </button>
                The Screener
              </span>
            ) : query ? (
              'Search'
            ) : onToday ? (
              // The sidebar already says Briefing: the title is the day.
              todayLabel()
            ) : (
              (activeBox?.name ?? '')
            )}
          </h1>
          <SearchField
            value={query}
            onChange={setQuery}
            inputRef={searchRef}
            expanded={searchExpanded}
            onFocusChange={setSearchFocused}
            onLeave={() => {
              rememberSearch(query)
              searchRef.current?.blur()
              setActivePane('list')
              if (searchRows[0]) open(searchRows[0])
            }}
          />
          {/* With a thread open, the reader's top bar shows it instead. */}
          {!searchExpanded && listAlone && <AiSpend onOpen={() => setSettingsTab('usage')} />}
        </header>
        {columnOpen && (
          <ColumnThread list={list} posting={list.find((p) => p.id === target?.postingId) ?? null} where={query ? 'Search' : onToday ? 'Briefing' : (activeBox?.name ?? '')} onOpen={open} onClose={closeReader}>
            <Reader target={target} active={activePane === 'reader'} onOpenThread={open} onClose={closeReader} onLeaveBox={leaveBox} variant="column" />
          </ColumnThread>
        )}
        {/* Standing alone, the list keeps a readable measure (kept, hidden, while an email is unrolled, so it keeps its place). */}
        <div className={columnOpen ? 'hidden' : listAlone ? `mx-auto flex min-h-0 w-full flex-1 flex-col ${column ? 'column-list max-w-[860px]' : 'max-w-[780px]'}` : 'contents'}>
        {screening ? (
          <ScreenerList
            items={waiting}
            selectedId={screenerTarget}
            onEmpty={leaveScreener}
            onSelect={(item) =>
              setTarget({
                postingId: null,
                topicId: item.topicId,
                entryCount: null,
                subject: item.subject ?? '',
                appUrl: null,
                isBundle: false,
                sender: item.name ?? item.email,
                screeningId: item.id,
              })
            }
          />
        ) : searching ? (
          <>
            <SearchFilters
              text={query}
              onChange={setQuery}
              onFrom={() => {
                setQuery((q) => `${q.trimEnd()} from:`)
                searchRef.current?.focus()
              }}
            />
            <SearchResults text={query} selectedId={target?.postingId ?? null} onOpen={open} onRows={setSearchRows} boxNames={boxNames} />
          </>
        ) : onToday ? (
          <>
            <ScreenerBanner count={waiting.length} onOpen={openScreener} />
            <TodayList today={todayData} selectedId={target?.postingId ?? null} onOpen={open} onGoToBox={showBox} />
          </>
        ) : (
          <>
          {activeBox?.kind === 'imbox' && <ScreenerBanner count={waiting.length} onOpen={openScreener} />}
          <PostingList
            key={activeBox?.id}
            postings={boxList}
            heldNew={heldNew}
            loading={postings.loading && !postings.data}
            selectedId={target?.postingId ?? null}
            onOpen={open}
            collapsed={groups.collapsed}
            onToggleGroup={groups.toggle}
          />
          </>
        )}
        </div>
      </section>

      <div data-pane="reader" className="contents">
        {!listAlone && <Reader target={target} active={activePane === 'reader'} onOpenThread={open} onClose={screening ? undefined : closeReader} onLeaveBox={leaveBox} />}
      </div>
      </>
      )}
      <Toasts />
      {showActivity && <ActivityDrawer onClose={() => setShowActivity(false)} />}
      {showHelp && <ShortcutHelp onClose={() => setShowHelp(false)} />}
      {(showSettings || settingsTab) && (
        <Settings
          initialTab={settingsTab ?? undefined}
          onClose={() => {
            setShowSettings(false)
            setSettingsTab(null)
          }}
        />
      )}
      {showCommands && (
        <CommandBarHost
          boxes={ordered}
          postingId={target?.postingId ?? null}
          onClose={() => setShowCommands(false)}
          goToBox={showBox}
          openEmail={openInBox}
          openActivity={() => setShowActivity(true)}
        />
      )}
      <Tooltips />
      {composing && (
        <div className="fixed inset-0 z-[65] flex items-start justify-center bg-ink/20 p-6 pt-[10vh]">
          <div className="rise w-full max-w-[680px]">
            <Composer request={composing} variant="dialog" onClose={() => setComposing(null)} />
          </div>
        </div>
      )}
    </div>
  )
}

/** The command bar with the app's own commands: boxes, labels for the open thread, and more. */
function CommandBarHost({
  boxes,
  postingId,
  onClose,
  goToBox,
  openEmail,
  openActivity,
}: {
  boxes: BoxRow[]
  postingId: number | null
  onClose: () => void
  goToBox: (boxId: number) => void
  openEmail: (p: PostingRow) => void
  openActivity: () => void
}) {
  const labels = useLive(() => api.labels(), [])
  const posting = useLive(() => (postingId == null ? Promise.resolve(null) : api.posting(postingId)), [postingId])
  const commands = useMemo<Command[]>(
    () => [
      ...boxCommands(boxes, goToBox),
      ...labelCommands(labels.data ?? [], posting.data ?? null, (labelId, add) => {
        if (postingId != null) void api.runAction({ type: 'label', postingId, labelId, add })
      }),
      { id: 'app:activity', section: 'App', title: 'Show activity', keywords: ['log', 'history', 'undo'], run: openActivity },
    ],
    // The callbacks come fresh from each render of the app; the bar only needs them at run time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [boxes, labels.data, posting.data, postingId],
  )
  // Stable, so the bar's lookup isn't restarted by the app re-rendering; the latest `openEmail` still runs.
  const openRef = useRef(openEmail)
  openRef.current = openEmail
  const findEmails = useCallback(async (q: string) => (await api.findPostings(q, 8)).map((p) => emailCommand(p, (row) => openRef.current(row))), [])
  return <CommandBar commands={commands} findEmails={findEmails} onClose={onClose} />
}

/**
 * When you last looked at Today, for "new since you last looked": the time you last left
 * it (per device). It moves on when you leave Today, not while you're on it, so what's new
 * stays listed while you work through it.
 */
function useLastLook(onToday: boolean): string | null {
  const KEY = 'today:last-look'
  const read = () => {
    try {
      return localStorage.getItem(KEY)
    } catch {
      return null
    }
  }
  const [since, setSince] = useState<string | null>(read)
  useEffect(() => {
    if (onToday) {
      setSince(read())
      return
    }
    try {
      localStorage.setItem(KEY, new Date().toISOString())
    } catch {
      // works without it: "new since" becomes "unread"
    }
  }, [onToday])
  return since
}
