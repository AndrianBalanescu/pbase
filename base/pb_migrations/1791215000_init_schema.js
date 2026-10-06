/// <reference path="../pb_data/types.d.ts" />
//
// Initial schema for baseStarter.
//
// JS migrations are the PocketBase default (v0.40+). The callback receives a
// *transactional* app: throwing an error rolls the whole file back.
//
//   Add a new migration : make new-migration name=<thing>
//   Snapshot current UI : make collections
//   Apply / revert      : make migrate  |  make migrate-down
//
// ⚠️  PocketBase v0.40 SHIPS a default `users` auth collection (id, password,
//     tokenKey, email, emailVisibility, verified, name, avatar, created, updated).
//     Do NOT create it again — "Collection name must be unique" — extend it.
//
// API RULE SEMANTICS (empirically verified on v0.40.4):
//   ""        → rule disabled → PUBLIC: anyone (incl. guests) may perform the action
//   null      → SUPERUSER-ONLY
//   "expr"    → filter expression evaluated per request
//   ⚠️  "" on update/delete means ANYONE can write — only use it where public write
//       is truly intended (e.g. open sign-up). Everything else should be an expression.
//
migrate((app) => {
  // ── app settings: production-shaped defaults ─────────────────────────────
  // These ship WRONG out of the box in a fresh PocketBase (appName "Acme",
  // rate limiter off, SMTP pointed at smtp.example.com). Set them in code so
  // every environment is reproducible — settings are state, not schema, but
  // they belong in the same versioned migration as the collections they serve.
  const settings = app.settings()

  // App identity (shows in the dashboard + outgoing mail).
  settings.meta.appName = "baseStarter"

  // /api/batch runs up to `maxRequests` operations in ONE transaction.
  settings.batch.enabled = true
  settings.batch.maxRequests = 50
  settings.batch.timeout = 5

  // Rate limiter: ON by default, with the three rules that actually matter
  // (auth brute-force, record-spam, batch abuse). Tune per project.
  settings.rateLimits.enabled = true

  // SMTP is intentionally left disabled/unset for dev — set it in production
  // (a real provider; the built-in `sendmail` default is unfit for delivery).
  app.save(settings)

  // ── users (extend the built-in auth collection) ───────────────────────────
  const users = app.findCollectionByNameOrId("users")
  users.listRule = ""                             // public: anyone can list/search users
  users.viewRule = ""                             // public: anyone can view a profile
  users.createRule = ""                           // public: open sign-up (null = admins only)
  users.updateRule = "id = @request.auth.id"      // owners only
  users.deleteRule = "id = @request.auth.id"
  users.fields.add(
    new TextField({ name: "bio", max: 2000 }),
    new SelectField({ name: "role", maxSelect: 1, values: ["admin", "editor", "viewer"] }),
  )
  app.save(users)

  // ── posts ─────────────────────────────────────────────────────────────────
  // NOTE: always set `max` explicitly on text fields. PocketBase silently
  // defaults TextField.Max to 5000 chars; oversized writes then fail validation
  // and reject the ENTIRE insert.
  const posts = new Collection({
    type: "base",
    name: "posts",
    listRule: "status = 'published' || @request.auth.id != ''",
    viewRule: "status = 'published' || @request.auth.id != ''",
    createRule: "@request.auth.id != ''",
    updateRule: "author = @request.auth.id",
    deleteRule: "author = @request.auth.id",
    fields: [
      { name: "title",       type: "text",     required: true, max: 300 },
      { name: "slug",        type: "text",     required: true, max: 300 },
      { name: "body",        type: "text",     max: 200000 }, // NOT the 5000 default
      { name: "status",      type: "select",   maxSelect: 1, values: ["draft", "published", "archived"] },
      { name: "tags",        type: "json",     maxSize: 20000 },  // free-form ["news","howto"]
      { name: "lang",        type: "select",   maxSelect: 1, values: ["en", "ro", "de", "fr", "es"] },
      { name: "cover",       type: "file",     maxSelect: 1, maxSize: 5242880, thumbs: ["400x300", "100x100"] },
      { name: "metadata",    type: "json",     maxSize: 200000 },
      { name: "publishedAt", type: "date" },
      { name: "created",     type: "autodate", onCreate: true, onUpdate: false },
      { name: "updated",     type: "autodate", onCreate: true, onUpdate: true },
      { name: "author",      type: "relation", required: true, maxSelect: 1, collectionId: users.id, cascadeDelete: false },
    ],
    indexes: [
      "CREATE UNIQUE INDEX `idx_posts_slug` ON `posts` (`slug`)",
      "CREATE INDEX `idx_posts_status_created` ON `posts` (`status`, `created`)",
    ],
  })
  app.save(posts)

  // ── comments ─────────────────────────────────────────────────────────────
  const comments = new Collection({
    type: "base",
    name: "comments",
    listRule: "",
    viewRule: "",
    createRule: "@request.auth.id != ''",
    updateRule: "author = @request.auth.id",
    deleteRule: "author = @request.auth.id",
    fields: [
      { name: "body",   type: "text",     required: true, max: 10000 },
      { name: "created",     type: "autodate", onCreate: true, onUpdate: false },
      { name: "updated",     type: "autodate", onCreate: true, onUpdate: true },
      { name: "author", type: "relation", required: true, maxSelect: 1, collectionId: users.id,    cascadeDelete: true },
      // cascadeDelete: deleting a post removes its comments.
      { name: "post",   type: "relation", required: true, maxSelect: 1, collectionId: posts.id, cascadeDelete: true },
    ],
    indexes: [
      "CREATE INDEX `idx_comments_post` ON `comments` (`post`)",
    ],
  })
  app.save(comments)

}, (app) => {
  // Down: disable batch, then drop the collections we added.
  try {
    const settings = app.settings()
    settings.batch.enabled = false
    app.save(settings)
  } catch (err) {
    // ignore
  }

  for (const name of ["comments", "posts"]) {
    try {
      app.delete(app.findCollectionByNameOrId(name))
    } catch (err) {
      // already gone — ignore
    }
  }

  try {
    const users = app.findCollectionByNameOrId("users")
    users.fields.removeByName("bio")
    users.fields.removeByName("role")
    // Restore the rules PocketBase ships with `users` (verified against a
    // fresh v0.40.4 instance): view/update/delete are owner-only, create is
    // public (open sign-up). Never leave deleteRule = "" here — that would
    // make user deletion public on rollback.
    users.listRule = "id = @request.auth.id"
    users.viewRule = "id = @request.auth.id"
    users.createRule = ""
    users.updateRule = "id = @request.auth.id"
    users.deleteRule = "id = @request.auth.id"
    app.save(users)
  } catch (err) {
    // ignore
  }
})
