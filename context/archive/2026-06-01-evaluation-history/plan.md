# Evaluation History (S-03) Implementation Plan

## Overview

Persist every successful evaluation as an append-only history row (the contract Markdown verbatim plus verdict, delta, counterparty_id, threshold_pct, source, and a server timestamp), and add a gated `/history` page that lists a user's past contracts most-recent-first with an expand-to-full-Markdown affordance. Closes US-05 and FR-018/FR-019.

## Current State Analysis

- No `public.evaluations` table exists, no `/history` page, and no navigation to one. The only user-data table is `public.user_lists` (S-02); the shared read-only `public.counterparties` holds the names.
- `src/pages/api/evaluate.ts` already produces an `EvaluateResponse` (`src/types.ts:38`) carrying **every** FR-018 field — `contract`, `counterparty_id`, `verdict`, `delta_pln`, `threshold_pct`, `source`. The history insert slots into the success path right after the S-02 `saveUserLists` call.
- Service/RLS/pgTAP/vitest patterns are fully established by S-02 (`src/lib/user-lists.ts`, `supabase/migrations/20260601120000_user_lists.sql`, `supabase/tests/user-lists.test.sql`, `test/user-lists.test.ts`).
- `src/middleware.ts:9` `isGated()` currently gates `/`, `/dashboard`, `/api/evaluate`; a new page route is added to that set.
- Pages are SSR (`output: "server"`). `index.astro` shows a fresh contract as raw Markdown in a `<pre>` — the history page reuses that treatment for the byte-identical guarantee.

### Key Discoveries

- `src/pages/api/evaluate.ts` success path: after `log.info("evaluate.success")` and the S-02 `saveUserLists` block, before `return new Response(...)` — the history insert goes here, same best-effort try/catch shape.
- `public.counterparties` is `id text primary key`, `name text` (`supabase/migrations/20260530120000_counterparties.sql:24`). A **nullable FK** from `evaluations.counterparty_id` to `counterparties(id)` is what lets Supabase's embedded-select (`counterparties(name)`) resolve the name in one query. The evaluator only ever emits a pool `id` or `null`, so the FK never blocks an insert.
- The uuid PK is not insertion-ordered, so FR-019's "tie-break by database row id (insertion order)" needs a monotonic column: a `seq bigint generated always as identity`. Ordering is `created_at desc, seq desc`.
- `EvaluateResponse.delta_pln` is typed `number | null`; stored as `numeric` (null for NO MATCH) to be lossless regardless of integer/fractional values.
- shadcn/ui kit is bare (`button.tsx`, `LibBadge.astro`); the list is plain Astro iteration + Tailwind with native `<details>`/`<summary>` — no client JS, no new dependency.

## Desired End State

A signed-in user who has evaluated at least once can open `/history` and see their past contracts, newest first, each row showing verdict, delta (PLN), counterparty name, threshold_pct, source, and timestamp. Expanding a row reveals the full Markdown contract verbatim (byte-identical to the original). A user with no evaluations sees an empty-state message. A second account never sees another user's history. The page is gated; anonymous visitors are redirected to sign-in.

**Verification:** `npm test` + `npm run db:test` pass; `npm run build`/`npm run lint` green. Manually: Account A evaluates → rows appear on `/history` with correct fields and verbatim contract on expand; Account B sees only its own (or empty state); anon `/history` → redirect to sign-in.

## What We're NOT Doing

- **No edit or delete of history.** The table is append-only (select + insert policies only). "Clear history" is out of scope.
- **No pagination.** The list caps at the 50 most-recent rows; older rows aren't shown (no "load more").
- **No Markdown-to-HTML rendering.** The contract displays as raw Markdown in a `<pre>`, matching the evaluator and preserving byte-identity. No markdown-renderer dependency.
- **No re-evaluation or re-rendering** of historical contracts against the current pool — the stored text is shown verbatim (PRD NFR).
- **No new shared API endpoint.** History is rendered server-side on the page; no `/api/history`.
- **No change to the evaluator pipeline, fairness logic, or determinism.**

## Implementation Approach

