# Production readiness — PocketBase

> Condensed from the official *Going to production* guide **plus** the recurring community
> warnings, then **verified against a live v0.40.4 instance of this repo**. Every claim marked
> ✅ was measured here. Anything not measured is attributed to its source.
>
> Full material: `.agents/reference/pocketbase-docs.txt` (search "going-to-production"),
> and the discussions cited inline.

---

## The one-line truth

PocketBase is a **single-server application with an embedded SQLite database** — not a managed,
horizontally scalable database. The three real risks are **permissive rules**, **untested
restores**, and **treating "it deployed" as "it's safe"**. Design for one instance; add a
coordinated layer only when a requirement forces it.

---

## 1. Rules are the public boundary (highest risk)

Collections are **locked by default** (`null` = superuser-only). Opening a rule to everyone must
be a deliberate act. ✅ In this repo the API-rule semantics are the verified kind:

- `""` (empty) → rule **disabled** → public, guests included.
- `null` → **superuser-only** (the default).
- `"expr"` → per-request filter **and** record scope.

**Owner-scoped pattern** (the community default for user data):

```
@request.auth.id != "" && owner = @request.auth.id
```

- ✅ This repo uses exactly this shape: `posts.updateRule = "author = @request.auth.id"`,
  `posts.deleteRule = "author = @request.auth.id"`.
- ✅ Never let a client choose ownership. `posts.createRule` is `@request.auth.id != ""` and the
  field is `required` — the relation is set server-side/at create, not trusted from the body.
- **Public means public.** ✅ `users.listRule = ""` here is a deliberate choice for the demo
  (public profiles). In a real app, scope it: `id = @request.auth.id`.
- **Create-rule nuance** (community, [discussion #5604](https://github.com/pocketbase/pocketbase/discussions/5604)):
  PocketBase dry-submits the record before evaluating `createRule`, so checks against
  **submitted** fields (e.g. `@request.body.role:isset = false`) are what actually hold.
- **Test rules as real users through the API**, not in the dashboard: a member, a non-member,
  an invited user, a guest. Complex relation/`@collection.*` membership checks are the ones that
  look right and fail open — attack them.

## 2. Settings ship wrong — pin them in a migration ✅

A fresh PocketBase is **not** production-shaped. Measured on a clean v0.40.4 database **before**
this repo's init migration: `meta.appName = "Acme"`, SMTP host `smtp.example.com`,
`rateLimits.enabled = false`. ✅ After `1791215000_init_schema.js`: `appName = "baseStarter"`,
`rateLimits.enabled = true`, `batch.enabled = true`.

Settings are **state**, but they belong in the **same versioned migration** as the collections
they serve — otherwise every environment drifts.

## 3. Security hardening

| Area | Action | Status here |
|---|---|---|
| **HTTPS** | Terminate TLS (PocketBase or a reverse proxy). Behind a proxy, set trusted client-IP headers — otherwise logs and IP controls see the proxy address. | ⚠️ dev = HTTP; set at deploy |
| **Rate limits** | Keep the built-in limiter ON; protect `*:auth`, `*:create`, `/api/batch`. | ✅ enabled in init migration |
| **CORS** | Allow only your origins. CORS is **not** authz — rules still guard every collection. | set per project |
| **SMTP** | Use a real provider. The built-in `sendmail` default is unfit for delivery. | ⚠️ disabled in dev by design |
| **Encryption key** | Set a random **32-char** key via env (`PB_ENCRYPTION_KEY`, wired in `dev.sh` via `--encryptionEnv`). Losing it makes encrypted settings unreadable. | ✅ supported |
| **Superusers** | Strong credentials, IP-restrict where possible, enable MFA/OTP. Never expose a superuser token to browser code. | see below |
| **Files** | A file URL is **not** authorization. Apply rules to the record that references the file; test downloads as an unauthorized user. | ✅ rules on `posts`/`comments` |

## 4. Backups — a backup you never restored is an assumption

- ✅ `scripts/backup.sh` snapshots every `*.db` through `sqlite3 .backup` (not a raw `tar` while
  the server writes — that can tear the DB; WAL keeps *readers* consistent, it does not make a
  multi-file copy atomic).
- **Keep one copy off the host.** A backup on the same disk is not disaster recovery.
- **Test a restore** on a separate instance: records, files, auth, and behaviour.
- **Built-in backups have a boundary:** they include locally stored uploads but **exclude** files
  on S3. Cover both in your recovery plan. Large data dirs (~5 GB+) → use SQLite's own backup
  mechanism instead of the ZIP snapshot.
- **Back up before every upgrade.** Pre-1.0 PocketBase does not guarantee backward-compatible
  upgrades.

## 5. Scaling: know the wall before you hit it

The limit is **horizontal scaling**: one embedded SQLite DB per instance. Adding app instances is
not "stateless replicas + shared DB".

- Autoscaling hosts can silently start a **second copy** with a **second database**
  ([discussion](https://www.reddit.com/r/pocketbase/comments/17dpp4k/building_my_web_server_over_pocketbase/)).
- Registered-user counts are a **bad capacity metric**. What matters: **concurrent activity**,
  query shape, and whether you actually need distributed writes / HA / multiple data sources.
- **Migration trigger is a requirement, not a number:** needing coordinated instances, HA,
  distributed writes, or infra SQLite doesn't suit — then split the app from the datastore.

## 6. Where business logic belongs

JS hooks are excellent for **request/record-scoped** logic (guards, enrichment, small routes,
cron). They are a poor fit for heavy or long-running work.

- ✅ **Goja, not Node** (measured): no global `fetch`, no `setTimeout`, `require("lodash")` and
  `require("fs")` both throw `GoError: Invalid module`. Keep handlers **synchronous**.
- Move logic to **Go** when you need Go libraries, strong typing, or performance-sensitive work —
  the tradeoff is maintaining a custom binary instead of the prebuilt one.
- **Heavy/background jobs** belong in a **separate worker**, not competing with the API on a small
  host. In-JS, the only background primitive is `cronAdd` (there is **no `$jobs`** — that is Go-only).
- **Keep hooks stateless.** `base/pb_hooks/lib/` modules share one registry; per-request state there
  bleeds across requests.

---

## Launch gate (run this before calling it production-ready)

- [ ] Every collection's rules exercised **as real users** (member / non-member / guest),
      including attempts to change ownership, relations, and privileged fields.
- [ ] Uploads restricted by size + MIME; unauthorized file download returns **404**.
- [ ] `rateLimits.enabled = true`; `*:auth`, `*:create`, `/api/batch` covered.
- [ ] HTTPS terminated; trusted proxy headers configured.
- [ ] Real SMTP provider configured and a test email sent.
- [ ] `PB_ENCRYPTION_KEY` set (32 chars), stored outside source control.
- [ ] Superuser: strong password, MFA/OTP where practical, no token in browser code.
- [ ] A recent backup **restored into a clean staging instance** and verified end-to-end.
- [ ] An upgrade path: version pinned, backup taken, migration guide reviewed.

## Sources

- Official: <https://pocketbase.io/docs/going-to-production/>
- Community: GitHub discussions
  [#3542](https://github.com/pocketbase/pocketbase/discussions/3542),
  [#5604](https://github.com/pocketbase/pocketbase/discussions/5604),
  [#650](https://github.com/pocketbase/pocketbase/discussions/650),
  [#232](https://github.com/pocketbase/pocketbase/discussions/232),
  [#2213](https://github.com/pocketbase/pocketbase/discussions/2213);
  Reddit r/pocketbase threads on scaling and hooks.
