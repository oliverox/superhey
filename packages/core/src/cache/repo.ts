import type { SQLInputValue } from 'node:sqlite'
import { PostingId, TopicId } from '../ids'
import type * as S from '../cli/schemas'
import { normalizeUtc } from '../cli/schemas'
import { transaction, type Db } from './db'

// Rows handed to the UI. Plain JSON so they cross Electron IPC unchanged.

export interface PostingRow {
  id: PostingId
  topicId: TopicId | null
  boxId: number
  subject: string
  summary: string | null
  senderName: string | null
  senderEmail: string | null
  seen: boolean
  bubbledUp: boolean
  entryCount: number | null
  hasAttachments: boolean
  isBundle: boolean
  activeAt: string | null
  appUrl: string | null
  /** HEY label names on the thread. */
  labels: string[]
  /** The sender's avatar as HEY describes it: a logo/photo URL, and the colour and initials for the fallback. */
  avatar: { url: string | null; color: string | null; initials: string }
  /** HEY blocked spy trackers in this email. */
  blockedTrackers: boolean
  /** For a bundle row: how many unread threads it holds (from the cache). */
  bundleCount: number | null
  /** What the AI made of the thread (when it has looked at it). */
  ai: PostingAnalysis | null
}

/** The part of a thread's analysis the list shows. */
export interface PostingAnalysis {
  summary: string
  needsReply: boolean
  replyReason: string | null
  expectsReply: boolean
  category: string
}

export interface AttachmentRow {
  id: string
  filename: string
  contentType: string | null
  byteSize: number | null
  /** Embedded in the message HTML (inline images, logos) rather than attached. */
  embedded: boolean
}

export interface Person {
  name: string | null
  email: string
  /** One of the account's own addresses. */
  isMe: boolean
}

export interface EntryRow {
  id: number
  from: Person | null
  createdAt: string
  to: Person[]
  cc: Person[]
  bodyMd: string
  isMine: boolean
  attachments: AttachmentRow[]
}

export interface ThreadView {
  topicId: TopicId
  subject: string | null
  fetchedAt: string
  entries: EntryRow[]
}

export interface BoxRow {
  id: number
  kind: string
  name: string
  unseen: number
}

export interface EventRow {
  key: string
  id: number
  calendarId: number | null
  title: string
  startsAt: string
  endsAt: string | null
  allDay: boolean
  location: string | null
}

export interface SearchHit {
  entryId: number
  topicId: TopicId
  subject: string | null
  senderName: string | null
  createdAt: string
  snippet: string
}

const now = () => new Date().toISOString()

const b = (v: boolean | null | undefined) => (v ? 1 : 0)
const n = <T>(v: T | null | undefined): T | null => v ?? null
/** HEY's kind decides; only a posting without one is taken for a bundle by its missing thread. */
const isBundle = (p: { kind?: string | null; topic_id?: number | null }) => (p.kind == null ? p.topic_id == null : p.kind === 'bundle')

export class Repo {
  constructor(readonly db: Db) {}

  private run(sql: string, ...params: SQLInputValue[]) {
    return this.db.prepare(sql).run(...params)
  }
  private all<T>(sql: string, ...params: SQLInputValue[]) {
    return this.db.prepare(sql).all(...params) as T[]
  }
  private get<T>(sql: string, ...params: SQLInputValue[]) {
    return this.db.prepare(sql).get(...params) as T | undefined
  }

  // Boxes

  replaceBoxes(boxes: S.Box[]) {
    transaction(this.db, () => {
      this.run('DELETE FROM boxes')
      for (const x of boxes) this.run('INSERT INTO boxes (id, kind, name) VALUES (?, ?, ?)', x.id, x.kind, x.name)
    })
  }

  boxes(): BoxRow[] {
    // Unread rows as HEY counts them: a bundle counts once, the mail inside it not at all.
    return this.all<BoxRow>(`
      SELECT b.id, b.kind, b.name,
        (SELECT count(*) FROM postings p WHERE p.box_id = b.id AND p.seen = 0)
        - (SELECT count(*) FROM postings m
             WHERE m.box_id = b.id AND m.seen = 0 AND m.is_bundle = 0
               AND m.sender_email IN (SELECT sender_email FROM postings x WHERE x.box_id = b.id AND x.is_bundle = 1)) AS unseen
      FROM boxes b ORDER BY b.id`)
  }

  boxByKind(kind: string) {
    return this.get<{ id: number; kind: string; name: string }>('SELECT * FROM boxes WHERE kind = ?', kind)
  }

  // Postings

  upsertPostings(postings: S.Posting[], fallbackBoxId?: number) {
    transaction(this.db, () => {
      for (const p of postings) this.upsertPosting(p, fallbackBoxId)
    })
  }

