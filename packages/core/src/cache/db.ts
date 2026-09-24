import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

// Each entry is one schema version. Append only; never edit a shipped migration.
// The cache is disposable (a re-sync rebuilds it), but migrations keep upgrades fast.
const MIGRATIONS: string[] = [
  `
  CREATE TABLE boxes (
    id   INTEGER PRIMARY KEY,
    kind TEXT NOT NULL,
    name TEXT NOT NULL
  );

  CREATE TABLE postings (
    id              INTEGER PRIMARY KEY,
    topic_id        INTEGER,
    box_id          INTEGER NOT NULL,
    subject         TEXT NOT NULL,
    summary         TEXT,
    sender_name     TEXT,
    sender_email    TEXT,
    seen            INTEGER NOT NULL DEFAULT 0,
    bubbled_up      INTEGER NOT NULL DEFAULT 0,
    entry_count     INTEGER,
    has_attachments INTEGER NOT NULL DEFAULT 0,
    is_bundle       INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT,
    active_at       TEXT,
    updated_at      TEXT,
    app_url         TEXT,
    raw_json        TEXT NOT NULL,
    synced_at       TEXT NOT NULL
  );
  CREATE INDEX postings_box_active ON postings (box_id, active_at DESC);
  CREATE INDEX postings_topic ON postings (topic_id);

  CREATE TABLE threads (
    topic_id      INTEGER PRIMARY KEY,
    subject       TEXT,
    last_entry_id INTEGER,
    entry_count   INTEGER NOT NULL,
    fetched_at    TEXT NOT NULL
  );

  CREATE TABLE entries (
    id              INTEGER PRIMARY KEY,
    topic_id        INTEGER NOT NULL,
    kind            TEXT,
    sender_name     TEXT,
    sender_email    TEXT,
    created_at      TEXT NOT NULL,
    recipients_json TEXT,
    body_md         TEXT NOT NULL,
    is_mine         INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX entries_topic ON entries (topic_id, created_at);

  -- rowid = entries.id
  CREATE VIRTUAL TABLE entries_fts USING fts5 (subject, sender, body, tokenize = 'porter unicode61');

  CREATE TABLE my_addresses (email TEXT PRIMARY KEY);

  CREATE TABLE calendars (
    id    INTEGER PRIMARY KEY,
    name  TEXT,
    kind  TEXT NOT NULL,
    color TEXT
  );

  -- key = occurrence_id for an occurrence of a repeating event, else the event id.
  CREATE TABLE events (
    key           TEXT PRIMARY KEY,
    id            INTEGER NOT NULL,
    occurrence_id TEXT,
    parent_id     INTEGER,
    calendar_id   INTEGER,
    title         TEXT NOT NULL,
    starts_at     TEXT NOT NULL,
    ends_at       TEXT,
    all_day       INTEGER NOT NULL DEFAULT 0,
    location      TEXT,
    raw_json      TEXT NOT NULL,
    synced_at     TEXT NOT NULL
  );
  CREATE INDEX events_start ON events (starts_at);

  CREATE TABLE todos (
    id           INTEGER PRIMARY KEY,
    title        TEXT NOT NULL,
    due_at       TEXT,
    completed_at TEXT,
    raw_json     TEXT NOT NULL
  );

  CREATE TABLE labels (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
  CREATE TABLE collections (id INTEGER PRIMARY KEY, name TEXT NOT NULL);

  CREATE TABLE sync_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);

  CREATE TABLE actions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    source      TEXT NOT NULL,
    type        TEXT NOT NULL,
    params_json TEXT NOT NULL,
    status      TEXT NOT NULL,
    verified    INTEGER,
    error       TEXT,
    created_at  TEXT NOT NULL,
    executed_at TEXT
  );
  `,
  `
  CREATE TABLE attachments (
    id           TEXT PRIMARY KEY,
    topic_id     INTEGER NOT NULL,
    entry_id     INTEGER NOT NULL,
    filename     TEXT NOT NULL,
    content_type TEXT,
    byte_size    INTEGER,
    local_path   TEXT
  );
  CREATE INDEX attachments_topic ON attachments (topic_id);
  -- Threads cached before attachments existed must be fetched again to list theirs.
  DELETE FROM threads;
  `,
  `
  -- Recipients now keep contact names; fetch cached threads again to pick them up.
  DELETE FROM threads;
  `,
  `
  ALTER TABLE actions ADD COLUMN posting_id INTEGER;
  ALTER TABLE actions ADD COLUMN summary TEXT;
  ALTER TABLE actions ADD COLUMN inverse_json TEXT;
  ALTER TABLE actions ADD COLUMN undone_by INTEGER;
  CREATE INDEX actions_recent ON actions (id DESC);
  `,
  `
  -- The original HTML of a message, fetched when it is first shown as HTML.
  ALTER TABLE entries ADD COLUMN body_html TEXT;
  `,
  `
  -- For unread counts and hiding bundled mail without scanning whole boxes.
  CREATE INDEX postings_box_seen ON postings (box_id, seen);
  CREATE INDEX postings_box_sender ON postings (box_id, sender_email, seen);
  CREATE INDEX postings_bundles ON postings (box_id, sender_email) WHERE is_bundle = 1;
  -- A box in list order, so the first page is read directly instead of sorting the box.
  CREATE INDEX postings_box_order ON postings (box_id, bubbled_up DESC, seen ASC, active_at DESC);
  `,
  `
  -- Only HEY's kind makes a bundle; a posting without a thread (a HEY World post) is not one.
  UPDATE postings SET is_bundle = 0
   WHERE is_bundle = 1 AND coalesce(json_extract(raw_json, '$.kind'), 'bundle') != 'bundle';
  `,
]

export type Db = DatabaseSync

export function openDb(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
  const db = new DatabaseSync(path)
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;')
  migrate(db)
  return db
}

function migrate(db: Db) {
  const { user_version: current } = db.prepare('PRAGMA user_version').get() as { user_version: number }
  for (let v = current; v < MIGRATIONS.length; v++) {
    transaction(db, () => {
      db.exec(MIGRATIONS[v]!)
      db.exec(`PRAGMA user_version = ${v + 1}`)
    })
  }
}

export function transaction<T>(db: Db, fn: () => T): T {
  db.exec('BEGIN')
  try {
    const result = fn()
    db.exec('COMMIT')
    return result
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}
