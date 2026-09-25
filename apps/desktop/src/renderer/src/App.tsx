import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AppStatus, BoxRow, PostingRow } from '@shared/api'
import { api, useLive } from './api'
import { useAppStatus } from './hooks'
import { Sidebar } from './components/Sidebar'
import { PostingList } from './components/Lists'
import { SearchField, SearchFilters, SearchResults } from './components/Search'
import { ActivityDrawer, Toasts } from './components/Activity'
import { Reader, type ReaderTarget } from './components/Reader'
import { SetupScreen, StartingScreen } from './components/Setup'
import { useTheme } from './theme'
import { useShortcut } from './shortcuts'
import { ShortcutHelp } from './components/ShortcutHelp'
import { Tooltips } from './components/Tooltips'
import { CommandBar } from './components/CommandBar'
import { Settings } from './components/Settings'
import { doneFor, TodayDone, TodayList, todayLabel, todayThreads, type TodayData } from './components/Today'
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
  const boxes = useLive(() => api.boxes(), [], (e) => e.type === 'change')
  const ordered = useMemo(
    () => [...(boxes.data ?? [])].sort((a, b) => BOX_ORDER.indexOf(a.kind) - BOX_ORDER.indexOf(b.kind)),
    [boxes.data],
  )

  const [boxId, setBoxId] = useState<number | null>(null)
  // Today is where the app opens; a box replaces it until you come back (0).
  const [onToday, setOnToday] = useState(true)
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
  const [target, setTarget] = useState<ReaderTarget | null>(null)
  const waiting = useScreener()
  const [screening, setScreening] = useState(false)
  const screeningRef = useRef(screening)
  screeningRef.current = screening
  const screenerTarget = target?.screeningId ?? null
  const openScreener = () => {
    setQuery('')
    setScreening(true)
  }
  const leaveScreener = useCallback(() => {
    setScreening(false)
    setTarget(null)
  }, [])
  useShortcut('screener', openScreener, waiting.length > 0 && !screening)
  const searchRef = useRef<HTMLInputElement>(null)
  const { theme, setTheme, toggle: toggleTheme, scheme, setScheme, toggleDark } = useTheme()
  const [activePane, setActivePane] = useState<PaneId>('list')
  const [showActivity, setShowActivity] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const [showCommands, setShowCommands] = useState(false)
  useShortcut('palette', () => setShowCommands((v) => !v))
  const [showSettings, setShowSettings] = useState(false)
  useShortcut('settings', () => setShowSettings((v) => !v))
  const [composing, setComposing] = useState<ComposeRequest | null>(null)
  useShortcut('compose', () => setComposing({ kind: 'new', message: { to: [], subject: '', body: '' } }), !composing)
  // An undone or failed send comes back here for editing (see the toasts).
  useEffect(() => {
    const onRestore = (e: Event) => setComposing((e as CustomEvent<ComposeRequest>).detail)
    window.addEventListener('myhey:compose', onRestore)
    return () => window.removeEventListener('myhey:compose', onRestore)
  }, [])

  const list = searching ? searchRows : onToday ? todayThreads(todayData) : (postings.data ?? [])
  const selectedIndex = target?.postingId != null ? list.findIndex((p) => p.id === target.postingId) : -1

  /** `markSeen: false` shows a thread without reading it (Today putting its first item up). */
  const open = useCallback((p: PostingRow, markSeen = true) => {
    // Opening a thread marks it seen, as in HEY. Kept out of the activity log.
    if (markSeen && !p.seen && !p.isBundle) api.runAction({ type: 'seen', postingId: p.id, seen: true }, 'auto').catch(() => {})
    setTarget({
      postingId: p.id,
      topicId: p.topicId,
      entryCount: p.entryCount,
      subject: p.subject,
      appUrl: p.appUrl,
      isBundle: p.isBundle,
      sender: p.senderName ?? p.senderEmail,
    })
  }, [])

  // On Today, the reader shows the first thing to handle, so there's never an empty pane to
  // look at. It isn't marked seen: you haven't chosen to read it.
  const firstOnToday = todayThreads(todayData)[0]
  useEffect(() => {
    if (onToday && !screening && !query && !target && firstOnToday) open(firstOnToday, false)
  }, [onToday, screening, query, target, firstOnToday, open])

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
  useShortcut('appearance', toggleDark, theme === 'default')
  const showBox = (id: number) => {
    setOnToday(false)
    setScreening(false)
    setQuery('')
    setBoxId(id)
  }
  const goToBox = (i: number) => ordered[i] && showBox(ordered[i]!.id)
  const goToToday = () => {
    setOnToday(true)
    setScreening(false)
    setQuery('')
    setTarget(null)
  }
  useShortcut('today', goToToday)
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
      className="tiles grid h-full grid-cols-[232px_minmax(340px,440px)_1fr]"
      onMouseDown={(e) => {
        const pane = (e.target as HTMLElement).closest<HTMLElement>('[data-pane]')?.dataset.pane as PaneId | undefined
        if (pane) setActivePane(pane)
      }}
    >
      <Sidebar
        boxes={ordered}
        activeBoxId={onToday || screening ? null : (activeBox?.id ?? null)}
        onSelectBox={showBox}
        today={{ active: onToday && !screening, count: todayData?.toHandle ?? null, onSelect: goToToday }}
        status={status}
        theme={theme}
        scheme={scheme}
        onScheme={setScheme}
        onTheme={setTheme}
        active={activePane === 'sidebar'}
        onOpenActivity={() => setShowActivity(true)}
        onOpenSettings={() => setShowSettings(true)}
      />

      <section className="pane flex flex-col bg-pane" data-pane="list" data-active={activePane === 'list'}>
        <header className="drag flex h-[52px] shrink-0 items-center border-b border-rule px-4">
          {/* The title makes way while the search box is in use. */}
          <h1
            aria-hidden={searchExpanded}
            className={`shrink-0 overflow-hidden text-[16px] font-semibold tracking-tight whitespace-nowrap transition-[max-width,opacity,margin] duration-200 ease-out ${
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
              <span className="flex items-baseline gap-2">
                Today <span className="text-[12.5px] font-normal text-ink-faint">{todayLabel()}</span>
              </span>
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
              searchRef.current?.blur()
              setActivePane('list')
              if (searchRows[0]) open(searchRows[0])
            }}
          />
        </header>
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
            postings={list}
            loading={postings.loading && !postings.data}
            selectedId={target?.postingId ?? null}
            onOpen={open}
          />
          </>
        )}
      </section>

      <div data-pane="reader" className="contents">
        {onToday && !screening && !query && !target ? (
          <TodayDone />
        ) : (
        <Reader
          target={target}
          active={activePane === 'reader'}
          onOpenThread={open}
          onLeaveBox={() => {
            // Move on to the next thread (or the previous one at the end), like HEY.
            const i = list.findIndex((p) => p.id === target?.postingId)
            const next = i < 0 ? undefined : (list[i + 1] ?? list[i - 1])
            if (next) open(next)
            else setTarget(null)
          }}
        />
        )}
      </div>
      <Toasts />
      {showActivity && <ActivityDrawer onClose={() => setShowActivity(false)} />}
      {showHelp && <ShortcutHelp onClose={() => setShowHelp(false)} />}
      {showSettings && <Settings onClose={() => setShowSettings(false)} />}
      {showCommands && (
        <CommandBarHost
          boxes={ordered}
          postingId={target?.postingId ?? null}
          onClose={() => setShowCommands(false)}
          goToBox={showBox}
          openEmail={(p) => {
            // Into its box when it's one of the six, so the list shows it selected.
            if (ordered.some((b) => b.id === p.boxId)) showBox(p.boxId)
            else {
              setScreening(false)
              setQuery('')
            }
            open(p)
          }}
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
