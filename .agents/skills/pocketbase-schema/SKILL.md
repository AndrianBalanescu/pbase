---
name: pocketbase-schema
description: >-
  Modify the PocketBase schema safely. Use when adding/altering/deleting collections,
  fields, indexes, or API rules in this repo; when a write fails validation; when an index
  won't build; or when the admin UI and the code disagree about a collection. Covers JS
  migrations (up/down), field options and the TextField 5000-char trap, relation/select/
  file/autodate specifics, API-rule semantics, and the verify-then-revert workflow.
---

# PocketBase schema & migrations

Schema lives in `base/pb_migrations/<unix>_name.js`. This is the only sanctioned place to change
it — never hand-edit `base/pb_data/data.db`.

## Workflow

```bash
make new-migration name=add_widgets   # scaffold (writes .js, prompts → handled by make)
# edit the file
make migrate                          # apply
make migrate-down                     # PROVE the down path works
/opt/homebrew/opt/sqlite/bin/sqlite3 base/pb_data/data.db "select name,type from _collections"
```

After changing a collection in the Admin UI, snapshot it: `make collections`.

## Migration shape

```js
/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const c = new Collection({
    type: "base",                 // "base" | "auth" | "view"
    name: "widgets",
    listRule: "", viewRule: "",   // "" = public, null = superuser-only, "expr" = filtered
    createRule: "@request.auth.id != ''",
    updateRule: "@request.auth.id != ''",
    deleteRule: "@request.auth.id != ''",
    fields: [
      { name: "label",   type: "text",     required: true, max: 200 },
      { name: "qty",     type: "number",   min: 0 },
      { name: "kind",    type: "select",   maxSelect: 1, values: ["a", "b"] },
      { name: "created", type: "autodate", onCreate: true, onUpdate: false },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    indexes: ["CREATE UNIQUE INDEX `idx_widgets_label` ON `widgets` (`label`)"],
  })
  app.save(c)
}, (app) => {
  app.delete(app.findCollectionByNameOrId("widgets"))
})
```

The callback receives a **transactional** app: throwing rolls the whole file back. A
`down()` is strongly recommended.

## Field options that bite

| Type | Set this | Default trap |
|---|---|---|
| `text` | `max` | zero ⇒ **5000 chars**, oversized writes are rejected |
| `number` | `min`/`max`/`noDecimal` | unbounded, floats allowed |
| `select` | `values` (non-empty) + `maxSelect` | `maxSelect` must be ≤ 1 unless multiple |
| `relation` | `collectionId`, `maxSelect`, `cascadeDelete` | cascade delete removes dependents |
| `file` | `maxSelect`, `maxSize`, `thumbs` | thumbs e.g. `["400x300","100x100"]` |
| `json` | `maxSize` | unlimited |
| `autodate` | `onCreate`/`onUpdate` | **not auto-added to new base collections** |

## API rules

`""` (empty) = public (rule disabled) · `null` = superuser-only · expression = per-request filter.
⚠️ `""` on update/delete lets anyone write — use an expression unless public write is intended.
An unsatisfied rule **hides** the record rather than returning 403: **list → 200** (filtered
to what you may see), **view/update/delete → 404**, **create → 400**.

## Extending a built-in collection

`users` already exists. Never re-create it:

```js
const users = app.findCollectionByNameOrId("users")
users.fields.add(new TextField({ name: "bio", max: 2000 }))
app.save(users)   // fields.add upserts by name
```
