# RLS Test Integrity + Isolation Proof Implementation Plan

## Overview

Harden the three existing pgTAP RLS tests so each one **provably fails when its policy is broken**, closing the R2 false-green gap, and lock cross-account isolation (R1) on the existing user-scoped tables. The mechanism is an in-transaction **negative control**: after the existing positive assertions, mutate the policy (drop/relax) inside the same `begin … rollback` envelope and re-assert that the previously-isolated behavior flips. This proves each assertion is causally bound to the policy, not to data absence or an unrelated grant. Finally, document the pattern in the test-plan cookbook and record that CI already runs the suite.

This is **Phase 1 of the frozen test rollout** (`context/foundation/test-plan.md` §3). The test-plan settles the framing: risks R1 (cross-account leak) and R2 (false-green RLS test), the cheapest layer (pgTAP integration), and the anti-patterns to avoid.

## Current State Analysis

Three pgTAP tests run today under `supabase test db` (and `npm run db:test`), each inside a `begin … rollback` transaction:

- `supabase/tests/rls_template.test.sql` — builds a synthetic `public._rls_probe` four-policy table (the documented executable spec of the template in `supabase/README.md`). Asserts: helpers exist, `current_user_id()` is NULL outside auth, Alice/Bob each see exactly their own row, Alice cannot insert as Bob (`42501`), superuser sees both rows.
- `supabase/tests/user-lists.test.sql` — the real user-scoped `public.user_lists` (S-02). Asserts: table exists + RLS enabled, own-row-visible, cross-write `42501`, upsert replaces (count stays 1), superuser sees the upserted value.
- `supabase/tests/counterparties.test.sql` — shared read-only pool (`using(true)`). Asserts: table exists + RLS enabled, anon sees all 5 rows, exact v1 order, byte-identical row content, an authenticated insert is denied (`42501`).

The gaps this plan closes:

1. **No negative control (R2).** The superuser-sees-all check proves rows *exist* (RLS is the filter, not data absence) — but nothing proves the isolation assertion would *flip* if the policy were dropped or relaxed to `using(true)`. A policy silently broken to `using(true)` on SELECT would still let the `count=1` assertion fail today *only because* Alice would see 2 rows — but that coupling is implicit and untested. The interview (test-plan R2 source, Q2) reports a green-but-broken test already happened. We make the coupling explicit and self-proving.
2. **`42501` is ambiguous (write-path false-green).** `throws_ok(…, '42501')` matches the SQLSTATE for *both* an RLS `WITH CHECK` violation *and* a missing table-level INSERT grant. The cross-write test could pass green for the wrong reason. The grants are present today, so the denial *is* RLS — but the test does not prove it.

### Key Discoveries:

- Postgres policy DDL (`create/alter/drop policy`, `grant`) is **transactional** — mutations made after the positive asserts are rolled back with the rest of the test (`supabase/tests/rls_template.test.sql:23,201`). No harness change needed.
- The JWT-spoofing identity-switch pattern sets **both** `request.jwt.claims` (JSON) and the legacy `request.jwt.claim.sub` GUC at every switch for image-version portability (`rls_template.test.sql:121-141`). Negative-control sections must keep this dual-set when re-asserting under an identity.
- `select plan(N)` declares the exact assertion count up front (`rls_template.test.sql:25`). Adding assertions requires bumping `N` to match, or the test fails with a plan mismatch.
- The CI `db` job **already** runs `supabase db lint --level warning` + `supabase test db` (`.github/workflows/ci.yml:28-44`), and `npm run db:test` exists (`package.json`). The gate is wired in-repo; only GitHub branch-protection "required status" is outside the repo.
- `evaluations` (S-03) is **not built** — that is Phase 3 of the rollout. Today `user_lists` is the only real user-scoped table; `_rls_probe` is synthetic to the template test.

## Desired End State

`npm run db:test` passes, and each of the three tests now contains an explicit negative-control section proving the assertion is bound to its policy:

- For the two user-scoped four-policy tables: relaxing SELECT to `using(true)` makes the hidden cross-account row become visible; relaxing the INSERT `WITH CHECK` (grant untouched) makes the previously-`42501` cross-write succeed — pinning the denial to RLS.
- For the shared read-only table: adding an INSERT grant + permissive policy makes the previously-`42501` write succeed, proving the denial is real (absence of a write policy) and not an artifact.

