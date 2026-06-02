# Evaluation History — Plan Brief

> Full plan: `context/changes/evaluation-history/plan.md`

## What & Why

Authenticated users should be able to look back at the barter contracts they've generated. This is US-05 / FR-018-019 from the v2 PRD: persist every successful evaluation and surface it as a browsable, expandable history — so a contract isn't lost the moment the user runs the next one.

## Starting Point

The evaluator is gated and persists the user's last give/want lists (S-01, S-02, both on `master`). But evaluations themselves are computed and shown once, never stored — there's no history table, no `/history` page, and no nav to one. The `evaluate()` result already carries every field FR-018 wants to record.

## Desired End State

A signed-in user opens `/history` and sees their past contracts newest-first — each row showing verdict, delta (PLN), counterparty name, threshold_pct, source, and timestamp — and can expand any row to read the full Markdown contract verbatim. A fresh account sees an empty-state message; a second account never sees another user's history; anonymous visitors are redirected to sign-in.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| RLS shape | Select + insert only (append-only) | History is an immutable audit log; FR has no edit/delete requirement | Plan |
| Counterparty name | Read-time join (nullable FK → counterparties) | counterparties is immutable seed data; keeps the row to FR-018's fields and enables Supabase embed | Plan |
| Page rendering | SSR-embed all rows + contracts in `<details>` | Zero client JS, byte-identical contract trivially met, instant expand | Plan |
| Contract display | Raw Markdown in `<pre>` | Guarantees byte-identity (FR-019); matches index.astro; no md-renderer dep | Plan |
| List limit | Most-recent 50, `created_at desc, seq desc` | Bounds payload; far exceeds realistic single-user volume | Plan |
| Save-failure | Silent best-effort (log, don't block) | Evaluation result is the product; consistent with S-02 | Plan |
| Ordering tie-break | `seq bigint identity` column | uuid PK isn't insertion-ordered; FR-019 wants row-id tie-break | Plan |
| Nav placement | index.astro bar + Topbar | Discoverable from the main workflow | Plan |

## Scope

**In scope:** `public.evaluations` migration (append-only RLS, nullable FK, `seq`), pgTAP, `src/lib/evaluations.ts` (save/list with name embed), best-effort insert in the evaluate route, `/history` SSR page, middleware gate, nav links, vitest.

**Out of scope:** edit/delete history, pagination, Markdown→HTML rendering, re-evaluation of stored contracts, a shared `/api/history` endpoint.

## Architecture / Approach

Server-only, mirroring S-02. On `POST /api/evaluate` success, `saveEvaluation()` inserts one append-only row (best-effort try/catch, after the S-02 list save). On `GET /history`, the page frontmatter calls `listEvaluations()` — a single Supabase select with an embedded `counterparties(name)` join, ordered newest-first, capped at 50 — and renders each row as a collapsed `<details>` with the verbatim contract in a `<pre>`. RLS scopes reads/writes to the owner.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. DB migration + pgTAP | `public.evaluations` (append-only RLS, FK, seq) + isolation/append-only proof | FK to counterparties must be nullable + `on delete set null` |
| 2. Service + wiring + vitest | save/list service, best-effort insert on eval success | Embedded-select join depends on the FK from Phase 1 |
| 3. History page + gate + nav | `/history` SSR list + expand, gating, nav links | Empty-state + NO-MATCH (null counterparty) rendering |

**Prerequisites:** F-01 (RLS baseline) ✅, F-02 (counterparties table) ✅, S-01 (auth gate) ✅, S-02 (save pattern) ✅ — all on `master`.
**Estimated effort:** ~1-2 sessions across 3 phases.

## Open Risks & Assumptions

- `delta_pln` stored as `numeric` to be lossless whether the evaluator emits integer or fractional PLN.
- Capping at 50 rows is acceptable for v2 (no pagination); revisit if a user accumulates more and wants the full archive.

## Success Criteria (Summary)

- `npm test` + `npm run db:test` pass; `npm run build`/`npm run lint` green.
- After evaluating, a user sees their contracts on `/history`, newest-first, expandable to byte-identical Markdown.
- A second account never sees another user's history (RLS + pgTAP verified); fresh accounts get a clean empty state.
