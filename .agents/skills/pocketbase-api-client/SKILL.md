---
name: pocketbase-api-client
description: >-
  Consume this PocketBase app's REST/realtime API from application code, scripts, or the
  browser. Use when reading or writing records, authenticating users, uploading files,
  subscribing to realtime updates. Covers the JS SDK, safe filter
  binding, expand/sort/pagination, batch, SSE, file URLs & thumbnails, auth-store handling,
  and curl equivalents.
---

# Consuming the PocketBase API

> **Check the native feature first.** Before writing a custom route, hook, or helper, read
> `.agents/reference/TOP-20-APIs.md` — 90% of what you'd write is an API rule, a field option,
> an index, `expand`, `cronAdd`, or `/api/batch`. Full manuals in `.agents/reference/`.

Base URL in dev: `http://127.0.0.1:8090`.

## JS SDK (browser — vendored at `/vendor/pocketbase.umd.js`)

```js
const pb = new PocketBase(location.origin);
pb.autoCancellation(false);                 // reactive UIs fire concurrent reads

const list = await pb.collection("posts").getFullList({
  sort: "-created",
  filter: pb.filter("status = {:s}", { s: "published" }),   // SAFE binding
  expand: "author",                                         // inline relations
});

await pb.collection("users").authWithPassword(email, password);
const url = pb.files.getURL(record, record.cover, { thumb: "400x300" });
pb.collection("posts").subscribe("*", (e) => console.log(e.action, e.record));
```

`autoCancellation(true)` (the default) aborts a pending identical request when a new one
starts — disable it in reactive code.

## REST cheatsheet

| Op | Call |
|---|---|
| List | `GET /api/collections/{c}/records?page&perPage&sort&filter&expand&fields&skipTotal` |
| View | `GET /api/collections/{c}/records/{id}` |
| Create | `POST /api/collections/{c}/records` |
| Update | `PATCH /api/collections/{c}/records/{id}` |
| Delete | `DELETE /api/collections/{c}/records/{id}` |
| Auth | `POST /api/collections/users/auth-with-password` |
| Batch | `POST /api/batch` (record create/update/upsert/delete only, ≤50 ops, one transaction; **off by default**) |
| Realtime | `GET /api/realtime` (SSE) |

**Auth header**: raw token (`Authorization: <token>`). A `Bearer ` prefix is accepted too — optional, not required.

Filter operators: `=` `!=` `>` `>=` `<` `<=` `~` (contains) `!~` `?=` `?~`,
plus `geoDistance(lon,lat,"field")`. Back-relation: `comments_via_post.id != ''`.

Multi-valued paths (`comments_via_post.body`, `tags`) match-ALL by default — use the
`?`-prefixed operators for any-of. Date filters are string comparisons: use full
timestamps (`created >= '2026-01-02 00:00:00.000Z'`). Pagination: `perPage` clamps to
**1000**; add `skipTotal=1` to skip the COUNT (then `totalItems` is `-1`).

```bash
BASE=http://127.0.0.1:8090
TOKEN=$(curl -s -X POST "$BASE/api/collections/users/auth-with-password" \
  -H 'Content-Type: application/json' \
  -d '{"identity":"demo@local.local","password":"demo12345678"}' | jq -r .token)

curl -s "$BASE/api/collections/posts/records?filter=status%3D'published'&sort=-created&perPage=5"
curl -s "$BASE/api/collections/posts/records" -H "Authorization: $TOKEN"
curl -s "$BASE/api/collections/posts/records?filter=(title~%22agent%22%7C%7Cbody~%22agent%22)&sort=-created"
curl -s "$BASE/api/stats"
```

## Realtime

```bash
# Open the SSE stream directly with a clientId + topics.
curl -N "$BASE/api/realtime?clientId=$(uuidgen)&subscriptions=posts"
# → 200 text/event-stream, one JSON {action, record} event per change
```

The JS SDK opens the stream then POSTs `{clientId, subscriptions}` to update topics;
a one-off curl subscription needs only the GET. Realtime honors list/view rules — a client
only sees records it may access. View collections emit **no** realtime events.

## Gotchas

- Dates come back as `"YYYY-MM-DD HH:MM:SS.sssZ"` (space, not ISO `T`).
- Omitting `max` on text fields silently caps at 5000 and rejects larger writes.
- `pb.filter()` protects against filter injection — build filters with it, never by string
  concatenation.
