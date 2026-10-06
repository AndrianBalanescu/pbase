/// <reference path="../pb_data/types.d.ts" />
//
// 60_webhooks.pb.js — outbound HTTP on record events.
//
// $http.send({ method, url, headers, body, timeout }) is synchronous inside the
// JSVM and AVAILABLE in v0.40. Response: { statusCode, headers, cookies, json, body }.
//
// Disabled unless POST_WEBHOOK_URL is set, so a fresh clone never makes network
// calls by accident. Runs on an "AfterSuccess" hook so a slow endpoint never
// stalls the API request (it fires after commit).
//
// ⚠️ The URL is read INSIDE the handler on purpose. Top-level `const`s (and
// functions) are NOT visible inside a hook: each handler runs in its own pooled
// goja VM. A top-level `const WEBHOOK_URL = ...` referenced here throws
// `ReferenceError: WEBHOOK_URL is not defined` at request time — and it stays
// invisible until the day someone sets the env var. Registering the hook
// conditionally at the top level IS fine (that code runs at load), but every
// value the handler uses must be resolved inside it.
//

if ($os.getenv("POST_WEBHOOK_URL")) {
  onRecordAfterCreateSuccess((e) => {
    try {
      const res = $http.send({
        method: "POST",
        url: $os.getenv("POST_WEBHOOK_URL"),
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event: "post.created",
          id: e.record.id,
          slug: e.record.get("slug"),
          title: e.record.get("title"),
        }),
        timeout: 10, // seconds
      })
      if (res.statusCode >= 300) {
        console.error("[webhook] non-2xx", res.statusCode)
      }
    } catch (err) {
      // Never let a webhook failure break the write — it already committed.
      console.error("[webhook] failed:", err)
    }
  }, "posts")
}
