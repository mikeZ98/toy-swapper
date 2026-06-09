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
--
-- Negative controls + the R5 byte-identical determinism proof are added by the
-- test rollout's Phase 3 (see context/foundation/test-plan.md §3). This is the
-- baseline isolation the feature ships per supabase/README.md.
--
-- Runs inside `npx supabase test db` (and `npm run db:test`). Whole test runs in
-- a transaction and ROLLBACKs. Mirrors the JWT-spoofing pattern in
-- supabase/tests/user-lists.test.sql.
-- ============================================================================

begin;

select plan(6);

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

select * from finish();

rollback;
