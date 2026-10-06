---
name: pocketbase-hooks
description: >-
  Write or debug PocketBase server-side JavaScript in base/pb_hooks/. Use when adding record
  validation/guards, custom HTTP routes, cron jobs, outbound webhooks, or when a hook throws
  ReferenceError / does not run / runs twice. Covers the JSVM handler contract, e.next(),
  typed errors, pooled-VM scoping, $app/$apis/$http/$os, routerAdd middleware, cronAdd, and
  the date-object trap.
---

# PocketBase JSVM hooks

Files in `base/pb_hooks/*.pb.js` load in filename order on boot; a leading `_` disables a file.
In dev, saving a file restarts the server (`--hooksWatch`) — watch the terminal for errors.

## Handler contract

```js
onRecordCreateRequest((e) => {
  e.record.set("status", "draft")
  e.next()                        // REQUIRED: continue the chain
}, "posts")                       // optional tag: collection name(s) or id(s)
```

- Omitting `e.next()` aborts the operation.
- Throw typed errors for control flow: `new BadRequestError("msg")` (400),
  `ForbiddenError` (403), `NotFoundError` (404), `UnauthorizedError` (401),
  `TooManyRequestsError` (429), `InternalServerError` (500).
- `...AfterSuccess` hooks run **after commit** and take **no** `e.next()`.
- Hook families: `onRecord*(Request|Execute|Validate|Enrich|After*)`, `onModel*`,
  `onCollection*`, `onRecordAuth*`, `onMailer*`, `onRealtime*`, `onFile*`,
  `onBootstrap`/`onTerminate`, `onBackupCreate`/`onBackupRestore`, `onBatchRequest`.
  There are **83** `on*` globals; grep `base/pb_data/types.d.ts` for `declare function on` for the
  authoritative list. ⚠️ **`onServe` is Go-only — it does not exist in the JSVM** (0 hit for
  `declare function onServe`; the `onServe()` you may see in types.d.ts is a method on the
  `App` type, not a global hook).

## Scoping trap

A handler sees **only globals and its own locals** — not its file's top level, not another
module's top level. Each handler runs in its own pooled goja VM, so a handler that touches
module scope throws `ReferenceError: <name> is not defined` at request time and the router
surfaces a bare **400**. `require()` the module **inside** the handler, via `${__hooks}`:

```js
// ✗ WRONG — `slug` at file top level is NOT in scope inside the handler
const slug = require(`${__hooks}/lib/slug.js`)
onRecordCreateRequest((e) => { e.record.set("slug", slug.slugify(e.record.getString("title"))); e.next() }, "posts")

// ✓ RIGHT — require inside the handler
onRecordCreateRequest((e) => {
  const { slugify } = require(`${__hooks}/lib/slug.js`)
  e.record.set("slug", slugify(e.record.getString("title")))
  e.next()
}, "posts")
```

- A function obtained via `require()` **keeps its own module's closure**, so it may call its own
  module siblings (this is why `openapi.buildSpec()` works). Keep modules **stateless**.
- Use **`${__hooks}`** (a real global) — a relative path resolves from the process cwd, not `base/pb_hooks/`.

## Custom routes

This repo keeps routes in a **table** (`base/pb_hooks/lib/api.js`) so the handlers and their OpenAPI
metadata cannot drift; `20_custom_routes.pb.js` just calls `require(...).register(routerAdd)` and
`30_api_docs.pb.js` serves the generated `/openapi.json`. Prefer adding an entry there. The raw
API is still:

```js
routerAdd("GET", "/api/me", (e) => e.json(200, { id: e.auth.id }), $apis.requireAuth())

routerAdd("POST", "/api/thing", (e) => {
  const { query, body, auth } = e.requestInfo()
  if (!body.title) return e.badRequestError("title is required")
  return e.json(201, { ok: true })
})
```

Middleware helpers: `$apis.requireAuth`, `requireSuperuserAuth`, `requireGuestOnly`,
`requireSuperuserOrOwnerAuth`, `gzip`, `bodyLimit`, `skipSuccessActivityLog`, `enrichRecord`,
and `$apis.static(dir, indexFallback)` for wildcard routes.

## Database

```js
$app.findRecordById("posts", id)                                   // throws if missing
$app.findRecordsByFilter("posts", "status={:s}", "-created", 20, 0, { s: "published" })
$app.countRecords("posts", $dbx.exp("status={:s}", { s: "published" }))
$app.save(rec); $app.delete(rec)
```

`$app.findFirstRecordByFilter(...)` **throws** `sql.ErrNoRows` when nothing matches —
capture the result outside try/catch.

## Cron & outbound HTTP

```js
cronAdd("nightly", "0 3 * * *", () => { /* local tz */ })   // there is NO $jobs in JSVM
const res = $http.send({ method: "POST", url, headers, body, timeout: 10 })
// res.statusCode, res.headers, res.cookies, res.json, res.body
```

## Date trap

`record.get("dateField")` returns a truthy `DateTime` **object** even when empty. Use
`record.getString(...)` or `record.getDateTime(...).isZero()`. Persist as
`"YYYY-MM-DD HH:MM:SS.sssZ"` (space, not ISO `T`) or the write silently drops the value.
