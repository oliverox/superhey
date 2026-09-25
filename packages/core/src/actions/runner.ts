import { EventEmitter } from 'node:events'
import type { SQLInputValue } from 'node:sqlite'
import type { BubbleWhen, HeyClient, ScreenerBox } from '../cli/client'
import type { Repo } from '../cache/repo'
import { PostingId } from '../ids'
import type { SyncEngine } from '../sync/engine'

/** Boxes a thread can be moved to. Bubble Up goes through the bubble actions instead. */
export type MoveTarget = 'imbox' | 'feedbox' | 'trailbox' | 'laterbox' | 'asidebox'

export type Action =
  | { type: 'seen'; postingId: number; seen: boolean }
  | { type: 'move'; postingId: number; to: MoveTarget }
  | { type: 'bubble'; postingId: number; when: BubbleWhen }
  | { type: 'unbubble'; postingId: number }
  | { type: 'label'; postingId: number; labelId: number; add: boolean }
  | { type: 'trash'; postingId: number }
  /** A Screener decision. Keyed by clearance ID (the sender isn't a posting yet). */
  | { type: 'screen'; clearanceId: number; decision: 'approve' | 'deny' | 'spam'; box?: ScreenerBox; name?: string }
  /** Completes (or reopens) a HEY to-do. */
  | { type: 'todo'; todoId: number; done: boolean }

/** Actions on a thread already in the cache (everything but Screener decisions and to-dos). */
type PostingAction = Exclude<Action, { type: 'screen' | 'todo' }>

/** Who asked: the user, an automatic behaviour (seen-on-open), an undo, and later agents and rules. */
export type ActionSource = 'user' | 'auto' | 'undo' | 'agent' | 'rule'

export type ActionStatus = 'running' | 'done' | 'failed' | 'undone'

export interface ActionRecord {
  id: number
  source: ActionSource
  type: Action['type']
  postingId: number
  summary: string
  status: ActionStatus
  /** true = confirmed in HEY; null = done but HEY's answer couldn't confirm it. */
  verified: boolean | null
  error: string | null
  createdAt: string
  canUndo: boolean
}

const BOX_NAMES: Record<MoveTarget, string> = {
  imbox: 'Imbox',
  feedbox: 'The Feed',
  trailbox: 'Paper Trail',
  laterbox: 'Reply Later',
  asidebox: 'Set Aside',
}

const WHEN_WORDS: Record<BubbleWhen['kind'], string> = {
  now: 'now',
  tomorrow: 'tomorrow',
  weekend: 'this weekend',
  'next-week': 'next week',
  on: '',
}

/**
 * Runs actions against HEY through the CLI. Each one is logged, applied to the cache at
 * once (so the UI moves immediately), executed, verified, and rolled back if HEY did not
 * take it. Its inverse is worked out from the thread's state beforehand, for undo.
 */
export class ActionRunner extends EventEmitter<{ action: [ActionRecord] }> {
  constructor(
    private readonly client: HeyClient,
    private readonly repo: Repo,
    private readonly engine: SyncEngine,
  ) {
    super()
  }

  async run(action: Action, source: ActionSource = 'user'): Promise<ActionRecord> {
    if (action.type === 'screen') return this.screen(action, source)
    if (action.type === 'todo') return this.todo(action, source)
    const posting = this.repo.posting(PostingId(action.postingId))
    if (!posting) throw new Error(`thread ${action.postingId} is not in the cache`)
    const snapshot = this.repo.postingSnapshot(action.postingId)!
    const inverse = this.inverseOf(action)
    const id = this.insert(action, source, this.describe(action, posting.subject), inverse)
    this.publish(id)

    try {
      this.applyOptimistic(action)
      const verified = await this.execute(action, posting.boxId, source)
      if (verified === false) throw new Error("HEY didn't apply the change")
      this.finish(id, 'done', verified, null)
    } catch (err) {
      this.repo.restorePosting(snapshot)
      this.engine.notify({ kind: 'postings', boxId: posting.boxId })
      this.finish(id, 'failed', null, err instanceof Error ? err.message : String(err))
    }
    // Re-read the boxes involved so the cache matches HEY (automatic marks leave that to
    // the live watch).
    if (source !== 'auto') for (const boxId of this.boxesTouched(action, posting.boxId)) this.engine.requestBoxRefresh(boxId)
    return this.publish(id)
  }