  private upsertPosting(p: S.Posting, fallbackBoxId?: number) {
    const boxId = p.box_id ?? fallbackBoxId
    if (boxId == null) return
    const sender = p.creator
    this.run(
      `INSERT INTO postings (id, topic_id, box_id, subject, summary, sender_name, sender_email, seen,
         bubbled_up, entry_count, has_attachments, is_bundle, created_at, active_at, updated_at,
         app_url, raw_json, synced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET
         -- An update that lacks the thread ID never erases a known one.
         topic_id = coalesce(excluded.topic_id, postings.topic_id), box_id = excluded.box_id, subject = excluded.subject,
         summary = excluded.summary, sender_name = excluded.sender_name,
         sender_email = excluded.sender_email, seen = excluded.seen,
         bubbled_up = excluded.bubbled_up, entry_count = excluded.entry_count,
         has_attachments = excluded.has_attachments,
         -- HEY's kind decides. Only without one does a missing thread ID mean a bundle: other
         -- kinds lack it too (a HEY World post), and taking one for a bundle would hide its
         -- sender's unread mail. (coalesce: json_extract answers NULL, which the column refuses.)
         is_bundle = CASE WHEN json_extract(excluded.raw_json, '$.kind') IS NULL
                          THEN coalesce(excluded.topic_id, postings.topic_id) IS NULL
                          ELSE json_extract(excluded.raw_json, '$.kind') = 'bundle' END,
         created_at = excluded.created_at, active_at = excluded.active_at,
         updated_at = excluded.updated_at, app_url = excluded.app_url,
         raw_json = excluded.raw_json, synced_at = excluded.synced_at`,
      p.id,
      n(p.topic_id),
      boxId,
      p.name,
      n(p.summary),
      n(p.alternative_sender_name ?? sender?.name ?? sender?.email_address),
      n(sender?.email_address?.toLowerCase()),
      b(p.seen),
      b(p.bubbled_up),
      n(p.visible_entry_count),
      b(p.includes_attachments),
      b(isBundle(p)),
      n(p.created_at),
      n(p.active_at),
      n(p.updated_at),
      n(p.app_url),
      JSON.stringify(p),
      now(),
    )
  }

  /** The raw cache row, for restoring after a failed optimistic change. */
  postingSnapshot(id: number): Record<string, SQLInputValue> | null {
    return this.get<Record<string, SQLInputValue>>('SELECT * FROM postings WHERE id = ?', id) ?? null
  }

