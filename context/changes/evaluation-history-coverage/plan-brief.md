# Evaluation-History Coverage — Plan Brief

> Full plan: `context/changes/evaluation-history-coverage/plan.md`

## What & Why

Close **Phase 3 of the test rollout** (`test-plan.md` §3, "Evaluation-history coverage"). The existing pgTAP test proves history rows are per-account isolated but **can't prove it would fail if a policy regressed** (no negative control), and **nothing proves R5** — that a persisted contract is served verbatim rather than re-rendered from live pool data. This change adds both proofs and closes a coverage asymmetry (`evaluation-history.ts` has 0 unit tests; its sibling `user-lists.ts` has 9).

## Starting Point

`supabase/tests/evaluation-history.test.sql` covers positive isolation (cross-read = 0, cross-write → `42501`, append semantics, superuser sanity) — its own header defers negative controls + the R5 proof to "Phase 3". `src/lib/evaluation-history.ts` reads the stored `contract` column directly and never calls the evaluator (so behavior is already correct — the work is to *lock it in*). Endpoint wiring is already covered by `test/evaluate.test.ts`.

## Desired End State

`npm run db:test` runs negative controls that flip the isolation results when a policy is relaxed (proving the green is real), and `npm test` runs a new `test/evaluation-history.test.ts` that exercises every branch of the service and proves the stored contract is byte-identical even when the live counterparty join returns a renamed name. No source code changes.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| R5 proof strategy | Join-rename unit test | Directly proves the contract is the frozen source of truth, decoupled from live pool data — R5's exact failure mode, at the cheapest layer | Plan |
| Unit test scope | Full sibling parity | Closes the coverage gap with `user-lists.test.ts`; exercises every branch | Plan |
| pgTAP file | Extend existing test in place | Test files aren't immutable (only migrations are); one canonical test per table, matching Phase 1's `user-lists` hardening | Plan |
| INSERT-control third-user trick | Omit | `evaluation_history` is append-only (no `UNIQUE(user_id)`), so a relaxed insert just succeeds — the trick is unnecessary | Plan |
| Page-state / e2e tests | Out of scope | Not in the §2 risk map; §1 cost×signal + §7 forbid expanding e2e | Plan |

## Scope

**In scope:**
- SELECT + INSERT negative controls in `supabase/tests/evaluation-history.test.sql` (+ plan bump)
- New `test/evaluation-history.test.ts`: full sibling-parity unit suite + R5 join-rename guard

**Out of scope:**
- `history.astro` page-state (loadError/empty) tests
- `e2e/history.spec.ts`
- Any `src/` change (tests only)
- `test/evaluate.test.ts` (wiring already covered)
- pgTAP byte round-trip for R5 (low signal vs the unit test)

## Architecture / Approach

Two independent, single-layer phases, each following a worked example. Phase 1 (DB/pgTAP) extends the SQL test additively with §6.1 negative controls — policy DDL runs as table owner inside the test's transaction and rolls back. Phase 2 (service/Vitest) mirrors `user-lists.test.ts`'s fake query-builder and adds the R5 guard, which leans on the source's separation of the stored `contract` column from the live `counterparties(name)` join.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. pgTAP negative controls | SELECT + INSERT controls prove the isolation test can fail | Forgetting `reset role` to owner before `alter policy` → `must be owner` error; stale `plan(N)` |
| 2. Vitest suite + R5 guard | Full-parity unit suite + byte-identical contract proof | Fake query-builder must terminate on `.order()` (the read's terminal call), not `.eq()` |

**Prerequisites:** Local Supabase up (`supabase start`) for `npm run db:test`; `.dev.vars` set. Node deps already installed.
**Estimated effort:** ~1 session, 2 phases.

## Open Risks & Assumptions

- Assumes the local Supabase image accepts the existing test's `auth.users` minimal-column insert and dual JWT GUCs (it already does — the positive suite passes today).
- Assumes `getEvaluationHistory`'s chain stays `select → eq → order`; if the source's query shape changes, the fake client's terminal-call assumption must follow.

## Success Criteria (Summary)

- The pgTAP isolation assertions provably fail when their policy is relaxed, and pass when it isn't.
- The stored history contract reads back byte-identical even when live counterparty data has changed.
- `evaluation-history.ts` reaches unit-test parity with `user-lists.ts`; `npm test` and `npm run db:test` are green.
