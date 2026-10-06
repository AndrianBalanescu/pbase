/// <reference path="../pb_data/types.d.ts" />
//
// 30_api_docs.pb.js — serves the machine-readable API surface.
//
//   GET /openapi.json        OpenAPI 3.1, generated live (same file the Scalar
//                            page at /docs/ loads, so the UI can never go stale)
//
// The endpoint requires `lib/openapi.js`, which reads collections from the
// running app and custom routes from `lib/api.js` — the same table that
// registers the handlers. There is nothing to keep in sync by hand.
//
// ⚠️ A handler may only use globals + its own locals; it cannot see this file's
// top-level scope. Hence the `require()` INSIDE the handler (a function obtained
// that way keeps its own module closure, so `buildSpec` can call its siblings).

// ── the OpenAPI document, at the conventional root path ─────────────────────
routerAdd("GET", "/openapi.json", (e) => {
  const openapi = require(`${__hooks}/lib/openapi.js`)
  const routes = require(`${__hooks}/lib/api.js`).ROUTES
  const built = openapi.buildSpec(e.app, routes, { serverUrl: "http://" + e.request.host })
  return e.json(200, built.spec)
})
