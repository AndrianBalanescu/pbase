/// <reference path="../pb_data/types.d.ts" />
//
// 50_cron.pb.js — background jobs.
//
// cronAdd(name, "min hour dom mon dow", handler)
//   The handler runs on PocketBase's own Go scheduler — no external cron needed.
//   Jobs are registered at boot; cronRemove(name) unregisters.
//
// NOTE: JSVM has no $jobs namespace (Go-only). cronAdd is the way in pb_hooks.
// Standard 5-field cron in the server's LOCAL timezone.
//

// ── hourly: prune archived drafts older than 90 days ─────────────────────────
cronAdd("prune_old_drafts", "0 * * * *", () => {
  try {
    const cutoff = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString()
    const stale = $app.findRecordsByFilter(
      "posts",
      "status = 'archived' && updated < {:cutoff}",
      "-updated",
      200,
      0,
      { cutoff: cutoff },
    )

    for (const rec of stale) {
      $app.delete(rec)
    }
    if (stale.length) {
      console.log("[cron] pruned", stale.length, "archived posts")
    }
  } catch (err) {
    console.error("[cron] prune_old_drafts failed:", err)
  }
})

// ── daily at 03:00: emit a stats line to the server log ─────────────────────
cronAdd("daily_stats", "0 3 * * *", () => {
  try {
    const total = $app.countRecords("posts")
    const published = $app.countRecords("posts", $dbx.exp("status = {:s}", { s: "published" }))
    console.log("[cron] daily stats — posts:", total, "published:", published)
  } catch (err) {
    console.error("[cron] daily_stats failed:", err)
  }
})
