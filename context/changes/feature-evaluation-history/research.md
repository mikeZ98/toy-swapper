---
date: 2026-06-09T13:11:49+0200
researcher: Michał Zasiadczuk
git_commit: 86bdc9a22ea4e6cc9965a9f73fcf1ff0f9c2b883
branch: master
repository: toyswapper
topic: "Evaluation history feature (S-03 / FR-018 / FR-019 / US-05)"
tags: [research, codebase, evaluation-history, rls, persistence, determinism]
status: complete
last_updated: 2026-06-09
last_updated_by: Michał Zasiadczuk
---

# Research: Evaluation history feature (S-03 / FR-018 / FR-019 / US-05)

**Date**: 2026-06-09T13:11:49+0200
**Researcher**: Michał Zasiadczuk
**Git Commit**: 86bdc9a22ea4e6cc9965a9f73fcf1ff0f9c2b883
**Branch**: master
**Repository**: toyswapper

## Research Question

What does it take to build per-account evaluation history (roadmap S-03): persist each
successful evaluation as a history row scoped per user via RLS, and let the user browse
past contracts (most recent first) and expand any row to see the original Markdown
verbatim — byte-identical to the original?

## Summary

This is a textbook **append-only, user-scoped RLS table** plus a **write hook** in the
evaluate endpoint and a **read/list UI**. The codebase already contains a near-exact
template at every layer:

- **Data model**: `public.user_lists` (S-02) is the closest analog — same RLS four-policy
  shape, same `references auth.users(id) on delete cascade`. The difference is semantics:
  history is **append-only / many-rows-per-user** (an event log), whereas `user_lists` is
  **one-row-per-user upsert**. So history drops `UNIQUE(user_id)` and the upsert, and adds
  a `created_at desc` read order.
- **Row shape**: the required FR-018 fields map almost 1:1 onto the existing
  `EvaluateResponse` (`src/types.ts:38-45`) — `contract`, `counterparty_id`, `verdict`,
  `delta_pln`, `threshold_pct`, `source` — plus `user_id` and a server `created_at`. The
  history row is essentially a persisted `EvaluateResponse` + owner + timestamp.
- **Write hook**: `src/pages/api/evaluate.ts:57-63` already persists `user_lists`
  best-effort after a successful evaluation. The history insert goes right beside it, same
  best-effort pattern (a save failure must not hide the result the user just got).
- **Read/UI**: there is no history page yet. `dashboard.astro` is a near-empty gated stub —
  the natural host (or a dedicated `/history` page). The list shows verdict/delta/
  counterparty-name/threshold/source/timestamp; a row expands to the stored contract blob.
- **Determinism**: the **load-bearing constraint** (PRD:116, PRD:181) — the stored contract
  Markdown is shown **verbatim on read, never re-rendered or re-evaluated**. The row stores
  the `contract` string as-is; reading returns that string. This is what makes history
  survive a later edit of the counterparty pool.
- **Testing**: the pgTAP isolation test for this table is **Phase 3 of the test rollout**
  (R1 cross-account leak + R5 byte-identical) — out of scope for this build change, but the
  table must be shaped so that test can prove cross-account SELECT returns zero and
  cross-account INSERT raises `42501`. `supabase/tests/user-lists.test.sql` is the pattern.

## Detailed Findings

### Requirements (PRD + roadmap)

- **FR-018** (`prd.md:170`) — persist each successful evaluation with: contract Markdown
  **verbatim**, verdict, delta_pln, counterparty_id, threshold_pct, source
  (`llm`|`stub`|`llm-failed-fallback`), server timestamp. Rows scoped per user via RLS.
- **FR-019** (`prd.md:171`) — list past contracts most-recent-first; each row shows verdict,
  delta, **counterparty name**, threshold_pct, source, timestamp; row expands to the full
  Markdown contract verbatim.
- **US-05** (`prd.md:103-116`) — acceptance: each user sees only their own history
  (RLS-verified); history survives sign-out/in; the expanded contract is the exact Markdown
  originally generated and persisted — **no re-rendering, no re-evaluation against the
  current fixture pool**.
- **NFR** (`prd.md:181`) — "Persisted evaluation history rows store the contract Markdown as
  it was originally rendered… Historical contracts must remain byte-identical to their
  original output even after the fixture pool is edited or extended."
- **Roadmap S-03** (`roadmap.md:35`) — status `proposed`; prerequisites **F-01** (RLS
  baseline ✓), **F-02** (counterparty table ✓), **S-01** (auth gate ✓). All prerequisites
  are shipped, so S-03 is unblocked.

