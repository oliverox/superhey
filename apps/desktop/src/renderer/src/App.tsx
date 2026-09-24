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
  const searchRef = useRef<HTMLInputElement>(null)
  const { theme, setTheme, toggle: toggleTheme } = useTheme()
  const [activePane, setActivePane] = useState<PaneId>('list')
  const [showActivity, setShowActivity] = useState(false)

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
    })
  }, [])

  // Keyboard: j/k or arrows move through the list, / searches, Esc leaves search.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement
      if (e.key === 'Escape') {
        setQuery('')
        searchRef.current?.blur()
        return
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === 'T' && e.shiftKey) {
        toggleTheme()
      } else if (e.key === '/') {
        e.preventDefault()
        searchRef.current?.focus()
      } else if ((e.key === 'j' || e.key === 'ArrowDown') && !query) {
        e.preventDefault()
        const next = list[Math.min(selectedIndex + 1, list.length - 1)]
        if (next) open(next)
        setActivePane('list')
      } else if ((e.key === 'k' || e.key === 'ArrowUp') && !query) {
        e.preventDefault()
        const prev = list[Math.max(selectedIndex - 1, 0)]
        if (prev) open(prev)
        setActivePane('list')
      } else if (/^[1-6]$/.test(e.key)) {
        const box = ordered[Number(e.key) - 1]
        if (box) setBoxId(box.id)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [list, selectedIndex, open, ordered, query, toggleTheme])

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
            {query ? 'Search' : (activeBox?.name ?? '')}
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
        {query ? (
          <SearchResults
            query={query}
            onOpen={(hit) =>
              setTarget({ postingId: null, topicId: hit.topicId, entryCount: null, subject: hit.subject ?? '', appUrl: null, isBundle: false })
            }
            activeTopicId={target?.topicId ?? null}
          />
        ) : (
          <PostingList
            key={activeBox?.id}
            postings={list}
            loading={postings.loading && !postings.data}
            selectedId={target?.postingId ?? null}
            onOpen={open}
          />
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
    </div>
  )
}
