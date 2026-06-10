# Evaluation-History Coverage Implementation Plan

## Overview

Close **Phase 3 of the test rollout** (`context/foundation/test-plan.md` §3) — "Evaluation-history coverage". Two risks are in scope:

- **R1** (cross-account history leak, High×High) — the existing pgTAP test proves positive isolation but has **no negative control**, so it cannot yet prove it would *fail* if a policy regressed. This plan adds those controls.
- **R5** (persisted contract re-rendered on read instead of stored verbatim, Medium×Medium) — **currently unproven**. This plan locks in "the stored contract blob is the frozen source of truth" at the cheapest layer.

It also closes a coverage asymmetry: `src/lib/evaluation-history.ts` has **zero** direct unit tests, while its sibling `src/lib/user-lists.ts` has 9 (`test/user-lists.test.ts`).

**This is a tests-only change. No source files are modified** — the service behavior is already correct; the work is to prove and lock it.

## Current State Analysis

- **`supabase/tests/evaluation-history.test.sql`** — `plan(6)`: table exists, RLS enabled, Alice sees only her row (cross-read = 0), cross-write → `42501`, append semantics (count grows to 2), superuser sees all 3. The file header explicitly states *"Negative controls + the R5 byte-identical determinism proof are added by the test rollout's Phase 3."* That is this change.
- **`src/lib/evaluation-history.ts`** — `saveEvaluation` and `getEvaluationHistory`. Both follow the `user-lists.ts` contract: throw on null client, throw on query error preserving the Postgres code via `cause: { code }`. `getEvaluationHistory` reads the stored `contract` column directly and resolves the counterparty name through an embedded `counterparties(name)` join — it **never calls the evaluator**, so it physically cannot re-render. R5's job is to *lock that in* against future regression.
- **`test/evaluate.test.ts`** — already covers the endpoint *wiring* (`saveEvaluation` called once when a user is present; best-effort — response stays 200 and logs `evaluation_history.save_failed` when the save throws). `saveEvaluation` is mocked there, so the service itself is untested. This plan does not touch endpoint wiring.
- **`test/user-lists.test.ts`** — the canonical sibling unit suite. Uses a hand-rolled fake Supabase query-builder (`makeClient`) that captures call arguments and resolves the chain to `{ data, error }`. Phase 2 of this plan mirrors its structure.
- **`supabase/README.md` §"Adding a new table" + `test-plan.md` §6.1** — the negative-control cookbook: policy DDL is transactional (rolls back with the test) and **must run as the table owner** (`reset role` to superuser first); running `alter policy` under `authenticated` raises `must be owner of table`.

### Key Discoveries

- The evaluation_history table is **append-only — it has no `UNIQUE(user_id)`** (`evaluation-history.ts:6–8`). The §6.1 "third seeded user" trick (needed for `user-lists` to avoid a `23505` unique violation when relaxing the insert control) is therefore **unnecessary here** — a relaxed cross-account insert simply succeeds.
- `getEvaluationHistory` maps `row.counterparties?.name ?? null` → `counterparty_name` (`evaluation-history.ts:87`), a field **separate from** the embedded `row.contract`. This separation is exactly what makes the R5 join-rename test possible and meaningful.
- Test SQL files are **not immutable** — only `supabase/migrations/*` are (CLAUDE.md, `supabase/README.md`). So extending `evaluation-history.test.sql` in place is correct and matches how Phase 1 hardened `user-lists.test.sql`.
- The select returns `delta_pln`, `verdict`, `counterparty_id` as nullable (NO-MATCH rows). The R5 / mapping tests should include a NO-MATCH-shaped row so the null branch of the mapping is exercised.

## Desired End State

- `npm run db:test` runs an `evaluation-history.test.sql` whose isolation assertions are each **causally bound to their policy**: relaxing `_select_own` makes Alice see Bob's row; relaxing `_insert_own`'s WITH CHECK lets the previously-denied cross-account write succeed. The suite still passes green in its unmutated state.
- `npm test` runs a new `test/evaluation-history.test.ts` that exercises every branch of `evaluation-history.ts` (null-client, payload, error propagation, join mapping, empty array, ordering) **and** proves R5: the returned `contract` is byte-identical to the stored blob even when the live counterparty join returns a different (renamed) name.
- `context/foundation/test-plan.md` §3 Phase 3 status reflects the work (moved toward `complete` by the implement step; this plan does not edit the test-plan).

