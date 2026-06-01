-- ============================================================================
-- evaluations.test.sql
--
-- pgTAP test for S-03 (evaluation-history) — public.evaluations.
--
-- Proves the per-user RLS contract AND the append-only shape (FR-018/019):
--   * table exists, RLS enabled
--   * a user sees only their own rows under SELECT (cross-user read → 0)
--   * a user cannot INSERT a row owned by another user (WITH CHECK → 42501)
--   * a user cannot UPDATE or DELETE — no policy/grant exists (→ 42501),
--     proving the table is append-only at runtime
--   * the postgres superuser bypasses RLS (sanity — RLS IS the filter)
--
-- Runs inside `npx supabase test db` (and `npm run db:test`). Whole test runs
-- in a transaction and ROLLBACKs at the end. Mirrors the JWT-spoofing pattern
-- in supabase/tests/user-lists.test.sql.
-- ============================================================================

begin;

select plan(7);

-- ---------------------------------------------------------------------------
-- 1-2. Table exists, RLS enabled.
-- ---------------------------------------------------------------------------

select has_table(
  'public', 'evaluations',
  'public.evaluations table exists'
);

select is(
  (select relrowsecurity from pg_class where oid = 'public.evaluations'::regclass),
  true,
  'RLS is enabled on public.evaluations'
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
-- 4. Insert one row as Alice, one as Bob (NO-MATCH rows: counterparty_id NULL).
--    Set BOTH the legacy and JSON JWT GUCs so auth.uid() resolves across images.
-- ---------------------------------------------------------------------------

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}';
set local "request.jwt.claim.sub" to '00000000-0000-0000-0000-00000000000a';
insert into public.evaluations (user_id, contract, verdict, delta_pln, counterparty_id, threshold_pct, source)
  values ('00000000-0000-0000-0000-00000000000a', 'alice-contract', 'FAIR', 0, null, 20, 'stub');

set local "request.jwt.claims" to '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}';
set local "request.jwt.claim.sub" to '00000000-0000-0000-0000-00000000000b';
insert into public.evaluations (user_id, contract, verdict, delta_pln, counterparty_id, threshold_pct, source)
  values ('00000000-0000-0000-0000-00000000000b', 'bob-contract', 'NEEDS BALANCING', 30, null, 20, 'stub');

-- ---------------------------------------------------------------------------
-- 5. As Alice, SELECT returns exactly her own row (Bob hidden by RLS).
-- ---------------------------------------------------------------------------

set local "request.jwt.claims" to '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}';
set local "request.jwt.claim.sub" to '00000000-0000-0000-0000-00000000000a';

select results_eq(
  $$ select count(*)::bigint from public.evaluations $$,
  $$ values (1::bigint) $$,
  'Alice sees exactly her own row under SELECT (Bob hidden by RLS)'
);

-- ---------------------------------------------------------------------------
-- 6. Cross-write attempt: as Alice, insert a row owned by Bob → 42501.
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ insert into public.evaluations (user_id, contract, threshold_pct, source)
       values ('00000000-0000-0000-0000-00000000000b', 'x', 20, 'stub') $$,
  '42501',
  NULL,
  'Alice cannot insert a row owned by Bob (WITH CHECK enforces user_id = current_user_id)'
);

-- ---------------------------------------------------------------------------
-- 7. Append-only: as Alice, UPDATE her own row → 42501 (no update grant/policy).
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ update public.evaluations set verdict = 'NEEDS BALANCING'
       where user_id = '00000000-0000-0000-0000-00000000000a' $$,
  '42501',
  NULL,
  'Alice cannot UPDATE history rows (append-only — no update policy/grant)'
);

-- ---------------------------------------------------------------------------
-- 8. Append-only: as Alice, DELETE her own row → 42501 (no delete grant/policy).
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ delete from public.evaluations
       where user_id = '00000000-0000-0000-0000-00000000000a' $$,
  '42501',
  NULL,
  'Alice cannot DELETE history rows (append-only — no delete policy/grant)'
);

-- ---------------------------------------------------------------------------
-- 9. Sanity: reset to superuser, count == 2 (rows exist; RLS is the filter).
-- ---------------------------------------------------------------------------

reset role;

select results_eq(
  $$ select count(*)::bigint from public.evaluations $$,
  $$ values (2::bigint) $$,
  'postgres role sees both rows — confirms RLS (not data absence) is filtering'
);

select * from finish();

rollback;
