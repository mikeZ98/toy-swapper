-- ============================================================================
-- user-lists.test.sql
--
-- pgTAP test for S-02 (restore-saved-lists) — public.user_lists.
--
-- Proves the table follows the four-policy RLS contract AND the "one row per
-- user, replaced on each save" upsert semantics (FR-016):
--   * table exists, RLS enabled
--   * a user sees only their own row under SELECT (cross-user read returns 0)
--   * a user cannot INSERT a row owned by another user (WITH CHECK → 42501)
--   * an upsert from the same user REPLACES rather than duplicates (count stays 1)
--   * the postgres superuser bypasses RLS (sanity check — RLS IS the filter)
--
-- Runs inside `npx supabase test db` (and `npm run db:test`). Whole test runs
-- in a transaction and ROLLBACKs at the end. Mirrors the JWT-spoofing pattern
-- in supabase/tests/rls_template.test.sql.
-- ============================================================================

begin;

select plan(6);

-- ---------------------------------------------------------------------------
-- 1-2. Table exists, RLS enabled.
-- ---------------------------------------------------------------------------

select has_table(
  'public', 'user_lists',
  'public.user_lists table exists'
);

select is(
  (select relrowsecurity from pg_class where oid = 'public.user_lists'::regclass),
  true,
  'RLS is enabled on public.user_lists'
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
-- 4. Insert one row as Alice, one as Bob, each spoofing their own JWT.
--    Set BOTH the legacy and JSON GUCs so auth.uid() resolves across image ages.
-- ---------------------------------------------------------------------------

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}';
set local "request.jwt.claim.sub" to '00000000-0000-0000-0000-00000000000a';
insert into public.user_lists (user_id, give_text, want_text)
  values ('00000000-0000-0000-0000-00000000000a', 'alice-give-v1', 'alice-want-v1');

set local "request.jwt.claims" to '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}';
set local "request.jwt.claim.sub" to '00000000-0000-0000-0000-00000000000b';
insert into public.user_lists (user_id, give_text, want_text)
  values ('00000000-0000-0000-0000-00000000000b', 'bob-give-v1', 'bob-want-v1');

-- ---------------------------------------------------------------------------
-- 5. As Alice, SELECT returns exactly her own row (Bob hidden by RLS).
-- ---------------------------------------------------------------------------

set local "request.jwt.claims" to '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}';
set local "request.jwt.claim.sub" to '00000000-0000-0000-0000-00000000000a';

select results_eq(
  $$ select count(*)::bigint from public.user_lists $$,
  $$ values (1::bigint) $$,
  'Alice sees exactly her own row under SELECT (Bob hidden by RLS)'
);

-- ---------------------------------------------------------------------------
-- 6. Cross-write attempt: as Alice, insert a row owned by Bob → 42501.
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ insert into public.user_lists (user_id, give_text, want_text)
       values ('00000000-0000-0000-0000-00000000000b', 'x', 'y') $$,
  '42501',
  NULL,
  'Alice cannot insert a row owned by Bob (WITH CHECK enforces user_id = current_user_id)'
);

-- ---------------------------------------------------------------------------
-- 7. Upsert from Alice REPLACES her row (count stays 1, value updated).
--    onConflict (user_id) do update — same shape the service uses.
-- ---------------------------------------------------------------------------

insert into public.user_lists (user_id, give_text, want_text)
  values ('00000000-0000-0000-0000-00000000000a', 'alice-give-v2', 'alice-want-v2')
  on conflict (user_id) do update
    set give_text = excluded.give_text,
        want_text = excluded.want_text,
        saved_at  = now();

select results_eq(
  $$ select count(*)::bigint from public.user_lists $$,
  $$ values (1::bigint) $$,
  'Alice still has exactly one row after upsert (replaced, not duplicated)'
);

-- ---------------------------------------------------------------------------
-- 8. Sanity: reset to superuser. Two rows total, and Alice''s row carries the
--    upserted value (proves the upsert updated in place).
-- ---------------------------------------------------------------------------

reset role;

select results_eq(
  $$ select give_text from public.user_lists
       where user_id = '00000000-0000-0000-0000-00000000000a' $$,
  $$ values ('alice-give-v2'::text) $$,
  'Alice row holds the upserted give_text (update in place, RLS confirmed as the filter)'
);

select * from finish();

rollback;
