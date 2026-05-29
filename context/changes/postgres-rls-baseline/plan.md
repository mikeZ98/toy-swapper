# Postgres + RLS Baseline Implementation Plan

## Overview

Land the data-layer foundation for ToySwapper v2: make Postgres reachable from the Cloudflare Workers runtime, ship `supabase/migrations/` with a single cross-cutting bootstrap migration (RLS helpers + a commented policy template — **no app tables**), prove the RLS contract with an automated pgTAP test, and wire `supabase db lint` / `test db` / `db push` into the CI/CD pipeline. This is the foundation that F-02 (seed-counterparty-pool), S-02 (restore-saved-lists), and S-03 (evaluation-history) all rest on; the named verification path "RLS denial is observable in prod" originates here.

## Current State Analysis

- **SSR client present, idle.** `src/lib/supabase.ts:5-24` constructs a `@supabase/ssr` server client reading `SUPABASE_URL` / `SUPABASE_KEY` from `astro:env/server` (both declared optional in `astro.config.mjs:19-20`). The auth API routes use it (`src/pages/api/auth/{signin,signout,signup}.ts`), but no app code reads or writes app tables.
- **No migrations directory.** `supabase/` contains only `config.toml`; `supabase/migrations/` does not exist. v1 state is in-memory over `src/lib/fixture-pool.ts`.
- **Stale starter config.** `supabase/config.toml:5` has `project_id = "10x-astro-starter"` — the starter default, not project-specific.
- **CI already wired for SUPABASE secrets.** `.github/workflows/ci.yml` passes `SUPABASE_URL` / `SUPABASE_KEY` to the build step, so a Supabase cloud project exists somewhere. No DB-touching CI steps yet.
- **No `app` schema, no helper functions, no `Database<T>` type.** `src/db/` doesn't exist; `src/types.ts` has the evaluator types only.
- **AI rules files are stale.** `CLAUDE.md` and `AGENTS.md` both still declare "No database, no auth" as PRD-locked rules — PRD v2 lifted both on 2026-05-28. Documents need to reflect v2 before downstream slices land.
- **Supabase CLI in devDeps** (`supabase ^2.23.4`). Local stack (Postgres 17 on port 54322, GoTrue on 54321) boots via `npx supabase start`; `db.migrations.enabled = true` and `db.seed.enabled = true` are already set.

## Desired End State

After this change:
- `supabase/migrations/<timestamp>_rls_baseline.sql` exists and applies cleanly to a fresh local Supabase stack and to the production project.
- An `app` schema lives in Postgres with two reusable helpers — `app.current_user_id()` (a thin wrapper over `auth.uid()`) and `app.tg_set_updated_at()` (a generic `BEFORE UPDATE` trigger function).
- `supabase/README.md` documents the four-policy-per-table RLS pattern with one worked example; downstream migrations copy that pattern.
- `supabase/tests/rls_template.test.sql` proves via pgTAP that a row owned by one user is invisible to another under the template policies; `supabase test db` exits 0.
- CI runs `supabase db lint` and `supabase test db` on every PR; on merge to master, CI runs `supabase db push` against prod before any Cloudflare deploy step.
- `CLAUDE.md` and `AGENTS.md` reflect v2 reality and point at `supabase/README.md` for the RLS pattern.
- The original v1 evaluator (`/api/evaluate` against `src/lib/fixture-pool.ts`) keeps working unchanged — F-01 ships no tables in `public` schema, so determinism is preserved by construction.

### Verification:
- `npx supabase start && npx supabase db reset` applies migrations and runs seeds cleanly.
- `npx supabase test db` exits 0 against the local stack.
- A new PR with a no-op migration passes `supabase db lint` in CI.
- Merging a PR with a migration triggers `supabase db push` against prod successfully.

