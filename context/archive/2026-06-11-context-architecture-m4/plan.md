# Context Architecture m4 — Decentralized Folder-Level Context Implementation Plan

## Overview

Transition ToySwapper's agent-context from a root monolith — two overlapping files (`CLAUDE.md`, `AGENTS.md`) that restate the same PRD-locked rules and repo conventions — into a decentralized, folder-level layout. A single canonical `context/foundation/conventions.md` holds the shared core (PRD invariants + repo-wide conventions); nested `CLAUDE.md` files carry folder-specific context for `src/lib/` and `src/pages/api/`; the root files slim to thin shells that reference the canonical body. This is the m4l1 "context scaling" pattern applied to the repo, using the already-decentralized `supabase/README.md` as the in-repo model.

## Current State Analysis

The repo carries two root agent-rules files plus one already-decentralized domain file:

- **`CLAUDE.md` (81 lines)** — sections: ToySwapper project context, `### PRD-locked rules (do not violate)`, `### Where the work lives` (a file-by-file inventory of `src/lib` + `src/pages/api` + supabase), `## Commands`, `## Architecture` (rendering mode, auth flow, `### Key conventions`, `### Environment`), `## CI`.
- **`AGENTS.md` (39 lines)** — sections: identity paragraph, `## PRD-locked rules (do not violate)`, `## Build, Test, and Development Commands`, `## Project Structure & Conventions`, `## Commits & CI`. Ends pointing to `@CLAUDE.md` for Astro/Supabase/shadcn depth.
- **`supabase/README.md` (148 lines)** — already a folder-level context file for the data layer (RLS contract, helper functions, four-policy template, worked shared-table example, checklist). This is the decentralization model to mirror; it is **not modified** by this change.

**Duplication / drift surface** (the problem this change dissolves):

| Topic | In `CLAUDE.md` | In `AGENTS.md` | Drift status |
|---|---|---|---|
| PRD-locked rules | full `### PRD-locked rules` | full `## PRD-locked rules` | **Already diverged** — AGENTS.md folds FR-017/FR-018 byte-identical clauses into the determinism rule; CLAUDE.md states the fairness default is "set during implementation" while AGENTS.md says "X configurable (FR-009)". Same rule, two phrasings. |
| Build/test commands | `## Commands` | `## Build, Test, and Development Commands` | Both list dev/build/lint/format; AGENTS.md adds the `localhost:4321` port + lint-staged detail. |
| Structure / conventions | `### Key conventions` | `## Project Structure & Conventions` | Both restate API-route rules, `src/lib`, shadcn new-york, `@/*` alias, `src/types.ts`. |
| RLS deep detail | delegates to `@supabase/README.md` | delegates to `@supabase/README.md` | Already decentralized ✓ — the pattern to extend. |
| File inventory | `### Where the work lives` | — | CLAUDE.md only; belongs nested per-folder. |
| CI specifics | `## CI` (lint+build, secrets) | `## Commits & CI` (adds `db` job, `supabase db push`, conventional commits) | AGENTS.md is the fuller/more current CI description. |

**Code surface for nested files:**
- `src/lib/` — 10 modules: `auth-log.ts`, `config-status.ts`, `counterparties.ts`, `evaluation-history.ts`, `evaluator.ts`, `log.ts`, `redirect.ts`, `supabase.ts`, `user-lists.ts`, `utils.ts`. (No `src/lib/services/` exists yet, though CLAUDE.md references it as a convention.)
- `src/pages/api/` — `evaluate.ts` + `auth/{signin,signup,signout}.ts`.

**Two-tool constraint:** both `.claude/.10x-cli-manifest.json` and `.cursor/.10x-cli-manifest.json` exist — the repo is targeted by Claude Code and Cursor, which is why root keeps both `CLAUDE.md` and `AGENTS.md`.

## Desired End State

