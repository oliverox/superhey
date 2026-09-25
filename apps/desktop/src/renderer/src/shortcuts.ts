// Every keyboard shortcut, declared once. The same table drives key handling, the `?`
// overlay and button tooltips, so they can't disagree. Components attach handlers by ID
// while they're on screen (the action keys only work while a thread is open, etc.).
import { useEffect, useRef } from 'react'

export interface ShortcutDef {
  /** `KeyboardEvent.key` values; `mod+` means ⌘ on macOS / Ctrl elsewhere. */
  keys: readonly string[]
  label: string
  group: 'Navigate' | 'Thread' | 'Act' | 'Screener' | 'App'
  /** Also works while typing in a field (only for ⌘ combos, which type nothing). */
  whileTyping?: boolean
}

export const SHORTCUTS = {
  nextThread: { keys: ['j', 'ArrowDown'], label: 'Next thread', group: 'Navigate' },
  prevThread: { keys: ['k', 'ArrowUp'], label: 'Previous thread', group: 'Navigate' },
  today: { keys: ['0'], label: 'Today', group: 'Navigate' },
  box1: { keys: ['1'], label: 'Imbox', group: 'Navigate' },
  box2: { keys: ['2'], label: 'The Feed', group: 'Navigate' },
  box3: { keys: ['3'], label: 'Paper Trail', group: 'Navigate' },
  box4: { keys: ['4'], label: 'Reply Later', group: 'Navigate' },
  box5: { keys: ['5'], label: 'Set Aside', group: 'Navigate' },
  box6: { keys: ['6'], label: 'Bubble Up', group: 'Navigate' },
  search: { keys: ['/'], label: 'Search', group: 'Navigate' },

  expandAll: { keys: [';'], label: 'Expand all messages', group: 'Thread' },
  collapseAll: { keys: [':'], label: 'Collapse all messages', group: 'Thread' },
  details: { keys: ['i'], label: 'Show or hide details', group: 'Thread' },

  replyLater: { keys: ['r'], label: 'Reply Later', group: 'Act' },
  setAside: { keys: ['s'], label: 'Set Aside', group: 'Act' },
  bubbleMenu: { keys: ['b'], label: 'Bubble Up…', group: 'Act' },
  moveMenu: { keys: ['m'], label: 'Move to…', group: 'Act' },
  toFeed: { keys: ['f'], label: 'Move to The Feed', group: 'Act' },
  toTrail: { keys: ['p'], label: 'Move to Paper Trail', group: 'Act' },
  labelsMenu: { keys: ['l'], label: 'Labels…', group: 'Act' },
  toggleSeen: { keys: ['u'], label: 'Mark seen / unseen', group: 'Act' },
  trash: { keys: ['#'], label: 'Move to Trash', group: 'Act' },
  done: { keys: ['e'], label: 'Done (on Today)', group: 'Act' },
  undo: { keys: ['z', 'mod+z'], label: 'Undo last action', group: 'Act' },

  reply: { keys: ['R'], label: 'Reply', group: 'Act' },
  replyAll: { keys: ['a'], label: 'Reply all', group: 'Act' },
  forward: { keys: ['F'], label: 'Forward', group: 'Act' },
  compose: { keys: ['c'], label: 'New message', group: 'App' },

  screener: { keys: ['S'], label: 'Open The Screener', group: 'Screener' },
  screenYes: { keys: ['y'], label: 'Yes, let them in', group: 'Screener' },
  screenNo: { keys: ['n'], label: 'No, screen them out', group: 'Screener' },
  screenSpam: { keys: ['!'], label: 'Spam', group: 'Screener' },

  palette: { keys: ['mod+k'], label: 'Command bar', group: 'App', whileTyping: true },
  settings: { keys: ['mod+,'], label: 'Settings', group: 'App', whileTyping: true },
  help: { keys: ['?'], label: 'Keyboard shortcuts', group: 'App' },
  theme: { keys: ['T'], label: 'Switch theme', group: 'App' },
  appearance: { keys: ['D'], label: 'Light or dark mode', group: 'App' },
} as const satisfies Record<string, ShortcutDef>

export type ShortcutId = keyof typeof SHORTCUTS

/** Most recently registered handler wins, so an overlay can take over a key. */
const handlers = new Map<ShortcutId, Array<{ run: () => void }>>()

/** Attaches `run` to a shortcut while the component is mounted and `enabled` is true. */
export function useShortcut(id: ShortcutId, run: () => void, enabled = true) {
  const ref = useRef(run)
  ref.current = run
  useEffect(() => {
    if (!enabled) return
    const entry = { run: () => ref.current() }
    const list = handlers.get(id) ?? []
    list.push(entry)
    handlers.set(id, list)
    return () => {
      const current = handlers.get(id) ?? []
      handlers.set(
        id,
        current.filter((e) => e !== entry),
      )
    }
  }, [id, enabled])
}

/** The combo string for an event: its key, prefixed with `mod+` when ⌘/Ctrl is held. */
export function comboOf(e: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey'>): string | null {
  if (e.altKey) return null
  return e.metaKey || e.ctrlKey ? `mod+${e.key.toLowerCase()}` : e.key
}

/** Keys typed into a field belong to the field. */
export function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el || !el.tagName) return false
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)
}

/** Which shortcut an event triggers, if any (and if something is listening for it). */
export function match(e: KeyboardEvent): ShortcutId | null {
  if (e.defaultPrevented) return null
  const combo = comboOf(e)
  if (!combo) return null
  const typing = isTyping(e.target)
  for (const [id, def] of Object.entries(SHORTCUTS) as Array<[ShortcutId, ShortcutDef]>) {
    if (typing && !def.whileTyping) continue
    if (def.keys.includes(combo) && isAvailable(id)) return id
  }
  return null
}

/** Whether a shortcut does something right now (some component is listening for it). */
export function isAvailable(id: ShortcutId): boolean {
  return (handlers.get(id)?.length ?? 0) > 0
}

/** Runs a shortcut's current handler, as its key would. Returns whether one ran. */
export function runShortcut(id: ShortcutId): boolean {
  const handler = handlers.get(id)?.at(-1)
  handler?.run()
  return !!handler
}

/** One listener for the whole app. Returns a cleanup function. */
export function installShortcuts(target: Window = window): () => void {
  const onKey = (e: KeyboardEvent) => {
    const id = match(e)
    if (!id) return
    e.preventDefault()
    runShortcut(id)
  }
  target.addEventListener('keydown', onKey)
  return () => target.removeEventListener('keydown', onKey)
}

const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform)
const KEY_NAMES: Record<string, string> = { ArrowDown: '↓', ArrowUp: '↑', enter: '↵', Enter: '↵' }

/** How a key is written in the UI: "r", "⇧R", "⌘Z", "⌘↵", "↓". */
export function keyLabel(key: string): string {
  if (key.startsWith('mod+')) {
    const k = key.slice(4)
    return `${isMac ? '⌘' : 'Ctrl+'}${KEY_NAMES[k] ?? k.toUpperCase()}`
  }
  if (/^[A-Z]$/.test(key)) return `⇧${key}`
  return KEY_NAMES[key] ?? key
}

/** Tooltip text for a button: its label and first key, e.g. "Reply Later (r)". */
export function withShortcut(label: string, id: ShortcutId): string {
  return `${label} (${keyLabel(SHORTCUTS[id].keys[0]!)})`
}

/** For tests: forget all registered handlers. */
export function resetShortcuts() {
  handlers.clear()
}
