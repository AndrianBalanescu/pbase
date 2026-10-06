// base/pb_hooks/lib/api.js — SINGLE SOURCE OF TRUTH for the app's custom HTTP routes.
//
// Each entry carries BOTH the handler and its OpenAPI metadata. 20_custom_routes.pb.js
// just calls `register(routerAdd)`; 30_api_docs.pb.js feeds the same table to the
// spec generator. Because behaviour and docs read the same object, they cannot drift.
//
// ── MODULE CONTRACT (learned the hard way — read before editing a handler) ──
// • A module required with `${__hooks}/...` runs in its OWN goja VM. Its
//   top-level `const`/`function`s live in the MODULE registry, and each handler
//   is executed in a DIFFERENT registry. A handler that references module scope
//   therefore throws **`ReferenceError: <name> is not defined`** at request time
//   (the router only surfaces a generic 400) — measured on v0.40.4 for `const`,
//   function declarations and arrows alike.
// • The fix: a handler may use ONLY globals ($app/$apis/$dbx/…), its own locals,
//   and values it obtained itself — i.e. `require(`${__hooks}/lib/x.js`)` INSIDE
//   the handler. A function obtained that way DOES keep its module's closure, so
//   it may freely call its own module siblings (this is why openapi.buildSpec
//   works: it is required and called from inside the handler).
// • Top-level registration (calling `routerAdd` while the module loads) works.
// • Keep this file STATELESS — the tables are immutable definitions.

// NOTE: no module-level helper is referenced from any handler below. Inline what
// you need (`new Date().toISOString()`) or `require()` it. The one exception is
// `$dbx.exp`, which is a global.

// ── the route table ─────────────────────────────────────────────────────────
//
// Fields:
//   method, path   registration + spec
//   handler        (e) => Response
//   auth           true → wrap with $apis.requireAuth()  (also sets OpenAPI security)
//   summary, description, tags, params, responses, openapi:false to hide from the spec

const ROUTES = [
  // ── liveness (no auth) — for load balancers and agents ────────────────────
  {
    method: "GET",
    path: "/healthz",
    summary: "Liveness probe",
    description: "Returns service identity and server time. No auth.",
    responses: {
      200: {
        description: "Service is up",
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                status: { type: "string" },
                service: { type: "string" },
                version: { type: "string" },
                time: { type: "string", format: "date-time" },
              },
            },
          },
        },
      },
    },
    handler: (e) =>
      e.json(200, {
        status: "ok",
        service: "baseStarter",
        version: "0.1.0",
        time: new Date().toISOString(),
      }),
  },

  // ── current user (auth required) ──────────────────────────────────────────
  {
    method: "GET",
    path: "/api/me",
    summary: "Current authenticated user",
    description: "Echoes the caller's own profile. Requires an auth token.",
    auth: true,
    responses: {
      200: { description: "The authenticated user's profile" },
      401: { description: "Missing or invalid token" },
    },
    handler: (e) =>
      e.json(200, {
        id: e.auth.id,
        email: e.auth.getString("email"),
        name: e.auth.getString("name"),
        role: e.auth.getString("role"),
      }),
  },

  // ── dashboard counters ────────────────────────────────────────────────────
  {
    method: "GET",
    path: "/api/stats",
    summary: "Collection counters",
    description: "Counts of posts (total/published), users and comments. Public.",
    responses: {
      200: {
        description: "Counts",
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                posts: {
                  type: "object",
                  properties: { total: { type: "integer" }, published: { type: "integer" } },
                },
                users: { type: "integer" },
                comments: { type: "integer" },
              },
            },
          },
        },
      },
    },
    handler: (e) => {
      // $dbx.exp builds a bound expression — never string-concatenate values.
      const published = e.app.countRecords("posts", $dbx.exp("status = {:s}", { s: "published" }))
      return e.json(200, {
        posts: { total: e.app.countRecords("posts"), published: published },
        users: e.app.countRecords("users"),
        comments: e.app.countRecords("comments"),
      })
    },
  },

  // ── recent activity feed (drives the dashboard timeline) ──────────────────
  {
    method: "GET",
    path: "/api/activity",
    summary: "Recent activity",
    description: "Newest published posts and comments, merged and time-sorted.",
    params: [{ name: "limit", in: "query", schema: { type: "integer", default: 8, maximum: 50 } }],
    handler: (e) => {
      const info = e.requestInfo()
      let limit = parseInt(info.query.limit, 10)
      if (!limit || limit < 1) limit = 8
      if (limit > 50) limit = 50 // the OpenAPI spec declares maximum:50 — honour it

      const events = []

      const posts = e.app.findRecordsByFilter("posts", "status = 'published'", "-created", limit, 0, {})
      for (let i = 0; i < posts.length; i++) {
        const r = posts[i]
        events.push({ kind: "post", id: r.id, title: r.getString("title"), slug: r.getString("slug"), at: r.getString("created") })
      }

      const comments = e.app.findRecordsByFilter("comments", "", "-created", limit, 0, {})
      for (let i = 0; i < comments.length; i++) {
        const r = comments[i]
        events.push({ kind: "comment", id: r.id, title: r.getString("body").slice(0, 80), at: r.getString("created") })
      }

      events.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
      return e.json(200, { items: events.slice(0, limit) })
    },
  },

  // ── LIVE SCHEMA — powers the "Schema" tab and the docs page ───────────────
  {
    method: "GET",
    path: "/api/schema",
    summary: "Live collection schema",
    description:
      "Every non-system collection with its fields, indexes and API rules, read live " +
      "from the running app. This is what the OpenAPI spec is generated from.",
    responses: {
      200: {
        description: "Collections with fields, indexes and rule exposure",
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                generatedAt: { type: "string", format: "date-time" },
                appName: { type: "string" },
                collections: { type: "array", items: { type: "object", additionalProperties: true } },
              },
            },
          },
        },
      },
    },
    handler: (e) => {
      const openapi = require(`${__hooks}/lib/openapi.js`)
      const routes = require(`${__hooks}/lib/api.js`).ROUTES
      const built = openapi.buildSpec(e.app, routes, {})
      return e.json(200, {
        generatedAt: new Date().toISOString(),
        appName: e.app.settings().meta.appName,
        collections: built.summaries,
      })
    },
  },
]

// ── registration entry point ────────────────────────────────────────────────

/**
 * Register every route with PocketBase's router.
 * @param {Function} add  the `routerAdd` global, passed in by the caller.
 *   `$apis` is read at call time (module load) — it is a global there.
 */
function register(add) {
  for (let i = 0; i < ROUTES.length; i++) {
    const r = ROUTES[i]
    if (r.auth) add(r.method, r.path, r.handler, $apis.requireAuth())
    else add(r.method, r.path, r.handler)
  }
}

module.exports = {
  ROUTES: ROUTES,
  register: register,
}
