# PocketBase Top-20 APIs — the always-loaded cheat sheet

> **Read this before writing any custom code.** PocketBase ships a huge native surface.
> 90% of "I'll write a custom route / a small service / a script" is already an API or a
> collection option. This file is the ranked list of the 20 things you reach for most, plus
> the rule for deciding **native feature vs custom code**.
>
> Everything below was exercised against a live PocketBase **v0.40.4** instance of this repo.
> Full manuals, in-repo: `.agents/reference/pocketbase-docs.txt` (18k lines, official docs),
> `.agents/reference/pocketbase-jsvm.txt` (complete JSVM hooks + globals),
> `.agents/reference/pocketbase-js-sdk.md` (client SDK).

---

## The rule: built-in first, custom last

Before you write a hook, route, or helper, walk this ladder **top-down**. Stop at the first rung
that solves it.

| Rung | Ask | Use | Do **not** write |
|---|---|---|---|
| 1 | Is it access control or a data filter? | **API rules** (5 rules/collection) | a hook that checks `@request.auth` |
| 2 | Is it "which rows can this user get"? | **API rules *are* filters** — `status="published"` | a custom `/api/published-posts` route |
| 3 | Is it validation on a field? | field **options** (`max`, `required`, `values`, `pattern`) | a hook that throws on bad input |
| 4 | Is it a unique/ordering constraint? | a collection **index** | an `onRecordCreate` that queries first |
| 5 | Is it "join/aggregate/total"? | **`expand` + `filter` + `sort` + `skipTotal`** | loading all rows and summing in JS |
| 6 | Is it a computed/derived field on write? | `onRecordCreateRequest` + `record.set(...)` | a DB trigger or external job |
| 7 | Is it "run something on a schedule"? | **`cronAdd()`** | a loop, a systemd timer, an external cron |
| 8 | Is it a live UI update? | **Realtime (SSE)** `pb.collection(x).subscribe()` | polling with `setInterval` |
| 9 | Is it "send an email"? | **`$mails.send()`** / mailer hooks | shelling out to `sendmail` |
| 10 | Is it "call an external URL"? | **`$http.send()`** | `$os.exec` / a sidecar service |
| 11 | Is it "many writes at once"? | **`/api/batch`** (record ops only) | N sequential fetches |
| 12 | Is it secret/crypto? | **`$security.*`** (`hash`, `randomString`, JWT) | hand-rolled crypto |
| 13 | Only **now** — genuinely novel server logic | a **JSVM hook** | — |

**Anti-patterns that look productive and are not:** a custom route that re-implements a filtered
list; a hook that re-implements `listRule`; a "helper" collection you keep in JS memory;
recreating a `users` collection; polling instead of subscribing.

---

## The Top-20, ranked

Legend: **JSVM** = server-side hook global · **SDK** = client `pb.*` · **REST** = HTTP endpoint.

### 1. API rules — the 5 per collection (`listRule`/`viewRule`/`createRule`/`updateRule`/`deleteRule`)
Your access control **and** your row filter, in one expression. This is the single most
under-used feature.
- `""` (empty) = **public** (rule disabled) · `null` = **superuser-only** (default) · `"expr"` = per-request filter.
- Unsatisfied rule is **silent**: `list` → **200** (filtered) · `view/update/delete` → **404** · `create` → **400** · `null` rule → **403**.
- Superusers bypass **all** rules.
- **Use it for:** "guests see published only", "authors edit their own", "only admins change role".
- **Instead of:** a hook or route that checks `e.auth`.

```
status = "published" || @request.auth.id != ""      // listRule/viewRule
author = @request.auth.id                            // updateRule/deleteRule
@request.body.role:isset = false                      // disallow role change
```

### 2. Filters + `@` macros + modifiers (`filter` param and rules)
The query language: `= != > >= < <= ~ !~` and the any-of `?=`-family; `&& || ()`; `//` comments.
- `@request.*` (`auth.id`, `body.*`, `query.*`, `headers.*`, `method`, `context`) ·
  `@collection.other.*` (join) · datetime macros `@now @todayStart @monthStart …`.
- Modifiers: `:isset` (was it submitted?), `:length` (array size), `:each`, `:lower`.
- **Use it for:** everything you would reach for `WHERE`.
- ⚠️ `@request.*` in a client `filter` param is **superuser-only** (403 otherwise) — scope with the **rule**, not the client filter.

### 3. List options: `page`/`perPage`/`skipTotal`/`sort`/`expand`
Server-side pagination, ordering, and relation-join in one call.
- `expand=author,comments_via_post` inlines related records.
- `skipTotal=1` skips the `COUNT(DISTINCT …)`; then `totalItems`/`totalPages` = **-1**.
- `perPage` clamps to **1000**; `perPage=0` resets to **30**.
- **Use it for:** any list view, any "get author with the post".
- **Instead of:** N+1 fetches or client-side joins.

