# baseStarter — common agent/dev tasks. `make help` lists targets.
SHELL := /bin/bash
PB    := base/pocketbase
DB    := pb_data
ROOT  := base
VERSION := $(shell tr -d '[:space:]' < base/pocketbase.version 2>/dev/null)

# .env is resolved IN THE RECIPE SHELL via the same loader the scripts use
# (`scripts/lib/env.sh`), not parsed into make variables. That matters: `$(shell)`
# folds newlines to spaces and make re-expands its output, so a make-level value
# would corrupt `PB_DIR` containing a space or a literal `$`, and would diverge
# from dev.sh/bootstrap.sh. Resolving in the shell keeps ONE precedence rule
# everywhere: an existing environment variable or a `make PB_DIR=…` command-line
# arg wins over `.env` (plain `KEY=VALUE` parsing; the file is never executed).
#
# PB_DIR default is relative to base/: every PocketBase artifact (binary, data,
# hooks, migrations, public site, backups) lives under base/ so the repo root
# stays clean. Absolute paths in PB_DIR still work.
LOAD_ENV := . ./scripts/lib/env.sh 2>/dev/null; _load_env_defaults .env;
DIR  := $${PB_DIR:-$(ROOT)/$(DB)}
HTTP := $${PB_HTTP:-127.0.0.1:8090}

.DEFAULT_GOAL := help
.PHONY: help install bootstrap dev serve migrate migrate-down new-migration collections superuser backup clean reset

help: ## List available targets
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

install: ## Download the pinned PocketBase binary
	@./scripts/install-pocketbase.sh

bootstrap: ## Install + migrate + create superuser (fresh checkout)
	@./scripts/bootstrap.sh

dev: ## Run dev server with live reload on :8090 (ensures a superuser first)
	@./scripts/dev.sh

serve: ## Run server without --dev
	@$(LOAD_ENV) $(PB) serve --http="$(HTTP)" --dir="$(DIR)" --migrationsDir=$(ROOT)/pb_migrations --hooksDir=$(ROOT)/pb_hooks

migrate: ## Apply all pending migrations
	@$(LOAD_ENV) $(PB) --automigrate=false migrate up --dir="$(DIR)" --migrationsDir=$(ROOT)/pb_migrations

migrate-down: ## Revert the last migration
	@$(LOAD_ENV) echo y | $(PB) --automigrate=false migrate down --dir="$(DIR)" --migrationsDir=$(ROOT)/pb_migrations

new-migration: ## Create a migration: make new-migration name=add_posts
	@[ -n "$(name)" ] || { echo "usage: make new-migration name=<name>"; exit 1; }
	@echo y | $(PB) --automigrate=false migrate create "$(name)" --migrationsDir=$(ROOT)/pb_migrations

collections: ## Snapshot current collections into a migration file
	@$(LOAD_ENV) echo y | $(PB) --automigrate=false migrate collections --dir="$(DIR)" --migrationsDir=$(ROOT)/pb_migrations

superuser: ## Create/update superuser: make superuser email=a@b.co pass=secret
	@[ -n "$(email)" ] || { echo "usage: make superuser email=<e> pass=<p>"; exit 1; }
	@$(LOAD_ENV) $(PB) --automigrate=false --dir="$(DIR)" superuser upsert "$(email)" "$(pass)"

backup: ## Snapshot the data dir (PB_DIR) into base/backups/
	@./scripts/backup.sh

clean: ## Remove the data dir (DESTRUCTIVE). Interactive y, or CONFIRM=1 non-interactively
	@$(LOAD_ENV) if [ -t 0 ]; then \
	  read -p "Delete $(DIR)/ and all data? [y/N] " y; \
	  [ "$$y" = "y" ] || { echo "aborted"; exit 1; }; \
	elif [ "$${CONFIRM:-}" != "1" ]; then \
	  echo "refusing: stdin is not a tty. Re-run with CONFIRM=1 to delete $(DIR)/." >&2; \
	  exit 1; \
	fi; \
	rm -rf "$(DIR)"; echo "✓ removed $(DIR)/"

reset: ## clean (needs CONFIRM=1 if non-interactive) then migrate + superuser a fresh DB
	@$(MAKE) --no-print-directory clean
	@$(LOAD_ENV) $(PB) --automigrate=false migrate up --dir="$(DIR)" --migrationsDir=$(ROOT)/pb_migrations
	@$(LOAD_ENV) source ./scripts/lib/ensure-superuser.sh && ensure_superuser "$(DIR)"
