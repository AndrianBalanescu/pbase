# baseStarter

> A production-oriented **PocketBase** starter: one Go binary + SQLite, a zero-build **ohno** UI
> on Vue 3, versioned JS migrations and hooks, and an **agent-first toolchain**
> (`AGENTS.md`, skills, `llms.txt`, live OpenAPI).

PocketBase **v0.40.4** · no Node, no bundler, no Docker.

```
┌───────────────────────────────────────────────────────────────┐
│                     one Go binary (~15 MB RAM)                │
│                                                               │
│   REST API  ·  Auth  ·  Realtime SSE  ·  File store  ·  Cron  │
│                         SQLite (base/pb_data/)                │
│                                                               │
│   base/pb_hooks/*.pb.js     ← server logic (Goja JSVM)        │
│   base/pb_migrations/*.js   ← versioned, reversible schema    │
│   base/pb_public/           ← zero-build ohno UI + Vue + SDK  │
└───────────────────────────────────────────────────────────────┘
        ▲                                   ▲
   humans & browsers                    AI agents
   (/, /_, /docs/)            (AGENTS.md, .agents/skills, llms.txt)
```

## Quickstart

```bash
./scripts/bootstrap.sh         # install binary · migrate · create superuser
SEED_DEMO=1 ./scripts/dev.sh   # dev server + demo user & 3 posts
```

- App / frontend → <http://127.0.0.1:8090>
- Admin UI → <http://127.0.0.1:8090/_/>  (`admin@local.local` / `supersecretdev` — dev-only defaults; change in `.env`)
- API reference → <http://127.0.0.1:8090/docs/>
- Agent guide → [`AGENTS.md`](./AGENTS.md) and [`base/pb_public/llms.txt`](./base/pb_public/llms.txt)

Run `make help` for every task (migrates, backups, migrations, reset).

## Reuse this starter

This repo is a **template**. To start a new project from it:

```bash
git clone <this-repo> my-app && cd my-app
rm -rf .git && git init          # fresh history for your project

cp .env.example .env             # then EDIT it — at minimum change the superuser password
make bootstrap                   # download binary · migrate · create superuser (idempotent)

make dev                         # http://127.0.0.1:8090
```

Then in day-to-day work: `make new-migration name=…` for schema, edit `base/pb_hooks/`, and let your
agent read `AGENTS.md` + `.agents/skills/` automatically.

**Nothing runtime is committed.** `base/pb_data/` (SQLite DB + uploads) and `.env` are gitignored, so a
clone ships only the *code* — no data, no secrets.

### The superuser: how it is actually created

The superuser is **NOT defined in the codebase** and **NOT created by a migration**. It is created
by a **CLI command**, shared by `scripts/bootstrap.sh` and `scripts/dev.sh` via
`scripts/lib/ensure-superuser.sh`:

```bash
EMAIL="${PB_SUPERUSER_EMAIL:-admin@local.local}"
PASSWORD="${PB_SUPERUSER_PASSWORD:-supersecretdev}"
./base/pocketbase --automigrate=false --dir="$DIR" superuser upsert "$EMAIL" "$PASSWORD"   # ← the CLI, not JS
```

- The values come from `.env` (`PB_SUPERUSER_EMAIL` / `PB_SUPERUSER_PASSWORD`), with those
  defaults as fallback. `grep superuser base/pb_migrations/*.js` returns **nothing** — migrations never
  touch `_superusers`.
- The account lands in the data dir's SQLite DB (`_superusers` table), created the first time a
  CLI command runs — it does **not** exist on a fresh clone until `make bootstrap`/`dev.sh` runs.
- **`dev.sh` upserts it before every start.** PocketBase shows its "Create your first superuser"
  install screen (and seeds a throwaway `__pbinstaller@example.com` row) whenever the `--dir` DB
  has no *real* superuser — e.g. after `make clean`, or a first `dev.sh` run that skipped
  `bootstrap`. The upsert is create-or-update, so it is idempotent and re-syncs the account with
  `.env` on each boot. That is why the prompt no longer comes back on restart.
- ⚠️ **Change `PB_SUPERUSER_PASSWORD` before any non-local use** — the default `supersecretdev` is
  a dev-only placeholder.
- ⚠️ The email domain **must contain a dot**: `admin@local` fails validation, `admin@local.local` works.

Ad-hoc (no `.env` edit): `make superuser email=me@my.app pass='a-strong-password'`.

## What you get

