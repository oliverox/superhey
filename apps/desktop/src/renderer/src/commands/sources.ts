import type { BoxRow, PostingRow } from '@shared/api'
import { shortDate } from '../format'
import { isAvailable, runShortcut, SHORTCUTS, type ShortcutDef, type ShortcutId } from '../shortcuts'
import type { Command, Section } from './model'

/**
 * Where the command bar's commands come from. Each source is a plain function of the app's
 * state, so what's offered is exactly what works at that moment.
 */

/** Shortcuts the bar leaves out: moving through a list, and the boxes (their own source). */
const NOT_COMMANDS = new Set<ShortcutId>(['palette', 'nextThread', 'prevThread', 'box1', 'box2', 'box3', 'box4', 'box5', 'box6'])

/** Other words people reach for. */
const KEYWORDS: Partial<Record<ShortcutId, string[]>> = {
  replyLater: ['later', 'todo', 'follow up'],
  setAside: ['save', 'keep', 'pin'],
  bubbleMenu: ['remind', 'snooze', 'later'],
  moveMenu: ['file', 'box'],
  toFeed: ['newsletter', 'feed'],
  toTrail: ['receipt', 'paper trail', 'file'],
  labelsMenu: ['tag', 'label'],
  toggleSeen: ['read', 'unread', 'mark'],
  trash: ['delete', 'remove', 'bin'],
  undo: ['revert'],
  compose: ['write', 'new email', 'send'],
  forward: ['share', 'fwd'],
  search: ['find'],
  details: ['sidebar', 'info', 'context'],
  theme: ['omarchy', 'default'],
  appearance: ['dark', 'light', 'night', 'appearance', 'mode'],
  help: ['keys', 'keyboard', 'shortcuts'],
  settings: ['preferences', 'ai', 'claude', 'api key', 'budget', 'model'],
  screener: ['first-time', 'senders', 'approve'],
}

const SECTION_OF: Record<ShortcutDef['group'], Section> = {
  Navigate: 'Go to',
  Thread: 'Actions',
  Act: 'Actions',
  Screener: 'Actions',
  App: 'App',
}

/** Every shortcut that does something right now, as a command that runs it. */
export function shortcutCommands(available: (id: ShortcutId) => boolean = isAvailable, run: (id: ShortcutId) => void = runShortcut): Command[] {
  return (Object.entries(SHORTCUTS) as Array<[ShortcutId, ShortcutDef]>)
    .filter(([id]) => !NOT_COMMANDS.has(id) && available(id))
    .map(([id, def]) => ({
      id: `key:${id}`,
      // The Screener is a place to go; its decisions are actions.
      section: id === 'screener' ? 'Go to' : SECTION_OF[def.group],
      title: def.label,
      keywords: KEYWORDS[id],
      keys: def.keys.slice(0, 1),
      run: () => run(id),
    }))
}

/** The boxes, in sidebar order, with their number keys. */
export function boxCommands(boxes: BoxRow[], go: (boxId: number) => void): Command[] {
  return boxes.map((b, i) => ({
    id: `box:${b.kind}`,
    section: 'Go to',
    title: b.name,
    keywords: ['go to', 'open', 'box'],
    keys: i < 6 ? [String(i + 1)] : undefined,
    run: () => go(b.id),
  }))
}

/** For the open thread: add each label it lacks, remove each it has. */
export function labelCommands(labels: Array<{ id: number; name: string }>, posting: PostingRow | null, toggle: (labelId: number, add: boolean) => void): Command[] {
  if (!posting || posting.isBundle) return []
  return labels.map((l) => {
    const on = posting.labels.includes(l.name)
    return {
      id: `label:${l.id}`,
      section: 'Labels',
      title: on ? `Remove label ${l.name}` : `Label ${l.name}`,
      keywords: [l.name, 'tag'],
      run: () => toggle(l.id, !on),
    }
  })
}

/** An email found in the cache, to jump to. Found by subject or sender, in either order. */
export function emailCommand(p: PostingRow, open: (p: PostingRow) => void): Command {
  const sender = p.senderName ?? p.senderEmail ?? ''
  return {
    id: `email:${p.id}`,
    section: 'Emails',
    title: p.subject || '(no subject)',
    detail: [sender, p.activeAt ? shortDate(p.activeAt) : ''].filter(Boolean).join(' · '),
    keywords: [`${sender} ${p.subject}`, `${p.subject} ${sender}`, p.senderEmail ?? ''],
    run: () => open(p),
  }
}
