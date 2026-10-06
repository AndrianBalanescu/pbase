# AGENTS.md — scripts/

Operational scripts. Bash for ops.

```
install-pocketbase.sh   download the pinned PocketBase binary (version from ../base/pocketbase.version)
bootstrap.sh            install + migrate + create dev superuser (idempotent)
dev.sh                  run the dev server (--dev: SQL log + hook hot-reload); ensures a
                        superuser before serving (demo seed needs SEED_DEMO=1 at migrate time)
backup.sh               consistent sqlite snapshot of the data dir (PB_DIR) → base/backups/
lib/env.sh              shared `.env` loader (sourced by bootstrap.sh & dev.sh)
lib/ensure-superuser.sh shared idempotent superuser upsert (sourced by bootstrap.sh & dev.sh)
```

`lib/env.sh` loads `.env` as **defaults only**: a variable already present in the
environment wins over the same key in `.env`. This lets CI/systemd/Docker inject secrets
without a checked-out `.env` clobbering them. Plain `KEY=VALUE` parsing; the file is never
`source`d, so it cannot execute code. The **Makefile resolves `.env` in the recipe
shell through this same loader** (not into make variables), so `make migrate`/`serve`/`reset`
honour `.env` with identical precedence — an env var or a `make PB_DIR=…` command-line arg
still wins. Doing it in the shell (not `$(shell)`/make vars) is deliberate: make re-expands
`$(shell)` output and folds newlines, which would corrupt a `PB_DIR` containing a space or a
literal `$`. Use this pattern when adding a new env-driven var.

`lib/ensure-superuser.sh` guarantees a real superuser in the target `--dir` before the
server starts (`superuser upsert`, create-or-update, `--automigrate=false`). PocketBase
`serve` prints "Create your first superuser" and seeds a throwaway
`__pbinstaller@example.com` account whenever the dir has none — i.e. after `make clean` or
a first run that skipped `bootstrap`. Calling `ensure_superuser` first makes every restart
silent. `dev.sh`/`serve` also **pin `--dir`/`--migrationsDir`/`--hooksDir`**: without
`--migrationsDir`, PocketBase resolves it relative to the **parent of `--dir`**, so a
custom data dir silently applies no migrations and loads no hooks.

## Rules

- **Never hardcode the PocketBase version** — read it from `../base/pocketbase.version`.
- Scripts must be **idempotent** and safe to re-run (bootstrap, install, backup).
- Use `set -euo pipefail`; fail loudly. No silent fallbacks.
- CLI migrations are **interactive** — always pipe `echo y |` for `migrate create`/`migrate down`.
- Pass `--automigrate=false` to CLI ops that shouldn't fabricate a snapshot migration.
- `base/pb_data/` and `.env` are runtime/secret — never print their contents, never commit them.
- Every entrypoint that starts the server runs `ensure_superuser` first (see `lib/ensure-superuser.sh`).
- Pass `--dir` **and** `--migrationsDir`/`--hooksDir` to `serve` so a custom data dir still gets migrations + hooks.
- Every data-dir-touching command (migrate, superuser, backup, clean, reset, serve, dev) honours `PB_DIR` — never hardcode `pb_data`.

## SDK / HTTP patterns the scripts use

- **Auth header**: `-H "Authorization: $TOKEN"` (raw token). A `Bearer ` prefix is also accepted.
- Login: `POST /api/collections/users/auth-with-password` → `.token`.
- Bind filters — pass query params, never concatenate untrusted input.
- Dates are `"YYYY-MM-DD HH:MM:SS.sssZ"` (space, not ISO `T`).

See `../AGENTS.md` for repo-wide conventions and `../base/pb_public/llms-full.txt` for the API.
