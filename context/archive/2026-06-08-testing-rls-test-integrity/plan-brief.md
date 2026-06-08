# RLS Test Integrity + Isolation Proof — Plan Brief

> Full plan: `context/changes/testing-rls-test-integrity/plan.md`
> Upstream framing: `context/foundation/test-plan.md` (§2 R1/R2, §3 Phase 1)

## What & Why

Make every RLS pgTAP test **provably fail when its policy is broken**, and lock cross-account isolation on the existing user-scoped tables. This is Phase 1 of the frozen test rollout, protecting the two High×High risks: a cross-account data leak (R1) and — the direct target — a test that passes green while the policy is actually broken (R2, which the team reports has already happened).

## Starting Point

Three pgTAP tests run today (`supabase/tests/`): `rls_template` (synthetic probe + the documented spec), `user-lists` (real user-scoped table), `counterparties` (shared read-only). They assert isolation well in the *positive* direction (own row visible, cross-write → `42501`, superuser sees all). What's missing: nothing proves an assertion would *flip* if the policy were dropped or relaxed — and `throws_ok('42501')` is ambiguous between an RLS denial and a missing grant.

## Desired End State

Each test gains an in-transaction **negative control**: after the positive asserts, it mutates its own policy (rolled back with the test) and re-asserts the behavior flips — the hidden cross-account row becomes visible, and the previously-denied write succeeds once the `WITH CHECK` is relaxed (grant left intact, pinning the `42501` to RLS). Breaking a real policy now turns a test red. The test-plan cookbook documents the recipe.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Negative-control mechanism | In-txn policy mutation | Postgres policy DDL is transactional, so mutate-then-reassert proves runtime binding with zero harness changes, fully rolled back. | Plan |
| Scope of hardening | All three existing tests | Every live RLS test must be trustworthy, including the shared-table write-denial. | Plan |
| `42501` ambiguity | Pin denial to RLS via the control | Relaxing only the `WITH CHECK` (grant untouched) and showing the write succeed proves the denial was RLS, not a missing grant. | Plan |
| Doc/gate work | Fill test-plan §6.1 + note CI already wired | §6.1 is the named Phase-1 deliverable; the `db` CI job already runs the suite, so only branch-protection (out of repo) remains. | Plan |
| Migrations | Untouched | Immutable by contract; controls mutate policy only inside the rolled-back test txn. | test-plan / CLAUDE.md |

## Scope

**In scope:**
- Negative-control coda in `rls_template.test.sql`, `user-lists.test.sql` (SELECT visibility flip + INSERT `42501`→success).
- Inverted control in `counterparties.test.sql` (grant + permissive policy → write succeeds).
- Fill `test-plan.md` §6.1 cookbook; note CI gate already wired.

**Out of scope:**
- Any migration edit; the `evaluations`/history table + test (Phase 3, S-03 not built).
- A separate expected-fail mutation harness; `pg_policies` catalog-only assertions.
- `supabase/README.md` edits; GitHub branch-protection config.

## Architecture / Approach

Each test keeps its positive assertions and appends a coda inside the existing `begin … rollback`: (1) prove isolation holds, (2) `alter`/`drop` the relevant policy in-txn, (3) re-assert under the same spoofed JWT identity that behavior flipped. Shared read-only `counterparties` uses the inverse (no write policy exists → add grant+policy, show write succeed). Every `plan(N)` is recounted to match new assertions.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. User-scoped controls | Negative controls in `rls_template` + `user_lists` (SELECT flip + INSERT disambiguation) | Forgetting to re-set role/JWT GUCs after `reset role`; miscounting `plan(N)` |
| 2. Shared-table inverted control | `counterparties` write-denial proven real | Mutating the grant instead of only the policy would prove nothing |
| 3. Cookbook + gate note | `test-plan.md` §6.1 recipe + CI-gate note | Doc drifting from the actual test shape |

**Prerequisites:** Local Supabase stack bootable (`npx supabase start` / `supabase db start`); `npm run db:test` runnable.
**Estimated effort:** ~1 session across 3 small phases (all in test SQL + one doc file).

## Open Risks & Assumptions

- Assumes policy DDL inside the test transaction is rolled back cleanly — true for Postgres, verified by the existing `begin … rollback` envelope.
- Negative controls add assertions; each `plan(N)` must be recounted or the suite reports a plan mismatch.
- The `42501` disambiguation depends on the mutation step being present (Q1 = mutation) — kept in lockstep within each phase.

## Success Criteria (Summary)

- `npm run db:test` green with the new controls; assertion counts match `plan(N)`.
- Sabotaging a real policy (uncommitted) turns the relevant test red — the controls demonstrably bite.
- `test-plan.md` §6.1 documents the recipe and the CI-gate status accurately.