| | |
|---|---|
| **Schema as code** | `base/pb_migrations/` — reversible JS migrations for `users`, `posts`, `comments`. |
| **Server logic** | `base/pb_hooks/` — record guards, cron, webhooks, and custom routes defined in `lib/api.js` (`/api/stats`, `/api/activity`, `/api/me`, `/api/schema`). |
| **Zero-build UI** | `base/pb_public/` — the **ohno** UI kit + Vue 3 global build + PocketBase SDK, all vendored; edit and refresh. Sidebar shell, dashboard, live posts table, schema inspector, ⌘K palette. |
| **Seeded demo** | `SEED_DEMO=1` creates a user and posts (idempotent). |
| **Agent-native** | `AGENTS.md`, nested guides, `.agents/skills/*`, `llms.txt` + `llms-full.txt`, **live** OpenAPI 3.1 (generated from the DB + route table, rendered by Scalar). |
| **Ops scripts** | install · bootstrap · dev · backup. `dev.sh` ensures a superuser before every start, so the install screen never reappears on restart. |
| **Pinned runtime** | `base/pocketbase.version` is the single source of truth; `scripts/install-pocketbase.sh` fetches it. |

The UI stack is a **default, not a lock-in.** The backend never references ohno or Vue, and every
ohno call in `assets/app.js` is guarded, so the REST API and the page keep working if you swap in
another kit — the change is confined to the frontend: `index.html`, `assets/app.css`, `assets/app.js`
and the static `docs/licenses/index.html`. Details in
[`base/pb_public/AGENTS.md`](./base/pb_public/AGENTS.md).

## File map

```
baseStarter/
├── Makefile                        # task runner (make help)
├── AGENTS.md                       # canonical agent guide
├── .agents/skills/                 # pocketbase-schema · -hooks · -api-client
├── .agents/reference/              # PocketBase knowledge base (always-loaded)
│                                   #   TOP-20-APIs.md · PRODUCTION.md · docs.txt · jsvm.txt · js-sdk.md
├── scripts/                        # install · bootstrap · dev · backup  (+ AGENTS.md)
│                                   #   lib/env.sh — .env loader (env vars win over .env)
│                                   #   lib/ensure-superuser.sh — idempotent superuser upsert
├── base/
│   ├── pocketbase.version          # pinned PocketBase version
│   ├── pb_migrations/              # schema (JS, reversible)          (+ AGENTS.md)
│   ├── pb_hooks/                   # JSVM hooks (records · routes · cron · webhooks)  (+ AGENTS.md)
│   │                               #   lib/api.js — route table · lib/openapi.js · lib/slug.js
│   ├── pb_public/                  # static site: index.html · assets · docs · llms*.txt
│   │                               #   vendor/ (ohno · Vue · PB SDK · Scalar)  (+ AGENTS.md)
│   │                               #   docs/licenses/ — third-party MIT texts  (/docs/licenses/)
│   └── pb_data/                    # SQLite + uploads (gitignored)
└── LICENSE                         # MIT (kept in root — only place GitHub auto-detects it)
```

## Collections

| Collection | Purpose | Notable |
|---|---|---|
| `users` | Auth | extended with `bio`, `role`; public sign-up, owner-only edits |
| `posts` | Content | unique auto-slug, `status`, file `cover` with thumbnails, `publishedAt` |
| `comments` | Discussion | cascade-deletes with its post |

## Development

```bash
make new-migration name=add_widgets   # scaffold a schema change
make migrate && make migrate-down     # apply, then prove the rollback
make collections                      # snapshot UI schema edits into a migration
make backup                           # consistent sqlite snapshot of the data dir → base/backups/
```

Everyday traps (5000-char text default, API-rule semantics, JSVM scoping, date formats) are
documented in [`AGENTS.md`](./AGENTS.md) and [`base/pb_public/llms-full.txt`](./base/pb_public/llms-full.txt).

## API docs are generated, not written

The OpenAPI 3.1 document served at `/openapi.json` is built **at request time** by
`base/pb_hooks/lib/openapi.js`: collections come from `$app.findAllCollections()`, and custom routes
come from the same `ROUTES` table in `base/pb_hooks/lib/api.js` that registers the handlers. Add a field
or a route and the reference at `/docs/` reflects it on reload — there is no static spec to drift.

## License

The starter code in this repository is released under the MIT License — see [`LICENSE`](./LICENSE)
(kept at the root because that is the only location GitHub and most tooling auto-detect).

The bundled `pocketbase` binary and the vendored UI/JS libraries are third-party MIT projects;
their full license texts live in [`base/pb_public/docs/licenses/`](./base/pb_public/docs/licenses/README.md)
and are served at `/docs/licenses/`.