```
context/foundation/conventions.md   ← canonical: PRD invariants + repo-wide conventions
CLAUDE.md                           ← thin shell: identity + @context/foundation/conventions.md import + Claude-specific framing
AGENTS.md                           ← thin shell: identity + prose pointer to conventions.md + cross-tool framing
src/lib/CLAUDE.md                   ← folder principles + concise module map; points up to conventions.md
src/pages/api/CLAUDE.md             ← route contract + concise route map; points up to conventions.md
supabase/README.md                  ← UNCHANGED (the model)
```

**Verification of end state:** every rule/section present in the original root files is traceable to exactly one new home via a coverage mapping table (Phase 4); no PRD invariant is lost or reworded away from its PRD meaning; Claude Code still surfaces the global rules at the root and the folder rules when touching `src/lib/` or `src/pages/api/`.

### Key Discoveries:

- `supabase/README.md:1` is a working folder-level context file — replicate its shape (prose conventions + worked examples + checklist), not invent a new one.
- The PRD-rules divergence between the two root files is real (`AGENTS.md:9` vs `CLAUDE.md` determinism line) — Phase 1 must reconcile against `context/foundation/prd.md` §NFR + §Success Criteria, not blindly union.
- `@`-import (auto-inlining) is a `CLAUDE.md` feature; `AGENTS.md` uses a read-pointer. The two root files reference the same canonical body through format-appropriate mechanisms.
- `src/lib/services/` is referenced as a convention in CLAUDE.md but does not exist on disk — the nested `src/lib/CLAUDE.md` should phrase it as "extract to `src/lib/services/` when business logic grows", not as an existing location.

## What We're NOT Doing

- **Not modifying `supabase/README.md`** — it is already the decentralized model and stays as-is.
- **Not changing any application code, migrations, or behavior** — this is a documentation/context refactor only.
- **Not adding nested `AGENTS.md`** in `src/lib/`/`src/pages/api/` — the chosen nested format is `CLAUDE.md` (Cursor will still read the root `AGENTS.md` + conventions.md).
- **Not creating nested context for other folders** (`src/components/`, `src/pages/auth/`, root `src/pages/`) — scope is `src/lib/` and `src/pages/api/` only.
- **Not editing the PRD, roadmap, or any foundation doc other than creating `conventions.md`** — those are read-only sources of truth here.
- **Not touching the `.cursor` or `.claude` manifests** beyond the Phase 4 `change.md` status sync.
- **Not resolving the PRD's open questions** (OQ-1…OQ-6) — conventions.md records the locked rules, not the open ones.

## Implementation Approach

Bottom-up content flow: first establish the canonical body (Phase 1), then write the folder-level files that reference it (Phase 2), then hollow out the root files to reference it (Phase 3) — so at no point does a root file point at a conventions.md that doesn't exist yet. Phase 4 audits the whole redistribution against the original root files via a coverage mapping table. Content is moved and reconciled, never invented: every line in the new layout traces to an original root-file line or to a PRD/roadmap source used to settle a divergence.

## Critical Implementation Details

- **Reconciliation tiebreaker:** where the two root files disagree, `context/foundation/prd.md` and `context/foundation/roadmap.md` are authoritative. The fairness-threshold wording resolves to PRD FR-009 (relative threshold, X configurable, default set during implementation — v1 used 20% per OQ-3); the determinism rule resolves to PRD §NFR including the FR-017 (byte-identical seeded counterparties) and FR-018 (byte-identical persisted contracts) clauses, since the PRD carries both.
- **Import mechanics differ by file:** root `CLAUDE.md` uses `@context/foundation/conventions.md` (auto-inlined by Claude Code). Root `AGENTS.md` and the nested `CLAUDE.md` files use a markdown reference/pointer (read, not auto-inlined). Do not write `@`-imports into `AGENTS.md` expecting inlining.
- **Ordering requirement:** create `conventions.md` (Phase 1) before editing any file that references it (Phases 2–3), or the references dangle.