Verification that the controls actually bite: temporarily breaking a real policy in a working copy (not committed) must turn a test **red** — the controls would not catch nothing.

`context/foundation/test-plan.md` §6.1 documents the recipe, and the plan records that CI already runs the suite.

## What We're NOT Doing

- **Not editing any migration.** Migrations are immutable (`CLAUDE.md`, `supabase/README.md`). All work is in `supabase/tests/*.sql` and docs. The negative controls mutate policies only *inside the test transaction*, which is rolled back.
- **Not adding the `evaluations` history table or its test** — that is Phase 3 (S-03 not yet built).
- **Not building a separate expected-fail mutation harness** (Q1 rejected option B) — the in-txn mutation gives runtime proof without CI plumbing.
- **Not adding `pg_policies` catalog-only assertions** (Q1 rejected option C / Q3 rejected "assert grant exists first") — runtime mutation is the proof; structural text-matching is the false-green the test-plan warns against.
- **Not updating `supabase/README.md`** (deselected in Q4) — `rls_template.test.sql` remains the executable spec; prose stays as-is this phase.
- **Not configuring GitHub branch protection** — flagged as an out-of-repo setting, not implemented here.

## Implementation Approach

Each test keeps its existing positive assertions unchanged and gains a **negative-control coda** appended before `select * from finish();`, all still inside the single `begin … rollback`. The pattern, established first in `rls_template.test.sql` (the documented canonical spec) and copied to `user_lists`:

1. (existing) prove isolation holds — cross-account row hidden, cross-write denied with `42501`.
2. (new) mutate the relevant policy in-txn — `alter policy … using (true)` for SELECT; drop/replace the `with check` for INSERT (grant left intact).
3. (new) re-assert under the same spoofed identity that the behavior **flipped** — the hidden row is now visible; the previously-denied insert now succeeds.

Because the flip only happens if (a) the role switch + JWT claim are live and (b) RLS is actually the enforcing mechanism, a passing negative control proves the positive assertion was meaningful. The shared read-only table uses the inverse: it has *no* write policy, so the control adds a grant + permissive policy and shows the write succeed.

Every `plan(N)` count is bumped to match the new assertion total.

## Critical Implementation Details

- **`plan(N)` must be recounted per file.** Each added `select … ('… test')` is one assertion; the header `plan(N)` must equal the final total or pgTAP reports a plan mismatch (not a per-assertion failure). Count deliberately when editing.
- **Reset identity between mutation and any superuser check.** The existing tests end with `reset role` before the superuser sanity assert. Negative-control re-asserts run *as the spoofed authenticated user*, so the dual GUC set (`request.jwt.claims` + `request.jwt.claim.sub`) must be re-established after any `reset role`, and `set local role authenticated` re-applied. Ordering matters: do the in-txn mutation, re-assert under identity, then (if needed) `reset role` last.
- **Grant must stay intact during the INSERT negative control.** The whole point of the `42501` disambiguation (Q3) is that relaxing *only* the `with check` — while the `authenticated` INSERT grant remains — flips the write from denied to allowed. If the grant were also dropped, the insert would still raise `42501` (missing privilege) and prove nothing. Mutate the policy, never the grant.

## Phase 1: Negative controls for user-scoped tables

### Overview

Establish the negative-control pattern in `rls_template.test.sql` (the canonical documented spec) and apply it to `user-lists.test.sql` (the one real user-scoped table). Closes R2 for SELECT isolation and the `42501` write-path ambiguity (R1/R2) on both.

### Changes Required:

#### 1. Canonical template test

**File**: `supabase/tests/rls_template.test.sql`

**Intent**: After the existing assertions, add an in-transaction negative-control coda proving (a) relaxing the SELECT policy to `using(true)` makes Bob's row visible to Alice, and (b) relaxing the INSERT `WITH CHECK` (grant untouched) makes Alice's previously-denied write-as-Bob succeed — pinning the `42501` to RLS. Bump `plan(9)` to the new total.

