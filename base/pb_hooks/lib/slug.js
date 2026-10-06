// pb_hooks/lib/slug.js — shared helper module.
//
// ── WHY THIS FILE EXISTS (the pattern worth copying) ────────────────────────
// Hook files (*.pb.js) are loaded as REGISTRATION entry points. Helpers you put
// at their top level are NOT visible inside hook callbacks, because each handler
// runs in its own pooled goja VM and only sees its own scope + the globals.
//
// The idiomatic fix is a plain .js module here in `lib/`, loaded inside the
// handler with:
//
//     const { slugify } = require(`${__hooks}/lib/slug.js`)
//
// ⚠️ Use `${__hooks}` (the absolute path to this directory). A relative path
// like `./lib/slug.js` resolves from the PROCESS WORKING DIRECTORY, not from
// pb_hooks/, so it breaks the moment the binary is started from another cwd.
//
// ⚠️ Required modules share ONE registry for the process. Keep them
// STATELESS (pure functions) — storing per-request data here causes
// cross-request bleed under concurrency.
//
// ⚠️ This is Goja, not Node: there is no `fs`, no `fetch`, no `setTimeout`,
// and `require("some-npm-package")` throws `GoError: Invalid module`.

module.exports = {
  /** URL-safe slug: lowercase, ASCII-folded, hyphenated, trimmed, capped. */
  slugify(text, maxLen = 80) {
    return String(text || "")
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "") // strip diacritics
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, maxLen)
  },

  /** PocketBase stores datetime as "YYYY-MM-DD HH:MM:SS.sssZ" — a SPACE, not "T". */
  nowPB() {
    return new Date().toISOString().replace("T", " ")
  },
}
