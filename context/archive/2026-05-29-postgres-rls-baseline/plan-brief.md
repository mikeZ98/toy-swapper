# Postgres + RLS Baseline — Plan Brief

> Full plan: `context/changes/postgres-rls-baseline/plan.md`
> Roadmap entry: `context/foundation/roadmap.md#f-01-postgres--rls-baseline`

## What & Why

Land the data-layer foundation for ToySwapper v2: make Postgres reachable from the Cloudflare Workers runtime, ship the first migration (RLS helpers + a commented policy template — no app tables), prove the RLS contract with an automated pgTAP test, and wire migrations into the CI/CD pipeline. F-02 (counterparty pool), S-02 (give/want persistence), and S-03 (history) all rest on this foundation; the roadmap's named verification path "RLS denial is observable in prod" originates here.

## Starting Point

The Supabase SSR client is wired (`src/lib/supabase.ts:5-24`) and the auth API routes use it, but no app code touches Postgres. `supabase/migrations/` does not exist; `supabase/config.toml` still has the starter's default `project_id`; CI passes `SUPABASE_URL`/`SUPABASE_KEY` secrets to the build but never runs DB commands. `CLAUDE.md` and `AGENTS.md` still declare "No database, no auth" as PRD-locked rules — PRD v2 lifted both on 2026-05-28.

## Desired End State

`supabase/migrations/<timestamp>_rls_baseline.sql` exists and applies cleanly to local + prod; an `app` schema holds two reusable helpers (`current_user_id()`, `tg_set_updated_at()`); `supabase/README.md` documents the four-policy-per-table pattern with a worked example; `supabase/tests/rls_template.test.sql` proves cross-user reads are denied; every PR is gated on `supabase db lint` + `test db`, every merge to master runs `supabase db push` against prod. The v1 evaluator keeps working unchanged — no app tables ship in this change.

## Key Decisions Made

| Decision                              | Choice                                                                                                    | Why (1 sentence)                                                                                                                                                            | Source |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Scope of F-01                         | Cross-cutting helpers + RLS template; no app tables                                                       | Roadmap Risk says per-table migrations belong to their owning slice (F-02/S-02/S-03) — keeps F-01 immutable and downstream slices unblocked                                  | Roadmap |
| First migration contents              | `app` schema with `current_user_id()` + `tg_set_updated_at()` + commented policy template                 | Reusable helpers make downstream RLS policies one-liners; quality main_goal benefits from a DB-enforced consistency contract                                                 | Plan   |
| RLS template format                   | Both — executable helpers in migration + short prose in `supabase/README.md`                              | Future agents need both the code-grounded copy-paste and the prose WHY; lessons.md doesn't exist yet to fill the prose gap                                                   | Plan   |
| Migration application strategy        | CI-applied on merge to master; `db lint` + `test db` on PRs                                               | Migrations and code can never desync; quality bias rejects the "operator forgot to push" failure mode                                                                        | Plan   |
| Local dev DB                          | Docker via `npx supabase start` (required)                                                                | Hermetic, free, RLS testable end-to-end; matches the existing `supabase/config.toml`                                                                                         | Plan   |
| RLS verification path                 | pgTAP test (`supabase test db`) against local Docker stack                                                | Turns the policy template into an executable invariant; satisfies the roadmap's named "RLS denial observable" path independently of F-03 (logging)                           | Plan   |
| Migration filename                    | `20260529120000_rls_baseline.sql`                                                                         | Today's date; treated as immutable from the moment it lands — fixes go in new timestamped migrations (determinism contract)                                                  | Plan   |
| Defense-in-depth on helpers           | `security invoker` + `set search_path = ''` + schema-qualified `auth.uid()`                               | RLS helpers MUST run as the caller and resist schema-poisoning; default plpgsql security-definer would silently bypass RLS                                                   | Plan   |

## Scope

**In scope:**
- `supabase/migrations/20260529120000_rls_baseline.sql` (helpers + commented template)
- `supabase/README.md` (RLS pattern doc with one worked example)
- `supabase/tests/rls_template.test.sql` (pgTAP proof of the contract)
- `supabase/config.toml` project_id rename
- `.github/workflows/ci.yml` extended with a `db` job
- `CLAUDE.md` + `AGENTS.md` synced to PRD v2 (drop "no DB, no auth" lines; point at `supabase/README.md`)
- `README.md` updated with local Supabase workflow and new repo secrets
- `package.json` script alias `db:test`