### Key Discoveries:
- The roadmap Risk on F-01 explicitly forbids per-table migrations in this change — `user_lists` belongs to S-02, `counterparties` to F-02, `evaluations` to S-03. F-01 ships only cross-cutting helpers + the policy template.
- `astro:env/server` already declares `SUPABASE_URL` and `SUPABASE_KEY` as optional secrets; the SSR client gracefully returns `null` when unset (`src/lib/supabase.ts:6-8`). No env-schema change needed.
- `supabase/config.toml:36` pins Postgres major_version 17 — production Supabase project must match. The four-policy template depends on Postgres 9.5+ RLS syntax, which is fine.
- `supabase/config.toml:53-58` already enables migrations; no config flip needed beyond renaming `project_id`.
- Supabase CLI's `supabase test db` reads `*.test.sql` files under `supabase/tests/` and runs them inside a pgTAP transaction. pgTAP comes preinstalled in Supabase Postgres images.

## What We're NOT Doing

- **No app tables** — `user_lists` (S-02), `counterparties` (F-02), `evaluations` (S-03) are explicitly out of scope.
- **No Cloudflare deploy automation** — `npx wrangler deploy` stays operator-managed; CI gets only the Supabase-side migration application.
- **No `Database<T>` generated types** — no app tables means nothing to type. S-02 will introduce `npx supabase gen types` when it ships the first real table.
- **No env-schema changes** — `SUPABASE_URL`/`KEY` are already wired through `astro:env/server`.
- **No new runtime dependency on app helpers** — `app.current_user_id()` is consumed only by future RLS policies, not by application code.
- **No backfill / data migration** — there is no existing data to migrate.
- **No anonymous-demo path decisions** — OQ-5 blocks S-01, not F-01.
- **No save-granularity decisions** — OQ-4 blocks S-02, not F-01.

## Environment constraints (logged 2026-05-29)

The local dev environment for this implementation run does not have a container runtime: no Docker Desktop, OrbStack, Colima, or Rancher Desktop is installed; only the `docker` CLI from Homebrew is present. The operator's intended dev DB lives on a remote homelab server reachable via Tailscale + SSH (native Postgres + Qdrant containers already running), but the current corporate Wi-Fi enforces Deep Packet Inspection and blocks outbound VPN traffic, so the homelab is unreachable from this session.

Consequences for verification:

- **Phase 1 automated checks 1.2, 1.3, 1.4 are deferred** — they require a live Postgres + Supabase CLI booted via `npx supabase start`, which needs Docker locally. They will be re-validated by Phase 3 CI (GitHub Actions runners have unrestricted network access and a clean Docker daemon, so `supabase db start` + `db lint` + `test db` run there on every PR). The migration SQL is reviewable by inspection in this commit; runtime verification rides on CI.
- **Phase 1 manual checks 1.9 and 1.10 are deferred** for the same reason — they call for `npx supabase start && npx supabase db reset` and a working `.dev.vars` against the local stack. The operator runs these when on a homelab-reachable network, or relies on CI.
- **Phase 2 success criteria 2.2 (`npx supabase test db` exits 0) is deferred** to Phase 3 CI on the same grounds. The pgTAP file ships and is reviewable as-written; execution waits for CI.

This is a documented one-time accommodation. Future phases must NOT assume the same deferral — once the operator is back on a homelab-reachable network (or CI lands in Phase 3), the deferred rows get flipped and back-filled.

## Implementation Approach

Three phases of escalating commitment. Phase 1 ships the migration and documentation against a local Docker stack — a contributor (or agent) can reset the local DB and observe the helpers in `app.*`, but the production project is untouched. Phase 2 adds the pgTAP test that turns the policy template from "documentation" into "executable invariant". Phase 3 wires both into CI/CD so that (a) every PR's migrations are linted and tested before review, and (b) merges to master cannot deploy code whose migration didn't run first. Each phase is independently verifiable and can be paused at without leaving the repo in a broken state.

## Critical Implementation Details

- **Migration immutability.** Once a migration filename ships, it is never edited — fixes go in a new timestamped migration. This is the determinism contract every downstream slice depends on (PRD NFR: "Schema migrations that change seeded counterparties are explicit determinism boundaries"). The plan treats the Phase 1 migration filename as load-bearing.
- **`set search_path = ''` on helper functions.** Both helpers must explicitly empty `search_path` to defend against schema-poisoning when called from RLS policies; references must be schema-qualified (`auth.uid()`, not `uid()`). This is non-obvious and easy to skip; without it, a malicious table-level function-call path can subvert policies.
- **`security invoker` on helpers.** RLS helpers MUST run as the calling role, not as the owner — otherwise they bypass RLS by construction. The default for SQL functions is `security invoker` but plpgsql functions default to `security definer` in some templates; the contract here is invoker for both.
- **pgTAP role switching.** `supabase test db` runs as the `postgres` superuser by default. To exercise `auth.uid()` returning a specific user id, the test must `set local role authenticated; set local request.jwt.claims to ...` inside the test transaction. The plan treats this as a Phase 2 contract.

