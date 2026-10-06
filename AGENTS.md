# AGENTS.md — baseStarter

Guidance for AI coding agents working in this repository.
Human contributors should read this too :)

**Stack:** PocketBase **v0.40.4** (single Go binary + SQLite) · zero-build **ohno** UI kit + Vue 3 global build · JS schema migrations · Goja JSVM hooks.

REQUIRED: read the relevant file in `.agents/reference/` before developing or debugging any PocketBase logic — do not invent or assume!

---

## Start here

1. `./scripts/bootstrap.sh` — installs the pinned binary, applies migrations, creates a
   dev superuser. Idempotent; safe to re-run.
2. `./scripts/dev.sh` — dev server on `http://127.0.0.1:8090` (`--dev`: SQL logging + hook
   hot-reload). It ensures a superuser exists **before** serving (idempotent upsert from `.env`), so the
   "Create your first superuser" install screen never comes back on restart (trap 30). For demo data,
   run `SEED_DEMO=1 ./scripts/bootstrap.sh` — the seed fires when migrations first run.
3. `make help` — every common task.
4. **Read `.agents/reference/TOP-20-APIs.md` first** — the ranked cheat sheet of PocketBase's
   native surface and the *built-in vs custom code* rule. Most "let me write a route/helper"
   jobs are already an API rule, a field option, an index, `expand`, `cronAdd`, or `/api/batch`.
5. Deep manuals, in-repo: `.agents/reference/pocketbase-docs.txt` (official docs),
   `.agents/reference/pocketbase-jsvm.txt` (complete JSVM hooks/globals),
   `.agents/reference/pocketbase-js-sdk.md` (client SDK). One-page map: `base/pb_public/llms.txt`.