**Contract**: New assertions appended before `select * from finish();`, inside the existing `begin … rollback`. SELECT control: `alter policy "_rls_probe_select_own" on public._rls_probe using (true);` then re-assert Alice's visible `count = 2`. INSERT control: `alter policy "_rls_probe_insert_own" on public._rls_probe with check (true);` (grant unchanged) then assert the insert that previously raised `42501` now succeeds (e.g. `lives_ok`). Re-establish `set local role authenticated` + both JWT GUCs under Alice's identity before the re-asserts. `plan(N)` updated to match.

#### 2. user_lists test

**File**: `supabase/tests/user-lists.test.sql`

**Intent**: Apply the same negative-control pattern to `public.user_lists`: relax `user_lists_select_own` to `using(true)` and re-assert Alice sees both rows; relax `user_lists_insert_own`'s `with check` (grant intact) and re-assert the previously-`42501` cross-write succeeds. Bump `plan(6)` to the new total.

**Contract**: Coda appended before `finish()`, inside the existing transaction, mirroring the template's two controls against the `user_lists_select_own` / `user_lists_insert_own` policy names. Identity re-established under Alice before re-asserts. `plan(N)` updated.

### Success Criteria:

#### Automated Verification:

- pgTAP suite passes: `npm run db:test`
- Each test's `plan(N)` equals its actual assertion count (no pgTAP plan mismatch in output)
- SQL lint passes: `supabase db lint --level warning`

#### Manual Verification:

- Sabotage check (not committed): relaxing `_rls_probe_select_own` to `using(true)` in the *base* table definition (before the coda) turns the positive SELECT assert **and** the negative control behavior such that the test goes red — confirming the control is causally live.
- Sabotage check: dropping the `with check` from `user_lists_insert_own` at definition time turns the cross-write `42501` assert red — confirming `42501` was RLS, not a grant artifact.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the sabotage checks behaved as expected before proceeding to the next phase.

---

## Phase 2: Inverted control for the shared read-only table

### Overview

`counterparties` has no write policy by design (writes are migration-only). The negative control is therefore *inverted*: prove the write-denial is real by granting INSERT + adding a permissive policy in-txn and showing the previously-`42501` insert now succeeds, then confirm the seeded read-path is unaffected.

### Changes Required:

#### 1. counterparties test

**File**: `supabase/tests/counterparties.test.sql`

**Intent**: After the existing assertions, add an inverted negative control: as `authenticated`, grant INSERT and create a permissive insert policy in-txn, then assert the same insert that previously raised `42501` now succeeds — proving the denial stems from the absent write policy, not an unrelated artifact. Confirm the read-path (anon sees 5 rows) is unchanged after the mutation. Bump `plan(6)` to the new total.

**Contract**: Coda appended before `finish()`, inside the existing transaction. `grant insert on public.counterparties to authenticated;` + `create policy "_cp_write_probe" on public.counterparties for insert to authenticated with check (true);` then `lives_ok` on the insert that line 83-89 expects to throw. The mutation is rolled back with the transaction. `plan(N)` updated.

### Success Criteria:

#### Automated Verification:

- pgTAP suite passes: `npm run db:test`
- `plan(N)` equals actual assertion count
- SQL lint passes: `supabase db lint --level warning`

#### Manual Verification:

- Sabotage check (not committed): adding a permissive insert policy in the *base* setup turns the existing `42501` write-denial assert red — confirming the denial assert is live and the inverted control is meaningful.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human before proceeding to the next phase.

---

## Phase 3: Cookbook + gate documentation

### Overview

Replace the `TBD` placeholder in the test-plan cookbook with the concrete negative-control recipe, and record that CI already runs the suite (the only residual being a GitHub branch-protection setting).

### Changes Required:

#### 1. Test-plan cookbook §6.1

**File**: `context/foundation/test-plan.md`

**Intent**: Replace the `TBD — see §3 Phase 1` bullet in §6.1 with the concrete recipe: the four-policy positive asserts (own-row-visible, cross-write `42501`, superuser-sees-all) **plus** the in-txn negative control (relax SELECT → row becomes visible; relax INSERT `with check`, grant intact → write succeeds), and the inverted shape for shared read-only tables (grant + permissive policy → write succeeds). Reference the three tests as worked examples. Update the §-header "Last updated" line.

**Contract**: §6.1 prose edit; the three test files cited as examples; `npm run db:test` as the run command (already present). No change to §1–§5 strategy.

#### 2. CI gate note

**File**: `context/foundation/test-plan.md`

