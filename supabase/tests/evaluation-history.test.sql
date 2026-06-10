-- ============================================================================
-- evaluation-history.test.sql
--
-- pgTAP isolation test for S-03 (evaluation-history) — public.evaluation_history.
--
-- Proves the README-mandated RLS isolation contract for a user-scoped table,
-- adapted for APPEND-ONLY semantics (the divergence from user_lists):
--   * table exists, RLS enabled
--   * a user sees only their own rows under SELECT (cross-user read returns 0)
--   * a user cannot INSERT a row owned by another user (WITH CHECK → 42501)
--   * a SECOND insert from the same user GROWS the count (append, not replace)
--   * the postgres superuser bypasses RLS (sanity — RLS IS the filter)
--   * NEGATIVE CONTROLS (R2): each isolation assertion provably FLIPS when its
--     policy is relaxed in-transaction — select→using(true) makes Alice see all
--     rows; insert WITH CHECK→(true) lets a cross-account write succeed.
--
-- The R5 byte-identical determinism proof lives at the Vitest service layer
-- (test/evaluation-history.test.ts, join-rename guard), per the test rollout's
-- Phase 3 (context/foundation/test-plan.md §3) — a SQL byte round-trip would
-- mostly test Postgres text storage (low signal). This file owns the isolation
-- contract (R1) + its negative controls (R2) per supabase/README.md §6.1.
--
-- Runs inside `npx supabase test db` (and `npm run db:test`). Whole test runs in
-- a transaction and ROLLBACKs. Mirrors the JWT-spoofing pattern in
-- supabase/tests/user-lists.test.sql.
-- ============================================================================

begin;

select plan(8);

-- ---------------------------------------------------------------------------
-- 1-2. Table exists, RLS enabled.
-- ---------------------------------------------------------------------------

select has_table(
  'public', 'evaluation_history',
  'public.evaluation_history table exists'
);

select is(
  (select relrowsecurity from pg_class where oid = 'public.evaluation_history'::regclass),
  true,
  'RLS is enabled on public.evaluation_history'
);

-- ---------------------------------------------------------------------------
-- 3. Seed two users in auth.users (minimal column set the local image accepts).
-- ---------------------------------------------------------------------------

insert into auth.users (id, instance_id, email, encrypted_password, aud, role, created_at, updated_at)
values
  ('00000000-0000-0000-0000-00000000000a',
   '00000000-0000-0000-0000-000000000000',
   'alice@test.local', '', 'authenticated', 'authenticated', now(), now()),
  ('00000000-0000-0000-0000-00000000000b',
   '00000000-0000-0000-0000-000000000000',
   'bob@test.local',   '', 'authenticated', 'authenticated', now(), now());

-- ---------------------------------------------------------------------------
-- 4. Insert one history row as Alice, one as Bob, each spoofing their own JWT.
--    Set BOTH the legacy and JSON GUCs so auth.uid() resolves across image ages.
--    counterparty_id left null (NO-MATCH shape); contract/threshold/source are
--    NOT NULL so they must be supplied.
-- ---------------------------------------------------------------------------

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}';
set local "request.jwt.claim.sub" to '00000000-0000-0000-0000-00000000000a';
insert into public.evaluation_history (user_id, contract, threshold_pct, source)
  values ('00000000-0000-0000-0000-00000000000a', '# alice contract 1', 20, 'stub');

set local "request.jwt.claims" to '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}';
set local "request.jwt.claim.sub" to '00000000-0000-0000-0000-00000000000b';
insert into public.evaluation_history (user_id, contract, threshold_pct, source)
  values ('00000000-0000-0000-0000-00000000000b', '# bob contract 1', 20, 'stub');

-- ---------------------------------------------------------------------------
-- 5. As Alice, SELECT returns exactly her own row (Bob hidden by RLS).
-- ---------------------------------------------------------------------------

set local "request.jwt.claims" to '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}';
set local "request.jwt.claim.sub" to '00000000-0000-0000-0000-00000000000a';

