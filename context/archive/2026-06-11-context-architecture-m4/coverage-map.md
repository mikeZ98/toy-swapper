# Coverage map — context redistribution (zero-loss audit)

Maps every rule/section from the **original** root files (`CLAUDE.md` @ 81 lines, `AGENTS.md` @ 39 lines, recoverable at `git show b122e8e~1:CLAUDE.md` / `b122e8e~1:AGENTS.md`) to its home in the decentralized layout. Destinations: **conventions.md** (`context/foundation/conventions.md`), **lib** (`src/lib/CLAUDE.md`), **api** (`src/pages/api/CLAUDE.md`), **root** (slimmed `CLAUDE.md` / `AGENTS.md`), or **dropped** (intentional — duplicate or stale).

## Original CLAUDE.md (81 lines)

| Original section / rule | New home | Notes |
|---|---|---|
| `# Rules for AI` + intro line | root `CLAUDE.md` | Retained verbatim. |
| `## ToySwapper — project context` intro paragraph | root `CLAUDE.md` (+ conventions.md) | Identity kept at root; conventions.md carries an equivalent project-context header. |
| `### PRD-locked rules` — no realtime/images/multi-party/scraping | conventions.md | |
| `### PRD-locked rules` — RLS is the data-layer contract | conventions.md | Delegation to `supabase/README.md` preserved. |
| `### PRD-locked rules` — determinism is binding | conventions.md | **Reconciled:** FR-017 (seeded counterparties) + FR-018 (persisted contracts) byte-identical clauses made explicit per PRD §NFR. |
| `### PRD-locked rules` — migrations immutable | conventions.md | |
| `### PRD-locked rules` — no silent item drops (FR-004) | conventions.md | |
| `### PRD-locked rules` — fairness threshold relative (FR-009) | conventions.md | **Reconciled:** v1 20% `FAIRNESS_THRESHOLD_PCT` default added per OQ-3. |
| `### PRD-locked rules` — bidirectional match (US-01) | conventions.md | |
| `### PRD-locked rules` — single counterparty per run (FR-008) | conventions.md | |
| `### PRD-locked rules` — bilingual / CommonMark / ≤5s | conventions.md | |
| `### Where the work lives` — `fixture-pool.ts` | dropped (stale) | F-02 deleted the module; current reality (`counterparties.ts`) is in **lib**. |
| `### Where the work lives` — `evaluator.ts` pipeline | lib | |
| `### Where the work lives` — `api/evaluate.ts` | api | |
| `### Where the work lives` — `index.astro` form | dropped | Page-level detail; not in scope for the two nested folders. Discoverable from the file tree. |
| `### Where the work lives` — supabase auth wiring + "not yet gating / S-01" | root `CLAUDE.md` (auth-flow map) | **Stale claim fixed:** S-01 shipped gating; the "not yet gating" line was dropped. |
| `### Where the work lives` — `supabase/migrations/` → README | api/lib + root pointers | Pointer to `supabase/README.md` retained in root + AGENTS index. |
| `## Commands` | conventions.md | |
| `## Architecture` intro (Astro SSR stack one-liner) | root `CLAUDE.md` | Kept as orientation. |
| `### Rendering mode` (`output: "server"`, `prerender = false`) | conventions.md | Under "Repo-wide conventions"; api specifics also in **api**. |
| `### Auth flow` (supabase.ts, middleware, auth pages/endpoints) | root `CLAUDE.md` (auth-flow map) | Cross-folder; kept at root. |
| `### Key conventions` (path alias, Astro/React, cn(), shadcn, api, migrations, hooks, services, types) | conventions.md | Folder-specific slices also echoed in **lib**/**api**. |
| `### Environment` | conventions.md | |
| `## CI` | conventions.md | Superseded by the fuller AGENTS.md CI text (see below). |

## Original AGENTS.md (39 lines)

| Original section / rule | New home | Notes |
|---|---|---|
| `# Repository Guidelines` intro paragraph | root `AGENTS.md` | Retained verbatim. |
| `## PRD-locked rules` (full list) | conventions.md | Reconciled into the single canonical copy. |
| `## Build, Test, and Development Commands` | conventions.md | `localhost:4321` port + lint-staged detail preserved. |
| `## Project Structure & Conventions` | conventions.md | api/lib slices also in nested files. |
| `## Commits & CI` (two-job CI, `db` job, `supabase db push`, conventional commits) | conventions.md | **This fuller version won** the reconciliation over CLAUDE.md's shorter `## CI`. |
| Closing `see @CLAUDE.md for depth` pointer | root `AGENTS.md` (folder index) | Replaced by the explicit folder-level context index. |

## Result

Every original rule lands in exactly one canonical home, or is an explicit, justified drop (stale `fixture-pool.ts` reference, the "not yet gating" stale claim, and the page-level `index.astro` line). No PRD invariant was lost; the two diverged rules (determinism FR-017/018, fairness default) were reconciled to PRD wording. `supabase/README.md` was untouched.