Verify: `npm run db:test` and `npm test` both pass; temporarily reverting either negative-control mutation (or the R5 rename) makes the corresponding assertion fail.

## What We're NOT Doing

- **No `history.astro` page-state tests** (loadError / empty state) — not in the §2 risk map; excluded per §1 cost×signal and §7.
- **No `e2e/history.spec.ts`** — §7 forbids expanding e2e into a risk-driven suite; nothing here is browser-only.
- **No source changes to `evaluation-history.ts`** or any other `src/` file — coverage only.
- **No third-user trick** in the INSERT control — append-only table, so it's not needed (noted inline in the test).
- **No changes to `test/evaluate.test.ts`** — endpoint wiring is already covered.
- **No pgTAP byte round-trip for R5** — R5 is proven at the unit layer (join-rename); a SQL round-trip would mostly test Postgres text storage (low signal, §1).

## Implementation Approach

Two independent phases, each owning one layer and following an existing worked example:

1. **pgTAP (DB layer)** — extend the existing SQL test additively with the two negative controls from §6.1, adapted for an append-only table. Reference: `supabase/tests/user-lists.test.sql` (controls) and `supabase/tests/rls_template.test.sql` (canonical template).
2. **Vitest (service layer)** — new unit suite mirroring `test/user-lists.test.ts`'s fake-client structure, extended with the R5 join-rename guard. Reference: `test/user-lists.test.ts`.

The phases are order-independent but written 1→2 (DB risk R1 first, then R5).

## Critical Implementation Details

- **Negative-control policy DDL must run as table owner.** `reset role` to the superuser before any `alter policy`, then re-establish the `authenticated` role + JWT GUCs (`request.jwt.claims` and the legacy `request.jwt.claim.sub`) before re-asserting as a user. Mutating a policy under the `authenticated` role raises `must be owner of table`, not a test failure.
- **`plan(N)` must match the final assertion count** or pgTAP reports a plan mismatch rather than a per-assertion failure. Count the added `select` assertions and bump `plan(6)` accordingly.
- **Each identity switch sets BOTH JWT GUCs** (JSON `request.jwt.claims` and legacy `request.jwt.claim.sub`) for image-version portability — the existing test already does this; the controls must keep doing it after every `reset role`.

---

## Phase 1: pgTAP negative controls (R1)

### Overview

Make every isolation assertion in `evaluation-history.test.sql` provably fail when its policy is relaxed, closing the R2-class "false-green" gap for this table and hardening the R1 isolation proof. Additive edit to the existing file.

### Changes Required:

#### 1. SELECT negative control

**File**: `supabase/tests/evaluation-history.test.sql`

**Intent**: After the existing positive assertions, prove the "Alice sees only her own row" result is caused by the `_select_own` policy — not by data absence — by relaxing the policy in-transaction and showing Alice then sees Bob's row too.

**Contract**: As superuser (`reset role`), `alter policy "evaluation_history_select_own" on public.evaluation_history using (true);` then re-establish Alice's `authenticated` role + both JWT GUCs and assert her visible count is now 2 (her row + Bob's). Use the same `results_eq(... count(*) ...)` shape as the existing assertions.

#### 2. INSERT negative control

**File**: `supabase/tests/evaluation-history.test.sql`

**Intent**: Prove the cross-account-write `42501` is caused by the `_insert_own` WITH CHECK clause (RLS), not by a missing grant — by relaxing only the WITH CHECK and showing the previously-denied write now succeeds.