select results_eq(
  $$ select count(*)::bigint from public.evaluation_history $$,
  $$ values (1::bigint) $$,
  'Alice sees exactly her own row under SELECT (Bob hidden by RLS)'
);

-- ---------------------------------------------------------------------------
-- 6. Cross-write attempt: as Alice, insert a row owned by Bob → 42501.
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ insert into public.evaluation_history (user_id, contract, threshold_pct, source)
       values ('00000000-0000-0000-0000-00000000000b', 'x', 20, 'stub') $$,
  '42501',
  NULL,
  'Alice cannot insert a row owned by Bob (WITH CHECK enforces user_id = current_user_id)'
);

-- ---------------------------------------------------------------------------
-- 7. APPEND semantics: a second insert from Alice GROWS her count to 2 (the
--    divergence from user_lists, where an upsert would keep it at 1).
-- ---------------------------------------------------------------------------

insert into public.evaluation_history (user_id, contract, threshold_pct, source)
  values ('00000000-0000-0000-0000-00000000000a', '# alice contract 2', 20, 'stub');

select results_eq(
  $$ select count(*)::bigint from public.evaluation_history $$,
  $$ values (2::bigint) $$,
  'Alice now has TWO rows after a second insert (append-only, not replaced)'
);

-- ---------------------------------------------------------------------------
-- 8. Sanity: reset to superuser. Three rows total (Alice 2 + Bob 1) — proves
--    RLS (not data absence) was the filter for Alice''s count of 2.
-- ---------------------------------------------------------------------------

reset role;

select results_eq(
  $$ select count(*)::bigint from public.evaluation_history $$,
  $$ values (3::bigint) $$,
  'Superuser sees all three rows (RLS confirmed as the filter, not missing data)'
);

-- ---------------------------------------------------------------------------
-- 9. NEGATIVE CONTROL (R2 — false-green guard): prove the SELECT assertion is
--    causally bound to evaluation_history_select_own. Relax it to using(true)
--    and re-assert Alice now sees ALL THREE rows (her 2 + Bob''s 1). Policy DDL
--    runs as the table OWNER (superuser); step 8 did `reset role`, so we are
--    superuser here.
-- ---------------------------------------------------------------------------

alter policy "evaluation_history_select_own" on public.evaluation_history using (true);

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}';
set local "request.jwt.claim.sub" to '00000000-0000-0000-0000-00000000000a';

select results_eq(
  $$ select count(*)::bigint from public.evaluation_history $$,
  $$ values (3::bigint) $$,
  'NEGATIVE CONTROL: with the select policy relaxed to using(true), Alice sees ALL rows (her 2 + Bob 1) — proves the "Alice sees 1" assertion is bound to the policy'
);

-- ---------------------------------------------------------------------------
-- 10. NEGATIVE CONTROL (R2 — 42501 disambiguation): relax the insert WITH CHECK
--     to (true), grant untouched, and prove a cross-account write now SUCCEEDS.
--     Unlike user_lists, evaluation_history is APPEND-ONLY (no UNIQUE(user_id)),
--     so no third-user trick is needed — Alice can simply write a SECOND row
--     owned by Bob and it succeeds (no 23505 to confuse with the relaxed RLS).
-- ---------------------------------------------------------------------------

reset role;
alter policy "evaluation_history_insert_own" on public.evaluation_history with check (true);

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}';
set local "request.jwt.claim.sub" to '00000000-0000-0000-0000-00000000000a';

select lives_ok(
  $$ insert into public.evaluation_history (user_id, contract, threshold_pct, source)
       values ('00000000-0000-0000-0000-00000000000b', '# alice writing as bob', 20, 'stub') $$,
  'NEGATIVE CONTROL: with the insert WITH CHECK relaxed to (true) and the grant intact, Alice CAN write a row Bob owns — proves the earlier 42501 was the RLS policy, not a missing grant'
);

reset role;

select * from finish();

rollback;
