# Context Architecture m4 — Plan Brief

> Full plan: `context/changes/context-architecture-m4/plan.md`

## What & Why

Apply the m4l1 "context scaling" pattern to ToySwapper: dissolve the root agent-context monolith (two overlapping files, `CLAUDE.md` + `AGENTS.md`, that restate the same PRD rules and conventions) into a decentralized, folder-level layout. The two root copies have already diverged — the same rule exists in two phrasings — which is exactly the drift a single canonical source eliminates.

## Starting Point

`CLAUDE.md` (81L) and `AGENTS.md` (39L) both carry full PRD-locked rules, build commands, and structure conventions. `supabase/README.md` (148L) is already a working folder-level context file — the in-repo model this change replicates. `src/lib/` (10 modules) and `src/pages/api/` (4 routes) have no nested context.

## Desired End State

A canonical `context/foundation/conventions.md` owns the global shared core (PRD invariants + repo-wide conventions). Nested `src/lib/CLAUDE.md` and `src/pages/api/CLAUDE.md` carry folder-scoped principles + a concise module map. The root `CLAUDE.md` (`@`-import) and `AGENTS.md` (prose pointer) slim to thin shells referencing the canonical body. Every original rule is provably preserved.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Nested file format | Nested `CLAUDE.md` | Claude-native contextual auto-loading when touching a folder | Plan |
| Root-file relationship | Both reference `conventions.md` | Symmetric thin shells; no single root file owns the other | Plan |
| `conventions.md` scope | PRD rules + repo-wide conventions | Kills the full duplication surface, not just the rule copies | Plan |
| Nested depth | Principles + concise module map | Matches `supabase/README.md`; orientation without per-file rot | Plan |
| Reconciling divergence | PRD/roadmap is tiebreaker | Canonical file is provably correct, not one side's stale copy | Plan |
| Loss verification | Coverage mapping table | Auditable proof every original rule found a home | Plan |

## Scope

**In scope:** create `conventions.md`; create `src/lib/CLAUDE.md` + `src/pages/api/CLAUDE.md`; slim root `CLAUDE.md` + `AGENTS.md`; build a coverage map.

**Out of scope:** `supabase/README.md` (unchanged — it's the model); any app code/migrations/behavior; nested context for other folders; nested `AGENTS.md`; resolving PRD open questions.

## Architecture / Approach

Bottom-up: build the canonical body first (Phase 1), then the folder files that reference it (Phase 2), then hollow out the root files to reference it (Phase 3) — so no reference ever dangles. Phase 4 audits the redistribution against the git-recoverable originals. Content is moved and reconciled, never invented.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Extract conventions.md | Canonical shared body, reconciled vs PRD | Mis-reconciling a diverged rule away from PRD meaning |
| 2. Nested folder context | `src/lib/` + `src/pages/api/` CLAUDE.md | Module map drifts from filesystem |
| 3. Slim root monolith | Thin root shells referencing conventions.md | Dropping a rule that wasn't actually duplicated |
| 4. Verify & sync | Coverage map + change.md sync | Reworded (not keyword-matched) rule slips through |

**Prerequisites:** none — discovery complete, all decisions settled.
**Estimated effort:** ~1 session across 4 phases.

## Open Risks & Assumptions

- Assumes Claude Code contextual loading of nested `CLAUDE.md` works as expected when touching a subfolder; Phase 4 manually verifies this.
- Cursor reads only root `AGENTS.md` + the conventions.md pointer (not nested `CLAUDE.md`) — acceptable given the chosen format.
- The fairness/determinism divergences are resolved to PRD wording; if the PRD itself is ambiguous, that surfaces during Phase 1 manual verification.

## Success Criteria (Summary)

- One canonical `conventions.md`; root files reference it instead of duplicating it.
- Nested context surfaces when an agent works in `src/lib/` or `src/pages/api/`.
- Coverage map shows every original rule landed somewhere — zero silent loss.
