/// <reference path="../pb_data/types.d.ts" />
//
// 10_record_hooks.pb.js — *Request hooks: invariants enforced on API writes.
// The public API and the Admin UI both go through them (official docs: "via
// API"); cron/migration DAO writes do NOT — for an invariant that must hold on
// every write path, use the non-Request model hooks (onRecordCreate, …) instead.
//
// Load order is alphabetical: 10_ → 20_ → 30_ → 50_ → 60_. Prefix `_` to disable.
// --hooksWatch (default in dev) hot-reloads: saving this file restarts the server.
//
// CONTRACT
//   • `e.next()` continues the chain. Omitting it aborts the operation.
//   • Throwing BadRequestError("msg") → HTTP 400 with that message.
//     Others: ForbiddenError (403), NotFoundError (404), UnauthorizedError (401).
//   • "Request" hooks run before/after an API request. "...AfterSuccess" hooks
//     run after commit and take NO e.next().
//
// ── THE SHARED-HELPER PATTERN (the one thing to get right) ───────────────────
// Helpers at a hook file's top level are NOT visible inside handlers: each
// handler runs in its own pooled goja VM. Put reusable logic in a module under
// lib/ and require it INSIDE the handler, with `${__hooks}` (relative paths
// resolve from the process cwd, not from pb_hooks/):
//
//     const { slugify } = require(`${__hooks}/lib/slug.js`)
//
// ⚠️ This is Goja, not Node — no `fs`, `fetch`, `setTimeout`; npm `require`
//    throws `GoError: Invalid module`. Everything a handler needs (env vars,
//    config) must be resolved INSIDE the handler, not at file top level.
//
// ⚠️ OTHER TRAPS THAT COST REAL DEBUGGING TIME:
//   1. record.get("someDate") returns a DateTime OBJECT, not a string — it is
//      truthy even when empty. Use record.getString(...) or getDateTime().isZero().
//   2. Date fields want "YYYY-MM-DD HH:MM:SS.sssZ" (space, no "T"). An ISO
//      string with "T" silently fails to persist.

// ── users: mirror email → name when name is empty ────────────────────────────
onRecordCreateRequest((e) => {
  if (!e.record.getString("name")) {
    e.record.set("name", String(e.record.getString("email")).split("@")[0])
  }
  e.next()
}, "users")

// ── users: `role` is a privilege field — never trust the client with it ──────
// Public sign-up (createRule = "") could otherwise mint `role: admin` in the
// payload. "Request" hooks fire only for API writes, so server-side paths
// (migrations/seed) keep their role assignments untouched.
onRecordCreateRequest((e) => {
  if (e.record.getString("role")) {
    e.record.set("role", "")
  }
  e.next()
}, "users")

// On update the API rule already scopes to the owner, so e.auth reaching this
// hook is either the owner's users record (must already be an admin to grant
// or revoke roles) or the `_superusers` record (measured: the superuser token
// resolves to e.auth — that is the Admin UI path that grants the first admin).
onRecordUpdateRequest((e) => {
  const roleChanged = e.record.original().getString("role") !== e.record.getString("role")
  const isUser = e.auth && e.auth.collection().name === "users"
  if (roleChanged && isUser && e.auth.getString("role") !== "admin") {
    throw new ForbiddenError("only admins can change roles")
  }
  e.next()
}, "users")

// ── posts: derive an SEO slug, enforce uniqueness, stamp publishedAt ─────────
onRecordCreateRequest((e) => {
  const { slugify, nowPB } = require(`${__hooks}/lib/slug.js`)

  if (!e.record.getString("slug") && e.record.getString("title")) {
    e.record.set("slug", slugify(e.record.getString("title")))
  }

  const slug = e.record.getString("slug")
  if (!slug) {
    throw new BadRequestError("slug or title is required")
  }

  // Friendly 400 instead of a raw SQL unique-index error.
  // findFirstRecordByFilter() THROWS when nothing matches, so the match must
  // be captured outside the try/catch.
  let existing = null
  try {
    existing = e.app.findFirstRecordByFilter("posts", "slug = {:slug}", { slug: slug })
  } catch (err) {
    existing = null // sql.ErrNoRows — the expected path
  }
  if (existing && existing.id !== e.record.id) {
    throw new BadRequestError("slug already exists: " + slug)
  }

  if (!e.record.getString("publishedAt") && e.record.getString("status") === "published") {
    e.record.set("publishedAt", nowPB())
  }
  e.next()
}, "posts")

// ── posts: stamp publishedAt the first time a draft goes live ────────────────
onRecordUpdateRequest((e) => {
  const { nowPB } = require(`${__hooks}/lib/slug.js`)
  const before = e.record.original().getString("status")
  const after = e.record.getString("status")
  if (after === "published" && before !== "published" && !e.record.getString("publishedAt")) {
    e.record.set("publishedAt", nowPB())
  }
  e.next()
}, "posts")

// ── comments: users may not rewrite other people's comments ──────────────────
// Defense-in-depth on the API path: the collection's updateRule already scopes
// writes to the author; this guard stays even if the rule is ever loosened.
// (Request hooks do not fire for cron/migration DAO writes — those are trusted
// server-side paths.)
onRecordUpdateRequest((e) => {
  const changed = e.record.original().getString("body") !== e.record.getString("body")
  if (changed && e.auth && e.record.getString("author") !== e.auth.id) {
    throw new ForbiddenError("you can only edit your own comments")
  }
  e.next()
}, "comments")

// ── audit trail: log every successful delete ─────────────────────────────────
// "...AfterSuccess" hooks fire after commit; there is nothing to call next() on.
onRecordAfterDeleteSuccess((e) => {
  console.log("[audit] deleted", e.record.collection().name, e.record.id)
}, "*")