DB first (table + append-only RLS + pgTAP), then the service + best-effort wiring into the evaluate route (vitest), then the gated SSR page + nav. Each phase is independently verifiable. The save is best-effort throughout — a history-write failure never blocks the evaluation result, consistent with S-02.

## Critical Implementation Details

- **The nullable FK is load-bearing for the name join.** Without `evaluations.counterparty_id references counterparties(id)`, Supabase's `.select("…, counterparties(name)")` embed cannot resolve. Use `on delete set null` (counterparties is immutable seeded data, so this never fires in practice).
- **Ordering must be `created_at desc, seq desc`.** The uuid PK is random, not monotonic; `seq` (identity) provides the stable insertion-order tie-break FR-019 requires.
- **History insert is inside its own try/catch**, separate from the S-02 save, so neither failure masks the other and neither blocks the response.

## Phase 1: DB migration + pgTAP test

### Overview

Create `public.evaluations` as an append-only, per-user table (select + insert RLS only), with a nullable FK to `counterparties` and a monotonic `seq`. Prove cross-user isolation and that update/delete are denied.

### Changes Required:

#### 1. Migration

**File**: `supabase/migrations/20260601130000_evaluations.sql` (new)

**Intent**: Create the per-user evaluation history table as an immutable audit log, enable RLS with select+insert policies only, and wire the counterparty name join via a nullable FK.

**Contract**: Columns: `id uuid primary key default gen_random_uuid()`, `seq bigint generated always as identity`, `user_id uuid not null references auth.users (id) on delete cascade`, `contract text not null`, `verdict text`, `delta_pln numeric`, `counterparty_id text references public.counterparties (id) on delete set null`, `threshold_pct smallint not null`, `source text not null`, `created_at timestamptz not null default now()`. A `check (source in ('llm','stub','llm-failed-fallback'))` constraint guards the source enum. RLS enabled. **Two** policies only — `evaluations_select_own` (select, `using (user_id = app.current_user_id())`) and `evaluations_insert_own` (insert, `with check (user_id = app.current_user_id())`); grant `select, insert` (NOT update/delete) to `authenticated`, with a comment noting the append-only deviation from the four-policy template. Index on `(user_id, created_at desc, seq desc)` for the read path.

#### 2. pgTAP test

**File**: `supabase/tests/evaluations.test.sql` (new)

**Intent**: Prove per-user isolation and the append-only contract.

**Contract**: Assert: table exists; RLS enabled; Alice sees only her own rows under select; Alice cannot insert a row owned by Bob (`42501`); Alice cannot UPDATE her own row (`42501` — no update policy); Alice cannot DELETE her own row (`42501` — no delete policy); superuser sees all rows (sanity). Follows the JWT-spoofing pattern in `supabase/tests/user-lists.test.sql`.

### Success Criteria:

#### Automated Verification:
- Migration applies cleanly: `npx supabase db reset`
- pgTAP test passes: `npm run db:test`
- Type checking passes: `npm run build`
- Linting passes: `npm run lint`

#### Manual Verification:
- `public.evaluations` in Supabase Studio: RLS enabled, select+insert policies only (no update/delete), FK to `counterparties` present

**Implementation Note**: After automated verification passes, pause for human confirmation before proceeding.

---

## Phase 2: Service layer + evaluate-route wiring + vitest

### Overview

Add `src/lib/evaluations.ts` (`saveEvaluation`, `listEvaluations`), wire a best-effort insert into the evaluate route's success path, and cover the service with vitest.

### Changes Required:

#### 1. Service module

**File**: `src/lib/evaluations.ts` (new)

**Intent**: Single place for evaluation-history DB interactions, following the `user-lists.ts` contract (null-client throws, Postgres error code preserved via `cause`).

**Contract**:
- `export async function saveEvaluation(client: SupabaseClient | null, userId: string, row: { contract: string; verdict: string | null; delta_pln: number | null; counterparty_id: string | null; threshold_pct: number; source: string }): Promise<void>` — inserts one row with `user_id: userId`; throws on null client or DB error.
- `export interface EvaluationHistoryRow { id: string; verdict: string | null; delta_pln: number | null; counterparty_id: string | null; counterparty_name: string | null; threshold_pct: number; source: string; created_at: string; contract: string }`
- `export async function listEvaluations(client: SupabaseClient | null, userId: string): Promise<EvaluationHistoryRow[]>` — selects `id, verdict, delta_pln, counterparty_id, threshold_pct, source, created_at, contract, counterparties(name)`, filtered by `user_id`, ordered `created_at desc` then `seq desc`, limit 50; maps the embedded `counterparties` object (or null) to `counterparty_name`; throws on null client or query error.