  /** Reverses a finished action by running its inverse. */
  async undo(actionId: number): Promise<ActionRecord> {
    const row = this.row(actionId)
    if (!row) throw new Error(`no action ${actionId}`)
    if (row.status !== 'done' || !row.inverse_json || row.undone_by != null) throw new Error("This action can't be undone")
    const steps = JSON.parse(row.inverse_json) as Action[]
    let last: ActionRecord | null = null
    for (const step of steps) {
      last = await this.run(step, 'undo')
      if (last.status === 'failed') throw new Error(`Undo failed: ${last.error}`)
    }
    this.repo.db.prepare("UPDATE actions SET status = 'undone', undone_by = ? WHERE id = ?").run(last?.id ?? null, actionId)
    return this.publish(actionId)
  }

  /** Recent actions, newest first. Automatic ones (seen-on-open) are left out unless asked. */
  recent(limit = 50, includeAuto = false): ActionRecord[] {
    const rows = this.repo.db
      .prepare(`SELECT * FROM actions ${includeAuto ? '' : "WHERE source != 'auto'"} ORDER BY id DESC LIMIT ?`)
      .all(limit) as ActionRow[]
    return rows.map(toRecord)
  }

  /**
   * Yes and No undo each other (HEY lets a decision be reversed with the opposite one);
   * Spam also trains HEY's filter, so it has no undo. Verified by the sender leaving the queue.
   */
  private async screen(action: Extract<Action, { type: 'screen' }>, source: ActionSource): Promise<ActionRecord> {
    const who = action.name ?? 'this sender'
    const summary =
      action.decision === 'approve'
        ? `Let ${who} in${action.box && action.box !== 'imbox' ? ` (to ${BOX_NAMES[action.box]})` : ''}`
        : action.decision === 'deny'
          ? `Screened out ${who}`
          : `Marked ${who} as spam`
    const inverse: Action[] | null =
      action.decision === 'approve'
        ? [{ ...action, decision: 'deny', box: undefined }]
        : action.decision === 'deny'
          ? [{ ...action, decision: 'approve', box: 'imbox' }]
          : null
    const res = this.repo.db
      .prepare(
        `INSERT INTO actions (source, type, params_json, status, created_at, posting_id, summary, inverse_json)
         VALUES (?, 'screen', ?, 'running', ?, 0, ?, ?)`,
      )
      .run(source, JSON.stringify(action), new Date().toISOString(), summary, inverse ? JSON.stringify(inverse) : null)
    const id = Number(res.lastInsertRowid)
    this.publish(id)
    try {
      if (action.decision === 'approve') await this.client.screenerApprove(action.clearanceId, action.box)
      else await this.client.screenerDeny(action.clearanceId, { spam: action.decision === 'spam' })
      const waiting = await this.engine.refreshScreener()
      // An undo puts a decided sender back in play, so only a first decision is checked here.
      const verified = source === 'undo' ? null : !waiting.some((e) => e.id === action.clearanceId)
      if (verified === false) throw new Error("HEY didn't apply the decision")
      this.finish(id, 'done', verified, null)
    } catch (err) {
      this.finish(id, 'failed', null, err instanceof Error ? err.message : String(err))
    }
    // Approving delivers the sender's waiting mail.
    if (action.decision === 'approve') {
      const box = this.repo.boxByKind(action.box ?? 'imbox')
      if (box) this.engine.requestBoxRefresh(box.id)
    }
    return this.publish(id)
  }

