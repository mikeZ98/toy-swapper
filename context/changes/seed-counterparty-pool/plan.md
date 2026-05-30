# Counterparty Pool Migrated to Seeded Table — Implementation Plan

## Overview

Move the 5-counterparty `FIXTURE_POOL` out of `src/lib/fixture-pool.ts` and into a seeded, RLS-protected `public.counterparties` table; flip the evaluator to read the pool from Postgres instead of importing a hardcoded array; delete the module. The binding constraint is the v1→v2 determinism guarantee: the same `give-list` + `want-list` must continue to produce **byte-identical** Markdown after the read-source flip (PRD FR-017, NFR). A regression test proves equivalence before the module is deleted.

## Current State Analysis

- **`evaluate()` is pure and DB-free.** `src/lib/evaluator.ts:14` does `import { FIXTURE_POOL }` and `:378` calls `findBestMatch(op_give, op_want, FIXTURE_POOL, processOpts)`. The API route `src/pages/api/evaluate.ts` calls `evaluate(give, want, opts)` with no Supabase client. F-02 introduces the evaluator's first DB read.
- **Counterparty `id` is a human slug** (`"kasia-warszawa"`), embedded verbatim in the contract output (`renderContract`, `evaluator.ts:338`). It must stay a text slug PK, not a uuid — changing it changes output bytes.
- **Pool order is determinism-load-bearing.** `findBestMatch` (`evaluator.ts:247-251`) sorts candidates with a *stable* `Array.prototype.sort` and a two-key comparator (`delta_pln` asc, then `matched_giving + matched_receiving` desc). On a full tie it keeps insertion order and returns `candidates[0]`. `FIXTURE_POOL` order (`kasia, tom, ania, piotr, mira`) is **not** alphabetical by id, so a DB query that returns rows in any other order can change the selected counterparty on a tie → different bytes.
- **"fixture pool" appears in user-facing output.** The NO MATCH contract (`evaluator.ts:308`) reads "No counterparty in the fixture pool overlaps…". Rewording it would itself break byte-identical determinism for NO-MATCH inputs.
- **No JS test runner exists.** `package.json` scripts are `dev/build/preview/astro/db:test/lint/lint:fix/format` — no vitest/jest. `@supabase/supabase-js ^2.99.1` and `@supabase/ssr ^0.10.3` are present.
- **F-01 shipped the RLS contract.** `supabase/migrations/20260529120000_rls_baseline.sql` provides `app.current_user_id()` / `app.tg_set_updated_at()` and the four-policy template. `supabase/README.md` already names "F-02's counterparty pool" as the canonical **shared read-only** RLS deviation (enable RLS, `select` to `anon, authenticated`, no per-row `user_id`). `supabase/tests/rls_template.test.sql` is the pgTAP pattern to copy. CI runs `db lint` + `test db` + gated `db push` (`.github/workflows/ci.yml`).
- **Local-DB caveat (carried from F-01).** This machine runs Postgres via Colima; the Supabase CLI's host→`54322` forward is broken by a stale `~/.colima`. Local DB verification is done via `docker exec supabase_db_toy-swapper psql …`; the literal `supabase test db` / `db reset` CLI rides Phase-3 CI. See `context/archive/2026-05-29-postgres-rls-baseline/plan.md` "Environment constraints".

## Desired End State

After this change:
- `public.counterparties` exists, seeded by a migration with 5 rows byte-identical to the v1 `FIXTURE_POOL`, RLS-enabled, `select`-able by `anon` + `authenticated`, with no write policies.
- `evaluate(give, want, pool, opts)` takes the pool as a parameter; `src/lib/counterparties.ts` fetches it from the DB ordered by `sort_order`; the API route wires the client → pool → evaluator.
- `src/lib/fixture-pool.ts` is deleted; no `FIXTURE_POOL` reference remains in `src/`.
- A vitest suite proves the contract output is byte-identical for representative inputs over the seeded pool, and runs in CI.
- For any given `give`/`want`, the produced Markdown is byte-identical to v1.

### Verification:
- `npx supabase db reset` (or docker-exec equivalent) applies the new migration and seeds 5 rows.
- pgTAP `supabase/tests/counterparties.test.sql` passes: 5 rows visible to `anon` in `sort_order`, content matches the golden fixture, writes are denied (`42501`).
- `npm test` (vitest) passes: `evaluate()` over the golden pool yields the checked-in expected contracts byte-for-byte.
- `POST /api/evaluate` with a known fixture input returns a contract byte-identical to the v1 output.
- `grep -rn FIXTURE_POOL src/` returns nothing.