#### 2. Evaluate route — persist after success

**File**: `src/pages/api/evaluate.ts`

**Intent**: After a successful evaluation (and the S-02 list save), persist the evaluation as a history row without blocking or exposing the result on failure.

**Contract**: In a new try/catch after the `saveUserLists` block and before the `return`, when `locals.user` is present, call `saveEvaluation(supabase, locals.user.id, { contract: result.contract, verdict: result.verdict, delta_pln: result.delta_pln, counterparty_id: result.counterparty_id, threshold_pct: result.threshold_pct, source: result.source })`. The catch logs `log.warn("evaluations.save_failed", { outcome: "failure", error: err })` and does not re-throw.

#### 3. Vitest unit tests

**File**: `test/evaluations.test.ts` (new)

**Intent**: Verify the service's argument-building and result-mapping and its error/null handling.

**Contract**: Mock the Supabase builder chain (mirroring `test/user-lists.test.ts`). Cases: `saveEvaluation` null client throws; `saveEvaluation` inserts the correct payload (user_id + all six fields); `saveEvaluation` propagates a DB error; `listEvaluations` null client throws; `listEvaluations` issues order (`created_at` desc, `seq` desc) + limit(50) and maps embedded `counterparties: { name }` → `counterparty_name`, and `counterparties: null` → `counterparty_name: null`; `listEvaluations` propagates a query error.

### Success Criteria:

#### Automated Verification:
- All tests pass: `npm test`
- Type checking passes: `npm run build`
- Linting passes: `npm run lint`

#### Manual Verification:
- Account A runs the evaluator twice → two rows in `public.evaluations` (Studio), correct fields; Account B → none

**Implementation Note**: After automated verification passes, pause for human confirmation before proceeding.

---

## Phase 3: History page + middleware gate + nav

### Overview

Add the gated `/history` SSR page (list + expand), add `/history` to the middleware gate, and surface a nav link from the evaluator bar and the Topbar.

### Changes Required:

#### 1. History page

**File**: `src/pages/history.astro` (new)

**Intent**: Server-render the user's evaluation history, newest first, each row expandable to its verbatim contract; show an empty state for accounts with no evaluations; never break on a load error.