## Phase 1: Local Supabase wiring + first migration

### Overview

Establish the local-dev DB workflow (rename project_id, document the boot sequence in README), ship the first migration containing the `app` schema + two helper functions + the policy template as commented SQL, and update the AI-rules files (`CLAUDE.md`, `AGENTS.md`) so future agents reference `supabase/README.md` for the RLS pattern.

### Changes Required:

#### 1. Rename starter project_id to match this project

**File**: `supabase/config.toml`

**Intent**: Disambiguate this project's local Supabase instance from any other project sitting on the same machine — the starter's `project_id = "10x-astro-starter"` shadows naming when `supabase link` is later used.

**Contract**: `project_id = "toy-swapper"`. No other keys in `config.toml` change. The local API/db ports (54321/54322) and schemas (`public`, `graphql_public`) stay as-is.

#### 2. First migration — RLS baseline (helpers + template)

**File**: `supabase/migrations/20260529120000_rls_baseline.sql`

**Intent**: Ship the cross-cutting SQL that every downstream RLS-scoped migration consumes — an `app` schema with two helper functions and an in-file commented template showing the four-policy-per-table pattern. No tables in `public`. This is the migration that establishes the determinism boundary for v2.

**Contract**:
- `create schema if not exists app;`
- `app.current_user_id() returns uuid` — `language sql`, `stable`, `security invoker`, `set search_path = ''`, body `select auth.uid()`. Used by downstream RLS policies as `using (user_id = app.current_user_id())`.
- `app.tg_set_updated_at() returns trigger` — `language plpgsql`, `security invoker`, `set search_path = ''`, body sets `NEW.updated_at := now()`. Used as `before update ... execute function app.tg_set_updated_at()`.
- Both functions carry a `comment on function` explaining when to use them.
- A block of **commented-out** SQL at the end of the migration shows the canonical four-policy-per-table pattern: `for select to authenticated using (user_id = app.current_user_id())`, `for insert to authenticated with check (user_id = app.current_user_id())`, `for update to authenticated using (...) with check (...)`, `for delete to authenticated using (...)`. The template is comments only — it must not be executed.

#### 3. RLS pattern reference doc

**File**: `supabase/README.md`

**Intent**: Single short markdown explaining the four-policy-per-table pattern, what `app.current_user_id()` does, and how to test a new RLS-scoped table. The prose complement to the executable migration; future agents read this before authoring a new table migration.

**Contract**: Sections — `## Why RLS here`, `## Helper functions` (links to the migration), `## Policy pattern` (the four-policy template with one fully-worked example using a fictional `notes` table), `## Adding a new table` (5-step checklist: name the migration `YYYYMMDDHHmmss_<feature>.sql`, define the table with `user_id uuid not null references auth.users (id) on delete cascade`, `enable row level security`, four policies, optional `updated_at` trigger, add a pgTAP test). Under 150 lines. CommonMark only.

#### 4. Sync AI-rules files to PRD v2

**File**: `CLAUDE.md`

**Intent**: Remove the "No database, no authentication" bullet from the PRD-locked rules (lifted by PRD v2 on 2026-05-28); replace with the v2 reality (Postgres + Supabase auth ARE in scope, gated by RLS); add a pointer to `supabase/README.md` for the RLS pattern. Other PRD-locked rules (determinism, no silent item drops, fairness threshold, bilingual, CommonMark) stay verbatim.

**Contract**: The `## ToySwapper — project context` section's "PRD-locked rules" subsection drops the "No database, no authentication" bullet and the line saying "The Supabase code shipped by the starter stays unused." A new bullet states: "RLS-scoped persistence is the v2 contract — every user-scoped table enables RLS with per-operation, per-role policies; see `supabase/README.md` for the pattern." The "Where the work lives" subsection adds `supabase/migrations/` to the list. The note "Do not add the ToySwapper pages to `PROTECTED_ROUTES`" is removed (S-01 will add them).