  /**
   * Completes or reopens a to-do; each undoes the other. Applied to the cache at once, then
   * verified by reading HEY's to-dos back.
   */
  private async todo(action: Extract<Action, { type: 'todo' }>, source: ActionSource): Promise<ActionRecord> {
    const before = this.repo.todo(action.todoId)
    if (!before) throw new Error(`to-do ${action.todoId} is not in the cache`)
    const summary = `${action.done ? 'Completed' : 'Reopened'} “${before.title}”`
    const inverse: Action[] = [{ ...action, done: !action.done }]
    const res = this.repo.db
      .prepare(
        `INSERT INTO actions (source, type, params_json, status, created_at, posting_id, summary, inverse_json)
         VALUES (?, 'todo', ?, 'running', ?, 0, ?, ?)`,
      )
      .run(source, JSON.stringify(action), new Date().toISOString(), summary, JSON.stringify(inverse))
    const id = Number(res.lastInsertRowid)
    this.publish(id)
    this.repo.setTodoDone(action.todoId, action.done ? new Date().toISOString() : null)
    this.engine.notify({ kind: 'todos' })
    try {
      await this.client.todoDone(action.todoId, action.done)
      await this.engine.refreshTodos()
      const after = this.repo.todo(action.todoId)
      if (!after || (after.completedAt != null) !== action.done) throw new Error("HEY didn't apply the change")
      this.finish(id, 'done', true, null)
    } catch (err) {
      this.repo.setTodoDone(action.todoId, before.completedAt)
      this.engine.notify({ kind: 'todos' })
      this.finish(id, 'failed', null, err instanceof Error ? err.message : String(err))
    }
    return this.publish(id)
  }

  // Internals

  /** The actions that put things back as they are now. Empty when nothing would change. */
  private inverseOf(action: PostingAction): Action[] | null {
    const p = this.repo.posting(PostingId(action.postingId))!
    const box = this.repo.box(p.boxId)
    const restoreSeen: Action[] = [{ type: 'seen', postingId: action.postingId, seen: p.seen }]
    switch (action.type) {
      case 'seen':
        return p.seen === action.seen ? null : restoreSeen
      case 'move':
        // Moving can mark a thread seen, so undo restores that too.
        return box?.kind === action.to || !isMoveTarget(box?.kind) ? null : [{ type: 'move', postingId: action.postingId, to: box!.kind as MoveTarget }, ...restoreSeen]
      case 'bubble':
        return [
          { type: 'unbubble', postingId: action.postingId },
          ...(isMoveTarget(box?.kind) ? [{ type: 'move' as const, postingId: action.postingId, to: box!.kind as MoveTarget }] : []),
          ...restoreSeen,
        ]
      case 'unbubble':
        return null
      case 'label': {
        const has = this.repo.postingLabelIds(action.postingId).includes(action.labelId)
        return has === action.add ? null : [{ ...action, add: !action.add }]
      }
      case 'trash':
        return null // the CLI cannot restore from Trash
    }
  }

  private applyOptimistic(action: PostingAction) {
    const p = this.repo.posting(PostingId(action.postingId))!
    const boxes = new Set([p.boxId])
    switch (action.type) {
      case 'seen':
        this.repo.setSeen(PostingId(action.postingId), action.seen)
        break
      case 'move': {
        const dest = this.repo.boxByKind(action.to)
        if (dest) {
          this.repo.setPostingBox(action.postingId, dest.id)
          boxes.add(dest.id)
        }
        break
      }
      case 'bubble':
        if (action.when.kind === 'now') this.repo.setBubbledUp(action.postingId, true)
        else {
          const dest = this.repo.boxByKind('bubblebox')
          if (dest) {
            this.repo.setPostingBox(action.postingId, dest.id)
            boxes.add(dest.id)
          }
        }
        break
      case 'unbubble':
        this.repo.setBubbledUp(action.postingId, false)
        break
      case 'label': {
        const label = this.repo.labels().find((l) => l.id === action.labelId)
        if (label) this.repo.setPostingLabel(action.postingId, label, action.add)
        break
      }
      case 'trash':
        this.repo.deletePosting(action.postingId)
        break
    }
    for (const boxId of boxes) this.engine.notify({ kind: 'postings', boxId })
  }

