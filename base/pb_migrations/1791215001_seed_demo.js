/// <reference path="../pb_data/types.d.ts" />
//
// Seed demo content — but ONLY when SEED_DEMO=1.
//
//     SEED_DEMO=1 ./scripts/bootstrap.sh   # or the FIRST serve on a not-yet-migrated dir
//
// WHY A MIGRATION AND NOT A HOOK
//   Migrations are the one place that is guaranteed to run AFTER the schema exists and
//   exactly once. A seeder in pb_hooks/ would have to run on `onBootstrap`, which fires
//   BEFORE pb_migrations are applied on a brand-new database — so the `posts` collection
//   does not exist yet and the seeder fails with an invalid-collection error. The JSVM
//   also exposes no `onServe` hook (that one is Go-only), so there is no "app is ready"
//   hook to use instead. Seed data therefore belongs in a migration.
//
// It is a no-op unless SEED_DEMO=1, so production never seeds itself.
//
migrate((app) => {
  if ($os.getenv("SEED_DEMO") !== "1") return
  if (app.countRecords("posts") > 0) return

  const users = app.findCollectionByNameOrId("users")
  const posts = app.findCollectionByNameOrId("posts")

  const author = new Record(users)
  author.set("email", "demo@local.local")
  author.set("password", "demo12345678")
  author.set("passwordConfirm", "demo12345678")
  author.set("name", "Demo Author")
  author.set("role", "editor")
  author.set("verified", true)
  app.save(author)

  const seeds = [
    { title: "Welcome to baseStarter", status: "published", body: "A seeded post. Edit base/pb_migrations/*_seed_demo.js to change it." },
    { title: "How migrations work",    status: "draft",     body: "Migrations live in base/pb_migrations/ and run on `make migrate`." },
    { title: "Agent quickstart",       status: "published", body: "Read AGENTS.md, then llms-full.txt, then poke the API at /docs/." },
  ]
  for (const s of seeds) {
    const post = new Record(posts)
    post.set("title", s.title)
    post.set("slug", s.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""))
    post.set("body", s.body)
    post.set("status", s.status)
    post.set("lang", "en")
    post.set("author", author.id)
    if (s.status === "published") {
      post.set("publishedAt", new Date().toISOString().replace("T", " "))
    }
    app.save(post)
  }

  console.log("[seed] inserted demo user + " + seeds.length + " posts")
}, (app) => {
  // Down: remove the demo content (posts first, then the author).
  try {
    const demo = app.findFirstRecordByFilter("users", "email = 'demo@local.local'")
    if (demo) {
      for (const p of app.findRecordsByFilter("posts", "author = {:a}", "-created", 200, 0, { a: demo.id })) {
        app.delete(p)
      }
      app.delete(demo)
    }
  } catch (err) {
    // already gone — nothing to revert
  }
})