### Key Discoveries:
- Determinism hinges on (a) seed fidelity, (b) row order via `sort_order`, (c) leaving output-affecting copy untouched. All three are addressed explicitly.
- The evaluator's stub path is pure and network-free (`processListStub`); vitest runs it with no API key and no DB, so the determinism test is CI-friendly without a live Postgres.
- The seed must live in a **migration**, not `supabase/seed.sql` — `seed.sql` runs only on local `db reset`, never on `db push`, so prod would otherwise have an empty table (PRD also makes seeded-counterparty migrations explicit determinism boundaries).

## What We're NOT Doing

- **Not gating the evaluator** — S-01 (gated-evaluator) owns auth gating of `/` and `/api/evaluate`. F-02 reads the shared pool with the anon key; no session required.
- **Not changing matching, valuation, fairness, or rendering logic** — `KEYWORD_MAP`, `CONDITION_MAP`, `computeVerdict`, `renderContract`, the LLM call shape, and all output copy (including the "fixture pool" NO-MATCH line) stay byte-identical.
- **Not adding per-user counterparty authorship** (PRD OQ-6, v3 scope) — the table is shared and read-only.
- **Not generating `Database<T>` types** — a single hand-written row interface suffices; `supabase gen types` can come with S-02's first user-scoped table.
- **Not seeding via `supabase/seed.sql`** — see Key Discoveries.
- **Not touching `app.*` helpers or the F-01 migration** — migrations are immutable; this is a new additive migration.

## Implementation Approach

Three phases of escalating commitment, each independently verifiable and safe to pause at. Phase 1 lands the data layer (table + seed + RLS + pgTAP) with zero app changes — `fixture-pool.ts` is still the live source. Phase 2 introduces the DB read behind a determinism gate: the evaluator gains a `pool` parameter, a data-access module fetches the seeded rows, the API route wires them, and a vitest suite proves `evaluate()` over `FIXTURE_POOL` equals `evaluate()` over the DB-shaped pool byte-for-byte — all while the module still exists, so a failure is reversible. Phase 3 deletes the module, drops the now-impossible equivalence assertion, keeps the golden-snapshot determinism test, and wires vitest into CI so future drift is caught.

## Critical Implementation Details

- **Row ordering is the determinism boundary.** The DB read MUST be `order by sort_order asc`, and the seed MUST assign `sort_order` 1..5 in the exact `FIXTURE_POOL` array order (`kasia-warszawa`=1, `tom-krakow`=2, `ania-wroclaw`=3, `piotr-gdansk`=4, `mira-poznan`=5). Any other order can flip tie-broken matches.
- **Seed fidelity is byte-level.** The `give`/`want`/`name` strings carry Polish diacritics and exact punctuation/spacing; they must be copied verbatim (UTF-8) from `fixture-pool.ts` into the migration `INSERT`. The golden fixture and pgTAP assertions exist to catch any drift.
- **The evaluator now hard-depends on a reachable DB.** With the module deleted, a null Supabase client (env unset) or an empty/failed query must throw so the API returns 500 — the evaluator no longer has an in-process fallback. Local dev therefore requires `.dev.vars` pointing at the local stack (documented in README).

## Phase 1: Counterparty table + seed migration + RLS + pgTAP

### Overview

Ship the data layer only: a new migration creating `public.counterparties` (shared read-only RLS shape), seeding the 5 rows byte-identical to `FIXTURE_POOL` with explicit `sort_order`, plus a pgTAP test proving visibility, ordering, content, and write-denial. No application code changes; `fixture-pool.ts` remains the live source of truth.

### Changes Required:

#### 1. Counterparties table + seed migration

**File**: `supabase/migrations/20260530120000_counterparties.sql`

**Intent**: Create the shared read-only counterparty pool table, enable RLS with a documented anon+authenticated read policy and no write policies, and seed the 5 rows verbatim from `FIXTURE_POOL` with `sort_order` preserving array order.

**Contract**:
- `create table public.counterparties (id text primary key, sort_order smallint not null unique, name text not null, give text not null, want text not null, created_at timestamptz not null default now());`
- `alter table public.counterparties enable row level security;`
- One policy `counterparties_select_all for select to anon, authenticated using (true)` carrying a `comment on policy` audit note: shared read-only seeded pool, no per-row `user_id` scoping by design (per `supabase/README.md` deviation).
- `grant select on public.counterparties to anon, authenticated;` — no insert/update/delete grants or policies.
- Five `insert` rows, `sort_order` 1..5 mapping `kasia-warszawa, tom-krakow, ania-wroclaw, piotr-gdansk, mira-poznan`, with `name/give/want` copied byte-for-byte from `src/lib/fixture-pool.ts`.
- Filename timestamp is immutable once on master.

