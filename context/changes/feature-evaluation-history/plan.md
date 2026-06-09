# Evaluation History (S-03) Implementation Plan

## Overview

Build per-account evaluation history (roadmap S-03 / FR-018 / FR-019 / US-05): persist each
successful evaluation as a per-user, RLS-scoped, **append-only** row, and let the operator
browse past contracts (most recent first) on a dedicated `/history` page, expanding any row
to its **verbatim** Markdown contract. A history row is a persisted `EvaluateResponse` +
`user_id` + `created_at`; the contract blob is stored as-is and rendered as-is — never
re-evaluated against the live counterparty pool.

## Current State Analysis

- **Prerequisites all shipped.** S-03's F-01 (RLS baseline), F-02 (counterparty table), and
  S-01 (auth gate) are done; the slice is unblocked (`roadmap.md:35`).
- **Exact template exists at every layer.** `public.user_lists` (S-02) is the closest analog
  — same four-policy RLS contract, same `references auth.users(id) on delete cascade`. The
  divergence is semantics: history is **append-only / many-rows-per-user**, not
  one-row-upsert. (`supabase/migrations/20260601120000_user_lists.sql`,
  `src/lib/user-lists.ts`, `supabase/tests/user-lists.test.sql`.)
- **Row shape ↔ `EvaluateResponse`.** `src/types.ts:38-45` already carries the FR-018 payload
  minus owner + timestamp: `contract`, `counterparty_id` (nullable), `verdict` (nullable),
  `delta_pln` (nullable), `threshold_pct`, `source`.
- **Write point exists.** `src/pages/api/evaluate.ts:57-63` already persists `user_lists`
  best-effort after a success, guarded by `if (locals.user)`. The history insert slots in
  beside it.
- **No history UI.** `dashboard.astro` is a gated stub; there is no `/history` route. The gate
  is `isGated()` in `src/middleware.ts:9-12` (`/` exact + `/dashboard`, `/api/evaluate`).
- **Counterparty name source.** `public.counterparties(id text pk, name text)` is immutable,
  migration-seeded (`supabase/migrations/20260530120000_counterparties.sql`). FR-019's list
  needs the name; FR-018 stores only `counterparty_id` → resolve via FK + read-time join.
- **Determinism constraint (binding).** PRD:116 / PRD:181 / US-05 — the stored contract is
  shown verbatim, byte-identical to the original, with no re-render and no re-evaluation,
  even after the pool is edited.

### Key Discoveries:

- RLS four-policy template + "ship a pgTAP test proving cross-user read=0 / write=42501":
  `supabase/README.md` (mandate, not optional).
- Append vs upsert divergence from the analog: `supabase/tests/user-lists.test.sql:97-108`
  (the upsert assertions become "second insert → count grows").
- Best-effort save pattern to mirror: `src/pages/api/evaluate.ts:54-63`
  (`user_lists.save_failed` warn; result never blocked).
- Service contract to follow (null-client throw, `cause` code): `src/lib/user-lists.ts:17-37`,
  `src/lib/counterparties.ts:21-49`.
- Contract presentation to reuse: `src/pages/index.astro:160-162` (`<pre id="contract-md">`).

## Desired End State

An authenticated operator runs an evaluation, navigates to `/history`, and sees their past
contracts most-recent-first (verdict, delta, counterparty name, threshold, source, timestamp);
expanding a row reveals the exact Markdown originally generated. A second account sees none of
it (RLS). `npm run db:test` proves the isolation contract. An anonymous visit to `/history`
redirects to sign-in.

## What We're NOT Doing

- **Not** the R5 byte-identical determinism test or negative-control hardening — that is
  test-rollout **Phase 3** (this change ships the README-mandated isolation test only).
- **Not** an update policy / edit-history feature — rows are immutable (append-only).
- **Not** a delete-history UI — the `delete`-own policy ships for future use, no UI yet.
- **Not** pagination, filtering, or search — all rows, most-recent-first (v2 volume is low).
- **Not** a React island for the list — server-rendered Astro + native `<details>`.
- **Not** denormalizing the counterparty name — resolved via FK join at read.
- **Not** changing the evaluator, the contract format, or `EvaluateResponse`.

## Implementation Approach

