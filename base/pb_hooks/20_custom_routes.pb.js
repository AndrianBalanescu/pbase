/// <reference path="../pb_data/types.d.ts" />
//
// 20_custom_routes.pb.js — REGISTRATION ENTRY POINT. Nothing else.
//
// The routes themselves live in `lib/api.js` as a table that carries both the
// handler and its OpenAPI metadata. Keeping them there means:
//   • this file stays a two-line loader, and
//   • `30_api_docs.pb.js` documents the SAME table that registers the handlers,
//     so `/openapi.json` can never drift from real behaviour.
//
// To add an endpoint: append an entry to `ROUTES` in `pb_hooks/lib/api.js`.
//
// ── WHY NOT DEFINE ROUTES HERE? ─────────────────────────────────────────────
// A handler can only use globals and its own locals — it CANNOT see this file's
// top-level scope (each handler runs in a separate pooled goja VM). So helpers
// shared with docs must live in a module and be `require()`d by path. See the
// module contract at the top of `lib/api.js` and `lib/slug.js`.

require(`${__hooks}/lib/api.js`).register(routerAdd)
