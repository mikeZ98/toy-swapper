-- ============================================================================
-- rls_template.test.sql
--
-- pgTAP test for the F-01 four-policy-per-table RLS template.
--
-- Proves that the cross-cutting helpers in migrations/20260529120000_rls_baseline.sql
-- plus the canonical four-policy pattern actually isolate user data:
--   * helper functions exist and are SQL/plpgsql as designed
--   * `app.current_user_id()` returns NULL outside an auth context
--   * a user only sees their own rows under SELECT
--   * a user cannot INSERT a row owned by another user (WITH CHECK denies)
--   * the postgres superuser bypasses RLS (sanity check — RLS IS the filter)
--
-- Runs inside `npx supabase test db` (and `npm run db:test`). The whole test
-- runs inside a transaction and ROLLBACKs at the end, so the probe table and
-- the seeded auth.users rows do not persist.
--
-- This is the executable spec of the template documented in supabase/README.md.
-- Future per-table migrations (F-02 counterparties, S-02 user_lists,
-- S-03 evaluations) ship a similarly-shaped test under supabase/tests/.
-- ============================================================================

begin;

select plan(9);

-- ---------------------------------------------------------------------------
-- 1-2. Helper functions exist
-- ---------------------------------------------------------------------------

select has_function(
  'app', 'current_user_id',
  'app.current_user_id() exists'
);

select has_function(
  'app', 'tg_set_updated_at',
  'app.tg_set_updated_at() exists'
);

-- ---------------------------------------------------------------------------
-- 3-4. Helper languages
-- ---------------------------------------------------------------------------

select function_lang_is(
  'app', 'current_user_id', ARRAY[]::name[],
  'sql',
  'app.current_user_id is a SQL function (planner can inline)'
);

select function_lang_is(
  'app', 'tg_set_updated_at', ARRAY[]::name[],
  'plpgsql',
  'app.tg_set_updated_at is plpgsql (trigger body)'
);

-- ---------------------------------------------------------------------------
-- 5. Outside an auth context, current_user_id() returns NULL.
--    (We're still running as the test role, before any role/JWT switch.)
-- ---------------------------------------------------------------------------

select is(
  app.current_user_id(),
  NULL::uuid,
  'app.current_user_id() returns NULL when no JWT claim is set'
);

-- ---------------------------------------------------------------------------
-- 6. Seed two users in auth.users. Real UUIDs; minimal fields.
--    `auth.users` is Supabase-managed and validates a number of constraints;
--    these inserts use the minimal column set the local Supabase image accepts.
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
-- 7. Build a probe table that follows the canonical four-policy template
--    (mirrors supabase/README.md verbatim — keep them in lockstep).
-- ---------------------------------------------------------------------------

create table public._rls_probe (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null references auth.users (id) on delete cascade,
  payload    text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public._rls_probe enable row level security;

create policy "_rls_probe_select_own"
  on public._rls_probe
  for select to authenticated
  using (user_id = app.current_user_id());

create policy "_rls_probe_insert_own"
  on public._rls_probe
  for insert to authenticated
  with check (user_id = app.current_user_id());

create policy "_rls_probe_update_own"
  on public._rls_probe
  for update to authenticated
  using      (user_id = app.current_user_id())
  with check (user_id = app.current_user_id());

create policy "_rls_probe_delete_own"
  on public._rls_probe
  for delete to authenticated
  using (user_id = app.current_user_id());

grant select, insert, update, delete on public._rls_probe to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Insert one row as Alice, one as Bob, each spoofing their own JWT.
--    set local scopes both the role switch and the JWT claim to this txn.
--
--    Portability: auth.uid() reads different GUCs across Supabase Postgres
--    image versions — older images read the legacy singular GUC
--    `request.jwt.claim.sub`, newer images parse `request.jwt.claims` (JSON).
--    We set BOTH at every identity switch so the test passes on the local
--    stack and on the CI runner regardless of image age.
-- ---------------------------------------------------------------------------

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}';
set local "request.jwt.claim.sub" to '00000000-0000-0000-0000-00000000000a';
insert into public._rls_probe (user_id, payload)
  values ('00000000-0000-0000-0000-00000000000a', 'alice-row');

set local "request.jwt.claims" to '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}';
set local "request.jwt.claim.sub" to '00000000-0000-0000-0000-00000000000b';
insert into public._rls_probe (user_id, payload)
  values ('00000000-0000-0000-0000-00000000000b', 'bob-row');

-- ---------------------------------------------------------------------------
-- 9. As Alice, count visible rows == 1 (RLS hides Bob's row).
-- ---------------------------------------------------------------------------

set local "request.jwt.claims" to '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}';
set local "request.jwt.claim.sub" to '00000000-0000-0000-0000-00000000000a';

select results_eq(
  $$ select count(*)::bigint from public._rls_probe $$,
  $$ values (1::bigint) $$,
  'Alice sees exactly her own row under SELECT (Bob hidden by RLS)'
);

-- ---------------------------------------------------------------------------
-- 10. As Bob, count visible rows == 1.
-- ---------------------------------------------------------------------------

set local "request.jwt.claims" to '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}';
set local "request.jwt.claim.sub" to '00000000-0000-0000-0000-00000000000b';

select results_eq(
  $$ select count(*)::bigint from public._rls_probe $$,
  $$ values (1::bigint) $$,
  'Bob sees exactly his own row under SELECT (Alice hidden by RLS)'
);

-- ---------------------------------------------------------------------------
-- 11. Cross-write attempt: as Alice, try to insert a row owned by Bob.
--     WITH CHECK clause must deny with 42501 (insufficient_privilege).
-- ---------------------------------------------------------------------------

set local "request.jwt.claims" to '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}';
set local "request.jwt.claim.sub" to '00000000-0000-0000-0000-00000000000a';

select throws_ok(
  $$ insert into public._rls_probe (user_id, payload)
       values ('00000000-0000-0000-0000-00000000000b', 'alice-trying-to-write-as-bob') $$,
  '42501',
  NULL,
  'Alice cannot insert a row owned by Bob (WITH CHECK enforces user_id = current_user_id)'
);

-- ---------------------------------------------------------------------------
-- 12. Sanity check: reset to test role, count == 2 (rows do exist; RLS is
--     what filters them). Without this, a test that always returns 0 rows
--     would pass falsely.
-- ---------------------------------------------------------------------------

reset role;

select results_eq(
  $$ select count(*)::bigint from public._rls_probe $$,
  $$ values (2::bigint) $$,
  'postgres role sees both rows — confirms RLS (not data absence) is filtering'
);

select * from finish();

rollback;
