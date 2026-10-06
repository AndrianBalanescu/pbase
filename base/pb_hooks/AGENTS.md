# AGENTS.md — base/pb_hooks/

Server-side JavaScript (Goja JSVM) that PocketBase loads at boot. **This is where behaviour
lives:** record guards, custom routes, cron, webhooks. Schema belongs in `base/pb_migrations/`.

```
base/pb_hooks/
  10_record_hooks.pb.js    *Request guards (API + Admin UI writes; cron/migration DAO writes bypass them)
  20_custom_routes.pb.js   registration entry point — 2 lines, loads lib/api.js
  30_api_docs.pb.js        serves GET /openapi.json (live spec)
  50_cron.pb.js            cronAdd / cronRemove jobs
  60_webhooks.pb.js        $http.send() outbound calls on record events
  lib/                     stateless helper modules (require()'d INSIDE handlers)
    api.js                 the ROUTES table: handler + OpenAPI metadata (single source of truth)
    openapi.js             builds the OpenAPI 3.1 document from the app + ROUTES
    slug.js                slugify() / nowPB() helpers
```

Load order is **filename order** (`10_` → `20_` → `30_` → `50_` → `60_`). A leading `_`
disables a file (`_foo.pb.js` is ignored). `--hooksWatch` (on in dev) hot-reloads on save.

## The one thing to get right: scoping

Every hook handler and every `require()`'d module runs in its **own pooled goja VM**. A handler
sees **only globals and its own locals** — never its file's top level, never another module's top
level. A handler that references module scope throws `ReferenceError: <name> is not defined` at
request time, which the router surfaces as a bare **400**.

```js
// ✗ WRONG — `slugify` is not in scope inside the handler
function slugify(t) { /* … */ }
onRecordCreateRequest((e) => { e.record.set("slug", slugify(e.record.getString("title"))); e.next() }, "posts")

// ✓ RIGHT — require INSIDE the handler, via ${__hooks}
onRecordCreateRequest((e) => {
  const { slugify } = require(`${__hooks}/lib/slug.js`)
  e.record.set("slug", slugify(e.record.getString("title")))
  e.next()
}, "posts")
```

- Use **`${__hooks}`** (a real global, `typeof __hooks === "string"`). A relative path like
  `./lib/x.js` resolves from the **process cwd**, not `base/pb_hooks/`, so it breaks when the binary
  starts elsewhere.
- A function obtained via `require()` keeps **its own module's closure**, so it may freely call
  its own module siblings. That is why `openapi.buildSpec()` works — the handler requires it and
  calls it; `buildSpec` internally calls its own helpers.
- Keep modules **stateless**. The module registry is per-VM; do not stash per-request data.
- Goja is **not Node**: no `fs`, no `fetch`, no `setTimeout`, no event loop, and
  `require("npm-package")` throws `GoError: Invalid module`. Use `$http.send()`, `$os`, `$filesystem`
  (storage only), `$security`, `$mails`.

## Routes

Do **not** define routes in the `.pb.js` file. Add an entry to the `ROUTES` table in
`base/pb_hooks/lib/api.js` — it carries both the handler and its OpenAPI metadata, and
`30_api_docs.pb.js` documents that same table, so `/openapi.json` cannot drift. `20_custom_routes.pb.js`
must stay a loader (`require(...).register(routerAdd)`).

```js
// lib/api.js
{
  method: "GET", path: "/api/thing", summary: "Thing", auth: true,
  handler: (e) => e.json(200, { ok: true }),   // globals + locals only
}
```

`e.json(status, body)` · `e.string(status, body, type)` · `e.requestInfo()` (`{ query, body,
headers, auth }`) · `e.auth` / `e.app` · `$apis.requireAuth()` middleware · typed errors
(`BadRequestError`, `ForbiddenError`, `NotFoundError`, `UnauthorizedError`).

## Record hooks

- `e.next()` **continues** the chain; omitting it aborts the operation.
- `"...AfterSuccess"` hooks run after commit and take **no** `e.next()`.
- Throw `BadRequestError("msg")` → HTTP 400 with `msg`.
- `record.getString(...)` / `getDateTime().isZero()` — do **not** trust `record.get("date")`
  (a truthy `DateTime` object even when empty).
- Persist dates as `"YYYY-MM-DD HH:MM:SS.sssZ"` — a **space**, not `T`.

## Traps

- **Handlers cannot see file/module top-level scope.** See the scoping section — the #1 cause of
  a mystery 400. Resolve everything inside the handler.
- **`field.type` on a live `Collection` is a Go method, not a string.** Call `f.type()`; never put
  it in a JSON body (`e.json()` then emits **truncated** output). Read canonical field metadata
  with `JSON.parse(toString(collection.marshalJSON()))`.
- `findFirstRecordByFilter()` **throws** on no match (capture outside try/catch);
  `findFirstRecordByFilter`/`findRecordsByFilter` bind params as the last arg — never concatenate
  user input into a filter.
- `onBootstrap` fires **before** migrations, so collections may not exist yet.
- There is **no `$jobs`** global. Background work is `cronAdd` / `cronRemove` only.
- Never put **`@request.*`** in a client-supplied `filter` — 403 for non-superusers. Let the
  collection rule scope the data.

See `../AGENTS.md` for repo-wide conventions and `.agents/reference/pocketbase-jsvm.txt` for the
complete JSVM reference.
