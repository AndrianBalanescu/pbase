# AGENTS.md — base/pb_public/

Static frontend, served by PocketBase at `/`. **No bundler, no `node_modules`, no build
step.** Edit a file and refresh the browser.

```
base/pb_public/
  index.html              entry page — loads ohno + vendor libs + assets/app.js
  assets/app.js           the Vue 3 app (global build, classic <script>)
  assets/app.css          app-specific tweaks on top of ohno (never restyle kit internals)
  vendor/                 pinned third-party libs (do NOT edit; do NOT re-fetch at runtime)
    pocketbase.umd.js     PocketBase JS SDK (UMD global `PocketBase`)
    vue.global.prod.js    Vue 3 global production build (global `Vue`)
    ohno/                 ohno UI kit — tokens/base/components (.css + .min.css) + ohno(.min).js
    scalar.standalone.js  API-reference renderer for docs/ (@scalar/api-reference@1.73.0, MIT)
  docs/index.html         interactive reference — renders the LIVE /openapi.json (Scalar)
  llms.txt                one-page map for LLM agents (llmstxt.org convention)
  llms-full.txt           full operating manual
```

> **`/openapi.json` is not a file here.** It is generated at request time by
> `base/pb_hooks/lib/openapi.js` (collections from `$app.findAllCollections()`, custom routes from the
> `ROUTES` table in `base/pb_hooks/lib/api.js`) and served by `base/pb_hooks/30_api_docs.pb.js`. There is
> nothing to keep in sync — add a field or route and the docs follow.

## Golden rules

- **Keep it zero-build AND offline.** Add libraries as pinned files in `vendor/`, referenced
  with a plain `<script>` tag. Never introduce `npm`, a bundler, or a **runtime CDN** — a
  `https://cdn…` `<script>` breaks the app whenever the machine is offline or egress is
  restricted (common in agent sandboxes). Vendor the file and record its version + license in
  `docs/licenses/` (index + license text; served at `/docs/licenses/`).
- **`vendor/` is vendored, not generated.** Update it only by deliberately downloading a new
  pinned version; record the version in a comment and add its row to `docs/licenses/`.
- **Never hardcode the API origin.** The app already does
  `const baseUrl = globalThis.PB_URL_OVERRIDE || location.origin` so the same file works via
  `file://`, a tunnel, or prod. Read the override via `globalThis`: a bare
  `PB_URL_OVERRIDE` reference throws `ReferenceError` when unset and aborts `setup()`.
- **`/`, `/docs/`, `/llms.txt`, `/openapi.json`, `/llms-full.txt` are public.** Anything placed
  here is world-readable — no secrets, no tokens.
- When you add or change a route/field, update `llms.txt` and `llms-full.txt` in the same change.
  (`/openapi.json` updates itself — it is generated, never edited.)

## ohno UI kit

The UI is **ohno** (vendored at `vendor/ohno/`) — a classless-first, zero-dependency kit. Native
elements (`<button>`, `<input>`, `<table>`, `<dialog>`, `<pre><code>`, `<details>`, `<progress>`)
are styled with **zero classes**; classes are only for variants and composite widgets.

- Use ohno's classes — `.card`, `.badge`, `.btn-primary`, `.table-wrap`, `.table-card`,
  `.shell`/`.sidebar`/`.content`, `.empty`, `.palette`, `.modal` — and its data-attributes
  (`data-modal-open`, `data-dropdown`, `data-tabs`, `th[data-sort]`, `data-table-filter`).
  **Never invent class names** (`card-dark`, `btn-xl`, …): if it is not in ohno's contract it
  does not exist. Full contract: `llm.txt` in the upstream ohno repository.
- Keep `assets/app.css` for **layout tweaks ohno does not own**, and consume ohno tokens
  (`--o-s*`, `--o-surface*`, `--o-*-text`) so it follows every theme / face / palette change.
- ohno's runtime uses **delegated listeners**, so table sorting/filtering, modals, dropdowns and
  tabs keep working on Vue-rendered markup after a data refresh. Call `OHNO.scan(root)` only after
  injecting markup that needs **internal state** (comboboxes, copy blocks).