### Data model — the analog and the delta

`supabase/migrations/20260601120000_user_lists.sql` is the template. The history table
follows the same four-policy RLS contract (`supabase/README.md`) but diverges on semantics:

| Aspect            | `user_lists` (S-02)                      | `evaluation_history` (S-03)                          |
| ----------------- | ---------------------------------------- | ---------------------------------------------------- |
| Cardinality       | one row per user (`UNIQUE(user_id)`)     | many rows per user (append-only log)                 |
| Write             | upsert `onConflict: user_id`             | plain insert per successful evaluation               |
| Ordering          | n/a                                      | `created_at desc` (most recent first, FR-019)        |
| Mutability        | replaced on each save                    | immutable once written (no app-side update)          |

- `user_id uuid not null references auth.users(id) on delete cascade` — same as the analog
  (`user_lists.sql:24`).
- Columns map to `EvaluateResponse` (`src/types.ts:38-45`): `contract text not null`,
  `counterparty_id text` (nullable — NO MATCH yields null), `verdict text` (nullable),
  `delta_pln` (nullable), `threshold_pct`, `source`, plus `created_at timestamptz not null
  default now()`.
- `counterparty_id` is a **text slug** referencing `public.counterparties(id)` (a text PK,
  `counterparties.sql:25`), nullable. An FK is feasible; counterparties is migration-seeded
  and immutable at runtime (no write policy), so the reference is stable.

### Row shape ↔ EvaluateResponse

`EvaluateResponse` (`src/types.ts:38-45`) carries exactly the FR-018 payload minus owner +
timestamp:

```
contract, counterparty_id (nullable), verdict (nullable), delta_pln (nullable),
threshold_pct, source
```

So the write is "persist the response object I just built." No new computation; the values
already exist at `evaluate.ts:45` (the `result`).

### Write hook (endpoint)

`src/pages/api/evaluate.ts`:
- Line 45: `const result = await evaluate(...)` — the full `EvaluateResponse`.
- Lines 57-63: gated route → `locals.user` always present → `saveUserLists(...)` best-effort
  inside a try/catch that only `log.warn`s on failure (a save error must never hide the
  result). **The history insert goes here**, same best-effort shape:
  `try { await saveEvaluation(supabase, user.id, result) } catch { log.warn(...) }`.
- The Supabase SSR client is already in scope (`evaluate.ts:43`, `createClient(...)`).

### Read / list UI

- No history page exists. `src/pages/dashboard.astro` is a gated stub (just a welcome +
  sign-out). It is the natural host, or a dedicated `/history` page (both are already
  covered by the middleware gate pattern — add to `PROTECTED_ROUTES`/`isGated` if a new
  route).
- **Counterparty name** (FR-019 list column) is not stored in the row (FR-018 stores only
  `counterparty_id`). Resolve it at read time by joining `counterparty_id →
  counterparties.name` — supabase-js embedded select (`.select("..., counterparties(name)")`)
  or a manual map against `getCounterpartyPool`. See Open Questions for the fidelity
  trade-off.
- The **expanded contract** is the stored `contract` string rendered as-is. The existing
  evaluator UI already displays a contract in a `<pre>` block
  (`index.astro:160-162`, `#contract-md`) — the history detail can reuse that presentation.

### RLS + the test that rides on it

- The table needs `select`-own and `insert`-own policies at minimum (append-only). The
  README four-policy template also defines `update`/`delete`; for an append-only log they're
  arguably unnecessary (no feature mutates or deletes history). See Open Questions.
- `supabase/tests/user-lists.test.sql` is the exact pattern the Phase-3 rollout test will
  follow: seed two users, JWT-spoof each (both GUCs), prove A sees only A's rows, prove a
  cross-account insert raises `42501`, superuser bypasses RLS, **plus negative controls**
  (relax the policy in-txn, show the assertion flips). For an append-only table the upsert
  assertions (test steps 7-8) are replaced by "a second insert from A yields count 2"
  (append, not replace).

### Determinism / byte-identical (the constraint that shapes the schema)

- The contract is stored as a **text blob, verbatim**. Reading returns that blob unchanged —
  no re-evaluation, no re-render against the live counterparty pool. This is why history
  survives `FR-017`-style pool edits (PRD:181).
- This is testable as a determinism/integration check (test-plan R5): store a contract,
  edit/re-seed the pool, read the stored row back, assert byte-identical. `test/
  determinism.test.ts` is the existing determinism pattern; the persisted-contract variant
  is named in test-plan §6.4.

