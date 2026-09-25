# Product Spec — AI companion for HEY (working title TBD)

Status: draft v0.1 · 2026-09-24 · Owner: Oliver Oxenham

> The product name must not use "HEY" (37signals trademark). "the app" below.

## 1. Summary

A desktop app that sits **on top of HEY** and makes it AI-first: a daily Brief instead of an
inbox, a ⌘K bar that understands plain language, reply drafts in your voice, follow-up
tracking, calendar extraction, and Insights about your mail, money and time.

It does not replace HEY. HEY stays the system of record; everything the app does goes
through the official HEY CLI (`hey`), so all changes are visible in every HEY client.

**Positioning:** "Superhuman-style AI for HEY — pay once, bring your own AI."

- One-time purchase, $29.
- Users bring their own AI (Claude API key or a local model) → no subscription, no
  servers, no mail on our infrastructure.
- Claude subscribers can also drive the app from Claude Desktop / Claude Code via MCP.

## 2. Principles

1. **AI proposes, you approve.** Every write the AI suggests is shown as a plan and runs
   only after approval. Automation exists only as rules the user approved once.
2. **Never sends on its own.** Sending email is always a human action. No rule can send.
3. **Local-first and private.** Cache, embeddings and AI keys live on the device. No backend.
4. **Visible and undoable.** Every action (human, agent, rule) lands in an activity log with
   an undo where the CLI allows one.
5. **Calm, clean, professional.** HEY's spirit, not a dashboard of AI sparkles. AI output
   appears inline where it helps and nowhere else.
6. **Keyboard-first.** Everything reachable from the keyboard; ⌘K teaches shortcuts.
7. **Respect HEY's model.** Use Imbox / Feed / Paper Trail / Screener / Reply Later /
   Set Aside / Bubble Up / labels / collections rather than inventing parallel concepts.

## 3. Decisions

| Topic | Decision | Status |
|---|---|---|
| Relationship to HEY | Sits on top; HEY web/mobile still used for rarer tasks | Decided |
| Platform | Desktop app, Electron + React + TypeScript, Mac first, then Windows/Linux | Decided |
| Hosted web app | Rejected: would hold users' HEY credentials and mail on our servers; recurring costs | Decided |
| Localhost web app | Used for development only (same core runs in a browser), not the shipped product | Decided |
| AI provider | User's choice among cloud providers (Claude, OpenAI, Grok; more by adding a registry entry), a local model, or mixed | Decided |
| Claude subscription | Cannot power in-app features (Anthropic policy); supported via MCP server instead | Decided |
| Autonomy | Suggestions + user-approved rules | Decided |
| Auto-drafts location | Local until accepted; saved to HEY only when the user accepts | Decided |
| Price | $29 one-time | Decided |
| Name | Proposed "SuperHey" — trademark concern (contains HEY, echoes Superhuman) | Open |
| Weekly review → HEY journal | Undecided; off by default until decided | Open |
| Database | Node built-in `node:sqlite` (FTS5 included; no native modules to rebuild) | Decided |
| Insights v1 | A (attention), C (commitments & money), E (narrative / ask) | Decided |
| Insights later | B (relationships), D (time & life) | Decided |
| Package manager | pnpm | Decided |
| Business model | One-time license key, offline-validated | Decided |

## 4. Architecture

```
┌──────────────────────────── Electron app ────────────────────────────┐
│ Renderer (React)          │ Main process (Node, "core")              │
│  Brief · Mail · Thread    │  CLI adapter ──► hey (subprocess)        │
│  ⌘K · Calendar · Insights │  Watcher ─────► hey watch (long-running) │
│  Approvals · Settings     │  Sync engine / backfill                  │
│         ▲  typed IPC  ▼   │  Cache: SQLite + FTS5 + sqlite-vec       │
│                           │  AI layer: providers, tasks, agent       │
│                           │  Actions: approval queue, rules, log     │
│                           │  Local embeddings (ONNX)                 │
└───────────────────────────┴──────────────────────────────────────────┘
          ▲ stdio
   app-mcp shim  ◄── Claude Desktop / Claude Code (user's subscription)
```