Standard database-feature sequence: schema+test → service → write hook → read UI. Each phase
verifies independently. The contract blob is persisted verbatim from the existing
`EvaluateResponse`; reads never recompute. All four phases follow established in-repo patterns
(the `user_lists` analog for data/service, the `saveUserLists` hook for the write, the gated
server-rendered page convention for the UI).

## Critical Implementation Details

- **Byte-identical is a storage choice, not a render choice.** Store `contract` as `text`
  verbatim; the `/history` read returns that string and renders it in a `<pre>` unchanged. Any
  design that re-renders or re-evaluates on read violates PRD:181 — do not.
- **counterparty_id FK must be declared** so PostgREST can embed `counterparties(name)` in the
  read select. Nullable (NO-MATCH rows have null id → embedded object is null).
- **Append, not upsert.** No `UNIQUE(user_id)`; a plain `insert` per success. This is the one
  place the `user_lists` analog must NOT be copied verbatim.

## Phase 1: Migration + RLS + pgTAP Isolation Test

### Overview

Create the append-only `evaluation_history` table with per-user RLS and ship its mandated
isolation test.

### Changes Required:

#### 1. Migration

**File**: `supabase/migrations/<YYYYMMDDHHmmss>_evaluation_history.sql` (new, UTC timestamp)

**Intent**: Append-only per-user history table following the four-policy RLS template, minus
the update policy (rows are immutable), with an FK to the counterparty pool for name
resolution.

**Contract**: `public.evaluation_history` columns: `id uuid pk default gen_random_uuid()`,
`user_id uuid not null references auth.users(id) on delete cascade`, `contract text not null`,
`counterparty_id text references public.counterparties(id)` (nullable), `verdict text`
(nullable), `delta_pln numeric` (nullable), `threshold_pct numeric not null` (or smallint/int
to match `FAIRNESS_THRESHOLD_PCT`), `source text not null`, `created_at timestamptz not null
default now()`. `enable row level security`. Policies (`to authenticated`,
`app.current_user_id()`): `evaluation_history_select_own` (using), `_insert_own` (with check),
`_delete_own` (using). **No update policy.** `grant select, insert, delete … to authenticated`.
Index on `(user_id, created_at desc)` for the list read. No `UNIQUE(user_id)`. A `comment on
table` noting append-only semantics. Immutable once on master.

#### 2. pgTAP isolation test

**File**: `supabase/tests/evaluation-history.test.sql` (new)

**Intent**: Prove the README-mandated isolation contract for the new table, adapted for
append-only semantics.

**Contract**: Mirror `supabase/tests/user-lists.test.sql` (seed two users, JWT-spoof both
GUCs at each identity switch, `select plan(N)`): table exists + RLS enabled; A sees only A's
rows under select (cross-account read = 0); a cross-account insert raises `42501`; a **second
insert from A grows A's count** (append, not replace — the divergence from the upsert analog);
superuser `reset role` sees all rows (RLS is the filter). Runs in `begin … rollback`.

### Success Criteria:

#### Automated Verification:

- Migration applies from scratch: `npx supabase db reset`
- pgTAP suite passes (incl. the new test): `npm run db:test`
- DB lint clean: `npx supabase db lint --level warning`

#### Manual Verification:

- The table is append-only — confirm no `UNIQUE(user_id)` and no update policy.
- Policies use `app.current_user_id()` (not inlined `auth.uid()`), per README.

**Implementation Note**: After automated verification passes, pause for manual confirmation
before proceeding.

---

## Phase 2: Service Layer

### Overview

A typed read/write module for the history table, following the project's service contract.

### Changes Required:

#### 1. History service

**File**: `src/lib/evaluation-history.ts` (new)

**Intent**: Encapsulate the insert (persist an evaluation result) and the list read (with
counterparty name join), mirroring `user-lists.ts`'s null-client/`cause`-code contract.

