# SuperHey

A fast, keyboard-first desktop app for [HEY](https://www.hey.com) email, with AI that
works for you and never acts without you.

SuperHey sits on top of HEY. It doesn't replace it or store your mail on anyone's
servers: everything it reads and does goes through the official
[HEY CLI](https://github.com/basecamp/hey-cli), so each change you make here shows up in
every HEY app, and HEY stays the one source of truth.

> **Status:** early and in active development. It runs well day to day on macOS, and there
> are no signed builds yet, so you run it from source (below).
>
> SuperHey is an independent project. It is not made by, endorsed by or affiliated with
> 37signals or HEY.

## Contents

- [What it does](#what-it-does)
- [Getting started](#getting-started)
- [AI: set-up, costs and privacy](#ai-set-up-costs-and-privacy)
- [Searching](#searching)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [Appearance and themes](#appearance-and-themes)
- [Where your data lives](#where-your-data-lives)
- [Development](#development)
- [Troubleshooting](#troubleshooting)

## What it does

**Reading and triage**

- **Today:** a single page of what needs you: what's due or late, emails that need a
  reply, Reply Later, people you're waiting on, what's new since you last looked, and
  what's coming up in the next week (from your HEY calendar and dates found in your mail).
- **All of HEY's boxes** (Imbox, The Feed, Paper Trail, Reply Later, Set Aside, Bubble Up),
  with **The Screener** and bundles, grouped as HEY does (New for you, Previously seen).
- **Threads that read well:** HTML mail shown as designed or simplified, forwarded mail
  unwrapped (with a link to the original), quoted history and repeated signatures folded,
  mailing-list and "Action required" tags shown as chips.
- **Quick Look for attachments:** PDFs and images laid over the app like paper on a desk,
  with page tracking and zoom (buttons, `+`/`−`, or pinch).
- **Actions with undo:** move, Set Aside, Reply Later, Bubble Up, labels, seen/unseen,
  trash. Every action is logged in Activity, and most can be undone (`z`).

**Calendar**

- Your HEY Calendar in **Day, Week and Month** views, like the Mac's Calendar: events in
  their calendar's colours, all-day events above the hours, a line at the time now, and
  details with **Join** for meeting links. Press `7`, or pick Calendar in the sidebar.
- The sidebar leads with what's happening now or next ("In 10 min", with Join), then the
  rest of today and tomorrow.
- **Add dates from email to the calendar:** calls, bookings and trips the AI finds in a
  thread get an **Add** button (in the details panel and in Today's Coming up) that opens a
  filled-in event to check first. Dates already in your calendar say **In calendar**.

**Writing**

- Reply, Reply all and Forward, from the end of a thread or **to any earlier message** in it.
- **Send with a 5-second undo.** Your reply appears in the thread at once, with Undo while it
  waits.
- Recipients you can see and edit, Cc/Bcc, attachments, HEY drafts. Unsent text is kept on
  your device until you send or discard it.

**AI** (optional, with your own key or a local model)

- One-line summaries, and what each thread needs from you (a reply, a deadline, a date,
  an amount).
- **Reply drafts in your voice**, learnt from emails you've written. Type what you want
  to say ("yes, Monday works") and press `⌘J`.
- A monthly budget cap, usage per task, and prompt caching to keep the cost down.

**Search**

- Gmail-style operators (`from:`, `has:pdf`, `newer_than:7d`…) with suggestions as you
  type, recent searches, and results from both your local cache and HEY.

## Getting started

### Requirements

- **macOS** (Linux works for development; it's the main target after macOS).
- **Node.js 22.13+** and **pnpm 10** (`corepack enable` sets up pnpm).
- The **HEY CLI** (1.6 or newer), installed and signed in:
  ```sh
  hey auth login
  hey auth status   # should show you're signed in
  ```

### Install and run

```sh
git clone https://github.com/oliverox/superhey.git
cd superhey
pnpm install
pnpm dev
```

`pnpm dev` starts the app with hot reload. On first start SuperHey finds the `hey` CLI,
syncs your boxes into a local cache, and then follows changes live (`hey watch`).

To build the app:

```sh
pnpm build        # into apps/desktop/out
pnpm --filter @superhey/desktop start   # run the built app
```

## AI: set-up, costs and privacy

AI is off until you set it up in **Settings → AI** (`⌘,`). You bring your own:

| Provider | Models | Notes |
| --- | --- | --- |
| Claude (Anthropic) | Haiku 4.5, Sonnet 5, Opus 5.5 | Recommended. Haiku for quick tasks, Sonnet for drafting. |
| OpenAI | GPT-6 Luna, Sol, Astra | |
| Grok (xAI) | Grok 4.3, 4.7 | |
| Local | Ollama or LM Studio | Free and private, runs on your Mac. Weaker at drafting. |

- **Keys** are stored in your macOS Keychain (through Electron's `safeStorage`), never in a
  file or in the repository. Each provider bills you directly.
- **What's sent:** only what a task needs (the latest few messages of a thread, trimmed),
  and only to the provider you chose for that task. Nothing is sent for The Feed unless you
  ask. Mail content is treated as data in prompts, never as instructions.
- **Budget:** set a monthly cap for cloud spending. When it's reached, AI stops until the
  next month. **Settings → Usage** shows what each task cost.
- **Cost:** summaries run on a small model with prompt caching. Drafts use the quality
  model and are only written for threads you open that need a reply (or when you ask).
- **Your voice:** in **Settings → Your voice**, SuperHey reads up to 40 of your own sent
  emails once to build a short style guide. You can read it, add notes ("never use
  exclamation marks"), rebuild it or delete it.

AI never sends email and never changes your mailbox on its own.

## Searching

Type in the search box (`/`). Plain words search everything; a "quoted phrase" matches
exactly; `-word` excludes it; `a OR b` finds either. Operators:

| Operator | Example | Finds |
| --- | --- | --- |
| `from:` | `from:sam` | Sender (name or address) |
| `to:` | `to:sam` | Recipient |
| `subject:` | `subject:invoice` | Words in the subject |
| `in:` | `in:feed` | A box: `imbox`, `feed`, `papertrail`, `later`, `aside`, `bubble`, `trash` |
| `label:` | `label:travel` | A HEY label |
| `has:` | `has:pdf` | `attachment`, `pdf`, `image`, `document`, `spreadsheet`, `presentation`, `media`, `zip`, `invite` |
| `is:` | `is:unread` | `unread` or `read` |
| `after:` / `before:` | `after:2026-01-31` | On or after / before a day |
| `newer_than:` / `older_than:` | `newer_than:7d` | Within / older than `d`, `w`, `m`, `y` |

Results come from your local cache straight away, then from HEY's own search.

## Keyboard shortcuts

Press `?` in the app for the full list. The main ones:

| | |
| --- | --- |
| **Navigate** | `j` / `k` next and previous · `0` Today · `1`–`6` boxes · `7` Calendar · `\` boxes and settings (Column style) · `/` search · `Esc` close the email or leave search |
| **Calendar** | `←` / `→` previous and next · `T` today · `D` `W` `M` day, week, month · double-click a time to add an event |
| **Thread** | `;` expand or collapse all · `i` details |
| **Act** | `r` Reply Later · `s` Set Aside · `b` Bubble Up… · `m` Move to… · `f` The Feed · `p` Paper Trail · `l` Labels… · `u` seen/unseen · `#` Trash · `e` Done (on Today) · `z` undo |
| **Write** | `⇧R` reply · `a` reply all · `⇧F` forward · `c` new message · `⌘↵` send · `⌘J` draft in your voice |
| **Screener** | `⇧S` open · `y` let them in · `n` screen out · `!` spam |
| **App** | `⌘K` command bar · `⌘,` Settings · `⇧T` switch style · `⇧D` light or dark |

## Appearance and themes

**Settings → Appearance** (or the switch at the bottom of the sidebar):

- **Column style** (the default): SuperHey's own look, in **light, dark or system**. One
  column to read down: the open email unrolls inside the list, the emails around it fade
  back, and a day rail in the margin marks where each day starts and what needs you. Mail is set in
  a reading serif (Newsreader), the interface in Geist, times and counts in Geist Mono, with
  one signal colour for what needs you. The sidebar becomes a drawer: click the page's title
  ("Imbox ▾", "Today ▾") or press `\`. Designed (HTML) emails show **As designed** on their own sheet, or **As text**
  in the app's type.
- **Default style:** SuperHey's own look, in **light, dark or system**. Themes:
  **Cobalt** (the default), **Graphite** (black and greys), **Linen**, **Fjord**, **Moss** and
  **Plum**. Each has a light and a dark version.
- **Omarchy style:** squared-off and monospaced, in the colours of
  [Omarchy](https://omarchy.org)'s themes: Tokyo Night, Catppuccin, Catppuccin Latte,
  Everforest, Gruvbox, Kanagawa, Nord, Rosé Pine, Flexoki Light, Matte Black and Ristretto.

Motion follows your system's "reduce motion" setting, and the Omarchy style has none.

## Where your data lives

Everything stays on your computer:

| What | Where (macOS) |
| --- | --- |
| Mail cache (SQLite), attachments, avatars | `~/Library/Application Support/SuperHey/` |
| AI keys | macOS Keychain ("SuperHey Safe Storage") |
| Look, recent searches, unsent text | The app's local storage |

Deleting that folder resets SuperHey. It will sync again from HEY; your mail in HEY is
untouched.

## Development

This is a pnpm monorepo:

```
packages/core     @superhey/core: no Electron. The HEY CLI adapter, SQLite cache
                  (node:sqlite), sync engine and `hey watch`, actions and outbox,
                  search, Today, and the AI (analysis, voice, drafts) via the AI SDK.
apps/desktop      @superhey/desktop: Electron main process and preload, the React 19
                  renderer (Tailwind v4), and a dev web server that serves the same UI
                  in a browser.
docs/SPEC.md      The product spec: principles, features and plans.
```

Common commands (from the root):

```sh
pnpm dev          # the Electron app with hot reload
pnpm test         # all tests (Vitest), core and desktop
pnpm typecheck    # TypeScript, all packages
pnpm build        # build the desktop app
pnpm demo         # end-to-end sync check against your HEY account
pnpm --filter @superhey/desktop dev:web   # the UI in a browser at http://127.0.0.1:5174
```

### A safe test instance

To try changes against your real account without sending mail or changing anything,
run a second, read-only copy with its own data folder:

```sh
cd apps/desktop
SUPERHEY_TEST_NO_SEND=1 \
SUPERHEY_TEST_NO_SCREENER_DECISIONS=1 \
SUPERHEY_TEST_NO_AUTO_ACTIONS=1 \
SUPERHEY_USER_DATA=/tmp/superhey-test \
npx electron-vite dev --remoteDebuggingPort 9335 -- --port 5175
```

| Variable | Effect |
| --- | --- |
| `SUPERHEY_TEST_NO_SEND=1` | Sending mail and changing the calendar fail instead of happening (the window says "Test instance"). |
| `SUPERHEY_TEST_NO_SCREENER_DECISIONS=1` | The Screener can't let anyone in or out. |
| `SUPERHEY_TEST_NO_AUTO_ACTIONS=1` | Nothing is changed automatically (e.g. marking seen on open). |
| `SUPERHEY_USER_DATA` | Electron's profile folder (keeps this copy's settings apart). |
| `SUPERHEY_APP_DATA` | Where the mail cache lives, if not the default. |

### Principles the code follows

- **You approve every write.** AI proposes; nothing sends on its own; every action is
  logged and undoable where HEY allows.
- **HEY is the source of truth.** The cache is only a cache, and all changes go through
  the CLI.
- **Local-first.** No backend, no telemetry.

## Troubleshooting

- **"HEY CLI not found":** install it and make sure `hey` is on your `PATH`, then check
  `hey auth status`.
- **Nothing syncs:** run `pnpm demo` to test the CLI and sync outside the app.
- **"unknown method …" after pulling changes:** a copy of the app from before the change
  is still running. Quit every SuperHey window, then run `pnpm dev` again.
- **AI says it isn't set up:** add a key in **Settings → AI** and use **Test** next to
  the provider.

## Licence

No licence has been chosen yet, so all rights are reserved for now.