**Contract**: Frontmatter reads `user, log` from `Astro.locals`, creates a Supabase client (`createClient(Astro.request.headers, Astro.cookies)`), and calls `listEvaluations(supabase, user.id)` inside a try/catch (on error: `log.warn("evaluations.load_failed", …)`, fall back to `[]`). Body: when the list is empty, render an empty-state message; otherwise iterate rows, each as a `<details>` whose `<summary>` shows verdict, delta (PLN, or "n/a"), counterparty name (or "—" when null / NO MATCH), threshold_pct, source, and a formatted `created_at`, with the contract inside a `<pre>` (raw Markdown, mirroring `index.astro`'s contract panel). Uses `Layout`; matches existing Tailwind styling.

#### 2. Gate the route

**File**: `src/middleware.ts`

**Intent**: Require a session for `/history`.

**Contract**: Add `"/history"` to the gated route list in `isGated()`. No other change.

#### 3. Navigation links

**File**: `src/pages/index.astro`, `src/components/Topbar.astro`

**Intent**: Make history reachable from the workflow.

**Contract**: Add a "Historia" link to `/history` in the `index.astro` top bar (next to the sign-out control) and in `Topbar.astro` (next to the existing Dashboard link). Style consistent with the surrounding links.

### Success Criteria:

#### Automated Verification:
- Type checking passes: `npm run build`
- Linting passes: `npm run lint`

#### Manual Verification:
- Signed in, after ≥1 evaluation → `/history` lists rows newest-first with all fields; expanding a row shows the contract byte-identical to the evaluator output
- Fresh account → `/history` shows the empty-state message (no crash)
- Second account never sees the first account's history
- Signed out → visiting `/history` redirects to `/auth/signin?redirect=%2Fhistory`

**Implementation Note**: After automated verification passes, pause for human confirmation.

---

## Testing Strategy

### Unit Tests (vitest):
- `saveEvaluation`: null client → throw; correct insert payload; DB error propagated.
- `listEvaluations`: null client → throw; order + limit(50) applied; embedded `counterparties(name)` mapped to `counterparty_name` (incl. null); query error propagated.

### DB Tests (pgTAP):
- `public.evaluations` exists, RLS enabled.
- Cross-user select isolation; cross-user insert → `42501`.
- Update own row → `42501`; delete own row → `42501` (append-only proof).
- Superuser sees all rows (sanity).

### Manual Testing Steps:
1. `npx supabase db reset` → migration applies; `npm run db:test` → all pgTAP pass incl. `evaluations.test.sql`.
2. Sign in (Account A) → run the evaluator twice with different lists → open `/history`: two rows, newest first, each showing verdict/delta/counterparty/threshold/source/timestamp.
3. Expand a row → contract matches the evaluator's output byte-for-byte.
4. Sign up Account B → `/history` shows empty state; never shows A's rows.
5. Sign out → GET `/history` → redirected to `/auth/signin?redirect=%2Fhistory`.
6. NO-MATCH evaluation (e.g. "qwerty" / "asdfg") → history row shows counterparty "—" and delta "n/a", contract still verbatim.

## Performance Considerations

One extra insert per successful evaluation and one indexed read (`user_id, created_at desc, seq desc`, limit 50) per history page load. Negligible at this scale. The SSR-embed of up to 50 contracts bounds the page payload.

## Migration Notes

New migration only; no changes to existing migrations or seeds. No backfill — evaluations run before this ships are not retroactively recorded (those users simply have shorter history). The `counterparties` FK references existing immutable seed rows.

## References

- Roadmap slice: `context/foundation/roadmap.md` § S-03
- PRD: US-05, FR-018, FR-019, NFR (historical contracts byte-identical)
- Prior slice (patterns): `context/archive/2026-06-01-restore-saved-lists/`
- RLS baseline + template: `supabase/migrations/20260529120000_rls_baseline.sql`, `supabase/README.md`
- Service pattern: `src/lib/user-lists.ts`; pgTAP pattern: `supabase/tests/user-lists.test.sql`
- Evaluate route (wiring point): `src/pages/api/evaluate.ts`
- Counterparties (name join): `supabase/migrations/20260530120000_counterparties.sql`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: DB migration + pgTAP test

#### Automated
- [x] 1.1 Migration applies cleanly: `npx supabase db reset` — b1b81c6
- [x] 1.2 pgTAP test passes: `npm run db:test` — b1b81c6
- [x] 1.3 Type checking passes: `npm run build` — b1b81c6
- [x] 1.4 Linting passes: `npm run lint` — b1b81c6

#### Manual
- [x] 1.5 `public.evaluations` in Studio: RLS enabled, select+insert only (no update/delete), FK to `counterparties` present — b1b81c6

### Phase 2: Service layer + evaluate-route wiring + vitest

#### Automated
- [x] 2.1 All tests pass: `npm test` — 13daf51
- [x] 2.2 Type checking passes: `npm run build` — 13daf51
- [x] 2.3 Linting passes: `npm run lint` — 13daf51

#### Manual
- [x] 2.4 Account A runs evaluator twice → two `evaluations` rows with correct fields; Account B → none — 13daf51

### Phase 3: History page + middleware gate + nav

#### Automated
- [x] 3.1 Type checking passes: `npm run build` — 3e7d6ff
- [x] 3.2 Linting passes: `npm run lint` — 3e7d6ff

#### Manual
- [x] 3.3 After ≥1 eval → `/history` lists rows newest-first; expand shows contract byte-identical — 3e7d6ff
- [x] 3.4 Fresh account → `/history` empty-state (no crash) — 3e7d6ff
- [x] 3.5 Second account never sees the first account's history — 3e7d6ff
- [x] 3.6 Signed out → `/history` redirects to `/auth/signin?redirect=%2Fhistory` — 3e7d6ff