## Phase 1: Extract canonical conventions.md

### Overview

Create `context/foundation/conventions.md` as the single source of truth for the shared core — PRD-locked invariants plus repo-wide conventions — reconciling the two diverged root copies against the PRD/roadmap.

### Changes Required:

#### 1. Canonical conventions file

**File**: `context/foundation/conventions.md` (new)

**Intent**: Hold every rule that is global (applies repo-wide, not folder-specific): the PRD-locked invariants and the cross-cutting conventions (commands, path alias, `src/types.ts`, shadcn variant, React/Astro split, CI gates). This becomes the body both root files reference. Folder-specific guidance and the per-file inventory are deliberately excluded — they go to the nested files.

**Contract**: Markdown document with these sections:
- A short header noting it is the canonical shared context referenced by `CLAUDE.md`, `AGENTS.md`, and the nested folder files.
- `## PRD-locked rules (do not violate)` — the reconciled invariant list: no-realtime/images/multi-party/scraping; RLS four-policy contract (delegating depth to `supabase/README.md`); determinism (temperature 0 + seed, or cache, or rule-based fallback) including the FR-017 seeded-counterparty and FR-018 persisted-contract byte-identical clauses; immutable migrations; no silent item drops (FR-004); relative fairness threshold (FR-009, X configurable, v1 default 20%); bilingual PL+EN CommonMark output ≤5s for ≤10 counterparties; bidirectional match criterion (US-01); single counterparty per run (FR-008).
- `## Commands` — dev (`npm run dev`, port 4321), build, preview, lint, lint:fix, format, plus the husky + lint-staged note.
- `## Repo-wide conventions` — path alias `@/*` → `./src/*`; shared types in `src/types.ts`; shadcn new-york variant in `src/components/ui/`; React only for interactivity, hooks in `src/components/hooks/`; no Next.js directives; SSR `output: "server"`, API routes `export const prerender = false` + uppercase exports + zod validation; `cn()` for class merging.
- `## Environment` — Node 22.14.0, env vars (`SUPABASE_URL`/`SUPABASE_KEY`, `OPENAI_API_KEY` via `astro:env/server`), local Supabase + Cloudflare `.dev.vars`, deploy via wrangler.
- `## CI` — the reconciled (fuller AGENTS.md) description: two jobs (`ci`: lint+build with `SUPABASE_URL`/`SUPABASE_KEY`; `db`: Postgres + `supabase db lint` + `supabase test db`), `supabase db push` on merge to master, conventional-commit preference.
- Cross-reference line pointing to `supabase/README.md` for the data-layer contract depth.

### Success Criteria:

#### Automated Verification:

- File exists: `test -f context/foundation/conventions.md`
- Markdown is well-formed (no broken headings): `npx prettier --check context/foundation/conventions.md`
- No dangling self-references / placeholder tokens: `! grep -nE 'TODO|TBD|<.*>' context/foundation/conventions.md`

#### Manual Verification:

- Every PRD-locked rule from both original root files appears exactly once, with the diverged ones (fairness default, determinism FR-017/018 clauses) matching the PRD wording.
- No folder-specific guidance (per-file inventory, `src/lib`/`api` module detail) leaked in — those are reserved for Phase 2.
- A reader unfamiliar with the project gets the full global picture from this one file.

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 2: Nested folder context files

### Overview

Author `src/lib/CLAUDE.md` and `src/pages/api/CLAUDE.md` — folder-scoped principles plus a concise one-line-per-module map — each pointing up to `conventions.md` for the global rules.

### Changes Required:

#### 1. Library folder context

**File**: `src/lib/CLAUDE.md` (new)

**Intent**: Orient an agent working in `src/lib/`: the folder holds services/helpers; carry the determinism boundary reminder (the evaluator pipeline is the determinism-critical path) and the "extract to `src/lib/services/` as business logic grows" convention. Provide a concise module map so an agent knows where each concern lives without reading every file.