  restorePosting(row: Record<string, SQLInputValue>) {
    const cols = Object.keys(row)
    this.run(
      `INSERT OR REPLACE INTO postings (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
      ...cols.map((c) => row[c]!),
    )
  }

  setPostingBox(id: number, boxId: number) {
    this.run('UPDATE postings SET box_id = ? WHERE id = ?', boxId, id)
  }

  setBubbledUp(id: number, bubbledUp: boolean) {
    this.run('UPDATE postings SET bubbled_up = ? WHERE id = ?', b(bubbledUp), id)
  }

  /** Adds or removes a label in the cached posting (labels live in its raw JSON). */
  setPostingLabel(id: number, label: { id: number; name: string }, present: boolean) {
    const row = this.get<{ raw_json: string }>('SELECT raw_json FROM postings WHERE id = ?', id)
    if (!row) return
    const raw = JSON.parse(row.raw_json) as { folders?: Array<{ id: number; name: string }> | null }
    const others = (raw.folders ?? []).filter((f) => f.id !== label.id)
    raw.folders = present ? [...others, { id: label.id, name: label.name }] : others
    this.run('UPDATE postings SET raw_json = ? WHERE id = ?', JSON.stringify(raw), id)
  }

  postingLabelIds(id: number): number[] {
    const row = this.get<{ raw_json: string }>('SELECT raw_json FROM postings WHERE id = ?', id)
    if (!row) return []
    return ((JSON.parse(row.raw_json) as { folders?: Array<{ id: number }> | null }).folders ?? []).map((f) => f.id)
  }

  labels(): Array<{ id: number; name: string }> {
    return this.all<{ id: number; name: string }>('SELECT id, name FROM labels ORDER BY name COLLATE NOCASE')
  }

  box(id: number) {
    return this.get<{ id: number; kind: string; name: string }>('SELECT * FROM boxes WHERE id = ?', id)
  }

  deletePosting(id: number) {
    this.run('DELETE FROM postings WHERE id = ?', id)
  }

  setSeen(id: PostingId, seen: boolean) {
    this.run('UPDATE postings SET seen = ? WHERE id = ?', b(seen), id)
  }

  /**
   * A box as HEY lists it: bubbled up, then new, then previously seen. Unread mail from a
   * sender who has a bundle row in the box is left out (HEY shows it inside the bundle),
   * and each bundle carries how many of those it holds.
   *
   * Bundles are few, so their senders are gathered once (`bundled`) and rows are checked
   * against that small set; checking every row against the whole box took seconds.
   */
  postings(boxId: number, limit = 100, offset = 0): PostingRow[] {
    return this.withAnalysis(this.all<Record<string, unknown>>(
      `WITH bundled AS (
         SELECT id, sender_email FROM postings WHERE box_id = ?1 AND is_bundle = 1
       )
       SELECT p.*,
         CASE WHEN p.is_bundle = 1 THEN
           (SELECT count(*) FROM postings m
             WHERE m.box_id = ?1 AND m.sender_email = p.sender_email AND m.seen = 0 AND m.is_bundle = 0)
         END AS bundle_count
       FROM postings p
       WHERE p.box_id = ?1
         AND NOT (p.is_bundle = 0 AND p.seen = 0
                  AND p.sender_email IN (SELECT sender_email FROM bundled WHERE id != p.id))
       ORDER BY p.bubbled_up DESC, p.seen ASC, p.active_at DESC LIMIT ?2 OFFSET ?3`,
      boxId,
      limit,
      offset,
    ).map(toPostingRow))
  }

  /** Most recent threads from one sender, across every box, one row per thread. */
  postingsFromSender(email: string, excludeTopicId: TopicId | null, limit = 5): PostingRow[] {
    return this.withAnalysis(this.all<Record<string, unknown>>(
      `SELECT * FROM postings p
       WHERE p.sender_email = ? AND p.topic_id IS NOT NULL AND p.topic_id IS NOT ?
         AND p.id = (SELECT q.id FROM postings q WHERE q.topic_id = p.topic_id ORDER BY q.active_at DESC LIMIT 1)
       ORDER BY p.active_at DESC LIMIT ?`,
      email.toLowerCase(),
      excludeTopicId,
      limit,
    ).map(toPostingRow))
  }

  /**
   * Emails whose subject or sender contains every word of `query`, newest first, one per
   * thread, across all boxes. For jumping to an email by name; full-text search of bodies
   * is `search`.
   */
  findPostings(query: string, limit = 8): PostingRow[] {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6)
    if (!words.length) return []
    // LIKE with the pattern characters escaped, so "100%" means a percent sign.
    const like = words.map(() => `lower(coalesce(p.subject,'') || ' ' || coalesce(p.sender_name,'') || ' ' || coalesce(p.sender_email,'')) LIKE ? ESCAPE '\\'`)
    return this.withAnalysis(this.all<Record<string, unknown>>(
      `SELECT * FROM postings p
       WHERE p.is_bundle = 0 AND p.topic_id IS NOT NULL AND ${like.join(' AND ')}
         AND p.id = (SELECT q.id FROM postings q WHERE q.topic_id = p.topic_id AND q.is_bundle = 0 ORDER BY q.active_at DESC, q.id DESC LIMIT 1)
       ORDER BY p.active_at DESC LIMIT ?`,
      ...words.map((w) => `%${w.replace(/[\\%_]/g, (c) => '\\' + c)}%`),
      limit,
    ).map(toPostingRow))
  }

  /** A sender's threads in one box, newest first (the latest posting of each thread). */
  senderThreadsInBox(boxId: number, email: string, limit = 25): PostingRow[] {
    return this.withAnalysis(this.all<Record<string, unknown>>(
      `SELECT * FROM postings p
       WHERE p.box_id = ? AND p.sender_email = ? AND p.is_bundle = 0 AND p.topic_id IS NOT NULL
         -- A bundle row can carry the thread ID of one of its emails; it never stands for it.
         AND p.id = (SELECT q.id FROM postings q WHERE q.topic_id = p.topic_id AND q.is_bundle = 0 ORDER BY q.active_at DESC, q.id DESC LIMIT 1)
       ORDER BY p.active_at DESC LIMIT ?`,
      boxId,
      email.toLowerCase(),
      limit,
    ).map(toPostingRow))
  }

  posting(id: PostingId): PostingRow | null {
    const row = this.get<Record<string, unknown>>('SELECT * FROM postings WHERE id = ?', id)
    return row ? this.withAnalysis([toPostingRow(row)])[0]! : null
  }

  postingCount(boxId?: number): number {
    const row = boxId == null
      ? this.get<{ c: number }>('SELECT count(*) AS c FROM postings')
      : this.get<{ c: number }>('SELECT count(*) AS c FROM postings WHERE box_id = ?', boxId)
    return row?.c ?? 0
  }

  // Threads

  replaceMyAddresses(emails: string[]) {
    transaction(this.db, () => {
      this.run('DELETE FROM my_addresses')
      for (const e of emails) this.run('INSERT OR IGNORE INTO my_addresses (email) VALUES (?)', e.toLowerCase())
    })
  }

  storeThread(topicId: TopicId, entries: S.Entry[], subject: string | null) {
    const mine = new Set(this.all<{ email: string }>('SELECT email FROM my_addresses').map((r) => r.email))
    transaction(this.db, () => {
      this.run('DELETE FROM entries_fts WHERE rowid IN (SELECT id FROM entries WHERE topic_id = ?)', topicId)
      this.run('DELETE FROM entries WHERE topic_id = ?', topicId)
      for (const e of entries) {
        // `sender` is the actual From when HEY recorded one; `creator` otherwise.
        const from = e.sender ?? e.creator
        const email = from?.email_address?.toLowerCase() ?? null
        const people = (list: S.Contact[]) =>
          list.flatMap((c) => (c.email_address ? [{ name: c.name ?? null, email: c.email_address.toLowerCase() }] : []))
        const recipients = e.recipients ? { to: people(e.recipients.to), cc: people(e.recipients.cc) } : null
        this.run(
          `INSERT INTO entries (id, topic_id, kind, sender_name, sender_email, created_at,
             recipients_json, body_md, is_mine) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          e.id,
          topicId,
          n(e.kind),
          n(from?.name),
          email,
          e.created_at,
          recipients ? JSON.stringify(recipients) : null,
          e.body,
          b(email != null && mine.has(email)),
        )
        this.run(
          'INSERT INTO entries_fts (rowid, subject, sender, body) VALUES (?, ?, ?, ?)',
          e.id,
          subject ?? '',
          [from?.name, email].filter(Boolean).join(' '),
          e.body,
        )
      }
      this.run(
        `INSERT INTO threads (topic_id, subject, last_entry_id, entry_count, fetched_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (topic_id) DO UPDATE SET subject = excluded.subject,
           last_entry_id = excluded.last_entry_id, entry_count = excluded.entry_count,
           fetched_at = excluded.fetched_at`,
        topicId,
        subject,
        n(entries.at(-1)?.id),
        entries.length,
        now(),
      )
    })
  }

  thread(topicId: TopicId): ThreadView | null {
    const t = this.get<{ subject: string | null; fetched_at: string }>(
      'SELECT subject, fetched_at FROM threads WHERE topic_id = ?',
      topicId,
    )
    if (!t) return null
    const entries = this.all<Record<string, unknown>>(
      'SELECT * FROM entries WHERE topic_id = ? ORDER BY created_at, id',
      topicId,
    )
    const attachments = this.attachmentsByEntry(topicId)
    const mine = new Set(this.all<{ email: string }>('SELECT email FROM my_addresses').map((r) => r.email))
    // Older rows stored bare address strings; newer ones store { name, email }.
    const person = (p: string | { name: string | null; email: string }): Person => {
      const { name, email } = typeof p === 'string' ? { name: null, email: p.toLowerCase() } : p
      return { name, email, isMe: mine.has(email) }
    }
    const rows = entries.map((r): EntryRow => {
      const rec = r.recipients_json
        ? (JSON.parse(r.recipients_json as string) as { to: Parameters<typeof person>[0][]; cc: Parameters<typeof person>[0][] })
        : null
      const email = r.sender_email as string | null
      return {
        id: r.id as number,
        from: email ? { ...person(email), name: r.sender_name as string | null } : null,
        // Rows cached before times were normalised may lack their zone.
        createdAt: normalizeUtc(r.created_at as string),
        to: (rec?.to ?? []).map(person),
        cc: (rec?.cc ?? []).map(person),
        bodyMd: r.body_md as string,
        isMine: r.is_mine === 1,
        attachments: attachments.get(r.id as number) ?? [],
      }
    })
    return { topicId, subject: t.subject, fetchedAt: t.fetched_at, entries: rows }
  }

  replaceAttachments(topicId: TopicId, attachments: S.Attachment[]) {
    transaction(this.db, () => {
      // Keep downloaded files for attachments that are still there.
      const kept = new Map(
        this.all<{ id: string; local_path: string | null }>('SELECT id, local_path FROM attachments WHERE topic_id = ?', topicId).map(
          (r) => [r.id, r.local_path],
        ),
      )
      this.run('DELETE FROM attachments WHERE topic_id = ?', topicId)
      for (const a of attachments)
        this.run(
          `INSERT OR REPLACE INTO attachments (id, topic_id, entry_id, filename, content_type, byte_size, local_path)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          a.id,
          topicId,
          a.message_id,
          a.filename,
          n(a.content_type),
          n(a.byte_size),
          kept.get(a.id) ?? null,
        )
    })
  }

  attachment(id: string) {
    const r = this.get<Record<string, unknown>>('SELECT * FROM attachments WHERE id = ?', id)
    if (!r) return null
    return { ...toAttachmentRow(r), topicId: TopicId(r.topic_id as number), localPath: r.local_path as string | null }
  }

  setAttachmentPath(id: string, path: string) {
    this.run('UPDATE attachments SET local_path = ? WHERE id = ?', path, id)
  }

  private attachmentsByEntry(topicId: TopicId) {
    const byEntry = new Map<number, AttachmentRow[]>()
    for (const r of this.all<Record<string, unknown>>('SELECT * FROM attachments WHERE topic_id = ? ORDER BY rowid', topicId)) {
      const list = byEntry.get(r.entry_id as number) ?? []
      list.push(toAttachmentRow(r))
      byEntry.set(r.entry_id as number, list)
    }
    return byEntry
  }

  /** Cached original HTML for a thread's messages, by entry ID. Missing entries are absent. */
  entryHtml(topicId: TopicId): Map<number, string> {
    const rows = this.all<{ id: number; body_html: string }>(
      'SELECT id, body_html FROM entries WHERE topic_id = ? AND body_html IS NOT NULL',
      topicId,
    )
    return new Map(rows.map((r) => [r.id, r.body_html]))
  }

  storeEntryHtml(html: Map<number, string>) {
    transaction(this.db, () => {
      for (const [id, body] of html) this.run('UPDATE entries SET body_html = ? WHERE id = ?', body, id)
    })
  }

  /** Whether the cached thread is missing or older than what the posting reports. */
  threadIsStale(topicId: TopicId, entryCount: number | null): boolean {
    const t = this.get<{ entry_count: number }>('SELECT entry_count FROM threads WHERE topic_id = ?', topicId)
    if (!t) return true
    return entryCount != null && t.entry_count < entryCount
  }

  /** Full-text search over fetched thread entries. Each word matches as a prefix. */
  search(query: string, limit = 50): SearchHit[] {
    const terms = query.split(/\s+/).filter(Boolean).map((w) => `"${w.replaceAll('"', '""')}"*`)
    if (!terms.length) return []
    return this.all<Record<string, unknown>>(
      `SELECT e.id AS entry_id, e.topic_id, t.subject, e.sender_name, e.created_at,
              snippet(entries_fts, 2, '[', ']', '…', 12) AS snippet
       FROM entries_fts JOIN entries e ON e.id = entries_fts.rowid
       LEFT JOIN threads t ON t.topic_id = e.topic_id
       WHERE entries_fts MATCH ? ORDER BY rank LIMIT ?`,
      terms.join(' '),
      limit,
    ).map((r) => ({
      entryId: r.entry_id as number,
      topicId: TopicId(r.topic_id as number),
      subject: r.subject as string | null,
      senderName: r.sender_name as string | null,
      createdAt: normalizeUtc(r.created_at as string),
      snippet: r.snippet as string,
    }))
  }

  // Calendar, todos, labels, collections

  replaceCalendars(calendars: S.Calendar[]) {
    transaction(this.db, () => {
      this.run('DELETE FROM calendars')
      for (const c of calendars)
        this.run('INSERT INTO calendars (id, name, kind, color) VALUES (?, ?, ?, ?)', c.id, n(c.name), c.kind, n(c.color))
    })
  }

  /** Replaces every event starting inside [from, to), so deleted events disappear too. */
  replaceEvents(from: string, to: string, events: S.CalendarEvent[]) {
    transaction(this.db, () => {
      this.run('DELETE FROM events WHERE starts_at >= ? AND starts_at < ?', from, to)
      for (const e of events) {
        this.run(
          `INSERT OR REPLACE INTO events (key, id, occurrence_id, parent_id, calendar_id, title,
             starts_at, ends_at, all_day, location, raw_json, synced_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          e.occurrence_id ?? String(e.id),
          e.id,
          n(e.occurrence_id),
          n(e.parent_id),
          n(e.calendar?.id),
          e.title,
          e.starts_at,
          n(e.ends_at),
          b(e.all_day),
          n(e.location),
          JSON.stringify(e),
          now(),
        )
      }
    })
  }

  events(from: string, to: string): EventRow[] {
    return this.all<Record<string, unknown>>(
      'SELECT * FROM events WHERE starts_at < ? AND coalesce(ends_at, starts_at) >= ? ORDER BY all_day DESC, starts_at',
      to,
      from,
    ).map((r) => ({
      key: r.key as string,
      id: r.id as number,
      calendarId: r.calendar_id as number | null,
      title: r.title as string,
      startsAt: r.starts_at as string,
      endsAt: r.ends_at as string | null,
      allDay: r.all_day === 1,
      location: r.location as string | null,
    }))
  }

  replaceTodos(todos: S.Todo[]) {
    transaction(this.db, () => {
      this.run('DELETE FROM todos')
      for (const t of todos)
        this.run(
          'INSERT INTO todos (id, title, due_at, completed_at, raw_json) VALUES (?, ?, ?, ?, ?)',
          t.id,
          t.title,
          n(t.starts_at),
          n(t.completed_at),
          JSON.stringify(t),
        )
    })
  }

  replaceNamed(table: 'labels' | 'collections', rows: Array<{ id: number; name: string }>) {
    transaction(this.db, () => {
      this.run(`DELETE FROM ${table}`)
      for (const r of rows) this.run(`INSERT INTO ${table} (id, name) VALUES (?, ?)`, r.id, r.name)
    })
  }

  counts() {
    const c = (sql: string) => (this.get<{ c: number }>(sql)?.c ?? 0)
    return {
      postings: c('SELECT count(*) AS c FROM postings'),
      threads: c('SELECT count(*) AS c FROM threads'),
      entries: c('SELECT count(*) AS c FROM entries'),
      events: c('SELECT count(*) AS c FROM events'),
      todos: c('SELECT count(*) AS c FROM todos'),
      labels: c('SELECT count(*) AS c FROM labels'),
      collections: c('SELECT count(*) AS c FROM collections'),
    }
  }

  // Sync state

  // Thread analysis

  /** Fills in each row's analysis, in one query. */
  withAnalysis(rows: PostingRow[]): PostingRow[] {
    const topics = [...new Set(rows.flatMap((r) => (r.topicId == null ? [] : [r.topicId])))]
    if (!topics.length) return rows
    const found = new Map(
      this.all<Record<string, unknown>>(
        `SELECT topic_id, summary, needs_reply, expects_reply, category, json FROM thread_analysis WHERE topic_id IN (${topics.map(() => '?').join(', ')})`,
        ...topics,
      ).map((r) => [Number(r.topic_id), toAnalysis(r)]),
    )
    return rows.map((r) => (r.topicId != null && found.has(r.topicId) ? { ...r, ai: found.get(r.topicId)! } : r))
  }

  /** The thread's latest activity across its postings (what an analysis is measured against). */
  latestActivity(topicId: TopicId): string | null {
    return this.get<{ a: string | null }>('SELECT max(active_at) AS a FROM postings WHERE topic_id = ?', topicId)?.a ?? null
  }

  entryCount(topicId: TopicId): number | null {
    return this.get<{ n: number | null }>('SELECT max(entry_count) AS n FROM postings WHERE topic_id = ?', topicId)?.n ?? null
  }

  /** Whether the thread's analysis covers its latest activity, made with `version`'s instructions (or later). */
  analysisIsCurrent(topicId: TopicId, activeAt: string, version = 1): boolean {
    const row = this.get<{ active_at: string; version: number }>('SELECT active_at, version FROM thread_analysis WHERE topic_id = ?', topicId)
    return row != null && row.active_at >= activeAt && row.version >= version
  }

  saveAnalysis(topicId: TopicId, activeAt: string, engine: string, model: string, a: { summary: string; needsReply: boolean; expectsReply: boolean; category: string }, version = 1) {
    this.run(
      `INSERT INTO thread_analysis (topic_id, active_at, analyzed_at, engine, model, summary, needs_reply, expects_reply, category, json, version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (topic_id) DO UPDATE SET active_at = excluded.active_at, analyzed_at = excluded.analyzed_at, engine = excluded.engine,
         model = excluded.model, summary = excluded.summary, needs_reply = excluded.needs_reply, expects_reply = excluded.expects_reply,
         category = excluded.category, json = excluded.json, version = excluded.version`,
      topicId,
      activeAt,
      new Date().toISOString(),
      engine,
      model,
      a.summary,
      b(a.needsReply),
      b(a.expectsReply),
      a.category,
      JSON.stringify(a),
      version,
    )
  }

  /**
   * You've dealt with the thread (replied elsewhere, done what it asked): it no longer
   * needs your reply, you're not waiting on it, and its action items are done. Kept until
   * the thread has something new, which is read afresh. Answers whether it was analysed.
   */
  markHandled(topicId: TopicId): boolean {
    const res = this.db
      .prepare(
        `UPDATE thread_analysis SET needs_reply = 0, expects_reply = 0,
           json = json_set(json, '$.needsReply', json('false'), '$.expectsReply', json('false'), '$.replyReason', NULL, '$.actionItems', json('[]'), '$.handled', json('true'))
         WHERE topic_id = ?`,
      )
      .run(topicId)
    return Number(res.changes) > 0
  }

  /** The stored analysis as it is (for undoing "handled"). */
  analysisJson(topicId: TopicId): string | null {
    return this.get<{ json: string }>('SELECT json FROM thread_analysis WHERE topic_id = ?', topicId)?.json ?? null
  }

  /** Puts an analysis back as it was (undoing "handled"). */
  restoreAnalysis(topicId: TopicId, json: string) {
    const a = JSON.parse(json) as { needsReply?: boolean; expectsReply?: boolean }
    this.run('UPDATE thread_analysis SET json = ?, needs_reply = ?, expects_reply = ? WHERE topic_id = ?', json, b(a.needsReply), b(a.expectsReply), topicId)
  }

  /** The boxes a thread has postings in. */
  boxesOf(topicId: TopicId): number[] {
    return this.all<{ box_id: number }>('SELECT DISTINCT box_id FROM postings WHERE topic_id = ?', topicId).map((r) => r.box_id)
  }

  /** The full analysis (action items, dates, amounts), for the details panel. */
  analysis(topicId: TopicId): (Record<string, unknown> & { analyzedAt: string; model: string }) | null {
    const r = this.get<{ json: string; analyzed_at: string; model: string }>('SELECT json, analyzed_at, model FROM thread_analysis WHERE topic_id = ?', topicId)
    if (!r) return null
    try {
      return { ...(JSON.parse(r.json) as Record<string, unknown>), analyzedAt: r.analyzed_at, model: r.model }
    } catch {
      return null
    }
  }

  /**
   * Threads active since `sinceIso` whose analysis is current (made after their latest
   * activity), with their latest posting: what Today can say about mail. A thread with
   * something new since its analysis is left out until it's read again.
   */
  currentAnalyses(sinceIso: string): Array<{ posting: PostingRow; analysis: Record<string, unknown> }> {
    const rows = this.all<Record<string, unknown>>(
      `SELECT p.*, a.json AS analysis_json FROM thread_analysis a
       JOIN postings p ON p.topic_id = a.topic_id AND p.is_bundle = 0
         AND p.id = (SELECT q.id FROM postings q WHERE q.topic_id = a.topic_id AND q.is_bundle = 0 ORDER BY q.active_at DESC, q.id DESC LIMIT 1)
       WHERE p.active_at >= ? AND a.active_at >= p.active_at
       ORDER BY p.active_at DESC`,
      sinceIso,
    )
    const postings = this.withAnalysis(rows.map(toPostingRow))
    return rows.flatMap((r, i) => {
      try {
        return [{ posting: postings[i]!, analysis: JSON.parse(r.analysis_json as string) as Record<string, unknown> }]
      } catch {
        return []
      }
    })
  }

  /** Unread threads in a box since `sinceIso` that haven't been analysed as they are now: the first run's backlog. */
  unanalysedUnread(boxKind: string, sinceIso: string, limit: number, version = 1): TopicId[] {
    return this.all<{ topic_id: number }>(
      `SELECT p.topic_id FROM postings p
       WHERE p.box_id IN (SELECT id FROM boxes WHERE kind = ?) AND p.seen = 0 AND p.is_bundle = 0 AND p.topic_id IS NOT NULL AND p.active_at >= ?
         AND NOT EXISTS (SELECT 1 FROM thread_analysis a WHERE a.topic_id = p.topic_id AND a.active_at >= p.active_at AND a.version >= ?)
       ORDER BY p.active_at DESC LIMIT ?`,
      boxKind,
      sinceIso,
      version,
      limit,
    ).map((r) => TopicId(r.topic_id))
  }

  // Today

  /** The latest posting of each thread matching `where` (bundles never count), as list rows. */
  private threadRows(where: string, order: string, ...params: SQLInputValue[]): PostingRow[] {
    return this.withAnalysis(this.all<Record<string, unknown>>(
      `SELECT p.* FROM postings p
       WHERE p.is_bundle = 0 AND p.topic_id IS NOT NULL AND (${where})
         AND p.id = (SELECT q.id FROM postings q WHERE q.topic_id = p.topic_id AND q.is_bundle = 0 ORDER BY q.active_at DESC, q.id DESC LIMIT 1)
       ORDER BY ${order}`,
      ...params,
    ).map(toPostingRow))
  }

  /** Threads HEY has bubbled up now, oldest first. */
  bubbledUp(): PostingRow[] {
    return this.threadRows('p.bubbled_up = 1', 'p.active_at ASC')
  }

  /** What's parked in Reply Later, oldest first. */
  replyLater(): PostingRow[] {
    return this.threadRows("p.box_id IN (SELECT id FROM boxes WHERE kind = 'laterbox')", 'p.active_at ASC')
  }

  /**
   * Threads where you sent the latest message (HEY's posting `creator` is the latest
   * sender) between `fromIso` and `toIso`, to someone besides yourself, and not already
   * parked, bubbled or filed: waiting on others. Oldest first. A thread that's only your
   * forward ("Fwd:", "Fw:", French "TR:") is for their information, not waiting on them.
   */
  waitingOnOthers(myEmails: string[], fromIso: string, toIso: string): PostingRow[] {
    const mine = myEmails.map((e) => e.toLowerCase())
    if (!mine.length) return []
    const list = mine.map(() => '?').join(', ')
    return this.threadRows(
      `lower(json_extract(p.raw_json, '$.creator.email_address')) IN (${list})
       AND p.active_at >= ? AND p.active_at < ?
       AND p.box_id NOT IN (SELECT id FROM boxes WHERE kind IN ('laterbox', 'bubblebox', 'feedbox', 'trailbox'))
       AND p.bubbled_up = 0
       AND NOT (coalesce(p.entry_count, 1) <= 1
                AND (lower(ltrim(p.subject)) LIKE 'fwd:%' OR lower(ltrim(p.subject)) LIKE 'fw:%' OR lower(ltrim(p.subject)) LIKE 'tr:%'))
       AND EXISTS (SELECT 1 FROM json_each(p.raw_json, '$.contacts') c
                   WHERE lower(json_extract(c.value, '$.email_address')) NOT IN (${list}))`,
      'p.active_at ASC',
      ...mine,
      fromIso,
      toIso,
      ...mine,
    )
  }

  /** The people on a thread other than you (from HEY's contacts on its posting). */
  otherPeople(postingId: number, myEmails: string[]): Contact[] {
    const raw = this.get<{ raw_json: string }>('SELECT raw_json FROM postings WHERE id = ?', postingId)?.raw_json
    let contacts: Array<Record<string, unknown>> = []
    try {
      contacts = (JSON.parse(raw ?? '{}') as { contacts?: Array<Record<string, unknown>> }).contacts ?? []
    } catch {
      return []
    }
    const mine = new Set(myEmails.map((e) => e.toLowerCase()))
    const str = (v: unknown) => (typeof v === 'string' && v ? v : null)
    return contacts.flatMap((c) => {
      const email = str(c.email_address)?.toLowerCase()
      if (!email || mine.has(email)) return []
      const name = str(c.name)
      return [{ name: name && name !== email ? name : null, email, avatar: { url: str(c.avatar_url), color: str(c.avatar_background_color), initials: str(c.initials) ?? initialsOf(name ?? email) } }]
    })
  }

  /** Unread threads per box that arrived since `sinceIso` (all unread when null); bundles count their mail. */
  unseenSince(sinceIso: string | null): Array<{ boxId: number; kind: string; name: string; count: number }> {
    return this.all<Record<string, unknown>>(
      `SELECT b.id, b.kind, b.name, count(p.id) AS c
       FROM boxes b JOIN postings p ON p.box_id = b.id
       WHERE p.seen = 0 AND p.is_bundle = 0 AND (? IS NULL OR p.active_at > ?)
       GROUP BY b.id ORDER BY b.id`,
      sinceIso,
      sinceIso,
    ).map((r) => ({ boxId: Number(r.id), kind: r.kind as string, name: r.name as string, count: Number(r.c) }))
  }

  /**
   * HEY to-dos not done and dated before `beforeDay` (YYYY-MM-DD): overdue and today's,
   * oldest first. Compared as calendar days: HEY dates them at UTC midnight, which is the
   * named day wherever you are.
   */
  todosDue(beforeDay: string): TodoRow[] {
    return this.all<Record<string, unknown>>(
      'SELECT id, title, due_at, completed_at FROM todos WHERE completed_at IS NULL AND due_at IS NOT NULL AND substr(due_at, 1, 10) < ? ORDER BY due_at, id',
      beforeDay,
    ).map(toTodoRow)
  }

  todo(id: number): TodoRow | null {
    const r = this.get<Record<string, unknown>>('SELECT id, title, due_at, completed_at FROM todos WHERE id = ?', id)
    return r ? toTodoRow(r) : null
  }

  /** Marks a to-do done (or not) in the cache, ahead of HEY's answer. */
  setTodoDone(id: number, completedAt: string | null) {
    this.run('UPDATE todos SET completed_at = ? WHERE id = ?', completedAt, id)
  }

  /** Logs one model call. */
  recordAiUsage(u: AiUsageRecord) {
    this.run(
      'INSERT INTO ai_usage (at, task, engine, model, input, cache_read, cache_write, output, cost_usd) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      u.at,
      u.task,
      u.engine,
      u.model,
      u.input,
      u.cacheRead,
      u.cacheWrite,
      u.output,
      u.costUsd,
    )
  }

  /** Model calls since `sinceIso`, totalled per task, engine and model (most spent first). */
  aiUsageSince(sinceIso: string): AiUsageTotal[] {
    return this.all<Record<string, unknown>>(
      `SELECT task, engine, model, count(*) AS calls, sum(input) AS input, sum(output) AS output, sum(cost_usd) AS cost
       FROM ai_usage WHERE at >= ? GROUP BY task, engine, model ORDER BY cost DESC, calls DESC`,
      sinceIso,
    ).map((r) => ({
      task: r.task as string,
      engine: r.engine as string,
      model: r.model as string,
      calls: Number(r.calls),
      input: Number(r.input),
      output: Number(r.output),
      costUsd: Number(r.cost),
    }))
  }

  /** What Claude calls have cost since `sinceIso`, in USD. */
  aiSpentSince(sinceIso: string): number {
    return Number(this.get<{ c: number | null }>('SELECT sum(cost_usd) AS c FROM ai_usage WHERE at >= ?', sinceIso)?.c ?? 0)
  }

  getState(key: string): string | null {
    return this.get<{ value: string }>('SELECT value FROM sync_state WHERE key = ?', key)?.value ?? null
  }

  setState(key: string, value: string | null) {
    if (value == null) this.run('DELETE FROM sync_state WHERE key = ?', key)
    else this.run('INSERT OR REPLACE INTO sync_state (key, value) VALUES (?, ?)', key, value)
  }
}

function toAttachmentRow(r: Record<string, unknown>): AttachmentRow {
  return {
    id: r.id as string,
    filename: r.filename as string,
    contentType: r.content_type as string | null,
    byteSize: r.byte_size as number | null,
    embedded: /:e-/.test(r.id as string),
  }
}

function toPostingRow(r: Record<string, unknown>): PostingRow {
  return {
    id: PostingId(r.id as number),
    topicId: r.topic_id == null ? null : TopicId(r.topic_id as number),
    boxId: r.box_id as number,
    subject: r.subject as string,
    summary: r.summary as string | null,
    senderName: r.sender_name as string | null,
    senderEmail: r.sender_email as string | null,
    seen: r.seen === 1,
    bubbledUp: r.bubbled_up === 1,
    entryCount: r.entry_count as number | null,
    hasAttachments: r.has_attachments === 1,
    isBundle: r.is_bundle === 1,
    activeAt: r.active_at as string | null,
    appUrl: r.app_url as string | null,
    ...fromRaw(r.raw_json as string, (r.sender_name as string | null) ?? (r.sender_email as string | null)),
    bundleCount: r.is_bundle === 1 ? ((r.bundle_count as number | null) ?? null) : null,
    ai: null,
  }
}

/** Details kept only in the posting's raw JSON: labels, avatar, tracker flag. */
function fromRaw(rawJson: string, senderName: string | null): Pick<PostingRow, 'labels' | 'avatar' | 'blockedTrackers'> {
  type Raw = {
    folders?: Array<{ name?: unknown }> | null
    creator?: { avatar_url?: unknown; avatar_background_color?: unknown; initials?: unknown } | null
    blocked_trackers?: unknown
  }
  let raw: Raw = {}
  try {
    raw = JSON.parse(rawJson) as Raw
  } catch {
    // keep defaults
  }
  const str = (v: unknown) => (typeof v === 'string' && v ? v : null)
  return {
    labels: (raw.folders ?? []).flatMap((f) => (typeof f.name === 'string' ? [f.name] : [])),
    avatar: {
      url: str(raw.creator?.avatar_url),
      color: str(raw.creator?.avatar_background_color),
      initials: str(raw.creator?.initials) ?? initialsOf(senderName),
    },
    blockedTrackers: raw.blocked_trackers === true,
  }
}

function initialsOf(name: string | null): string {
  const words = (name ?? '').replace(/[^\p{L}\p{N} ]/gu, ' ').split(/\s+/).filter(Boolean)
  return words.slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?'
}

export interface AiUsageRecord {
  at: string
  task: string
  engine: string
  model: string
  input: number
  cacheRead: number
  cacheWrite: number
  output: number
  costUsd: number
}

export interface AiUsageTotal {
  task: string
  engine: string
  model: string
  calls: number
  input: number
  output: number
  costUsd: number
}

export interface TodoRow {
  id: number
  title: string
  /** The day it's for (HEY's starts_at). */
  dueAt: string | null
  completedAt: string | null
}

function toTodoRow(r: Record<string, unknown>): TodoRow {
  return { id: Number(r.id), title: (r.title as string) || '(untitled)', dueAt: (r.due_at as string | null) ?? null, completedAt: (r.completed_at as string | null) ?? null }
}

/** Someone a thread is with, as HEY lists them on its posting. */
export interface Contact {
  name: string | null
  email: string
  avatar: PostingRow['avatar']
}

function toAnalysis(r: Record<string, unknown>): PostingAnalysis {
  let reason: string | null = null
  try {
    reason = (JSON.parse(r.json as string) as { replyReason?: string | null }).replyReason ?? null
  } catch {
    // keep null
  }
  return { summary: r.summary as string, needsReply: r.needs_reply === 1, replyReason: reason, expectsReply: r.expects_reply === 1, category: r.category as string }
}