**Out of scope:**
- App tables (`user_lists`, `counterparties`, `evaluations`) — belong to S-02 / F-02 / S-03
- `Database<T>` generated types — defer to S-02
- Cloudflare deploy automation
- Anonymous-demo path decisions (OQ-5; blocks S-01)
- Save-granularity decisions (OQ-4; blocks S-02)
- Env-schema changes (`SUPABASE_URL`/`KEY` already wired)
- Backfill / data migration (no prior data to move)

## Architecture / Approach

```
                +--------------------------------------------+
local dev:      | npx supabase start  ->  Postgres 17        |
                |                         (local: 54322)      |
                |                                              |
                | npx supabase db reset                        |
                |   └─ applies migrations/20260529120000_*.sql |
                |        └─ creates app.current_user_id(),     |
                |           app.tg_set_updated_at(),           |
                |           + commented RLS policy template    |
                |                                              |
                | npx supabase test db                         |
                |   └─ runs tests/rls_template.test.sql        |
                |        └─ pgTAP: helpers exist, denial works |
                +--------------------------------------------+

CI (GitHub Actions, new `db` job alongside existing `ci` job):
  on PR:          checkout → setup-cli → db start → db lint → test db
  on push master: ... → db lint → test db → link --project-ref → db push --linked

App code (this change): zero diff. SSR client + auth routes already exist.
```

The data layer becomes a separate-but-parallel CI track; the existing `ci` (lint + build) job is untouched and continues to gate code. The `db push` step runs only on merge to master, atomic with that merge.

## Phases at a Glance

| Phase                                          | What it delivers                                                                                                              | Key risk                                                                                                              |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 1. Local Supabase wiring + first migration     | `app` schema with helpers, commented RLS template, `supabase/README.md`, AI-rules files synced to v2, local dev workflow docs | Getting the helper function semantics wrong (`security definer` vs `invoker`, leaky search_path) silently bypasses RLS |
| 2. RLS verification test                       | `supabase/tests/rls_template.test.sql` proving cross-user reads are denied; `npm run db:test` script alias                    | pgTAP role-switching + JWT-claim spoofing has subtle gotchas; a flaky test erodes trust in the contract                |
| 3. CI/CD integration — lint, test, push        | New GitHub Actions `db` job; `db push` gated to merge-to-master; three new repo secrets documented                            | A broken migration blocks deploys until reverted; missing secrets fail the first push silently if not pre-provisioned  |

**Prerequisites:** Docker installed (for local Supabase stack); Supabase prod project provisioned (already true — CI carries `SUPABASE_URL`/`KEY` secrets); operator has access to the Supabase prod project to pull `SUPABASE_PROJECT_REF`, generate `SUPABASE_ACCESS_TOKEN`, and retrieve `SUPABASE_DB_PASSWORD`.
**Estimated effort:** ~1–2 after-hours sessions across 3 phases; foundation work, no UI.

## Open Risks & Assumptions

- **Prod Postgres major_version must match `17` declared in `config.toml`.** If the prod project was provisioned earlier on Postgres 15, the `db push` step will fail. Operator confirms in Phase 3 manual verification.
- **Three new repo secrets must be set before the first merge to master.** Without them, `db push` fails and blocks the deploy. Documented in README; phase 3 manual checklist.
- **OQ-2 (overlap definition for matching) sits underneath F-02's determinism guarantee.** Not blocking F-01, but F-02 may surface a follow-on question that retroactively touches the helpers — acceptable risk.
- **The migration filename is treated as immutable from merge.** If a fix is needed post-merge, it ships as a new timestamped migration — not an edit. This is the determinism contract; we accept the slight friction.

## Success Criteria (Summary)

- A new contributor running `npx supabase start && npx supabase db reset && npx supabase test db` against a clean checkout exits 0 on all three commands.
- A merge to master successfully applies `20260529120000_rls_baseline.sql` to the prod Supabase project, visible in Studio as the `app` schema with both helper functions.
- The v1 evaluator (`/api/evaluate` against `src/lib/fixture-pool.ts`) produces byte-identical output before and after this change — F-01 ships no app tables, so determinism is preserved by construction.