- The **core** is plain TypeScript with no Electron dependency, so it also runs as a
  localhost dev server (`pnpm dev:web`) for fast iteration in a browser.
- The renderer never talks to the CLI or the network directly; it reads the cache through
  typed IPC and requests actions.

### 4.1 CLI adapter

- Finds the binary (`~/.local/bin/hey`, PATH, user override) and **verifies it is the HEY
  CLI** via `hey --version` (Homebrew's `hey` is an unrelated HTTP load tester).
  Minimum supported version pinned; newer versions warned but allowed.
- Every call uses `--json` (or `--quiet --jq`), `HEY_NONINTERACTIVE=1`, a timeout, and
  typed decoding (zod schemas) of the envelope. Auth errors (exit 3, `code: auth`) surface
  an onboarding screen telling the user to run `hey auth login`; the app never logs in.
- Concurrency limit (2–3 parallel calls) with backoff; ~0.5 s per call observed.
- **Mutation verification.** `hey seen`, `unseen` and `move` report success even for wrong
  IDs. The adapter re-reads the affected box and confirms the change before marking an
  action done. The two ID kinds (`id` box item vs `topic_id` thread) are distinct types in
  TypeScript so they cannot be mixed up.
- Bundle postings may lack `topic_id`; shown as bundles, opened via `contact unbundle`
  only on explicit user request.

### 4.2 Sync & cache

- **Live:** one `hey watch` process; each JSON line updates the cache. `resync` → re-read
  that box. `disconnected` → status indicator + restart with backoff and `--since`.
- **Initial sync:** first page of every box, today/this week's events, todos, labels,
  collections, contacts → app usable within seconds.
- **Backfill:** background job pages each box beyond the 101-page `--all` cap using
  `--page`, then `hey search --date <year>` for older mail. Thread bodies (`hey thread
  read`) fetched lazily: on open, for Brief candidates, and in a low-priority queue for
  Insights. Pausable; shows progress in Settings.
- **Store:** SQLite (`node:sqlite`, built into Electron 44's Node 24) with FTS5 for keyword search and sqlite-vec for
  semantic search. Schema in §8.
- The cache is disposable: deleting it only costs a re-sync.

### 4.3 AI layer

Providers via AI SDK so they are swappable:

| Mode | Provider | Notes |
|---|---|---|
| Claude | User's Anthropic API key | Best quality. Key stored in OS keychain (Electron safeStorage). |
| Local | Ollama / LM Studio (OpenAI-compatible endpoint) | Free, private, lower quality. App checks the model is present. |
| OpenAI | User's OpenAI API key | GPT-6 Luna for quick tasks, GPT-6 Sol for the rest. |
| Grok | User's xAI API key | Grok 4.3 for quick tasks, Grok 4.7 for the rest. |
| Mixed (default when both set) | Local for high-volume tasks, the cloud for reasoning | Cheapest good option. |

Cloud providers live in one registry (`packages/core/src/ai/providers.ts`): key format, key
URL, how to connect, models with list prices, default quick/main models. Settings lists the
connected ones in priority order (automatic tasks use the first that's on) with "Add
provider"; each can change its models, be turned off, re-keyed or removed. Adding a
provider is a registry entry plus checking its prices on its own site.

Task routing (each task has a default tier the user can override):

| Task | Tier | Default Claude model |
|---|---|---|
| One-line thread summary | cheap | Haiku 4.5 |
| Classification (needs reply, automated, category, sort suggestion) | cheap | Haiku 4.5 |
| Extraction (dates, bookings, receipts, action items) | cheap, structured output | Haiku 4.5 |
| Reply drafts / compose in your voice | quality | Sonnet 5 |
| ⌘K agent (tool use) | quality | Sonnet 5 |
| Insights narrative, weekly review | quality | Sonnet 5 (Opus 5.5 optional) |

- **Embeddings** run locally (small ONNX model via transformers.js) — free and private.
- **Voice profile:** built from the user's sent messages (entries they authored),
  summarised into a style guide + a few examples; cached with prompt caching.
- **Cost controls:** per-task on/off, monthly budget with a hard stop, usage meter
  (tokens and estimated cost) in Settings. Background AI runs only on new or opened mail,
  never re-processes unchanged threads (results keyed by thread + last entry id).
- **Prompt-injection stance:** email content is untrusted data. It is always passed as
  data, never as instructions. Agent write tools go through the approval queue, so a
  malicious email can at most produce a suggestion the user sees before anything happens.

### 4.4 Actions, approvals, rules, activity log

- **Action** = typed operation mapped to CLI commands (move, seen, label add/remove,
  collection add, set-aside, bubble up/pop, screener approve/deny, todo add, event add,
  draft create/edit, reply/compose/forward send, ignore…).
- Each action declares: `reversible` + its inverse, and `risk` (low / high / send).
- **Approval queue:** agent and suggestion engine produce *plans* (list of actions with a
  human-readable description and the thread/items affected). User approves all, some, or
  none. Keyboard: ⏎ approve, ⌫ reject.
- **Rules** ("always move receipts from Amex to Paper Trail"): created from an approved
  suggestion or in plain language, stored as structured conditions + actions, shown with
  a preview of what they would have matched in the last 30 days before activation. Rules
  may only use the reversible, low-risk allowlist: move (not to Trash), label, collection,
  seen, set aside, bubble up, todo add. Never send, trash, spam, or screener deny.
- **Activity log:** every executed action with source (you / agent / rule name), time,
  target, and an Undo button where an inverse exists. Trash has no CLI inverse → always
  requires explicit confirmation and is never automated.

### 4.5 MCP server (for Claude subscribers)

- A small `app-mcp` stdio binary bundled with the app. Settings shows a one-click
  "Add to Claude Desktop" and the `claude mcp add` command for Claude Code.
- Tools: search (keyword + semantic), brief, thread read (with summary), waiting-on,
  insights queries, calendar/free slots, create draft, propose actions.
- Reads come from the cache (fast, works while the app is closed). Writes are limited to
  drafts and **proposals** that appear in the app's approval queue; no direct sending.
- Runs on the user's Claude subscription inside Anthropic's own apps, which is within
  Anthropic's terms (the app is a tool, not a Claude login). Background features still
  need an API key or local model.

### 4.6 Security & packaging

- Electron hardening: context isolation, sandboxed renderer, no node integration, strict
  CSP, typed IPC allowlist. Email HTML (when shown) renders in a sandboxed iframe with
  remote content blocked by default.
- No telemetry by default; optional crash reports, opt-in.
- Distribution: signed + notarized macOS build (Developer ID), later Windows (signed) and
  Linux (AppImage). Auto-update via electron-updater.
- Licensing: Lemon Squeezy or Paddle license keys, validated offline after activation.

## 5. v1 features

### 5.1 Onboarding
Detect/verify HEY CLI → check `hey auth status` → pick AI mode (API key / local / skip:
the app works without AI) → initial sync → build voice profile (opt-in) → short
keyboard tour.

### 5.2 Today (home screen, the landing page)
A queue of decisions, not a dashboard: every item says why it's there, can be handled in
one key (open, done, not now), and disappears once handled, down to "You're caught up".
It opens on launch (key `0`, above the Imbox in the sidebar). Every action goes to HEY
(Reply Later, Bubble Up, HEY to-dos), so HEY's own apps agree; the only local state is
"not now" (hidden until the thread changes) and when you last looked.

**Phase 1 (no AI needed):**
- **Due:** HEY to-dos overdue or due today (complete in one key), threads bubbled up now.
- **Reply Later:** what you parked to answer, oldest first, with its age.
- **Waiting on others:** off until phase 2. "You sent the latest message 3–30 days ago"
  (HEY's posting `creator` is the latest sender) mostly found files sent and thanks said;
  it needs the per-thread AI to judge whether your message expects a reply. When it
  returns, rows get actions: remind me (Bubble Up), no reply needed, nudge.
- **Today:** the day's calendar events.
- **New since you last looked:** unread counts per box, and the Screener.
- Sections show a few items with "show all"; caught-up state when empty.

**Phase 2 (with per-thread AI analysis, 5.3):** Needs your reply (with summary, later a
ready draft); deadlines found in mail ("due Friday", "payment due Oct 3") in Due;
**Coming up** (bookings, renewals, deadlines in the next 7 days); new mail grouped by
meaning ("3 receipts · file all"); at most one insight. Assembled from cached per-thread
results; opening Today never sends the mailbox to a model.

**Later:** ready drafts, rule suggestions, meeting prep, morning/afternoon/evening modes.

### 5.3 Mail views
- Boxes as HEY defines them, plus **split tabs** built from HEY labels, AI labels and saved
  searches (Superhuman's Split Inbox, mapped onto HEY concepts).
- List rows show sender, subject, one-line AI summary (updates on new messages), badges
  (needs reply, waiting, booking, receipt).
- **Search (Gmail-style, whole mailbox; built):** words, `"phrases"`, `-excluded`, `a OR b` / `{a b}`,
  and `from:` `to:` `subject:` `in:` `label:` `has:` (attachment, pdf, image, document, spreadsheet,
  presentation, media, zip, invite) `is:unread/read` `after:` `before:` `newer_than:` `older_than:`.
  Runs twice and merges by thread: at once on the cache (subjects, senders, previews, AI summaries,
  bodies of threads read), and on `hey search` (the whole mailbox, bodies included, 10 a page, "More
  results"). HEY's date ranges are narrowed to the exact days on what comes back; read state and
  Reply Later / Set Aside / Bubble Up are cache-only. `from:`/`to:` match at word starts. The box
  grows to the list's width while in use, completes operators (people for from:/to:, labels, file
  kinds), lists them when empty, and has filter chips (From, date, box, attachment, Unread) that
  edit the query text. ↓/Enter open the first result; j/k move through results.
- Later: semantic search (embeddings) alongside.

### 5.4 Thread view
- Summary at top (key points, decisions, action items). Action items → todo or event in
  one keystroke.
- **Reply drafts:** generated only for threads classified as needing a reply (avoids
  Superhuman's "drafts for mail that doesn't need one" problem). Alternatives: short /
  detailed / decline. Edit inline, then send or save to HEY drafts.
- **Compose from a phrase** ("say yes but push to Friday") in the user's voice.
- HEY snippets available, AI fills variables.
- **Contact sidebar:** HEY contact note, recent threads, upcoming shared events, AI one-
  paragraph relationship summary.
- Translate thread / draft (later tier, cheap to add).
- **Reading width:** body text is capped at ~72 characters per line in every theme; wide
  tables scroll sideways inside the message.
- **Details panel** (right side, automatic when the reader is ≥1080px wide; toggle or `i`,
  remembered per device): people in the thread with copyable addresses, more threads from
  the sender, every file in the thread. The AI summary, action items, reply drafts and
  suggested actions move into this panel in M2.

### 5.5 Waiting on (follow-ups)
- Detects sent threads with no reply after N days (default 3, per-thread override).
- "Remind me if no reply" (`h` key) → uses HEY Bubble Up (`hey bubble up --on`) so the
  reminder also works in HEY's own apps.
- AI drafts a polite nudge on demand.

### 5.6 ⌘K command bar
- One bar for commands and requests. Typing matches commands first (with their shortcut
  shown so users learn it); a sentence goes to the agent.
- Agent can search, read, summarise, answer ("when is the Seaside check-in?"), and
  propose plans ("move all Amex receipts from the last 90 days to Paper Trail") that go
  through the approval UI.
- Conversation stays attached to the current context (thread, day, insight).

### 5.7 Calendar
- Day/week view (read from `hey event day/week`), all HEY calendars with their colours.
- **Email → event:** bookings, invitations and deadlines detected in mail become
  suggested events (title, time, location, link to thread, calendar chosen by rule, e.g.
  Airbnb → "AirBnB"). One keystroke to accept.
- **Share availability:** "reply with my free slots next week" inserts slots into a draft.
- **Meeting prep:** before an event, a card with related threads and people.
- Edits respect CLI limits (notes flattened to plain text → warn before editing events
  with formatted notes).

### 5.8 AI sorting & Screener help
- Suggests: Feed or Paper Trail for automated senders, screener approve/deny with reason,
  AI labels defined by prompt (e.g. "job applications") applied as real HEY labels.
- Accepting a suggestion offers "always do this" → rule (4.4).

### 5.9 Insights (v1: A, C, E)

**A · Attention health** (computed from the cache; no AI needed except classification)
- Mail volume per box per week; share from automated senders (currently ~32% of Imbox).
- Top senders by volume vs. your engagement (did you ever reply?).
- "Noise" candidates: senders you never reply to → one-click move to Feed/Paper Trail or
  rule.
- Reply Later and Set Aside ageing; Screener decisions over time.

**C · Commitments & money** (AI extraction over Paper Trail + Imbox)
- Extracted records: vendor, amount, currency, date, category, recurring?, source thread.
- Views: spend by month/vendor/category, **subscriptions** (detected recurring charges,
  next renewal), **upcoming commitments** (bookings, renewals, deadlines) cross-checked
  against the calendar.
- User can correct any record; corrections improve future extraction (few-shot examples).
- Every number links back to its source email.

**E · Narrative & ask**
- **Weekly review** (Sunday evening, or on demand): what happened, what's pending, money
  in/out, what's coming. Optionally saved as a HEY journal entry (with approval).
- **Ask anything** over the data ("how much did I spend on Airbnb this year?"): the agent
  queries safe read-only views of the extracted tables + semantic search, and cites
  sources.

Charts follow one consistent, accessible style (light + dark).

### 5.10 Themes
- **Default:** graphite sidebar, white panes, one cobalt accent, Onest typeface; follows
  system light/dark.
- **Omarchy:** matches Omarchy/Hyprland: tiled panes with gaps and borders, accent border
  on the active pane, square corners, monospace (the system's Omarchy font if installed,
  else bundled JetBrains Mono), Tokyo Night palette, no motion.
- Switch in the sidebar footer or with ⇧T; remembered per device.
- Later: the other Omarchy palettes (Catppuccin, Gruvbox, Nord, Everforest, Kanagawa…),
  and on Linux follow the user's active Omarchy theme automatically.

### 5.11 Settings
AI mode & keys, task routing & budget, usage meter, rules, activity log, backfill status,
MCP setup, keyboard shortcuts, license.

## 6. Later (post-v1)
- **Insights B · Relationships:** people you've gone quiet with, reply latency per person,
  correspondence trends (needs full thread backfill).
- **Insights D · Time & life:** calendar load by calendar (Coparenting, Projects…), focus
  time, time tracking, habits and journal trends.
- Voice dictation for compose. Instant Intro (move introducer to BCC). Translation.
- Windows and Linux builds. Apple on-device model via a Swift helper on Mac.
- Send Later — only if the CLI adds scheduling.

## 7. Superhuman features considered

| Feature | Decision |
|---|---|
| ⌘K palette, keyboard-first, shortcut teaching | Adopt |
| Auto Summarize | Adopt (5.3, 5.4) |
| Auto Drafts / Instant Reply | Adopt, gated by "needs reply" (5.4) |
| Ask AI | Adopt (5.6, 5.9 E) |
| Auto Labels / Split Inbox / Auto Archive | Adopt, mapped onto HEY boxes and labels (5.3, 5.8) |
| Remind if no reply / Auto Follow-Up | Adopt via Bubble Up (5.5) |
| One-tap event, share availability | Adopt (5.7) |
| Write with AI / Auto Compose | Adopt (5.4) |
| Snippets | Adopt, using HEY snippets |
| Contact sidebar | Adopt (5.4) |
| Instant Intro, Translate, Voice | Later |
| Read statuses (tracking pixels) | Reject — against HEY's values; CLI can't |
| Send Later | Reject for now — CLI can't schedule |
| Team features, agent marketplace | Out of scope |

## 8. Data model (cache, SQLite)

- `boxes(id, kind, name)`
- `postings(id, topic_id?, box_id, subject, summary_hey, created_at, active_at, seen?,
  bundle bool, contacts_json, raw_json)`
- `threads(topic_id, subject, last_entry_id, updated_at, fetched_at)`
- `entries(id, topic_id, sender_email, sender_name, created_at, to/cc/bcc_json,
  body_md, is_mine bool)` + `entries_fts` (FTS5) + `entry_vectors` (sqlite-vec)
- `contacts(id, name, email, aliases_json, note)`
- `labels`, `collections`, `posting_labels`, `collection_topics`
- `events(id, occurrence_id?, calendar_id, title, starts_at, ends_at, all_day, raw_json)`,
  `calendars`, `todos`
- AI: `ai_thread(topic_id, last_entry_id, summary, needs_reply, category, automated,
  action_items_json, model, created_at)`, `drafts_local(topic_id, variant, body_md,
  status)`, `extractions(id, topic_id, type[receipt|subscription|booking|deadline],
  vendor, amount, currency, date, fields_json, confidence, corrected bool)`
- Actions: `plans`, `actions(id, plan_id?, source, type, params_json, status, inverse_json,
  executed_at, verified bool)`, `rules(id, name, conditions_json, actions_json, enabled)`
- `usage(date, provider, model, task, input_tokens, output_tokens, est_cost)`
- `sync_state(box_id, cursor, backfill_done, last_watch_at)`

## 9. HEY CLI constraints (v1.6.0)

- ~0.5 s per call; `--all` capped at 101 pages → use `--page` cursors and year searches.
- `seen`/`unseen`/`move` silently accept wrong IDs → verify (4.1).
- Bundles can lack `topic_id`.
- No scheduled send; no untrash.
- `event edit` replaces the whole event; notes return as plain text; countdowns dropped
  unless re-sent.
- `hey watch` streams mail and calendar changes (`recording_*`, `calendar_*`). Some
  `updated` lines carry no posting → re-read that box's first page (debounced).
- A posting's `seen` is `true` or absent (absent = unseen).
- `hey mcp` exists (7 tools) — useful reference, but the app uses its own action layer.
- Auth is owned by the CLI; the app never handles HEY credentials.

## 10. Milestones

| # | Milestone | Scope |
|---|---|---|
| M0 | Foundations | pnpm monorepo, Electron + Vite + React shell, core package, CLI adapter with typed schemas + verification, SQLite cache, `hey watch`, initial sync. Runs in browser for dev. |
| M1 | Reading app | Mail views, thread view, search (FTS), keyboard map, ⌘K commands (no AI), actions + activity log + undo. |
| M2 | AI core | Provider settings (Claude / local / mixed), usage meter + budget, summaries, classification, drafts, voice profile, ⌘K agent with approval queue. |
| M3 | Daily flow | Brief, Waiting on, calendar views + email→event, availability, contact sidebar, sorting suggestions + rules. |
| M4 | Insights | A, C, E; embeddings + semantic search; weekly review. |
| M5 | Ship | MCP server, onboarding, licensing, signing/notarization, auto-update, polish. |

## 11. Risks

- **Dependency on 37signals.** CLI/API changes or terms could break or forbid a paid
  product. Action: read HEY API/CLI terms before selling; consider contacting 37signals.
  HEY may also ship its own AI features.
- **CLI install friction.** Every user must install and log in to the HEY CLI.
- **AI quality with local models.** Classification/extraction may be weak on small models;
  mixed mode is the recommended default.
- **Cost surprises on BYOK.** Mitigated by budget caps and cache-keyed processing.
- **Prompt injection via email.** Mitigated by approval queue and rule allowlist.
- **Electron footprint.** Accepted; keep the renderer lean.

## 12. Open questions

1. Product name ("SuperHey" proposed; see trademark risk).
2. Trial or not at $29.
3. Should the weekly review write to the HEY journal by default?