### 4. `onRecordCreateRequest` / `onRecordUpdateRequest` (and the `…Success`/`…Error` variants)
Intercept a write **before** the DB, mutate the record, then `e.next()`.
- **Use it for:** auto-slug, derived fields, stamping `owner`, soft defaults.
- Paired lifecycle: `onRecordValidate`, `onRecordCreate`, `onRecordAfterCreateSuccess`, `onRecordAfterCreateError`.
- ⚠️ Always call **`e.next()`**; handlers run in **pooled Goja VMs** (no top-level helpers in scope).

```js
onRecordCreateRequest((e) => {
  if (!e.record.getString("slug")) e.record.set("slug", toSlug(e.record.getString("title")))
  e.next()
}, "posts")
```

### 5. `routerAdd` / `routerUse` — custom routes & middleware
When you truly need a new endpoint. Mount under `/api/*`; guard with `$apis.require*`.
- **Use it for:** genuinely new behaviour (`/api/stats`, `/api/activity`).
- **Not for:** a filtered view of an existing collection — that's rung 1–3 above.
- Guards: `$apis.requireAuth()`, `$apis.requireRecordAuth()`, `$apis.requireSuperuserAuth()`.

```js
routerAdd("GET", "/api/stats", (e) => {
  const n = $app.countRecords("posts")
  return e.json(200, { posts: n })
}, $apis.requireSuperuserAuth())
```

### 6. `$app` — the app instance (server)
Do anything server-side: query, transact, read settings, send mail.
- `$app.findRecordById/FirstRecordByFilter`, `$app.countRecords`, `$app.db()`, `$app.settings()`,
  `$app.runInTransaction(fn)`, `$app.newMailClient()`, `$app.subscriptionsBroker()`.
- ⚠️ `findFirstRecordByFilter` **throws** `sql.ErrNoRows` (does not return null).
- **Use it for:** server logic in hooks/migrations.

### 7. `$dbx` — expression builder
Compose WHERE clauses safely (parameterised, no string concat).
- `$dbx.hashExp`, `$dbx.exp`, `$dbx.and/or/not`, `$dbx.in`, `$dbx.like`, `$dbx.in`.
- **Use it for:** complex queries from a hook via `$app.db()`.
- **Instead of:** interpolating user input into SQL.

