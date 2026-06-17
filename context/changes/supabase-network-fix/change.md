---
change_id: supabase-network-fix
title: Recover local Supabase from Edge Runtime bootstrap timeout (502/503)
status: new
created: 2026-06-17
updated: 2026-06-17
archived_at: null
---

## Resolution (2026-06-17)

Ran the **non-destructive** sequence only — no `--no-backup`, no `docker volume/network prune`:

1. `npx supabase stop` (kept snapshot)
2. `source scripts/colima-env.sh` → `colima stop` → `colima start` with the full documented
   flags (`--vm-type vz --mount-type virtiofs --cpu 4 --memory 8 --disk 60
   --mount /Volumes/KINGSTONE_SSD:w`) **plus** `--dns 1.1.1.1 --dns 8.8.8.8`. VM stayed on the
   SSD; containers persisted.
3. `npx supabase start -x vector,logflare` → still 502.

**Actual root cause:** the `edge_runtime` container (enabled by default in `config.toml`)
fails its health check fetching a Deno graph from `deno.land/std` at boot, and the CLI then
tears the whole stack down. This app has **no `supabase/functions/` and no edge-function calls
in `src/`**, so the container is unused locally.

**Fix:** `npx supabase start -x vector,logflare,edge-runtime`. Stack came up healthy —
4/4 migrations applied, 5 counterparties seeded, REST gateway HTTP 200, DB reachable. No data
lost. The DNS override was harmless but not the cause. Recorded in memory `local-supabase-colima`.

## Notes

Purging container networks and Deno graph caches.

Goal: fix the Supabase Edge Runtime bootstrap timeout (502/503) on local dev. Hypothesis is
that the local network environment changed and the Colima VM / Docker containers are holding
stale DNS-failure state and broken Deno graph caches.

Proposed recovery pipeline (NOT yet executed — see safety review below):

1. Hard stop: `npx supabase stop --no-backup`
2. Network purge: `docker network prune -f` and `docker volume prune -f`
3. DNS injection + VM restart: `colima stop` then `colima start --dns 1.1.1.1 --dns 8.8.8.8`
4. Clean boot: rebuild containers, re-apply migrations, let Deno re-pull graphs

**Safety flags raised before running any of this:**
- `docker volume prune -f` is unscoped and destroys ALL unused Docker volumes — including the
  local Supabase Postgres data volume. This wipes local DB state irreversibly.
- `npx supabase stop --no-backup` explicitly discards the local DB snapshot.
- The referenced "internal IDP pipeline `10x_mz_docker_supabase`" is not a known tool in this
  repo or environment — there is no such CLI/script to invoke.
- Local Supabase here runs via Colima on the external SSD (see memory `local-supabase-colima`);
  a blind volume prune + `--no-backup` stop loses that local data.

Determinism note: migrations are immutable and seeded fixtures must stay byte-identical
(conventions.md). Re-applying migrations from scratch is fine for schema, but local data loss
is the real cost here.
