import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AppStatus, PostingRow } from '@shared/api'
import { api, useLive } from './api'
import { useAppStatus } from './hooks'
import { Sidebar } from './components/Sidebar'
import { PostingList, SearchResults } from './components/Lists'
import { ActivityDrawer, Toasts } from './components/Activity'
import { Reader, type ReaderTarget } from './components/Reader'
import { SetupScreen, StartingScreen } from './components/Setup'
import { useTheme } from './theme'
import { useShortcut } from './shortcuts'
import { ShortcutHelp } from './components/ShortcutHelp'
import { Tooltips } from './components/Tooltips'
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
  const activeBox = ordered.find((b) => b.id === boxId) ?? ordered[0] ?? null

  const postings = useLive(
    () => (activeBox ? api.postings(activeBox.id) : Promise.resolve([] as PostingRow[])),
    [activeBox?.id],
    (e) => e.type === 'change' && e.change.kind === 'postings' && e.change.boxId === activeBox?.id,
  )

  const [query, setQuery] = useState('')
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
  const { theme, setTheme, toggle: toggleTheme } = useTheme()
  const [activePane, setActivePane] = useState<PaneId>('list')
  const [showActivity, setShowActivity] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const [composing, setComposing] = useState<ComposeRequest | null>(null)
  useShortcut('compose', () => setComposing({ kind: 'new', message: { to: [], subject: '', body: '' } }), !composing)
  // An undone or failed send comes back here for editing (see the toasts).
  useEffect(() => {
    const onRestore = (e: Event) => setComposing((e as CustomEvent<ComposeRequest>).detail)
    window.addEventListener('myhey:compose', onRestore)
    return () => window.removeEventListener('myhey:compose', onRestore)
  }, [])

  const list = postings.data ?? []
  const selectedIndex = target?.postingId != null ? list.findIndex((p) => p.id === target.postingId) : -1

  const open = useCallback((p: PostingRow) => {
    // Opening a thread marks it seen, as in HEY. Kept out of the activity log.
    if (!p.seen && !p.isBundle) api.runAction({ type: 'seen', postingId: p.id, seen: true }, 'auto').catch(() => {})
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

  // Keyboard (see shortcuts.ts for the full map).
  const step = (delta: number) => {
    const next = list[Math.min(Math.max(selectedIndex + delta, 0), list.length - 1)]
    if (next) open(next)
    setActivePane('list')
  }
  useShortcut('nextThread', () => step(1), !query)
  useShortcut('prevThread', () => step(-1), !query)
  useShortcut('search', () => searchRef.current?.focus())
  useShortcut('theme', toggleTheme)
  const goToBox = (i: number) => ordered[i] && setBoxId(ordered[i]!.id)
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
        activeBoxId={activeBox?.id ?? null}
        onSelectBox={(id) => {
          setBoxId(id)
          setQuery('')
        }}
        status={status}
        theme={theme}
        onTheme={setTheme}
        active={activePane === 'sidebar'}
        onOpenActivity={() => setShowActivity(true)}
      />

      <section className="pane flex flex-col bg-pane" data-pane="list" data-active={activePane === 'list'}>
        <header className="drag flex h-[52px] shrink-0 items-center gap-3 border-b border-rule px-4">
          <h1 className="text-[16px] font-semibold tracking-tight">
            {screening ? (
              <span className="flex items-center gap-2">
                <button onClick={leaveScreener} aria-label="Back to the Imbox" title="Back (Esc)" className="no-drag -ml-1 rounded-ui px-1 text-ink-faint hover:bg-pane-sunk hover:text-ink">
                  ←
                </button>
                The Screener
              </span>
            ) : query ? (
              'Search'
            ) : (
              (activeBox?.name ?? '')
            )}
          </h1>
          <div className="no-drag ml-auto flex h-7 w-44 items-center rounded-ui bg-pane-sunk px-2 text-ink-faint focus-within:ring-1 focus-within:ring-rule-strong">
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden className="shrink-0">
              <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5" />
              <path d="m10.5 10.5 3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search"
              aria-label="Search mail"
              className="ml-1.5 w-full bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-faint"
            />
            {!query && <kbd className="text-[11px] text-ink-faint">/</kbd>}
          </div>
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
        ) : query ? (
          <SearchResults
            query={query}
            onOpen={(hit) =>
              setTarget({ postingId: null, topicId: hit.topicId, entryCount: null, subject: hit.subject ?? '', appUrl: null, isBundle: false })
            }
            activeTopicId={target?.topicId ?? null}
          />
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
      </div>
      <Toasts />
      {showActivity && <ActivityDrawer onClose={() => setShowActivity(false)} />}
      {showHelp && <ShortcutHelp onClose={() => setShowHelp(false)} />}
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