## Code References

- `context/foundation/prd.md:103-116` — US-05 acceptance criteria (verbatim, RLS-isolated)
- `context/foundation/prd.md:170-171` — FR-018 (row fields) + FR-019 (list/expand)
- `context/foundation/prd.md:181` — NFR: persisted contracts byte-identical after pool edits
- `context/foundation/roadmap.md:35` — S-03 (proposed; prereqs F-01/F-02/S-01 all done)
- `supabase/migrations/20260601120000_user_lists.sql` — the RLS four-policy template + analog
- `src/lib/user-lists.ts:17-67` — service pattern (null-client throw, `cause` code, maybeSingle)
- `src/lib/counterparties.ts:21-49` — shared-pool read + name source for the FR-019 join
- `src/pages/api/evaluate.ts:43-68` — Supabase client + the best-effort save hook to extend
- `src/types.ts:38-45` — `EvaluateResponse` (the row payload)
- `src/pages/dashboard.astro:1-27` — gated stub, candidate history host
- `src/pages/index.astro:160-162` — existing `<pre id="contract-md">` contract presentation
- `supabase/tests/user-lists.test.sql` — pgTAP isolation + negative-control pattern (Phase 3)
- `supabase/README.md` — four-policy template + "Adding a new table" 5-step checklist

## Architecture Insights

- **History = persisted `EvaluateResponse` + owner + timestamp.** No new domain logic; the
  write is a serialization of an object that already exists at the save point.
- **Append-only is the key divergence from `user_lists`.** Drop `UNIQUE(user_id)` and the
  upsert; the table is an event log ordered by `created_at desc`. This also changes the
  pgTAP shape (count grows on second insert rather than staying 1).
- **Byte-identical = store the blob, never recompute.** The schema choice (store `contract
  text`) is what guarantees the NFR; any design that re-renders on read would violate it.
- **Best-effort write, never blocking.** Mirror `saveUserLists` — a history insert failure
  logs a warning and the user still gets their evaluation result.
- **counterparty_id is nullable** (NO MATCH path: verdict/delta/counterparty_id all null in
  `EvaluateResponse`), so the corresponding columns must be nullable.
- **The new migration is immutable once on master** (determinism boundary, `supabase/
  README.md`) — get the shape right before it lands.

## Historical Context (from prior changes)

- `context/archive/2026-06-09-testing-auth-gate/` — established the gate + the boundary-mock
  test patterns; confirms `/` and `/api/evaluate` are gated, so `locals.user` is present at
  the write hook.
- `context/archive/2026-06-09-testing-e2e-setup/frame.md` — notes the inline evaluator script
  and the auth round-trip; a future e2e could cover "run eval → see it in history," but that
  is not part of this build.
- `context/foundation/test-plan.md` §2 (R1, R5), §3 Phase 3, §6.1/§6.4 — the test coverage
  that will ride on this feature once built (cross-account history isolation + byte-identical
  persisted contract). Phase 3's `/10x-research` step is gated on this feature existing.

## Related Research

- None prior for this change. Test-rollout research lives in the archived testing changes.

## Open Questions

These are **plan-time design decisions** (surfaced, not decided here):

1. **RLS policy set** — append-only log: ship only `select`-own + `insert`-own, or the full
   four-policy (incl. `update`/`delete`-own)? No current feature mutates/deletes history; a
   future "clear my history" would want `delete`-own. Recommendation to weigh in plan:
   select + insert (+ delete for future-proofing), no update.
2. **Counterparty name: join vs denormalize** — FR-018 stores only `counterparty_id`; FR-019
   shows the name. Join `counterparty_id → counterparties.name` at read (canonical, but a
   future counterparty rename would change the *list* label while the stored contract stays
   correct), or denormalize `counterparty_name` into the row for full list fidelity. The
   expanded contract is byte-identical either way (the name is baked into the blob).
3. **UI location** — extend `dashboard.astro`, add a dedicated gated `/history` page, or a
   tab on `/`? Affects whether `isGated`/`PROTECTED_ROUTES` needs a new entry.
4. **List rendering: server vs island** — render the list server-side in Astro (history is
   read-only, no interactivity needed beyond expand/collapse, which can be `<details>`), or a
   React island? The expand/collapse can be pure CSS/`<details>`, suggesting server-only.
5. **Pagination / cap** — FR-019 says "list … most recent first" with no cap. For v2, an
   unbounded list is acceptable (low volume), but note whether a `limit` is wanted.