#### 2. pgTAP test for the counterparty table

**File**: `supabase/tests/counterparties.test.sql`

**Intent**: Prove the seeded table is visible to unauthenticated readers in the correct order with the correct content, and that the shared-read shape still denies writes — the executable spec of the determinism + RLS contract for this table.

**Contract**: A single `begin; select plan(N); … select * from finish(); rollback;` pgTAP transaction asserting: `has_table('public','counterparties')`; RLS is enabled (`is(... rowsecurity ...)` or a policy check); as `anon` (set role + claims as in `rls_template.test.sql`) `results_eq` that `select count(*)` = 5 and that `select id from public.counterparties order by sort_order` equals the golden id sequence; `results_eq` on one full row's `name/give/want` to lock content; `throws_ok('42501')` on an `insert` attempt as `authenticated`.

#### 3. Document the shared read-only table as a worked example

**File**: `supabase/README.md`

**Intent**: Turn the existing forward-reference ("F-02's counterparty pool") into a concrete worked example of the read-only-shared deviation so future shared tables copy it.

**Contract**: Extend the existing read-only-shared paragraph with the `counterparties` shape: RLS on, `select` to `anon, authenticated using (true)` + audit comment, no write policies/grants, seeded via migration (not `seed.sql`). Under 30 added lines, CommonMark only.

### Success Criteria:

#### Automated Verification:

- `supabase/migrations/20260530120000_counterparties.sql` applies cleanly from a fresh DB (`db reset`, or docker-exec `psql -f`) with no error
- After apply, `select count(*) from public.counterparties` = 5 and `select id ... order by sort_order` matches the golden sequence
- `npx supabase test db` (or docker-exec pgTAP) passes including the new `counterparties.test.sql`
- `npm run lint` and `npm run build` still pass (no app code touched)

#### Manual Verification:

- A reviewer can `select * from public.counterparties order by sort_order` and confirm the 5 rows are byte-identical to `src/lib/fixture-pool.ts` (diacritics, punctuation, spacing)
- As an `anon` session the rows are readable; an `insert`/`update`/`delete` is denied

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Read flip with determinism gate

### Overview

Introduce the DB read behind a determinism gate. Add a data-access module, change `evaluate()` to accept the pool as a parameter, wire the API route to fetch and pass it, and add vitest with a golden fixture + expected-contract snapshots. Prove `evaluate()` over `FIXTURE_POOL` is byte-identical to `evaluate()` over the DB-shaped pool — while `fixture-pool.ts` still exists, so the flip is reversible.

### Changes Required:

#### 1. Counterparty data-access module

**File**: `src/lib/counterparties.ts`

**Intent**: Provide the single read path for the seeded pool, ordered deterministically, that throws on failure so the evaluator's hard DB dependency is explicit.

**Contract**: `export async function getCounterpartyPool(client: SupabaseClient): Promise<Counterparty[]>` — selects `id, name, give, want` `order by sort_order asc`, maps rows to the existing `Counterparty` type, and throws if `client` is null, the query errors, or zero rows return (the 500 path). A row interface (`{ id; sort_order; name; give; want }`) is declared locally; no generated `Database<T>` types.

#### 2. Inject the pool into the evaluator

**File**: `src/lib/evaluator.ts`

**Intent**: Make the pool a parameter so the source (hardcoded vs DB) is the caller's choice and the determinism test can compare both. Remove the internal `FIXTURE_POOL` dependency from `evaluate()` without changing any matching/valuation/rendering behavior.

**Contract**: Change signature to `evaluate(give: string, want: string, pool: Counterparty[], opts: EvaluateOptions)`; pass `pool` into `findBestMatch`. Delete the `import { FIXTURE_POOL }` line (the file still exists; nothing else imports it yet). No change to `KEYWORD_MAP`, `CONDITION_MAP`, `computeVerdict`, `renderContract`, the LLM call, or any output string — including the line-308 "fixture pool" NO-MATCH copy.

#### 3. Wire the API route to fetch and pass the pool

**File**: `src/pages/api/evaluate.ts`

**Intent**: Create the Supabase client, fetch the pool, and pass it into `evaluate()`; surface a failed/empty read as a 500.

**Contract**: Add `cookies` to the handler context; build the client via `createClient(request.headers, cookies)`; call `getCounterpartyPool(client)` and pass the result as the new `pool` argument. A thrown pool error is caught by the existing `try/catch` and returned as 500 (`error: "evaluator failed"` or a clearer `"counterparty pool unavailable"` message). No change to request validation or success-path response shape.

