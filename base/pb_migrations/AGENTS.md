# AGENTS.md — base/pb_migrations/

Versioned, reversible schema definitions. This is the **only** sanctioned place to change
the database schema.

- One file per change: `migrate(up, down)`. Both callbacks receive a **transactional** app —
  throwing inside rolls the file back.
- Filenames are `<unix>_<name>.js`; generate them with `make new-migration name=<thing>`
  (or `echo y | ./base/pocketbase migrate create <name>` — it prompts). `migrate down` and
  `migrate collections` prompt too, so the Makefile pipes `y` into them.
- **Always set `max` on text fields.** The default is 5000 chars, and an oversized write
  fails validation and rejects the entire record.
- New **base** collections do not get `created`/`updated` automatically — declare them as
  `autodate` fields, or an index on `created` will fail to build.
- `select` fields need non-empty `values`; `maxSelect` must be 1 unless multiple.
- The `users` auth collection already exists — extend it via
  `app.findCollectionByNameOrId("users")` and `fields.add(...)`; do not re-create it.

Workflow:

```bash
make new-migration name=add_widgets   # scaffold
# ...edit the file...
make migrate                          # apply
make migrate-down                     # verify the down() path
sqlite3 base/pb_data/data.db "select name from _collections"   # confirm
```