- `window.OHNO` exposes `toast`, `openModal`/`closeModal`, `theme`, `loading`, `notch`, `scan`.
- ⚠️ **Known gap:** the vendored build ships only the *mobile* override for `.grid-2/3/4`
  (`.grid-* { grid-template-columns: 1fr }` under `max-width:767.98px`), so those helpers render
  as a single column at every width. `assets/app.css` re-adds the desktop base (`display:grid` +
  a `min-width:768px` column rule).

### ohno is the default, not a lock-in

ohno is a **starter default**, swappable for any other kit (Pico, Tailwind, Bootstrap, hand-rolled
CSS) without touching the backend. The coupling is confined to the frontend and is deliberately thin:

- **Server is untouched** — `base/pb_hooks/`, `base/pb_migrations/` and `scripts/` contain **zero**
  references to ohno or Vue. The REST API is identical whichever kit renders it.
- **Logic degrades gracefully** — every ohno call in `assets/app.js` is guarded
  (`if (window.OHNO) OHNO.toast(...)`). Delete `ohno.min.js` and the app still runs; you lose only
  toasts, modals and the delegated table helpers.
- **Swap surface = four frontend files that depend on ohno at runtime** — `index.html` (markup
  classes + `data-*`), `assets/app.css` (layout tweaks; consumes ohno tokens), `assets/app.js`
  (6 guarded `OHNO.*` calls), and `docs/licenses/index.html` (a self-contained static page).
  Files that merely *mention* ohno in prose (`llms*.txt`, this guide, the licenses index/rows)
  keep working unchanged after a swap — only their wording goes stale. Two of the four
  (`index.html`, `docs/licenses/index.html`) carry the `<link>`/`<script>` tags — drop those plus
  the `vendor/ohno/` directory. `docs/index.html` (Scalar) is independent — it references ohno nowhere.
- **Vue is independent of ohno** — you can keep Vue and replace only the CSS, or the reverse.

If you do swap, drop the `vendor/ohno/` directory and its `docs/licenses/` row to keep the tree honest.

## PocketBase SDK patterns that actually work here

```js
// One client per page. Disable auto-cancellation in reactive UIs, or a re-render aborts
// an in-flight read and you get a spurious ClientResponseError.
const pb = new PocketBase(globalThis.PB_URL_OVERRIDE || location.origin);
pb.autoCancellation(false);

// Full list (the SDK pages for you; safe for dashboards).
const posts = await pb.collection("posts").getFullList({ sort: "-created" });

// Server-side filter. The rule already scopes what you may see; this narrows it.
await pb.collection("posts").getList(1, 30, {
  sort: "-created",
  filter: 'status = "published"',
  expand: "author",     // inline relation records
  skipTotal: true,      // skips COUNT; totalItems becomes -1
});

// Bind user input — never string-concatenate into a filter.
pb.filter("title ~ {:q}", { q: userInput });

// Auth. The token lives in pb.authStore; the record is pb.authStore.record.
await pb.collection("users").authWithPassword(identity, password);
pb.authStore.clear();   // logout

// File URLs (original + thumbnail). The SDK builds the URL and appends the token.
pb.files.getURL(record, record.cover, { thumb: "400x300" });

// Realtime — one SSE connection, shared across collections. Returns an unsubscribe fn.
const unsub = await pb.collection("posts").subscribe("*", (e) => {
  // e.action: "create" | "update" | "delete"; e.record is the row
});
```

## Traps

- **Never put `@request.auth.*` in a client `filter`.** PocketBase rejects it with
  **403 "Only superusers can filter by @request."** for every non-superuser, so a page that
  hardcodes it renders empty with an error banner. Let the collection **rule** scope the data;
  filter client-side only on concrete fields (`status = "published"`, `title ~ "x"`).
- `pb.authStore.record` (v0.23+), **not** `pb.authStore.model`.
- Realtime only emits for collections the client may **list/view**; a private collection
  silently sends nothing. Only base/auth collections emit — **view collections do not**.
- `getFullList` with no `perPage` will still cap at the server clamp (**1000** rows).
- Dates arrive as `"YYYY-MM-DD HH:MM:SS.sssZ"` (a **space**, not ISO `T`) — parse defensively.
- A failed rule **hides** a record (404 on list/view), so "not found" often means "not yours".
- Don't `import` anything — these are classic scripts exposing globals `PocketBase` and `Vue`.

See `../AGENTS.md` for repo-wide conventions and `llms-full.txt` §7 for the frontend section.