**Contract**: As superuser, `alter policy "evaluation_history_insert_own" on public.evaluation_history with check (true);` (leave the grant intact). Re-establish Alice's role + JWT GUCs, then `lives_ok(...)` on the same cross-account insert (a row with `user_id` = Bob) that earlier raised `42501`. **No third-user trick** — the table has no `UNIQUE(user_id)`, so the relaxed insert succeeds rather than tripping `23505`. Add a one-line comment noting why the trick is omitted.

#### 3. Bump the plan count

**File**: `supabase/tests/evaluation-history.test.sql`

**Intent**: Keep the pgTAP plan honest after adding assertions.

**Contract**: Change `select plan(6)` to the new total (existing 6 + the SELECT control + the INSERT control). Update the file header comment block to note the controls are now present (the header currently says they are "added by Phase 3").

### Success Criteria:

#### Automated Verification:

- [ ] pgTAP suite passes: `npm run db:test`
- [ ] SQL lint clean: `npx supabase db lint --level warning`
- [ ] Plan count matches assertions (no pgTAP plan-mismatch warning in the run output)

#### Manual Verification:

- [ ] Temporarily neutralizing the SELECT control mutation (revert `using (true)`) makes the new SELECT-control assertion fail — confirming it is causally bound
- [ ] Temporarily neutralizing the INSERT control mutation makes the `lives_ok` assertion fail (write goes back to `42501`)
- [ ] The unmutated suite is green end-to-end

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation that the negative-control flip was verified before proceeding to Phase 2.

---

## Phase 2: Vitest service suite + R5 guard (R5)

### Overview

Add the missing direct unit coverage for `evaluation-history.ts` at full parity with the `user-lists` sibling, and prove R5: the stored `contract` is served byte-identical regardless of live pool/join data.

### Changes Required:

#### 1. New unit suite with fake Supabase client

**File**: `test/evaluation-history.test.ts`

**Intent**: Mirror `test/user-lists.test.ts`'s hand-rolled fake query-builder, adapted to the two chains this service uses — `.from().insert()` (resolves `{ error }`) and `.from().select().eq().order()` (resolves `{ data, error }`) — capturing call arguments for payload/column assertions.

**Contract**: A `makeClient({ data?, error? })` helper exposing `{ client, calls }`. The `select` chain is `select → eq → order`, where `order` resolves the promise (it is the terminal call in `getEvaluationHistory`, ordered `created_at` descending). `calls` records the table name, insert payload, `eq` column/value, and `order` arguments.

#### 2. `saveEvaluation` cases

**File**: `test/evaluation-history.test.ts`

**Intent**: Cover the save path's contracts.

**Contract**: Three `it` cases — (a) throws `/no Supabase client/` when client is null; (b) inserts into `evaluation_history` with a payload carrying `user_id`, `contract`, `counterparty_id`, `verdict`, `delta_pln`, `threshold_pct`, `source` (assert the fields map from the `EvaluateResponse`); (c) propagates a DB error as `/evaluation_history save failed: <msg>/` and preserves `cause.code`.

#### 3. `getEvaluationHistory` cases

**File**: `test/evaluation-history.test.ts`

**Intent**: Cover the read path's contracts: null-client, query, mapping, empty, ordering, error.

**Contract**: Cases — (a) throws `/no Supabase client/` when null; (b) queries `evaluation_history` filtered `eq("user_id", …)` and ordered `created_at` ascending:false; (c) maps a row including the `counterparties: { name }` join to `counterparty_name`, and a NO-MATCH row (`counterparty_id`/`verdict`/`delta_pln` null, `counterparties` null) to `counterparty_name: null`; (d) returns `[]` for no history; (e) propagates a DB error as `/evaluation_history read failed: <msg>/` with `cause.code`.

#### 4. R5 byte-identical guard (join-rename)

**File**: `test/evaluation-history.test.ts`

**Intent**: Prove the stored contract is the frozen source of truth — the read returns it verbatim even when the live counterparty join yields a *different* name than the one embedded in the contract at save time.