#### 5. Sync the second AI-rules file

**File**: `AGENTS.md`

**Intent**: Mirror the `CLAUDE.md` edits in `AGENTS.md` since both files declare overlapping rules and `AGENTS.md` is the contributor-facing version. Edits are textual, parallel to `CLAUDE.md`.

**Contract**: The "PRD-locked rules" section drops the "No database, no auth" bullet; new bullet points at `supabase/README.md` for the RLS pattern. No other rule lines change.

#### 6. Document local Supabase workflow

**File**: `README.md`

**Intent**: Add a short "Local Supabase development" section so a new contributor (or an agent looking at the repo cold) knows how to boot the local stack, apply migrations, reset the DB, and run pgTAP tests. Keeps the existing starter content intact above it.

**Contract**: New section before "Deploy" — bullets cover `npx supabase start` (boots Postgres on 54322, GoTrue on 54321, Studio on 54323), `npx supabase db reset` (re-applies all migrations + seeds), `npx supabase test db` (runs pgTAP tests; introduced in Phase 2 — note as forward reference), and a pointer to `supabase/README.md` for the RLS pattern. Note that `.dev.vars` must carry `SUPABASE_URL=http://127.0.0.1:54321` and `SUPABASE_KEY=<local anon key from `supabase start` output>` for the Workers dev server to talk to the local stack.

### Success Criteria:

#### Automated Verification:

- `supabase/migrations/20260529120000_rls_baseline.sql` exists and is the only file under `supabase/migrations/`
- `npx supabase start` boots the local stack cleanly (manual prerequisite for the rest)
- `npx supabase db reset` exits 0 — the migration applies without error from an empty schema
- After `db reset`, `psql` (or Studio) shows `app.current_user_id()` and `app.tg_set_updated_at()` exist and are `security invoker` with empty `search_path`
- `npm run lint` passes (no TS/ESLint code touched, but lint-staged hooks on docs run via prettier)
- `npm run build` still succeeds (no env / module changes break SSR build)

#### Manual Verification:

- `CLAUDE.md` and `AGENTS.md` read cleanly — no contradiction with `context/foundation/prd.md` v2
- `supabase/README.md` is readable cold by a new contributor; the four-policy template is the first thing visible
- A reviewer pulling the branch can run `npx supabase start && npx supabase db reset` and see `app.current_user_id()` returning `NULL` when called outside an auth context (sanity check: it doesn't crash)
- `.dev.vars` populated locally still drives `npm run dev` to a working v1 evaluator (no regression on FR-001..FR-011)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: RLS verification test

### Overview

Ship a pgTAP test under `supabase/tests/` that proves the four-policy template actually denies cross-user reads. The test creates two fake users in `auth.users`, switches role to `authenticated` while spoofing each user's JWT claims in turn, inserts a row as user A, and asserts user B sees zero rows. This makes the named verification path "RLS denial observable" from the roadmap entry into an executable invariant — and gives every downstream slice a copy-pasteable test pattern.

### Changes Required:

#### 1. pgTAP test for the RLS template

**File**: `supabase/tests/rls_template.test.sql`

**Intent**: Prove the helper-function-plus-four-policies pattern actually isolates user data, against a throwaway probe table the test creates and drops inside its own transaction. The test is the executable spec of the template documented in `supabase/README.md`.

**Contract**: A single pgTAP transaction with `begin; select plan(N); ... select * from finish(); rollback;` shape. Tests (in order):
1. `has_function('app', 'current_user_id')` and `has_function('app', 'tg_set_updated_at')` — helpers exist
2. `function_lang_is('app', 'current_user_id', 'sql')` and similar for the trigger function — language as designed
3. Probe table setup: `create temp table _rls_probe (id uuid primary key default gen_random_uuid(), user_id uuid not null, payload text); alter table _rls_probe enable row level security; create policy probe_select_own on _rls_probe for select to authenticated using (user_id = app.current_user_id()); create policy probe_insert_own on _rls_probe for insert to authenticated with check (user_id = app.current_user_id());`
4. Insert two test rows under two different JWT identities (each test block: `set local role authenticated; set local request.jwt.claims = '{"sub":"<uuid-a>"}'; insert into _rls_probe ... values (..., '<uuid-a>', ...);` then repeat with uuid-b)
5. `set local request.jwt.claims = '{"sub":"<uuid-a>"}'` → `select results_eq($$ select count(*) from _rls_probe $$, $$ values (1::bigint) $$, 'user A sees exactly their row')`
6. Same shape for user B → also 1
7. `set local role postgres` (superuser bypass) → `select results_eq(...)` returns 2 (sanity: rows exist; RLS is what's filtering)
8. Attempted cross-write: as user A, `insert into _rls_probe (user_id, payload) values ('<uuid-b>', 'x')` must raise → `throws_ok($$ ... $$, '42501', ...)` (insufficient_privilege from `with check`)

The probe table is `create temp table` so it never persists. `rollback` at the end is belt-and-braces.

#### 2. Optional convenience script

**File**: `package.json`

**Intent**: Make it idiomatic for a contributor (and CI) to run the DB test alongside `npm run lint` / `npm run build`. Single new script — no new dependency.

**Contract**: Add `"db:test": "supabase test db"` to the `scripts` block, alphabetized between existing scripts. No other package.json edits.

### Success Criteria:

#### Automated Verification:

- `supabase/tests/rls_template.test.sql` exists
- `npx supabase test db` exits 0 against the local stack (after `supabase start`)
- `npm run db:test` exits 0 (script alias works)
- The test file contains at least one assertion of each shape: `has_function`, `results_eq`, `throws_ok` (grep-verifiable)
- `npm run lint` still passes (no code paths touched)

#### Manual Verification:

- A reviewer can edit one policy in `20260529120000_rls_baseline.sql`'s commented template (in a scratch experiment branch), copy it into a real table in a temp test, deliberately break the `with check` clause, and observe the pgTAP test fail in the expected way
- The test runs in under 5 seconds locally — fast enough to not discourage running it on every change

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: CI/CD integration — lint, test, push

### Overview

Wire the Supabase CLI into GitHub Actions so that every PR is gated on `supabase db lint` + `supabase test db` and every push to master applies pending migrations via `supabase db push` against the production Supabase project. This closes the determinism contract: code and schema can never desync, because merge-to-master is the only path that mutates either, and it does both atomically.

### Changes Required:

#### 1. Extend CI with DB jobs

**File**: `.github/workflows/ci.yml`

**Intent**: Add Supabase CLI install + two new gated steps to the existing `ci` job (or split into a sibling `db` job that runs in parallel; the latter is cleaner). On PRs, run `supabase db lint` and `supabase test db` against an ephemeral local stack booted inside the runner. On pushes to master, additionally run `supabase db push` against the linked production project after the lint+test pass.

**Contract**: Two changes to the workflow:
1. New job `db` running on `ubuntu-latest`, parallel to the existing `ci` job. Steps: checkout → `supabase/setup-cli@v1` (official action, pin to v1) → `supabase db start` (boots local stack inside runner; Supabase action wraps Docker) → `supabase db lint --level warning` (fails on errors and warnings) → `supabase test db`.
2. New conditional step at the end of the `db` job, gated on `if: github.event_name == 'push' && github.ref == 'refs/heads/master'`: runs `supabase link --project-ref ${{ secrets.SUPABASE_PROJECT_REF }}` then `supabase db push --linked`. Requires secrets `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, and `SUPABASE_PROJECT_REF` (read by the CLI from env).

The existing `ci` job (lint + build) is untouched and still runs for both PR and push.

#### 2. Document the new repo secrets

**File**: `README.md`

**Intent**: The CI matrix expansion requires three new GitHub Actions secrets that the operator must set once. Document them next to the existing `SUPABASE_URL`/`SUPABASE_KEY` entries so they're discoverable.

**Contract**: Add to the existing CI / deploy section: a short subsection listing the three secrets, each with a one-line description (`SUPABASE_PROJECT_REF` — the prod project's ref, visible in the Supabase dashboard URL; `SUPABASE_ACCESS_TOKEN` — operator's personal access token from `https://supabase.com/dashboard/account/tokens`; `SUPABASE_DB_PASSWORD` — the prod project's DB password, set during project provisioning). Note that these secrets must be added before the next merge to master, or the `db push` step will fail and block deploys.

#### 3. Sync AGENTS.md to mention the CI contract

**File**: `AGENTS.md`

**Intent**: Surface the CI gate so future agents writing migrations know they will be linted, tested, and applied automatically.

**Contract**: One additional bullet under the existing build/test/dev section: "Migrations: every PR runs `supabase db lint` + `supabase test db`; merge to master runs `supabase db push` against prod. New migration files MUST follow `supabase/README.md` and ship with a pgTAP test."

### Success Criteria:

#### Automated Verification:

- `.github/workflows/ci.yml` defines a `db` job with `supabase/setup-cli@v1`, `db start`, `db lint`, and `test db` steps
- The `db push` step is conditional on `github.event_name == 'push' && github.ref == 'refs/heads/master'` (grep-verifiable in YAML)
- A new PR opened against master with a no-op markdown change passes both `ci` and `db` jobs
- A new PR opened against master with a deliberately broken migration (extra trailing semicolon or duplicate function definition) fails the `db lint` step

#### Manual Verification:

- Operator has set `SUPABASE_PROJECT_REF`, `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD` in the GitHub repo secrets before the first merge that triggers `db push`
- After merging the F-01 PR to master, the Actions log shows `supabase db push --linked` reporting "all migrations are up to date" or applying `20260529120000_rls_baseline.sql` exactly once
- Studio (cloud) shows the `app` schema with both helper functions after the first successful `db push`
- A subsequent PR introducing a new migration file (e.g., a probe migration that gets reverted) runs through PR lint+test → merge → push; the new migration is present in prod after the merge
- Operator has confirmed that the Supabase prod project's Postgres `major_version` matches the `17` declared in `supabase/config.toml`

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before declaring F-01 complete and the foundation ready to unlock F-02.

---

## Testing Strategy

### Unit Tests:

- Not applicable in the conventional sense — F-01 ships no application code, only SQL and config. The pgTAP test under `supabase/tests/` is the unit test for the policy template.

### Integration Tests:

- The pgTAP test IS the integration test for the RLS contract: it exercises the real helper functions against a real Postgres in a transaction. CI runs it on every PR.
- The CI `db lint` step catches schema-level integration issues (duplicate function defs, missing `security invoker`, syntax errors) before merge.

### Manual Testing Steps:

1. After Phase 1 lands locally, run `npx supabase start && npx supabase db reset`; open Studio at `http://127.0.0.1:54323` and verify the `app` schema exists with both helper functions, each marked `SECURITY INVOKER`.
2. From `psql`, run `select app.current_user_id();` as the `postgres` role — expect `NULL` (no JWT claim → `auth.uid()` returns null). This is the sanity check that helpers don't crash outside an auth context.
3. After Phase 2, run `npx supabase test db` and confirm all asserts pass; deliberately break one assertion in the test file (e.g., expect 2 rows for user A) and confirm the test correctly fails.
4. After Phase 3, open a throwaway PR with a no-op `.md` change and confirm both `ci` and `db` jobs run and pass. Open another PR with a deliberately broken migration (syntax error) and confirm the `db lint` step fails and blocks merge.
5. Run `npm run dev` after Phase 1 lands and confirm the v1 evaluator (`/api/evaluate`) still produces byte-identical output for a known fixture-pool input (determinism regression check — F-01 ships no app tables, so this should be a no-op).

## Performance Considerations

- The helpers are STABLE functions returning a single uuid; query planner inlines them inside RLS predicates and there is no per-row function-call overhead beyond what `auth.uid()` itself imposes.
- `db push` in CI adds ~10–30 seconds to the merge-to-master pipeline; acceptable given the determinism guarantee it buys.
- pgTAP tests run inside a single transaction and roll back at the end; no persistent state, no orphaned rows.

## Migration Notes

- The first migration is `20260529120000_rls_baseline.sql`. Treat the filename as immutable from the moment it lands on master. Subsequent fixes go in new timestamped migrations (e.g., `20260530090000_rls_baseline_fix.sql`).
- There is no v1 data to backfill — v1's only persisted state was Supabase auth users (if any signup tests were run), and `auth.*` schemas are Supabase-managed.
- Rollback strategy: if a downstream migration breaks against the helpers, drop and recreate the helpers in a new migration. Do not edit `20260529120000_rls_baseline.sql` post-merge.
- The `app` schema is owned by `postgres`; no GRANTs are required for `authenticated` or `anon` since they only consume the functions inside policies (RLS predicates run with the policy's invoker, and `security invoker` + `set search_path = ''` + schema-qualified calls handle access).

## References

- Roadmap entry: `context/foundation/roadmap.md#f-01-postgres--rls-baseline`
- PRD v2: `context/foundation/prd.md` — §Access Control, NFR on RLS, FR-016, FR-018
- Existing SSR client: `src/lib/supabase.ts:1-24`
- Existing middleware: `src/middleware.ts:1-26` (NOT modified in this change; S-01 will edit it)
- Supabase local config: `supabase/config.toml:5` (project_id), `:53-58` (migrations enabled), `:36` (Postgres 17)
- Existing CI workflow: `.github/workflows/ci.yml`
- Migration naming convention: `CLAUDE.md` → `YYYYMMDDHHmmss_short_description.sql`
- Supabase CLI test docs: `supabase test db` and pgTAP usage (Supabase docs)
- Roadmap NFR on determinism preservation across v1→v2: `context/foundation/prd.md` §Non-Functional Requirements

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Local Supabase wiring + first migration

#### Automated

- [x] 1.1 `supabase/migrations/20260529120000_rls_baseline.sql` exists and is the only file under `supabase/migrations/` — bf21952
- [x] 1.2 `npx supabase start` boots the local stack cleanly
- [x] 1.3 `npx supabase db reset` exits 0 — the migration applies without error from an empty schema
- [x] 1.4 After `db reset`, `app.current_user_id()` and `app.tg_set_updated_at()` exist and are `security invoker` with empty `search_path`
- [x] 1.5 `npm run lint` passes — bf21952
- [x] 1.6 `npm run build` still succeeds — bf21952

#### Manual

- [x] 1.7 `CLAUDE.md` and `AGENTS.md` read cleanly — no contradiction with PRD v2
- [x] 1.8 `supabase/README.md` is readable cold by a new contributor; the four-policy template is the first thing visible
- [x] 1.9 A reviewer can run `npx supabase start && npx supabase db reset` and see `app.current_user_id()` returning `NULL` when called outside an auth context
- [x] 1.10 `.dev.vars` populated locally still drives `npm run dev` to a working v1 evaluator (no regression on FR-001..FR-011)

### Phase 2: RLS verification test

#### Automated

- [ ] 2.1 `supabase/tests/rls_template.test.sql` exists
- [ ] 2.2 `npx supabase test db` exits 0 against the local stack
- [ ] 2.3 `npm run db:test` exits 0 (script alias works)
- [ ] 2.4 Test file contains at least one assertion of each shape: `has_function`, `results_eq`, `throws_ok`
- [ ] 2.5 `npm run lint` still passes

#### Manual

- [ ] 2.6 A reviewer can deliberately break a policy and observe the pgTAP test fail in the expected way
- [ ] 2.7 The test runs in under 5 seconds locally

### Phase 3: CI/CD integration — lint, test, push

#### Automated

- [ ] 3.1 `.github/workflows/ci.yml` defines a `db` job with `supabase/setup-cli@v1`, `db start`, `db lint`, and `test db` steps
- [ ] 3.2 The `db push` step is conditional on `github.event_name == 'push' && github.ref == 'refs/heads/master'`
- [ ] 3.3 A no-op PR passes both `ci` and `db` jobs
- [ ] 3.4 A PR with a deliberately broken migration fails the `db lint` step

#### Manual

- [ ] 3.5 Operator has set `SUPABASE_PROJECT_REF`, `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD` in repo secrets before the first merge that triggers `db push`
- [ ] 3.6 After merging F-01 to master, the Actions log shows `supabase db push --linked` succeeding
- [ ] 3.7 Studio (cloud) shows the `app` schema with both helper functions after the first successful `db push`
- [ ] 3.8 A subsequent PR with a new migration file runs through PR lint+test → merge → push and the migration is present in prod
- [ ] 3.9 Operator has confirmed prod Postgres `major_version` matches the `17` in `supabase/config.toml`