**Intent**: In §5 (and/or §6.1), note that `.github/workflows/ci.yml`'s `db` job already runs `supabase test db` + `supabase db lint --level warning`, so the suite is wired as an in-repo gate; the only residual to make it *blocking* is marking the `db` job a required status check in GitHub branch protection (an out-of-repo setting).

**Contract**: Prose note in `test-plan.md` §5; no workflow file edit (the job already exists).

### Success Criteria:

#### Automated Verification:

- Markdown is well-formed (no broken table syntax): file renders / `prettier --check context/foundation/test-plan.md` if run
- §6.1 no longer contains the literal string `TBD — see §3 Phase 1`

#### Manual Verification:

- A reader unfamiliar with the suite can follow §6.1 to add a new RLS test with a negative control without reading the test source.
- The CI-gate note accurately matches `ci.yml` (`db` job present, runs `supabase test db`).

**Implementation Note**: After completing this phase, pause for human confirmation that the cookbook recipe reads correctly and the gate note is accurate.

---

## Testing Strategy

### Unit Tests:

- N/A — this change *is* test hardening. The "units" are the pgTAP assertions themselves.

### Integration Tests:

- The three pgTAP tests under `supabase/tests/` are the integration layer (Postgres + RLS). All run via `npm run db:test` / `supabase test db`.

### Manual Testing Steps:

1. Run `npm run db:test` — all three tests green, assertion counts match `plan(N)`.
2. In a throwaway working copy, sabotage one real policy at definition time (e.g. `_rls_probe_select_own → using(true)`; drop `user_lists_insert_own`'s `with check`; add an insert policy to `counterparties`) and confirm the relevant test goes **red**. Revert.
3. Confirm `supabase db lint --level warning` is clean.

## Performance Considerations

Negligible. Each test adds a handful of assertions and one or two policy DDL statements inside an already-transactional, already-rolled-back test. No impact on app runtime; the suite runs only in CI's `db` job and local `db:test`.

## Migration Notes

No migrations are touched. The negative controls mutate policies only inside the test transaction, which rolls back — production schema is unaffected and migration immutability is preserved.

## References

- Test rollout strategy & risk map: `context/foundation/test-plan.md` (§2 R1/R2, §3 Phase 1, §6.1)
- RLS contract (prose): `supabase/README.md`
- RLS contract (executable spec): `supabase/tests/rls_template.test.sql`
- Tables under test: `supabase/migrations/20260601120000_user_lists.sql`, `supabase/migrations/20260530120000_counterparties.sql`, helpers in `supabase/migrations/20260529120000_rls_baseline.sql`
- CI gate: `.github/workflows/ci.yml:28-44`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Negative controls for user-scoped tables

#### Automated

- [x] 1.1 pgTAP suite passes: `npm run db:test` — 61c6b50
- [x] 1.2 Each test's `plan(N)` equals its actual assertion count (no plan mismatch) — 61c6b50
- [x] 1.3 SQL lint passes: `supabase db lint --level warning` — 61c6b50

#### Manual

- [x] 1.4 Sabotage check: relaxing `_rls_probe_select_own` to `using(true)` at definition time turns the template test red — 61c6b50
- [x] 1.5 Sabotage check: dropping `user_lists_insert_own`'s `with check` turns the cross-write `42501` assert red — 61c6b50

### Phase 2: Inverted control for the shared read-only table

#### Automated

- [x] 2.1 pgTAP suite passes: `npm run db:test` — 69fc5ab
- [x] 2.2 `plan(N)` equals actual assertion count — 69fc5ab
- [x] 2.3 SQL lint passes: `supabase db lint --level warning` — 69fc5ab

#### Manual

- [x] 2.4 Sabotage check: adding a permissive insert policy at setup time turns the `counterparties` write-denial assert red — 69fc5ab

### Phase 3: Cookbook + gate documentation

#### Automated

- [x] 3.1 §6.1 no longer contains the literal `TBD — see §3 Phase 1`
- [x] 3.2 Markdown well-formed (`prettier --check context/foundation/test-plan.md` if run)

#### Manual

- [x] 3.3 A reader can follow §6.1 to add a new RLS test with a negative control unaided
- [x] 3.4 CI-gate note accurately matches `ci.yml` (`db` job runs `supabase test db`)