**Contract**: Markdown with: a one-line "see `context/foundation/conventions.md` for global rules" pointer at top; a `## Conventions` section (services/helpers placement, determinism reminder for `evaluator.ts`, no raw user input/output logged); and a `## Module map` listing each present module with a one-line responsibility — `evaluator.ts` (standardize→value→match→fairness→Markdown pipeline), `counterparties.ts` (DB read of seeded pool), `evaluation-history.ts`, `user-lists.ts`, `supabase.ts` (SSR client), `log.ts`/`auth-log.ts` (structured logging), `config-status.ts`, `redirect.ts`, `utils.ts` (`cn()`). Phrase `src/lib/services/` as a future location, not an existing one.

#### 2. API routes folder context

**File**: `src/pages/api/CLAUDE.md` (new)

**Intent**: Orient an agent working in `src/pages/api/`: the route contract every endpoint follows, plus what each route does. Capture the auth-gate behavior and the determinism/logging constraints specific to the endpoints.

**Contract**: Markdown with: top pointer to `conventions.md`; a `## Route contract` section (uppercase `GET`/`POST` exports, `export const prerender = false`, zod input validation, auth gating — `POST /api/evaluate` returns `401 {"error":"unauthorized"}` without a session, `evaluate.ts` reads `OPENAI_API_KEY` via `astro:env/server` and falls back to a deterministic stub when absent, no raw user input/output logged in prod paths); and a `## Route map` — `evaluate.ts` (gated evaluator endpoint), `auth/signin.ts`, `auth/signup.ts`, `auth/signout.ts`.

### Success Criteria:

#### Automated Verification:

- Both files exist: `test -f src/lib/CLAUDE.md && test -f src/pages/api/CLAUDE.md`
- Markdown well-formed: `npx prettier --check src/lib/CLAUDE.md src/pages/api/CLAUDE.md`
- Module map matches reality — no listed module is absent and no present module is unlisted: cross-check `ls src/lib` and `find src/pages/api -type f` against the maps.

#### Manual Verification:

- Each nested file references conventions.md and does NOT restate global rules verbatim (points up instead of duplicating).
- The `src/lib/services/` mention reads as a future convention, not a claim the dir exists.
- An agent could land in either folder and know the local contract + where each file's concern lives.

**Implementation Note**: Pause for manual confirmation after automated verification passes before proceeding.

---

## Phase 3: Slim the root monolith

### Overview