**Contract**: `saveEvaluation(client: SupabaseClient | null, userId: string, result:
EvaluateResponse): Promise<void>` — inserts one row from the result fields; throws on null
client or query error (preserving `cause: { code }`). `getEvaluationHistory(client, userId):
Promise<EvaluationHistoryItem[]>` — selects all own rows `order by created_at desc` with the
embedded `counterparties(name)` resource; maps to a view type carrying `counterparty_name:
string | null`. Define `EvaluationHistoryItem` (in this module or `src/types.ts`).

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx astro check`
- Linting passes: `npm run lint`

#### Manual Verification:

- The read select embeds `counterparties(name)` and orders `created_at desc`.
- The insert maps exactly the FR-018 fields from `EvaluateResponse` (+ `user_id`); no derived
  or recomputed values.

**Implementation Note**: After automated verification passes, pause for manual confirmation.

---

## Phase 3: Write Hook in the Evaluate Endpoint

### Overview

Persist each successful evaluation (including NO-MATCH) best-effort, without ever blocking the
response.

### Changes Required:

#### 1. Best-effort history write

**File**: `src/pages/api/evaluate.ts`

**Intent**: After a successful evaluation, persist a history row beside the existing
`user_lists` save, guarded by `if (locals.user)`, in its own try/catch that only warns on
failure.

**Contract**: Within the `if (locals.user)` block (around `evaluate.ts:57-63`), call
`saveEvaluation(supabase, locals.user.id, result)` in a try/catch; on failure
`log.warn("evaluation_history.save_failed", { outcome: "failure", error: saveErr })` and
continue. The 200 response is unchanged. Records every success — NO-MATCH rows carry null
counterparty_id/verdict/delta.

#### 2. Endpoint test

**File**: `test/evaluate.test.ts`

**Intent**: Cover the user-present write path the existing tests don't (they run with
`user: null`).

**Contract**: Add a context with `locals.user` set; mock `@/lib/evaluation-history`. Assert:
on success the history save is attempted; when the history save rejects, the response is still
200 and an `evaluation_history.save_failed` warn is logged (best-effort, never blocks). Mirror
the existing logging-assertion harness in `test/evaluate.test.ts`.

### Success Criteria:

#### Automated Verification:

- Unit/integration tests pass: `npm test`
- Type checking passes: `npx astro check`
- Linting passes: `npm run lint`

#### Manual Verification:

- A real evaluation against local Supabase writes exactly one history row.
- A NO-MATCH evaluation also writes a row (null counterparty_id/verdict/delta + contract).
- A simulated save failure leaves the user's result intact (200), only a warn logged.

**Implementation Note**: After automated verification passes, pause for manual confirmation.

---

## Phase 4: /history Page + Gate + Nav

### Overview

A gated, server-rendered history page listing past contracts with verbatim expansion.

### Changes Required:

#### 1. History page

**File**: `src/pages/history.astro` (new)

**Intent**: Server-render the authenticated user's history list, most-recent-first, with each
row expandable to its verbatim contract.

**Contract**: Resolve `Astro.locals.user`; build the SSR client (`createClient`) and call
`getEvaluationHistory`. Render a list where each row shows verdict, delta (PLN), counterparty
name (or a "no match" label when null), threshold_pct, source, and timestamp; a native
`<details>`/`<summary>` expands to the stored `contract` in a `<pre>` (reuse the
`index.astro:160-162` presentation). Empty state when the user has no history. No client JS.

#### 2. Gate the route

**File**: `src/middleware.ts`

**Intent**: Add `/history` to the gated routes so anonymous visitors are redirected to
sign-in.

**Contract**: Add `/history` to the `isGated()` route list (`src/middleware.ts:11`).

#### 3. Nav link

**File**: `src/components/Topbar.astro`

**Intent**: Make `/history` discoverable from the evaluator.

**Contract**: Add a "History" link to `/history` in the Topbar (shown on the gated evaluator
page).

### Success Criteria:

#### Automated Verification:

- Production build succeeds: `npm run build`
- Type checking passes: `npx astro check`
- Linting passes: `npm run lint`
- Gate covers the route — extend `test/middleware.test.ts`: anonymous `GET /history` → 302 to
  `/auth/signin`: `npm test`

#### Manual Verification:

- Authenticated `/history` lists past evaluations most-recent-first; a row expands to the
  exact Markdown contract (byte-identical to what the evaluator produced).
- A second account sees none of the first account's history.
- Anonymous `/history` redirects to sign-in.
- The Topbar "History" link navigates correctly.

**Implementation Note**: After automated verification passes, pause for manual confirmation.

---

## Testing Strategy

### Unit / Integration Tests:

- pgTAP isolation (Phase 1): cross-account read=0, cross-account insert 42501, append count
  growth, superuser bypass.
- Endpoint (Phase 3): user-present write path attempted; best-effort failure leaves 200.
- Middleware (Phase 4): anonymous `/history` → redirect.

### Manual Testing Steps:

1. `supabase start`; sign in; run an evaluation; open `/history` → the run appears, newest first.
2. Expand the row → contract matches the evaluator output byte-for-byte.
3. Run a NO-MATCH evaluation → a row appears (no counterparty name, no verdict).
4. Sign in as a second account → its `/history` is empty (RLS isolation).
5. Sign out; visit `/history` → redirected to sign-in.

## Performance Considerations

The list read is a single indexed query (`(user_id, created_at desc)`); v2 single-user volume
is low and the page is server-rendered with no hydration. No cap in v2 (revisit if a heavy
user makes the page large).

## Migration Notes

One new immutable migration; no data backfill (history accrues going forward). The
`counterparty_id` FK references the already-seeded, immutable counterparty table.

## References

- Research: `context/changes/feature-evaluation-history/research.md`
- Analog (data/service/test): `supabase/migrations/20260601120000_user_lists.sql`,
  `src/lib/user-lists.ts`, `supabase/tests/user-lists.test.sql`
- Write hook: `src/pages/api/evaluate.ts:54-63`
- Row payload: `src/types.ts:38-45`
- Gate: `src/middleware.ts:9-12`
- RLS contract + test mandate: `supabase/README.md`
- Requirements: `context/foundation/prd.md:103-116,170-171,181`; `roadmap.md:35`
- Downstream: `context/foundation/test-plan.md` §3 Phase 3 (R1 + R5 coverage rides on this)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Migration + RLS + pgTAP Isolation Test

#### Automated

- [x] 1.1 Migration applies from scratch: `npx supabase db reset` — 5adb1c5
- [x] 1.2 pgTAP suite passes incl. new test: `npm run db:test` — 5adb1c5
- [x] 1.3 DB lint clean: `npx supabase db lint --level warning` — 5adb1c5

#### Manual

- [x] 1.4 Append-only confirmed (no `UNIQUE(user_id)`, no update policy) — 5adb1c5
- [x] 1.5 Policies use `app.current_user_id()`, not inlined `auth.uid()` — 5adb1c5

### Phase 2: Service Layer

#### Automated

- [x] 2.1 Type checking passes: `npx astro check` — 43a9ef7
- [x] 2.2 Linting passes: `npm run lint` — 43a9ef7

#### Manual

- [x] 2.3 Read embeds `counterparties(name)` and orders `created_at desc` — 43a9ef7
- [x] 2.4 Insert maps exactly the FR-018 fields from `EvaluateResponse` (no recomputation) — 43a9ef7

### Phase 3: Write Hook in the Evaluate Endpoint

#### Automated

- [x] 3.1 Unit/integration tests pass: `npm test` — 5ff2cda
- [x] 3.2 Type checking passes: `npx astro check` — 5ff2cda
- [x] 3.3 Linting passes: `npm run lint` — 5ff2cda

#### Manual

- [x] 3.4 A real evaluation writes exactly one history row — 5ff2cda
- [x] 3.5 A NO-MATCH evaluation also writes a row (null counterparty_id/verdict/delta) — 5ff2cda
- [x] 3.6 A simulated save failure leaves the result intact (200), only a warn logged — 5ff2cda

### Phase 4: /history Page + Gate + Nav

#### Automated

- [x] 4.1 Production build succeeds: `npm run build`
- [x] 4.2 Type checking passes: `npx astro check`
- [x] 4.3 Linting passes: `npm run lint`
- [x] 4.4 Anonymous `GET /history` → 302 redirect (middleware test): `npm test`

#### Manual

- [x] 4.5 Authenticated `/history` lists past evaluations most-recent-first; row expands to verbatim contract
- [x] 4.6 A second account sees none of the first account's history (RLS)
- [x] 4.7 Anonymous `/history` redirects to sign-in
- [x] 4.8 Topbar "History" link navigates correctly
