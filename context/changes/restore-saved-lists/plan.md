# Restore Saved Lists (S-02) Implementation Plan

## Overview

Persist the authenticated user's most recent give-list and want-list after each successful evaluation, and pre-fill the evaluator textareas with those values on every subsequent page load. This closes US-04 and FR-016.

## Current State Analysis

- `public.user_lists` does not exist. The only user-data table is `public.counterparties` (shared, read-only).
- `src/pages/api/evaluate.ts` already has a `supabase` client in scope and a clear success path where the save can be wired. The client is guaranteed non-null at that point (it is also used for `getCounterpartyPool`, which throws on null before we could reach a save step).
- `src/pages/index.astro` is fully server-rendered (Astro SSR, `output: "server"`). The page can read saved lists from the DB at render time and inject them as textarea defaults — no client-side fetch needed.
- The four-policy RLS template (`app.current_user_id()`, four per-operation policies, optional `updated_at` trigger) is codified in `supabase/migrations/20260529120000_rls_baseline.sql` and documented in `supabase/README.md`. The new migration follows it exactly.
- pgTAP test pattern is established in `supabase/tests/rls_template.test.sql` and `supabase/tests/counterparties.test.sql`.
- Service-layer pattern: `src/lib/counterparties.ts` accepts `SupabaseClient | null`, throws on null, wraps Postgres errors preserving `cause: { code }` for RLS detection. `src/lib/user-lists.ts` follows the same shape.

### Key Discoveries

- `src/lib/supabase.ts:5-24` — `createClient()` returns the full Supabase client (auth + DB queries) and is already imported in the evaluate route.
- `src/pages/api/evaluate.ts:42-52` — the success path is one `return new Response(JSON.stringify(result), ...)` after `evaluate()`; the save goes in a try/catch immediately before that return.
- `src/pages/index.astro:4` — `const { user } = Astro.locals;` already exists; the page already reads `user` for the sign-out bar (S-01). Adding `createClient` and `getUserLists` follows the same pattern.
- `src/lib/log.ts:143-147` — `isRlsDenied(err)` detects code `42501`; the evaluate route already uses it for pool-read RLS errors. The save failure should log `user_lists.save_failed` (not an RLS error case in practice since the user always writes their own row).
- Upsert key: `UNIQUE(user_id)` on `public.user_lists` enables `.upsert(..., { onConflict: 'user_id' })`. One row per user, always replaced on save.

## Desired End State

A signed-in user who has run the evaluator at least once sees their last-entered give and want strings pre-filled in the textareas when they return to `/`. A fresh account (no prior evaluation) sees the sample placeholder text. A different account's saved lists are never visible. Save failures are silent (logged, not user-visible); pre-fill failures fall back to sample text silently.

**Verification:** `npm test` and `npm run db:test` pass; `npm run build` and `npm run lint` green. Manually: run the evaluator, sign out, sign back in — textareas pre-filled. A second account sees sample text. Supabase Studio shows exactly one `user_lists` row per account, updated on each evaluation.

## What We're NOT Doing

- **No debounced/keystroke saves.** Only successful evaluations trigger a DB write (OQ-4 settled).
- **No delete on clear.** The "Wyczyść" button clears the textareas for the current session only; the saved row persists until the next successful evaluation overwrites it.
- **No evaluation history (S-03).** `user_lists` stores only the most-recent give/want strings. The full per-evaluation history (FR-018/FR-019) is a separate table and a separate change.
- **No user-visible save status.** A failed save is logged silently; the user always sees the evaluation result.
- **No UI affordance to manage saved lists** (edit/clear saved state). Pre-fill is automatic.

## Implementation Approach

Three sequential phases: DB first (migration + pgTAP), service + API wiring second, page pre-fill last. Each phase is independently deployable and verifiable.

## Critical Implementation Details

- **Upsert requires `UNIQUE(user_id)`**, not just the FK reference. Without a unique constraint, Supabase's `.upsert(..., { onConflict: 'user_id' })` will error. The constraint is on `user_id`, not `id`.
- **`saved_at` is explicit, not a trigger.** Unlike tables with `updated_at + app.tg_set_updated_at()`, `user_lists` uses a single `saved_at` column written by the caller. The `INSERT ... ON CONFLICT DO UPDATE` sets `saved_at = EXCLUDED.saved_at`. No trigger needed.
- **Save is inside a try/catch, after `log.info("evaluate.success")`** and before the `return`. The evaluate route must not propagate the save error — it logs `warn` and continues to return the result.
- **Pre-fill is server-side only.** The textareas' initial content is set in the Astro frontmatter via `{initialGive}` / `{initialWant}`. There is no client-side fetch for pre-fill.

---

## Phase 1: DB migration + pgTAP test

### Overview

Create `public.user_lists` with a `UNIQUE(user_id)` constraint and four RLS policies following the canonical template. Prove cross-user isolation and single-row semantics with a pgTAP test.

