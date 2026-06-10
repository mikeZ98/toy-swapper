# Evaluation History (S-03) — Plan Brief

> Full plan: `context/changes/feature-evaluation-history/plan.md`
> Research: `context/changes/feature-evaluation-history/research.md`

## What & Why

Build per-account evaluation history (roadmap S-03 / FR-018 / FR-019 / US-05): persist each
successful evaluation as a per-user, RLS-scoped, append-only row, and let the operator browse
past contracts (most recent first) on a `/history` page, expanding any to its **verbatim**
Markdown. This completes the v2 thesis — persistence with identity — and unblocks the test
rollout's Phase 3.

## Starting Point

Prerequisites (F-01 RLS baseline, F-02 counterparty table, S-01 gate) are all shipped.
`public.user_lists` is a near-exact template for the table/service/test; a history row is a
persisted `EvaluateResponse` (`src/types.ts:38-45`) + `user_id` + `created_at`. The evaluate
endpoint already has a best-effort save hook (`evaluate.ts:57-63`). No history UI exists today.

## Desired End State

An authenticated operator runs an evaluation, opens `/history`, and sees their past contracts
newest-first (verdict, delta, counterparty name, threshold, source, timestamp); expanding a
row shows the exact original Markdown. A second account sees none of it (RLS). Anonymous
`/history` redirects to sign-in. `npm run db:test` proves the isolation contract.

## Key Decisions Made

| Decision         | Choice                                          | Why (1 sentence)                                                              | Source   |
| ---------------- | ----------------------------------------------- | ---------------------------------------------------------------------------- | -------- |
| Table semantics  | Append-only event log (no UNIQUE, no upsert)    | History is many-rows-per-user, the one divergence from the user_lists analog.| Research |
| RLS policy set   | select + insert + delete-own (no update)        | Matches append-only; leaves room for future "clear history" without migration.| Plan     |
| Counterparty name| FK + join `counterparty_id → counterparties.name` at read | Canonical (FR-018 stores only the id); pool is immutable so the name is stable.| Plan   |
| UI location      | Dedicated gated `/history` page                 | Matches US-05 "navigate to the history page"; clean separation.              | Plan     |
| Rendering        | Server Astro + native `<details>`               | Read-only content; matches "React only when interactive" convention.         | Plan     |
| Write scope      | Every success, incl. NO MATCH                   | FR-018 "each successful evaluation"; columns already nullable.               | Plan     |
| List size        | All rows, most-recent-first (no cap, v2)        | Matches FR-019 literally; single-user volume is low.                          | Plan     |
| Isolation test   | Ships in this change (Phase 1)                  | `supabase/README.md` mandates a pgTAP read=0 / write=42501 test per table.    | Research |

## Scope

**In scope:** new `evaluation_history` migration + RLS + pgTAP isolation test; a read/write
service; a best-effort write hook in the evaluate endpoint; a server-rendered `/history` page
+ gate entry + Topbar link.

**Out of scope:** R5 byte-identical determinism test + negative-control hardening (test-rollout
Phase 3); update/edit; delete-history UI; pagination/filter/search; React island; name
denormalization; any evaluator / contract-format change.

## Architecture / Approach

Standard DB-feature sequence: schema+test → service → write hook → read UI. The contract blob
is stored verbatim from the existing `EvaluateResponse` and rendered as-is (never recomputed —
PRD:181). Name resolution is an FK-embedded read join. Every layer mirrors an existing in-repo
pattern (`user_lists` for data/service/test, `saveUserLists` for the hook, gated
server-rendered pages for the UI).

## Phases at a Glance

| Phase                          | What it delivers                                          | Key risk                                                  |
| ------------------------------ | --------------------------------------------------------- | --------------------------------------------------------- |
| 1. Migration + RLS + pgTAP     | Append-only table, 3 policies, FK, isolation test         | copying the user_lists upsert/UNIQUE (must be append-only)|
| 2. Service layer               | `saveEvaluation` + `getEvaluationHistory` (name join)     | embed-join FK not detected by PostgREST                   |
| 3. Write hook                  | best-effort history insert on each success                | a save failure blocking the user's result (must not)      |
| 4. /history page + gate + nav  | server-rendered list + verbatim expand, gated route       | re-rendering on read instead of showing the stored blob   |

**Prerequisites:** local Supabase (`supabase start`) for Phases 1 & 3–4 manual checks; F-01/F-02/S-01 (all shipped).
**Estimated effort:** ~2–3 sessions across 4 phases.

## Open Risks & Assumptions

- PostgREST embedded `counterparties(name)` select requires the FK to be declared — verify the
  join returns the name (and null for NO-MATCH rows) at Phase 2.
- The contract blob must be stored and rendered verbatim; any re-render path violates PRD:181.
- This change ships isolation coverage (R1); the R5 byte-identical determinism proof is
  deferred to test-rollout Phase 3 by design.

## Success Criteria (Summary)

- Past evaluations appear on `/history` newest-first and expand to the exact original Markdown.
- A second account cannot see another user's history (RLS-proven via pgTAP).
- Every successful evaluation (including NO MATCH) is recorded, and a save failure never breaks
  the evaluator response.