6. Working inside a subdirectory? Its own `AGENTS.md` adds scoped rules — see
   [Nested AGENTS.md](#nested-agentsmd) below.

---

## Commands you will actually use

```bash
make dev                      # dev server
make migrate                  # apply pending migrations
make migrate-down             # revert the last migration
make new-migration name=x     # scaffold a migration (writes .js)
make collections              # snapshot the UI schema into a migration
make backup                   # consistent sqlite snapshot of the data dir → base/backups/
make reset                    # DESTRUCTIVE: wipe base/pb_data/ + re-migrate + superuser (CONFIRM=1 to skip prompt)

./base/pocketbase superuser upsert admin@local.local 'password'   # email needs a dot
echo y | ./base/pocketbase migrate create <name>                    # non-interactive
```

---

## Architecture

```
base/pb_migrations/   schema, versioned & reversible (JS). The ONLY place schema changes.
base/pb_hooks/        server-side JS: record guards, custom routes, cron, webhooks.
  lib/           stateless helper modules, required INSIDE handlers (see the contract).
base/pb_public/       static site served at /  (index.html, assets/, docs/, vendor/).
base/pb_data/         SQLite DB + uploads. Runtime state — gitignored, never edit by hand.
scripts/         install / bootstrap / dev / backup (lib/env.sh loads .env as defaults).
```

Load order for hooks is filename order (`10_` → `20_` → `30_` → `50_` → `60_`).
Prefix a file with `_` to disable it.

**Custom routes live in `base/pb_hooks/lib/api.js`, not in the hook file.** `20_custom_routes.pb.js`
is a two-line loader (`require(...).register(routerAdd)`); the `ROUTES` table there carries both
handler and OpenAPI metadata, and `30_api_docs.pb.js` documents that same table — so the docs
cannot drift from behaviour. Add an endpoint by appending one entry to `ROUTES`.

### Data model

- `users` (auth, ships with PocketBase) — extended with `bio`, `role`. Public sign-up.
- `posts` — `title`, `slug` (unique, auto), `body`, `status`, `lang`, `tags`, `cover`,
  `metadata`, `publishedAt`, `author`. Guests see published only; authors edit their own.
- `comments` — `body`, `author`, `post` (cascade-deletes with the post).

---

## Conventions

**Schema.** Never hand-edit collections in the DB or the Admin UI as the primary workflow.
Add a migration file. Use `make collections` to snapshot UI changes into a versioned file.

**Migrations** receive a *transactional* app; throwing rolls the whole file back.

```js
migrate((app) => { /* up */ }, (app) => { /* down */ })
```

**Hooks.** Always call `e.next()`. Throw the typed errors for control flow:

```js
onRecordCreateRequest((e) => {
  // helpers live in lib/ — require INSIDE the handler (pooled VMs have no shared scope)
  const { slugify } = require(`${__hooks}/lib/slug.js`)
  if (!e.record.getString("slug")) e.record.set("slug", slugify(e.record.getString("title")))
  e.next()
}, "posts")
```

**Frontend.** Plain ES modules in `base/pb_public/assets/`. No bundler, no `node_modules`. Use
the vendored `vendor/pocketbase.umd.js`, `vendor/vue.global.prod.js` and the **ohno** UI kit
(`vendor/ohno/`). ohno is classless-first — native elements are styled; use its classes
(`.card`, `.badge`, `.btn-primary`, `.table-wrap`, `data-modal-open`, `data-tabs`…) rather than
inventing new ones. `assets/app.css` is only for layout tweaks ohno does not own. Call
`pb.autoCancellation(false)` in reactive code.

**Style.** 2-space indent, double-quoted JS strings, trailing commas off, keep hook
filenames numbered by load order. Comments explain *why*, not *what*.

---

## Traps that have already bitten us

| # | Wrong belief | Reality |
|---|---|---|
| 1 | "Text fields are unbounded." | `TextField.Max` defaults to **5000**; oversized writes fail validation and reject the whole record. Always set `max`. |
| 2 | "`null` means public." | Backwards. `""` (empty string) = **public** — the rule is disabled. `null` = **superuser-only**. Expression = per-request filter. A record you may not see is **hidden, not 403'd**: an unsatisfied **list** rule returns **200 filtered** to what you may see; **view/update/delete** return **404**; **create** returns **400**. |
| 3 | "Base collections get created/updated for free." | Only auth collections do. Declare `autodate` fields explicitly or index creation fails on `created`. |
| 4 | "`record.get('date')` gives me a string." | It returns a truthy `DateTime` **object** even when empty. Use `getString()` / `getDateTime().isZero()`. |
| 5 | "ISO dates work." | Persist dates as `"YYYY-MM-DD HH:MM:SS.sssZ"` — a space, not `T`. ISO silently fails. |
| 6 | "Helpers at file top-level are reusable." | Each hook handler runs in its own pooled Goja VM and sees **only globals + its own locals** — not the file's top level, not another module's top level. Measured: a handler referencing module scope throws `ReferenceError: <name> is not defined` and the router surfaces a bare **400**. Fix: `require(\`${__hooks}/lib/x.js\`)` **inside** the handler; a function obtained that way keeps its own module closure. |
| 7 | "I'll create a `users` collection." | It already exists. Extend it; re-creating fails "Collection name must be unique". |
| 8 | "`findFirstRecordByFilter` returns null." | It **throws** `sql.ErrNoRows`. Capture outside try/catch. |
| 9 | "`migrate create/down/collections` run unattended." | All three prompt. `make` pipes `echo y \|`; call the binary directly and you must too. |
| 10 | "`migrate create` writes Go." | v0.40 defaults to **`.js`**. |
| 11 | "A select with no values is fine." | `select` needs non-empty `values`; `maxSelect` must be 1 unless explicitly multiple. |
| 12 | "`admin@local` is a valid superuser email." | The domain needs a dot: `admin@local.local`. |
| 13 | "Authorization *requires* `Bearer`." | The prefix is **optional**, not required. Both `Authorization: <token>` (what the SDK sends, and what the docs use) and `Authorization: Bearer <token>` return 200. |
| 14 | "`/api/batch` accepts any request." | Only record **create/update/upsert/delete**. Arbitrary GET endpoints are rejected with a 400. And it is **disabled by default** — this repo enables it in the init migration. |
| 15 | "Realtime needs a POST to subscribe." | Open the stream directly: `GET /api/realtime?clientId=X&subscriptions=posts`. The SDK's POST only updates topics on an already-open stream. |
| 16 | "Counts are cheap." | Without `?skipTotal=1` the server runs an extra `COUNT(DISTINCT …)`. With it, `totalItems`/`totalPages` = **-1**, not `null`. Use `perPage=1` + `skipTotal=1` when you only need a total. `perPage` silently clamps to **1000**; `perPage=0` resets to **30**. |
| 17 | "Back-relations match with `=`." | A multi-valued path (`comments_via_post.body`) applies **match-all**. Use the `?`-prefixed operators for any-of: `comments_via_post.body ?~ "spam"`. |
| 18 | "`@collection.*` works for anyone." | It is **superuser-only** in the `filter` param (guest → 403) and forces an expensive join. |
| 19 | "View collections emit realtime." | They do **not** — only base/auth collections emit realtime events. |
| 20 | "There is a `$jobs` global in the JSVM." | No. `grep -c '\$jobs' types.d.ts` = 0. Background work in `pb_hooks` is `cronAdd`/`cronRemove` only. |
| 21 | "A bare `PB_URL_OVERRIDE` reference is safe." | Referencing an undeclared identifier anywhere (even as `x \|\| fallback`) throws **`ReferenceError`** and aborts `setup()`. Read optional config via `globalThis.X \|\| default` and define it before the script. |
| 22 | "A 200 on an HTTP smoke check means the page works." | `indexFallback` serves `index.html` for any unknown path, so *every* path returns 200. Verify **content**, and render the page in a real browser — a JS error still returns 200. |
| 23 | "The client can filter by `@request.auth.*`." | It **cannot**. `@request.*` in the `filter` query param is rejected with **403 "Only superusers can filter by @request."** for *every* non-superuser (guests and normal authed users alike). A frontend that hardcodes it renders an empty, error-bannered page. Let the collection **rule** do the scoping; only filter on concrete fields client-side. |
| 24 | "Helpers at file top-level are fine if I `require` a module." | The *module* works, but it must be required **inside the handler**, and via **`${__hooks}/lib/x.js`** — a relative path resolves from the **process cwd**, not `base/pb_hooks/`, so it breaks when the binary starts elsewhere. `__hooks` is a real global (`typeof __hooks === "string"`). Keep modules **stateless**; the registry is shared per process. |
| 25 | "Goja is basically Node." | No — but it is **not** old JS either. Measured on v0.40.4: `typeof fetch` = **undefined**, `typeof setTimeout` = **undefined**, `require("lodash")` and `require("fs")` both throw **`GoError: Invalid module`**; handlers are synchronous (no event loop). **But** modern *syntax* works: arrow/`const`/`let`, spread, destructuring, `?.`, `??`, `for...of`, `Map`/`Set`, `class`, and stdlib like `Array.from`/`Object.entries`/`String.padStart`. So: modern syntax, limited runtime APIs. Use `$http.send()`, write helpers in `base/pb_hooks/lib/`. |
| 26 | "A fresh PocketBase is production-shaped." | It is not. Measured on a clean v0.40.4 DB: `meta.appName = "Acme"`, SMTP host `smtp.example.com`, `rateLimits.enabled = false`. Pin settings in the init migration (this repo sets `appName`, `rateLimits.enabled=true`, `batch.enabled=true`). |
| 27 | "`SEED_DEMO=1` is implemented by a hook." | Not in this repo — it is a **no-op migration** (`1791215001_seed_demo.js`) gated on `$os.getenv("SEED_DEMO")`. A hook seeder is wrong here: `onBootstrap` fires *before* migrations run, so the collection doesn't exist yet. |
| 28 | "`field.type` is a string." | On a live `Collection`, `field.type` and `field.columnType` are **bound Go methods** (`typeof f.type === "function"`; call `f.type()`) — not JSON-serializable. Putting them in an `e.json()` body makes the response emit **truncated** JSON mid-stream. Read canonical metadata with `JSON.parse(toString(collection.marshalJSON()))` (`marshalJSON()` returns a Go `[]byte`; `toString` decodes it). |
| 29 | "The vendored ohno `.grid-2/3/4` gives you columns." | In the vendored build only the **mobile** override ships (`max-width:767.98px → 1fr`), so the helpers render as a single column at every width. `base/pb_public/assets/app.css` re-adds the desktop base (`display:grid` + a `min-width:768px` column rule). |
| 30 | "The setup-script superuser should stop the install screen from reappearing." | It only does if `serve` sees a **real** superuser in the *same* `--dir`. `serve` prints "Create your first superuser" and seeds a throwaway `__pbinstaller@example.com` account whenever that dir's `_superusers` holds no non-installer row. So it reappears after `make clean`, or on a first `dev.sh`/`serve` run that skipped `bootstrap` — `.env` alone does nothing until a CLI command writes the account. Fix: every entrypoint calls `ensure_superuser` (`scripts/lib/ensure-superuser.sh`), i.e. `superuser upsert` before serving. Same trap for paths: without `--migrationsDir`, PocketBase resolves it **relative to the parent of `--dir`**, so a custom `PB_DIR` silently applies no migrations and loads no hooks. `dev.sh`/`serve` pin `--dir`, `--migrationsDir`, `--hooksDir`. |

---

## Before you commit

- [ ] Schema change is a migration; `make migrate` applies and `make migrate-down` reverts.
- [ ] New text fields set `max`; new base collections declare `created`/`updated`.
- [ ] Hook edits load without errors (watch the dev log).
- [ ] The endpoint actually works — exercise it with `curl`, don't assume.
- [ ] `/llms.txt` and `/llms-full.txt` updated if routes/fields changed. (`/openapi.json`
      is **generated live** — never edit it by hand; it reflects `lib/api.js` + the DB.)
- [ ] The matching nested `AGENTS.md` updated if conventions changed.
- [ ] New vendored library recorded in `base/pb_public/docs/licenses/` (row + license text).
- [ ] Only `LICENSE` sits at the repo root; third-party texts stay in `docs/licenses/`.
- [ ] `base/pb_data/` and `.env` are not staged.
- [ ] Doc endpoints checked by **content**, not status: indexFallback serves `index.html`
      for any unknown path, so `GET /anything` returns 200. Assert the expected text.

---

## Reference (always loaded)

### The native surface — reach for these before writing custom code

PocketBase ships these **built-in**. Walk the ladder: rules → field options/indexes →
`expand`/`filter` → hooks → routes. Full ranked list + worked examples:
`.agents/reference/TOP-20-APIs.md`.


### Deep manuals

| File | What |
|---|---|
| `TOP-20-APIs.md` | **Start here.** Ranked top-20 native APIs + the built-in-vs-custom ladder + worked examples. |
| `pocketbase-docs.txt` | Full official PocketBase docs (collections, auth, records, files, rules, hooks, realtime, backups, logs, crons). |
| `pocketbase-jsvm.txt` | Complete JSVM reference: every hook, `$app`/`$apis`/`$dbx`/`$http`/`$mails`/`$os`/`$security`, routing, DB ops. |
| `pocketbase-js-sdk.md` | Official client SDK (browser/Node) — `pb.collections`, `pb.realtime`, `pb.backups`, `pb.logs`, `pb.crons`, `pb.files`, batch. |
| `PRODUCTION.md` | Going-live guide: rules as the boundary, settings-in-a-migration, backups/restore, security hardening, the scaling wall, where logic belongs. Sources + what was measured. |
| `base/pb_public/vendor/ohno/` | The UI kit (vendored). Agent contract: `llm.txt` in the ohno repo. Classless-first — use its classes, don't invent them. |

## Skills

Task-specific guidance lives in `.agents/skills/`:

- `pocketbase-schema` — collections, field options, migrations.
- `pocketbase-hooks` — JSVM hooks, routes, cron, webhooks.
- `pocketbase-api-client` — consuming the REST API / realtime from code.

### Nested AGENTS.md

Directory-scoped guidance loads automatically when an agent works inside that directory
(in hierarchical-discovery tools such as Claude Code and Cursor — consumers without
directory discovery must be pointed at the file explicitly):

| File | Loads when editing |
|---|---|
| `AGENTS.md` (this file) | anything — repo-wide rules |
| `base/pb_hooks/AGENTS.md` | `base/pb_hooks/**` — JSVM handler contract, `e.next()`, scoping |
| `base/pb_migrations/AGENTS.md` | `base/pb_migrations/**` — migration shape, field traps, `up`/`down` |
| `base/pb_public/AGENTS.md` | `base/pb_public/**` — zero-build rules, SDK patterns, file URLs |
| `scripts/AGENTS.md` | `scripts/**` — ops, PB_DIR discipline, SDK auth patterns |

`base/pb_public/` is served by PocketBase, so `base/pb_public/*.md` are **also** reachable over HTTP
(`GET /AGENTS.md`, `GET /llms.txt`). That is intentional: human/LLM consumers of the running
app read the same text the coding agent reads.
