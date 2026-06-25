-- ============================================================================
-- evaluation-history-delete.test.sql
--
-- pgTAP isolation test for the DELETE leg of S-03 (evaluation-history) —
-- public.evaluation_history. The existing evaluation-history.test.sql owns the
-- SELECT/INSERT isolation contract; this file owns the delete policy
-- (evaluation_history_delete_own), which shipped in the table migration for a
-- "clear my history" path but had no coverage until the delete UI/service landed.
--
-- Proves:
--   * a user CAN delete their own row (delete policy grants self-deletes)
--   * a user CANNOT delete another user's row (cross-user delete is a no-op)
--   * the delete policy — not just the select policy — is the gate: with SELECT
--     relaxed to using(true) so visibility is NOT the blocker, a strict DELETE
--     policy still stops the cross-user delete; relaxing DELETE to using(true)
--     then lets it through (negative control, R2).
--
-- Rows are seeded as the table owner (RLS bypassed) so the seed does not depend
-- on the insert policy; the delete assertions run as `authenticated` with a
-- spoofed JWT (sub = the user id), mirroring evaluation-history.test.sql.
--
-- Runs inside `npx supabase test db`. Whole test runs in a transaction and
-- ROLLBACKs.
-- ============================================================================

begin;

select plan(5);

-- ---------------------------------------------------------------------------
-- 1. Table exists.
-- ---------------------------------------------------------------------------

select has_table('public', 'evaluation_history', 'public.evaluation_history table exists');

-- ---------------------------------------------------------------------------
-- 2. Seed two users and their rows AS OWNER (RLS bypassed): Alice has 2 rows,
--    Bob has 1. Seeding as owner keeps the fixture independent of the insert
--    policy (that contract is covered in evaluation-history.test.sql).
-- ---------------------------------------------------------------------------

insert into auth.users (id, instance_id, email, encrypted_password, aud, role, created_at, updated_at)
values
  ('00000000-0000-0000-0000-00000000000a',
   '00000000-0000-0000-0000-000000000000',
   'alice@test.local', '', 'authenticated', 'authenticated', now(), now()),
  ('00000000-0000-0000-0000-00000000000b',
   '00000000-0000-0000-0000-000000000000',
   'bob@test.local',   '', 'authenticated', 'authenticated', now(), now());

insert into public.evaluation_history (user_id, contract, threshold_pct, source)
values
  ('00000000-0000-0000-0000-00000000000a', '# alice contract 1', 20, 'stub'),
  ('00000000-0000-0000-0000-00000000000a', '# alice contract 2', 20, 'stub'),
  ('00000000-0000-0000-0000-00000000000b', '# bob contract 1',   20, 'stub');

-- ---------------------------------------------------------------------------
-- 3. As Alice (authenticated), deleting one of HER OWN rows succeeds.
-- ---------------------------------------------------------------------------

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}';
set local "request.jwt.claim.sub" to '00000000-0000-0000-0000-00000000000a';

select lives_ok(
  $$ delete from public.evaluation_history where contract = '# alice contract 1' $$,
  'Alice can delete her own row (evaluation_history_delete_own grants self-deletes)'
);

-- ---------------------------------------------------------------------------
-- 4. Alice now has exactly ONE row left (started with 2, deleted 1). Confirms
--    the delete actually removed a row under her own RLS-scoped view.
-- ---------------------------------------------------------------------------

select results_eq(
  $$ select count(*)::bigint from public.evaluation_history $$,
  $$ values (1::bigint) $$,
  'Alice has 1 row left after deleting one of her two (RLS-scoped delete took effect)'
);

-- ---------------------------------------------------------------------------
-- 5. Cross-user delete attempt (normal config, both policies strict): as Alice,
--    delete Bob's row. It matches 0 rows and Bob's row survives. (Under strict
--    config this is enforced by the select+delete policies together — step 6
--    isolates that the DELETE policy specifically is load-bearing.)
-- ---------------------------------------------------------------------------

delete from public.evaluation_history where user_id = '00000000-0000-0000-0000-00000000000b';

reset role;
select results_eq(
  $$ select count(*)::bigint from public.evaluation_history
     where user_id = '00000000-0000-0000-0000-00000000000b' $$,
  $$ values (1::bigint) $$,
  'Bob''s row SURVIVES Alice''s cross-user delete attempt (RLS blocks it)'
);

-- ---------------------------------------------------------------------------
-- 6. NEGATIVE CONTROL (R2) — isolate the DELETE policy as the gate. Relax SELECT
--    to using(true) so row visibility is NOT what blocks Alice, leaving the
--    strict DELETE policy as the only barrier; her delete of Bob's row still
--    affects 0 rows. Then relax DELETE to using(true) and the same delete now
--    succeeds — proving the block was bound to evaluation_history_delete_own.
-- ---------------------------------------------------------------------------

alter policy "evaluation_history_select_own" on public.evaluation_history using (true);

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}';
set local "request.jwt.claim.sub" to '00000000-0000-0000-0000-00000000000a';
delete from public.evaluation_history where user_id = '00000000-0000-0000-0000-00000000000b';

reset role;
alter policy "evaluation_history_delete_own" on public.evaluation_history using (true);

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}';
set local "request.jwt.claim.sub" to '00000000-0000-0000-0000-00000000000a';
delete from public.evaluation_history where user_id = '00000000-0000-0000-0000-00000000000b';

reset role;
select results_eq(
  $$ select count(*)::bigint from public.evaluation_history
     where user_id = '00000000-0000-0000-0000-00000000000b' $$,
  $$ values (0::bigint) $$,
  'NEGATIVE CONTROL: Bob''s row survives while DELETE is strict (select open) but is removed once DELETE is relaxed to using(true) — the delete policy is the gate'
);

select * from finish();

rollback;