### Changes Required:

#### 1. Migration

**File**: `supabase/migrations/20260601120000_user_lists.sql` (new)

**Intent**: Create the `user_lists` table with a unique-per-user constraint, enable RLS, and attach the four canonical policies.

**Contract**: Table columns: `id uuid primary key default gen_random_uuid()`, `user_id uuid not null unique references auth.users (id) on delete cascade`, `give_text text not null`, `want_text text not null`, `saved_at timestamptz not null default now()`. RLS enabled. Four policies (`user_lists_select_own`, `user_lists_insert_own`, `user_lists_update_own`, `user_lists_delete_own`) all scoped to `authenticated` using `app.current_user_id()`. No `updated_at` trigger — `saved_at` is written by the caller explicitly.

#### 2. pgTAP test

**File**: `supabase/tests/user-lists.test.sql` (new)

**Intent**: Prove that cross-user reads return zero rows, cross-user writes raise `42501`, and two saves from the same user produce exactly one row (upsert semantics).

**Contract**: Assert: table exists; RLS enabled; Alice can select her own row; Alice cannot see Bob's row; Alice cannot insert a row with Bob's `user_id` (42501); two upserts from Alice leave exactly one row in the table.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly: `npx supabase db reset`
- pgTAP test passes: `npm run db:test`
- Type checking passes: `npm run build`
- Linting passes: `npm run lint`

#### Manual Verification:

- `public.user_lists` visible in Supabase Studio with RLS enabled badge and `UNIQUE(user_id)` constraint

**Implementation Note**: After automated verification passes, pause for human confirmation before proceeding.

---

## Phase 2: Service layer + evaluate-route wiring + vitest

### Overview

Create a thin service module (`src/lib/user-lists.ts`) with `saveUserLists` and `getUserLists`, wire `saveUserLists` into the evaluate route's success path (inside a silent try/catch), and cover the service with vitest unit tests.

### Changes Required:

#### 1. Service module

**File**: `src/lib/user-lists.ts` (new)

**Intent**: Single place for all `user_lists` DB interactions, following the `counterparties.ts` pattern (accepts `SupabaseClient | null`, throws on null, wraps Postgres errors with `cause: { code }`).

**Contract**:
- `export async function saveUserLists(client: SupabaseClient | null, userId: string, give: string, want: string): Promise<void>` — upserts `{ user_id: userId, give_text: give, want_text: want, saved_at: new Date().toISOString() }` with `onConflict: 'user_id'`; throws on null client or DB error.
- `export async function getUserLists(client: SupabaseClient | null, userId: string): Promise<{ give: string; want: string } | null>` — selects `give_text, want_text` filtered by `user_id`, uses `.maybeSingle()` (returns `null` for no row, throws on query error).

#### 2. Evaluate route — save after success

**File**: `src/pages/api/evaluate.ts`

**Intent**: After a successful evaluation, persist the user's give/want strings to `user_lists` without blocking or exposing the result on save failure.

**Contract**: After `log.info("evaluate.success", ...)` and before `return new Response(...)`, add a try/catch block that calls `saveUserLists(supabase, context.locals.user!.id, parsed.data.give, parsed.data.want)`. The catch block calls `context.locals.log.warn("user_lists.save_failed", { outcome: "failure", error: err })` and does not re-throw. `context.locals.user` is always non-null at this point (middleware gate).

#### 3. Vitest unit tests

**File**: `test/user-lists.test.ts` (new)

**Intent**: Verify that `saveUserLists` and `getUserLists` call Supabase with the correct arguments and handle the null-client, DB-error, and empty-result cases.

**Contract**: Use `vi.mock` to intercept Supabase client calls. Test cases: `saveUserLists` with a null client throws; `saveUserLists` calls `.upsert()` with correct payload; `saveUserLists` propagates DB errors; `getUserLists` with a null client throws; `getUserLists` returns null for a no-row result (`.maybeSingle()` returns `{ data: null }`); `getUserLists` maps `give_text`/`want_text` to `{ give, want }`.

#### 4. Vitest stub update (if needed)

**File**: `test/stubs/astro-env-server.ts`

**Intent**: No new env vars are required for this feature; this file may need no change. Confirm and update only if missing exports cause test failures.

### Success Criteria:

#### Automated Verification:

- All tests pass: `npm test`
- Type checking passes: `npm run build`
- Linting passes: `npm run lint`

#### Manual Verification:

- Run the evaluator with a valid account → a row appears (or updates) in `public.user_lists` in Supabase Studio; sign out, sign in as a second account → no row visible for the second account

**Implementation Note**: After automated verification passes, pause for human confirmation before proceeding.

---

## Phase 3: SSR pre-fill on the evaluator page

### Overview

Read the saved give/want lists in `index.astro`'s server-side frontmatter and inject them as textarea defaults, falling back to sample text silently on error or for accounts with no saved data.

### Changes Required:

#### 1. Pre-fill logic in page frontmatter

**File**: `src/pages/index.astro`

**Intent**: On every page render, try to load the current user's saved lists from `user_lists` and use them as the textarea initial content; never break the page if the load fails.

**Contract**: Import `createClient` from `@/lib/supabase` and `getUserLists` from `@/lib/user-lists`. After reading `user` from `Astro.locals`, create a supabase client with `createClient(Astro.request.headers, Astro.cookies)`. If the client is non-null and the user is present, call `getUserLists(supabase, user.id)` inside a try/catch; on any error, call `Astro.locals.log.warn("user_lists.load_failed", ...)` and use `null`. Derive `initialGive = saved?.give ?? sampleGive` and `initialWant = saved?.want ?? sampleWant`. Replace the textarea default content (`{sampleGive}`, `{sampleWant}`) with `{initialGive}` and `{initialWant}`.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run build`
- Linting passes: `npm run lint`

#### Manual Verification:

- Sign in → run the evaluator with custom give/want strings → sign out → sign back in → verify textareas are pre-filled with the previous strings
- Sign up with a fresh account → evaluator shows sample text (empty state — no saved row)
- `?redirect=//evil.com` sign-in flow still works (S-01 regression check)

**Implementation Note**: After automated verification passes, pause for human confirmation before proceeding.

---

## Testing Strategy

### Unit Tests (vitest):

- `saveUserLists`: null client → throw; correct upsert payload (user_id, give_text, want_text, saved_at); DB error propagated with cause.
- `getUserLists`: null client → throw; `.maybeSingle()` returning null → returns null; maps `give_text`/`want_text` to `{ give, want }`.

### DB Tests (pgTAP):

- `public.user_lists` table exists, RLS enabled.
- Alice reads only her own row (Bob's hidden).
- Alice cannot insert a row owned by Bob (42501).
- Two upserts from Alice → exactly one row (upsert, not insert).

### Manual Testing Steps:

1. `npx supabase db reset` → confirm migration applies cleanly.
2. `npm run db:test` → all pgTAP tests pass, including new `user-lists.test.sql`.
3. Sign in with Account A → run the evaluator with "klocki LEGO" / "lalka Barbie" → inspect Supabase Studio → one row in `user_lists` for Account A's `user_id`.
4. Sign out → sign back in as Account A → textareas pre-filled with "klocki LEGO" / "lalka Barbie".
5. Sign up / sign in as Account B → textareas show sample text (no row for Account B).
6. From Account A, run the evaluator again with different strings → row in `user_lists` updated (count stays at 1).
7. Clear button → textareas empty in the current session → reload → textareas pre-filled again from the DB (clear does not touch saved state).

## Performance Considerations

One extra DB read at page render (`.maybeSingle()` on `user_lists`) and one DB write after a successful evaluation (`.upsert()`). Both are indexed by `user_id` (unique constraint). Negligible at this scale; no caching needed.

## Migration Notes

New migration only. No changes to existing migrations or the counterparties seed. No data backfill — users who sign in before this ships start with no saved lists (empty state → sample text shown, which is correct).

## References

- Roadmap slice: `context/foundation/roadmap.md` § S-02
- PRD: US-04, FR-016, OQ-4
- RLS baseline: `supabase/migrations/20260529120000_rls_baseline.sql`
- RLS contract prose: `supabase/README.md`
- Service pattern: `src/lib/counterparties.ts`
- pgTAP pattern: `supabase/tests/rls_template.test.sql`
- Evaluate route (wiring point): `src/pages/api/evaluate.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: DB migration + pgTAP test

#### Automated

- [x] 1.1 Migration applies cleanly: `npx supabase db reset` — b35c664
- [x] 1.2 pgTAP test passes: `npm run db:test` — b35c664
- [x] 1.3 Type checking passes: `npm run build` — b35c664
- [x] 1.4 Linting passes: `npm run lint` — b35c664

#### Manual

- [x] 1.5 `public.user_lists` in Studio: RLS enabled, `UNIQUE(user_id)` constraint visible — b35c664

### Phase 2: Service layer + evaluate-route wiring + vitest

#### Automated

- [x] 2.1 All tests pass: `npm test`
- [x] 2.2 Type checking passes: `npm run build`
- [x] 2.3 Linting passes: `npm run lint`

#### Manual

- [x] 2.4 Run evaluator with Account A → `user_lists` row created/updated in Studio; Account B → no row visible

### Phase 3: SSR pre-fill on the evaluator page

#### Automated

- [ ] 3.1 Type checking passes: `npm run build`
- [ ] 3.2 Linting passes: `npm run lint`

#### Manual

- [ ] 3.3 Sign in → run evaluator → sign out → sign back in → textareas pre-filled with previous strings
- [ ] 3.4 Fresh account → sample text shown (empty state)
- [ ] 3.5 Clear button → textareas empty in session; reload → textareas pre-filled from DB (save not cleared)