### 8. Realtime (SSE) — `GET /api/realtime`
Live updates without polling. `pb.collection("posts").subscribe("*", cb)`.
- Open the stream directly: `GET /api/realtime?clientId=X&subscriptions=posts` (the SDK's POST only **updates topics** on an open stream).
- ⚠️ Only **base/auth** collections emit events — **view** collections do **not**.
- Per-collection topic allow/reject rules in the collection's options.

### 9. `cronAdd` / `cronRemove` — scheduled server work
Cron jobs inside the binary. **This is the only background primitive** — there is **no `$jobs` global** (`grep -c '\$jobs' types.d.ts` = 0).
- **Use it for:** digests, cleanups, syncs.
- **Instead of:** an external scheduler or a `setInterval`.

```js
cronAdd("nightly", "0 3 * * *", () => { /* … */ })
```

### 10. `/api/batch` — many record ops in one transactional request
Up to `maxRequests` (50 here) record create/update/upsert/delete in one read&write transaction.
- ⚠️ **Only record ops** — arbitrary GET endpoints are rejected **400**.
- ⚠️ **Disabled by default**; enable in *Settings → Application* (`batch.enabled`). All sub-requests share one auth state (no per-request `Authorization`).
- **Use it for:** bulk imports, atomic multi-writes.
- **Instead of:** N sequential fetches (each its own round-trip + transaction).

```jsonc
POST /api/batch
{ "requests": [
  { "method": "POST",  "url": "/api/collections/posts/records",      "body": { /* … */ } },
  { "method": "PATCH", "url": "/api/collections/posts/records/ID",   "body": { "status": "published" } }
] }
```

### 11. Auth collection endpoints (built into every auth collection)
`auth-with-password`, `auth-with-otp`, `auth-with-oauth2`, `auth-refresh`, `request-otp`,
`request-password-reset`/`confirm-password-reset`, `request-verification`/`confirm-verification`,
`request-email-change`/`confirm-email-change`, `impersonate`.
- `options.manageRule` lets one user manage another's data.
- **Use it for:** the **entire** auth flow. Do not hand-roll login or password reset.

### 12. `$security` — crypto helpers
`hash()`, `compare()`, `randomString()`, `randomStringWithAlphabet()`, `newJWT()`, `parseJWT()`.
- **Use it for:** tokens, API keys, password hashing in hooks.
- **Instead of:** `$os.exec` to a crypto binary or a hand-rolled scheme.

### 13. `$http.send()` — outbound HTTP
Call external APIs / webhooks from server code.
- **Use it for:** integrations, outgoing webhooks.
- **Instead of:** a `fetch` shim or an external worker.

```js
const res = $http.send({ url: "https://hooks.example.com/x", method: "POST",
  headers: { "Content-Type": "application/json" }, data: JSON.stringify(payload) })
```

### 14. `$mails` / mailer hooks — email
`$mails.send()`, plus `onMailerSend` and per-type hooks
(`onMailerRecordPasswordResetSend`, `onMailerRecordVerificationSend`, …).
- **Use it for:** transactional mail, customising built-in templates.
- **Instead of:** shelling out to a mail binary.

### 15. File handling — `file` fields + `GET /api/files/{collection}/{id}/{filename}`
Upload, serve, and thumbnail files. `?thumb=100x300` for images.
- `pb.files.getURL(record, filename)`, `pb.files.getToken()` for protected files.
- **Use it for:** avatars, covers, attachments — and their public URLs.
- **Instead of:** a separate static host or an on-disk filename builder.

### 16. `$apis.*` — request helpers & middleware
`$apis.requestInfo(c)`, `$apis.recordAuthResponse(...)`, `$apis.enrichRecord(rec, expands)`,
`$apis.gzip()`, `$apis.static(fs, indexFallback)`, the `require*` guards.
- **Use it for:** auth responses, static mounts, gzip — instead of reimplementing them.

### 17. Collection options beyond rules
`options` per type: auth (`manageRule`, OTP, MFA, OAuth2), view (`viewQuery`), base
(indexes, `autodate` fields), plus **indexes** (`CREATE UNIQUE INDEX … ON posts (\`slug\`)`).
- **Use it for:** uniqueness, view collections, auth policy.
- **Instead of:** a hook that queries-then-inserts to emulate a unique index.

### 18. Settings & backups APIs
`GET /api/settings` (rate limits, batch, SMTP, realtime), `GET /api/backups` (+ create/restore/upload/download).
- **Use it for:** configuring the app, snapshotting `base/pb_data/`.
- `pb.backups.create()`, `pb.backups.restore()` from the SDK.

### 19. Logs & crons APIs
`GET /api/logs` (+ `logs/stats`, `truncate`), `GET /api/crons` (list + `POST /api/crons/{id}/run`).
- **Use it for:** observability and manual job triggers.

### 20. Migrations API — `migrate((app) => up, (app) => down)`
Schema as versioned, reversible code. Transactional: throwing rolls the whole file back.
- In JSVM: `app` is passed in; `toString(bytes)`/`toBytes(str)` for file-ish fields.
- **Use it for:** **every** schema change. Never hand-edit collections in the DB.
- ⚠️ v0.40 `migrate create` writes **`.js`**, and it **prompts** (pipe `echo y |`).

---

## "Should I write custom code?" — worked examples

| Task | Naive instinct (custom code) | Native answer (rung) |
|---|---|---|
| Guests must not see drafts | `routerAdd` a filtered list route | **listRule/viewRule** `status="published" || @request.auth.id!=""` (1) |
| Users edit only their own posts | a hook checking `e.auth.id === record.author` | **updateRule/deleteRule** `author=@request.auth.id` (1) |
| Prevent changing `role` | a hook diffing old/new | **`@request.body.role:isset = false`** in updateRule (2) |
| Auto slug from title | an external service / a DB trigger | **onRecordCreateRequest** + `record.set` (4) |
| Post + its comments in one call | fetch post, then fetch comments | **`expand=comments_via_post`** (3) |
| A "total posts" badge | fetch all, `.length` | **`perPage=1&skipTotal=1`** → read `totalItems` (3,14) |
| Live comment feed | `setInterval` poll | **Realtime** subscribe (8) |
| Import 500 rows | 500 sequential POSTs | **/api/batch** (10) |
| Nightly cleanup | external cron + `curl` | **cronAdd** (9) |
| Login / reset / verify | custom JWT + mailer | **auth collection endpoints** (11) |
| An API key generator | `randomBytes` via shell | **`$security.randomString()`** (12) |
| A webhook to Slack | a worker process | **`$http.send()`** from a hook (13) |
| Custom welcome email | SMTP client | **`$mails.send()`** / mailer hooks (14) |
| Thumbnails for covers | an image service | **`?thumb=WxH`** on the file URL (15) |
| A `published` view | copy rows on write | **view collection** `viewQuery` (17) |

---

## Verify, don't assume

PocketBase's surface is deep and version-sensitive (this is **v0.40.4**). Before trusting a
belief about an API, **exercise it** — the traps table in `AGENTS.md` is a list of assumptions
that were wrong:

```bash
# total without COUNT
curl -s "$B/api/collections/posts/records?perPage=1&skipTotal=1" | jq '.totalItems'   # -1

# realtime opens a stream (do not expect it to close)
curl -N "$B/api/realtime?clientId=x&subscriptions=posts"

# batch only takes record ops
curl -s -X POST "$B/api/batch" -H "Authorization: $TOK" -H 'Content-Type: application/json' \
  -d '{"requests":[{"method":"GET","url":"/api/health"}]}'    # → 400, by design
```

When behaviour differs from any doc here: **trust the binary**, then fix the doc.