#### 4. Add vitest + determinism fixtures

**File**: `package.json`, `vitest.config.ts`, `test/determinism.test.ts`, `test/fixtures/counterparty-pool.json`, `test/fixtures/contracts/*.md`

**Intent**: Establish the regression gate. A golden pool fixture (the 5 rows) plus expected contract snapshots for representative inputs let vitest lock byte-identical output without a live DB; an equivalence assertion proves the DB-shaped pool matches the hardcoded one before deletion.

**Contract**:
- Add `vitest` devDependency, a minimal `vitest.config.ts`, and `"test": "vitest run"` (alphabetized) in `package.json` scripts.
- `test/fixtures/counterparty-pool.json` captures the 5 rows verbatim (the golden pool).
- `test/fixtures/contracts/*.md` hold expected byte-identical contracts for ~3 representative `(give, want)` inputs covering FAIR, NEEDS BALANCING, and NO MATCH, produced via the stub path (no API key).
- `test/determinism.test.ts`: (a) for each fixture input, `evaluate(give, want, goldenPool, { thresholdPct: 20 })` equals the expected `.md` byte-for-byte; (b) **pre-deletion equivalence** — `FIXTURE_POOL` deep-equals the golden pool fixture (same content and order). Tests run the stub path; no network, no DB.

### Success Criteria:

#### Automated Verification:

- `npm test` passes: all representative contracts match their golden `.md` byte-for-byte
- The pre-deletion equivalence assertion (`FIXTURE_POOL` == golden pool) passes
- `npm run lint` and `npm run build` pass with the new signature and wiring
- `npx tsc`/astro type-check is clean (signature change propagated)

#### Manual Verification:

- With `.dev.vars` pointing at the local stack and the pool seeded, `npm run dev` + a `POST /api/evaluate` for a known fixture input returns a contract byte-identical to the v1 output
- Stopping the DB (or unsetting `SUPABASE_*`) makes `/api/evaluate` return 500, not a wrong/empty contract

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Delete fixture-pool.ts + lock determinism in CI

### Overview

Complete the migration: delete `src/lib/fixture-pool.ts`, remove the now-impossible pre-deletion equivalence assertion, keep the golden-snapshot determinism test, and wire vitest into CI so the byte-identical guarantee is enforced on every PR.

### Changes Required:

#### 1. Delete the module and the equivalence assertion

**File**: `src/lib/fixture-pool.ts` (deleted), `test/determinism.test.ts`

**Intent**: Remove the hardcoded pool now that the DB is the source of truth, and drop the equivalence assertion that referenced it (the golden-pool snapshot test remains as the ongoing gate).

**Contract**: `git rm src/lib/fixture-pool.ts`. Remove the `FIXTURE_POOL` import and the pre-deletion equivalence `it(...)` from `test/determinism.test.ts`; keep the golden-pool → expected-contract assertions. After this, `grep -rn FIXTURE_POOL src/ test/` returns nothing.

#### 2. Wire vitest into CI

**File**: `.github/workflows/ci.yml`

**Intent**: Enforce the determinism gate on every PR and push.

**Contract**: Add `npm test` to the existing `ci` job (after `npm run build`) or as a sibling step. No change to the `db` job. The pure stub-path test needs no DB, so it runs in the `ci` job without the Supabase stack.

#### 3. Confirm output-affecting copy retained

**File**: `src/lib/evaluator.ts` (verification only)

**Intent**: Document that the line-308 "fixture pool" NO-MATCH copy is intentionally retained for byte-identical determinism, despite the module rename.

**Contract**: No code change. A plan note + the NO-MATCH golden snapshot together assert the string is unchanged; any future reword is a deliberate determinism boundary in its own change.

### Success Criteria:

#### Automated Verification:

- `grep -rn FIXTURE_POOL src/ test/` returns nothing; `src/lib/fixture-pool.ts` no longer exists
- `npm test` passes with only the golden-pool determinism assertions
- `.github/workflows/ci.yml` `ci` job runs `npm test` (grep-verifiable)
- `npm run lint` and `npm run build` pass
- A no-op PR shows the `ci` job running and passing `npm test`

#### Manual Verification:

- `POST /api/evaluate` for the same known fixture inputs still returns byte-identical contracts (FAIR / NEEDS BALANCING / NO MATCH cases)
- After a merge to master, CI `db push` has the counterparties migration applied in prod and the evaluator works end-to-end against the cloud DB

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before declaring F-02 complete and the foundation ready to unlock S-03.

---

## Testing Strategy

### Unit Tests (vitest, stub path):