  private async execute(action: PostingAction, fromBoxId: number, source: ActionSource): Promise<boolean | null> {
    const id = PostingId(action.postingId)
    switch (action.type) {
      case 'seen': {
        const box = this.repo.posting(id)?.boxId
        // Automatic marks (seen-on-open) aren't re-checked: one CLI call instead of up to
        // four, and the live watch reports HEY's change anyway.
        return box == null ? null : (await this.client.markSeen(id, box, action.seen, { verify: source !== 'auto' })).verified
      }
      case 'move':
        return (await this.client.move(id, action.to, fromBoxId)).verified
      case 'bubble':
        return (await this.client.bubbleUp(id, action.when)).verified
      case 'unbubble':
        return (await this.client.bubblePop(id)).verified
      case 'label':
        await (action.add ? this.client.labelAdd(id, action.labelId) : this.client.labelRemove(id, action.labelId))
        return true
      case 'trash':
        await this.client.trash(id)
        return true
    }
  }

  private boxesTouched(action: PostingAction, fromBoxId: number): number[] {
    const kinds = action.type === 'move' ? [action.to] : action.type === 'bubble' || action.type === 'unbubble' ? ['bubblebox', 'imbox'] : []
    const ids = kinds.flatMap((k) => this.repo.boxByKind(k)?.id ?? [])
    return [...new Set([fromBoxId, ...ids])]
  }

  private describe(action: PostingAction, subject: string): string {
    const s = `“${subject || '(no subject)'}”`
    switch (action.type) {
      case 'seen':
        return `Marked ${s} as ${action.seen ? 'seen' : 'unseen'}`
      case 'move':
        return `Moved ${s} to ${BOX_NAMES[action.to]}`
      case 'bubble':
        return action.when.kind === 'on' ? `Bubble up ${s} on ${action.when.date}` : action.when.kind === 'now' ? `Bubbled up ${s}` : `Bubble up ${s} ${WHEN_WORDS[action.when.kind]}`
      case 'unbubble':
        return `Cancelled bubble up for ${s}`
      case 'label': {
        const name = this.repo.labels().find((l) => l.id === action.labelId)?.name ?? 'label'
        return action.add ? `Labelled ${s} ${name}` : `Removed label ${name} from ${s}`
      }
      case 'trash':
        return `Trashed ${s}`
    }
  }

  private insert(action: PostingAction, source: ActionSource, summary: string, inverse: Action[] | null): number {
    const res = this.repo.db
      .prepare(
        `INSERT INTO actions (source, type, params_json, status, created_at, posting_id, summary, inverse_json)
         VALUES (?, ?, ?, 'running', ?, ?, ?, ?)`,
      )
      .run(source, action.type, JSON.stringify(action), new Date().toISOString(), action.postingId, summary, inverse ? JSON.stringify(inverse) : null)
    return Number(res.lastInsertRowid)
  }

  private finish(id: number, status: ActionStatus, verified: boolean | null, error: string | null) {
    this.repo.db
      .prepare('UPDATE actions SET status = ?, verified = ?, error = ?, executed_at = ? WHERE id = ?')
      .run(status, verified == null ? null : verified ? 1 : 0, error, new Date().toISOString(), id)
  }

  private row(id: number) {
    return this.repo.db.prepare('SELECT * FROM actions WHERE id = ?').get(id) as ActionRow | undefined
  }

  private publish(id: number): ActionRecord {
    const record = toRecord(this.row(id)!)
    this.emit('action', record)
    return record
  }
}

interface ActionRow extends Record<string, SQLInputValue> {
  id: number
  source: string
  type: string
  status: string
  verified: number | null
  error: string | null
  created_at: string
  posting_id: number
  summary: string
  inverse_json: string | null
  undone_by: number | null
}

function toRecord(r: ActionRow): ActionRecord {
  return {
    id: r.id,
    source: r.source as ActionSource,
    type: r.type as Action['type'],
    postingId: r.posting_id,
    summary: r.summary,
    status: r.status as ActionStatus,
    verified: r.verified == null ? null : r.verified === 1,
    error: r.error,
    createdAt: r.created_at,
    canUndo: r.status === 'done' && r.inverse_json != null && r.undone_by == null && r.source !== 'undo',
  }
}

function isMoveTarget(kind: string | undefined): kind is MoveTarget {
  return kind != null && kind in BOX_NAMES
}