Reduce `CLAUDE.md` and `AGENTS.md` to thin shells: project identity + reference to `conventions.md` + only genuinely tool-specific or top-level framing. Delete the duplicated PRD-rules, commands, and conventions bodies now owned by conventions.md, and relocate the file-inventory content (already captured in Phase 2's nested maps).

### Changes Required:

#### 1. Slim root CLAUDE.md

**File**: `CLAUDE.md` (edit)

**Intent**: Keep the ToySwapper identity/orientation paragraph and `@`-import the canonical body; drop the duplicated `### PRD-locked rules`, `## Commands`, `### Key conventions`, `### Environment`, `## CI` bodies (now in conventions.md) and the `### Where the work lives` inventory (now in the nested files). Retain pointers to the nested files and to `supabase/README.md`.

**Contract**: Resulting `CLAUDE.md` contains: the project-context intro, an `@context/foundation/conventions.md` import line, brief pointers to `src/lib/CLAUDE.md` / `src/pages/api/CLAUDE.md` / `supabase/README.md`, and any Claude-Code-specific framing not in conventions.md. Net effect: substantially shorter, zero rule bodies duplicated from conventions.md.

#### 2. Slim root AGENTS.md

**File**: `AGENTS.md` (edit)

**Intent**: Keep the identity paragraph and replace the duplicated rule/command/structure/CI bodies with a prose pointer to `context/foundation/conventions.md` (read-pointer, not `@`-import). Retain the cross-tool framing and pointers to the nested folder files.

**Contract**: Resulting `AGENTS.md` contains: the "Repository Guidelines" intro paragraph, a clear pointer line directing readers to `context/foundation/conventions.md` for PRD rules + commands + conventions + CI, pointers to `src/lib/CLAUDE.md` / `src/pages/api/CLAUDE.md` / `supabase/README.md`, and nothing that re-states a conventions.md rule body.

### Success Criteria:

#### Automated Verification:

- `CLAUDE.md` contains the import: `grep -q 'context/foundation/conventions.md' CLAUDE.md`
- `AGENTS.md` points to conventions: `grep -q 'context/foundation/conventions.md' AGENTS.md`
- Both root files shrank materially: `wc -l CLAUDE.md AGENTS.md` (expect both well below current 81 / 39).
- Prettier clean: `npx prettier --check CLAUDE.md AGENTS.md`
- No orphaned duplication of a canonical rule body: spot-grep that the determinism/RLS rule prose no longer appears verbatim in both root files AND conventions.md.

#### Manual Verification:

- Claude Code loads `CLAUDE.md` → conventions.md is inlined; the global rules still reach the agent at the repo root.
- `AGENTS.md` still reads as a coherent standalone onboarding doc for a Cursor/other-tool agent (pointer is followable).
- Nothing a contributor needs day-to-day was lost from the root view (commands findable in ≤1 hop).

**Implementation Note**: Pause for manual confirmation after automated verification passes before proceeding.

---

## Phase 4: Verify redistribution & sync

### Overview

Prove zero rule loss via a coverage mapping table, confirm contextual loading, and sync the change record.

### Changes Required:

#### 1. Coverage mapping table

**File**: `context/changes/context-architecture-m4/coverage-map.md` (new)

**Intent**: For every rule/section in the *original* `CLAUDE.md` + `AGENTS.md` (recovered from git), record its new home (conventions.md / `src/lib/CLAUDE.md` / `src/pages/api/CLAUDE.md` / retained-in-root / intentionally-dropped-as-duplicate) so the redistribution is auditable and any gap is caught.

**Contract**: A markdown table with columns: Original rule/section · Original file · New home · Notes. Built by diffing the original root files (`git show HEAD:CLAUDE.md`, `git show HEAD:AGENTS.md`) against the new layout. Every original line item maps to a destination or an explicit "dropped (duplicate of X)" note.

#### 2. Change record sync

**File**: `context/changes/context-architecture-m4/change.md` (edit)

**Intent**: Reflect completion state per the 10x convention.

**Contract**: `status` advanced appropriately and `updated` set to the implementation date.

### Success Criteria:

#### Automated Verification:

- Coverage map exists: `test -f context/changes/context-architecture-m4/coverage-map.md`
- No invariant keyword orphaned — each of {determinism, Row-Level Security / RLS, immutable migrations, couldn't classify, fairness, CommonMark, bidirectional} resolves somewhere in the new layout: `grep -rl <keyword> context/foundation/conventions.md src/lib/CLAUDE.md src/pages/api/CLAUDE.md CLAUDE.md AGENTS.md`
- Full build still green (sanity — no doc change broke tooling): `npm run build`

#### Manual Verification:

- Every row in the coverage map has a destination; no "lost" rule.
- Open `src/lib/` work in a fresh Claude Code session and confirm the nested `CLAUDE.md` surfaces; same for `src/pages/api/`.
- A diverged rule (fairness default, FR-017/018 determinism clauses) reads identically to the PRD in its single canonical home.

**Implementation Note**: Final phase — confirm the coverage map is complete and contextual loading works before considering the change done.

---

## Testing Strategy

This is a documentation/context refactor; "tests" are structural and content-completeness checks rather than unit tests.

### Structural checks:
- File existence and prettier-formatting for all new/edited markdown.
- Module/route maps match the actual filesystem.

### Content-completeness checks:
- Coverage mapping table (Phase 4) — every original rule traces to a destination.
- Invariant keyword grep across the new layout.

### Manual Testing Steps:
1. Fresh Claude Code session at repo root — confirm `CLAUDE.md` + inlined conventions.md give the global rules.
2. Touch a file under `src/lib/` — confirm `src/lib/CLAUDE.md` context surfaces.
3. Touch a file under `src/pages/api/` — confirm `src/pages/api/CLAUDE.md` context surfaces.
4. Read `AGENTS.md` as a cross-tool agent would — confirm the conventions.md pointer is followable and nothing critical is missing.
5. Spot-check the fairness/determinism diverged rules against `prd.md` for fidelity.

## Migration Notes

No data or code migration. The only "migration" is content relocation; the original root files are recoverable from git history (`HEAD:CLAUDE.md`, `HEAD:AGENTS.md`) for the Phase 4 audit. `supabase/migrations/` and the immutable-migration rule are untouched.

## References

- Change folder: `context/changes/context-architecture-m4/`
- Canonical sources for reconciliation: `context/foundation/prd.md` (§NFR, §Success Criteria, FR-009/017/018), `context/foundation/roadmap.md`
- Decentralization model: `supabase/README.md`
- Manifest: `.claude/.10x-cli-manifest.json` (lesson m4l1)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Extract canonical conventions.md

#### Automated

- [x] 1.1 File exists: `test -f context/foundation/conventions.md` — b122e8e
- [x] 1.2 Markdown well-formed: `npx prettier --check context/foundation/conventions.md` — b122e8e
- [x] 1.3 No placeholder tokens / dangling references — b122e8e

#### Manual

- [x] 1.4 Every PRD-locked rule appears once; diverged rules match PRD wording — b122e8e
- [x] 1.5 No folder-specific guidance leaked in — b122e8e
- [x] 1.6 Full global picture readable from this one file — b122e8e

### Phase 2: Nested folder context files

#### Automated

- [x] 2.1 Both nested files exist — 89c4f4d
- [x] 2.2 Markdown well-formed (prettier) — 89c4f4d
- [x] 2.3 Module/route maps match filesystem (no missing/extra entries) — 89c4f4d

#### Manual

- [x] 2.4 Nested files reference conventions.md, don't restate global rules — 89c4f4d
- [x] 2.5 `src/lib/services/` reads as future convention, not existing dir — 89c4f4d
- [x] 2.6 Local contract + per-file concern clear from each nested file — 89c4f4d

### Phase 3: Slim the root monolith

#### Automated

- [x] 3.1 `CLAUDE.md` contains the `@context/foundation/conventions.md` import — 5d9265e
- [x] 3.2 `AGENTS.md` points to conventions.md — 5d9265e
- [x] 3.3 Both root files shrank materially (`wc -l`) — 5d9265e
- [x] 3.4 Prettier clean on both root files — 5d9265e
- [x] 3.5 No canonical rule body duplicated across root + conventions.md — 5d9265e

#### Manual

- [x] 3.6 Claude Code inlines conventions.md via root CLAUDE.md — 5d9265e
- [x] 3.7 AGENTS.md reads as coherent standalone onboarding doc — 5d9265e
- [x] 3.8 Day-to-day contributor info findable in ≤1 hop — 5d9265e

### Phase 4: Verify redistribution & sync

#### Automated

- [x] 4.1 Coverage map exists — 19d956f
- [x] 4.2 No invariant keyword orphaned across the new layout — 19d956f
- [x] 4.3 `npm run build` still green — 19d956f

#### Manual

- [x] 4.4 Every coverage-map row has a destination; no lost rule — 19d956f
- [x] 4.5 Nested CLAUDE.md surfaces when touching `src/lib/` and `src/pages/api/` — 19d956f
- [x] 4.6 Diverged rules read identically to the PRD in their canonical home — 19d956f