- `evaluate()` over the golden pool yields byte-identical contracts for representative FAIR / NEEDS BALANCING / NO MATCH inputs.
- Pre-deletion only: `FIXTURE_POOL` deep-equals the golden pool fixture.

### Integration Tests (pgTAP):

- `counterparties.test.sql`: table + RLS exist; `anon` sees 5 rows in `sort_order`; one row's content matches the golden fixture; writes denied (`42501`).

### Manual Testing Steps:

1. After Phase 1: apply the migration locally (docker-exec `psql` per the F-01 Colima caveat), `select * from public.counterparties order by sort_order`, diff against `fixture-pool.ts`.
2. After Phase 2: `npm test` green; `npm run dev` + `POST /api/evaluate` for a known input → contract byte-identical to v1; stop the DB → 500.
3. After Phase 3: `grep -rn FIXTURE_POOL src/ test/` empty; open a no-op PR and confirm `ci` runs `npm test`; after merge, confirm prod `db push` applied the migration.

## Performance Considerations

- The pool read is a single `select` of 5 rows ordered by an indexed unique column — negligible. The ≤5s end-to-end budget (≤10 counterparties) is unaffected; the dominant cost remains LLM standardization when a key is present.
- Per-request fetch (no module-level pool cache) keeps the read correct after a re-seed; 5 rows make caching unnecessary.

## Migration Notes

- `20260530120000_counterparties.sql` is immutable once on master. A future pool edit ships as a new timestamped migration — an explicit determinism boundary per PRD NFR.
- No backfill: there is no prior counterparty data in Postgres; the seed is the initial population.
- Rollback: if the read flip misbehaves, Phase 2 is reversible because `fixture-pool.ts` still exists until Phase 3. After Phase 3, reverting means restoring the module from git history.

## References

- Roadmap entry: `context/foundation/roadmap.md#f-02-counterparty-pool-migrated-to-seeded-table`
- PRD v2: `context/foundation/prd.md` — FR-007, FR-017, §Non-Functional Requirements (determinism)
- F-01 RLS contract: `context/archive/2026-05-29-postgres-rls-baseline/` (migration, `supabase/README.md`, `supabase/tests/rls_template.test.sql`)
- Evaluator: `src/lib/evaluator.ts:14,247-251,308,378`
- Current pool: `src/lib/fixture-pool.ts`
- API route: `src/pages/api/evaluate.ts`
- SSR client: `src/lib/supabase.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Counterparty table + seed migration + RLS + pgTAP

#### Automated

- [x] 1.1 `20260530120000_counterparties.sql` applies cleanly from a fresh DB with no error
- [x] 1.2 After apply, `count(*)` = 5 and `select id ... order by sort_order` matches the golden sequence
- [x] 1.3 `npx supabase test db` (or docker-exec pgTAP) passes including `counterparties.test.sql`
- [x] 1.4 `npm run lint` and `npm run build` still pass

#### Manual

- [x] 1.5 Reviewer confirms the 5 rows are byte-identical to `src/lib/fixture-pool.ts`
- [x] 1.6 As `anon`, rows are readable; insert/update/delete denied

### Phase 2: Read flip with determinism gate

#### Automated

- [ ] 2.1 `npm test` passes: all representative contracts match their golden `.md` byte-for-byte
- [ ] 2.2 Pre-deletion equivalence assertion (`FIXTURE_POOL` == golden pool) passes
- [ ] 2.3 `npm run lint` and `npm run build` pass with the new signature and wiring
- [ ] 2.4 Type-check is clean (signature change propagated)

#### Manual

- [ ] 2.5 `POST /api/evaluate` for a known fixture input returns a contract byte-identical to v1
- [ ] 2.6 Stopping the DB / unsetting `SUPABASE_*` makes `/api/evaluate` return 500, not a wrong/empty contract

### Phase 3: Delete fixture-pool.ts + lock determinism in CI

#### Automated

- [ ] 3.1 `grep -rn FIXTURE_POOL src/ test/` returns nothing; `src/lib/fixture-pool.ts` no longer exists
- [ ] 3.2 `npm test` passes with only the golden-pool determinism assertions
- [ ] 3.3 `.github/workflows/ci.yml` `ci` job runs `npm test` (grep-verifiable)
- [ ] 3.4 `npm run lint` and `npm run build` pass
- [ ] 3.5 A no-op PR shows the `ci` job running and passing `npm test`

#### Manual

- [ ] 3.6 `POST /api/evaluate` still returns byte-identical contracts (FAIR / NEEDS BALANCING / NO MATCH)
- [ ] 3.7 After merge to master, CI `db push` applied the migration in prod and the evaluator works against the cloud DB
