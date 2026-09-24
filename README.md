# SuperHey (working title)

An AI-first desktop companion for HEY, built on the official HEY CLI. See [docs/SPEC.md](docs/SPEC.md).

Requires Node 22.13+, pnpm, and the [HEY CLI](https://github.com/basecamp/hey-cli) signed in (`hey auth login`).

```sh
pnpm install
pnpm dev                                # Electron app with hot reload
pnpm --filter @myhey/desktop dev:web    # same UI in a browser (http://127.0.0.1:5174)
pnpm test                               # core tests
pnpm typecheck
pnpm demo                               # end-to-end sync check against your HEY account
```

Layout:

- `packages/core` — CLI adapter, SQLite cache (`node:sqlite`), sync engine and `hey watch`. No Electron.
- `apps/desktop` — Electron main/preload, React renderer, dev web server.