**Contract**: Seed the fake `data` with a row whose `contract` string embeds a counterparty name (e.g. a Markdown blob mentioning `"Alice's Toys"`) while `counterparties.name` returns a **renamed** value (e.g. `"Renamed Co"`). Assert: `item.contract` is `===` the exact stored blob (byte-identical, still mentioning the original embedded name) AND `item.counterparty_name === "Renamed Co"` (the live join). This proves the contract is not reconstructed from `counterparty_id` + live pool data.

### Success Criteria:

#### Automated Verification:

- [ ] New suite passes: `npm test`
- [ ] Type checking passes (Vitest run type-checks the spec): no TS errors in `test/evaluation-history.test.ts`
- [ ] Lint passes: `npm run lint`
- [ ] Every exported function branch in `evaluation-history.ts` is exercised (null-client, error, success, empty, join-null) — confirmed by reading the spec against the source

#### Manual Verification:

- [ ] Temporarily changing the asserted `contract` expectation to the *renamed* name makes the R5 test fail — confirming it pins byte-identity, not a re-render
- [ ] The suite mirrors `test/user-lists.test.ts` structure (reviewer can diff the two and see parity)

**Implementation Note**: After this phase and automated verification, confirm the R5 flip manually as above.

---

## Testing Strategy

### Unit Tests (Vitest — `test/evaluation-history.test.ts`)

- `saveEvaluation`: null-client throw, insert payload shape, DB-error propagation + `cause.code`.
- `getEvaluationHistory`: null-client throw, query filter/order, join mapping (named + NO-MATCH/null), empty array, DB-error propagation + `cause.code`.
- **R5 edge case**: contract byte-identity under a renamed live join (the load-bearing regression guard).

### Integration Tests (pgTAP — `supabase/tests/evaluation-history.test.sql`)

- Existing positive isolation (unchanged): cross-read = 0, cross-write `42501`, append, superuser sanity.
- **New negative controls**: SELECT relaxation flips Alice's count to 2; INSERT WITH-CHECK relaxation flips the cross-write from `42501` to success.

### Manual Testing Steps

1. Run `npm run db:test` — suite green; check run output for no plan-mismatch.
2. In a scratch edit, revert one control mutation; re-run; confirm the bound assertion fails; restore.
3. Run `npm test` — new suite green.
4. In a scratch edit, change the R5 contract assertion to the renamed name; confirm it fails; restore.

## Performance Considerations

None — both suites run in milliseconds and add a handful of assertions. No new dependencies.

## Migration Notes

None — no schema or migration changes. Test SQL files are not immutable (only `supabase/migrations/*` are), so extending the existing test in place is within the rules.

## References

- Test rollout: `context/foundation/test-plan.md` §3 (Phase 3), §6.1 (pgTAP cookbook), §6.4 (determinism cookbook)
- Source under test: `src/lib/evaluation-history.ts`
- pgTAP worked examples: `supabase/tests/user-lists.test.sql`, `supabase/tests/rls_template.test.sql`
- Vitest sibling: `test/user-lists.test.ts`
- Endpoint wiring (already covered, untouched): `test/evaluate.test.ts:117–140`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: pgTAP negative controls (R1)

#### Automated

- [x] 1.1 pgTAP suite passes: `npm run db:test`
- [x] 1.2 SQL lint clean: `npx supabase db lint --level warning`
- [x] 1.3 Plan count matches assertions (no plan-mismatch in run output)

#### Manual

- [x] 1.4 Reverting the SELECT control mutation makes its assertion fail (causally bound)
- [x] 1.5 Reverting the INSERT control mutation flips the write back to `42501`
- [x] 1.6 Unmutated suite is green end-to-end

### Phase 2: Vitest service suite + R5 guard (R5)

#### Automated

- [ ] 2.1 New suite passes: `npm test`
- [ ] 2.2 No TS errors in `test/evaluation-history.test.ts`
- [ ] 2.3 Lint passes: `npm run lint`
- [ ] 2.4 Every exported-function branch in `evaluation-history.ts` is exercised

#### Manual

- [ ] 2.5 Changing the R5 contract assertion to the renamed name makes the test fail (pins byte-identity)
- [ ] 2.6 Suite mirrors `test/user-lists.test.ts` structure (parity on diff)
