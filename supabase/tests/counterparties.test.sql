-- ============================================================================
-- counterparties.test.sql
--
-- pgTAP test for the F-02 shared read-only counterparty pool
-- (migrations/20260530120000_counterparties.sql).
--
-- Proves the determinism + RLS contract for public.counterparties:
--   * the table exists and has RLS enabled
--   * an anon (unauthenticated) reader sees all 5 seeded rows
--   * the rows come back in the exact v1 FIXTURE_POOL order (by sort_order)
--   * one row's content is byte-identical to the v1 source
--   * the shared-read shape denies writes (42501) — only migrations mutate it
--
-- Runs inside `npx supabase test db` (and the docker-exec equivalent). The whole
-- test runs in a transaction and ROLLBACKs at the end.
-- ============================================================================

begin;

select plan(6);

-- ---------------------------------------------------------------------------
-- 1. Table exists
-- ---------------------------------------------------------------------------

select has_table(
  'public', 'counterparties',
  'public.counterparties table exists'
);

-- ---------------------------------------------------------------------------
-- 2. RLS is enabled
-- ---------------------------------------------------------------------------

select is(
  (select relrowsecurity from pg_class where oid = 'public.counterparties'::regclass),
  true,
  'row level security is enabled on public.counterparties'
);

-- ---------------------------------------------------------------------------
-- 3. An anon reader sees all 5 seeded rows (shared read-only: using(true)).
-- ---------------------------------------------------------------------------

set local role anon;

select results_eq(
  $$ select count(*)::bigint from public.counterparties $$,
  $$ values (5::bigint) $$,
  'anon sees all 5 counterparty rows'
);

-- ---------------------------------------------------------------------------
-- 4. Rows come back in the exact v1 FIXTURE_POOL order (by sort_order).
-- ---------------------------------------------------------------------------

select results_eq(
  $$ select id from public.counterparties order by sort_order $$,
  $$ values ('kasia-warszawa'), ('tom-krakow'), ('ania-wroclaw'), ('piotr-gdansk'), ('mira-poznan') $$,
  'counterparties are ordered byte-identically to the v1 FIXTURE_POOL array'
);

-- ---------------------------------------------------------------------------
-- 5. One row's content is byte-identical to src/lib/fixture-pool.ts.
-- ---------------------------------------------------------------------------

select results_eq(
  $$ select name, give, want from public.counterparties where id = 'kasia-warszawa' $$,
  $$ values (
       'Kasia (Warszawa)'::text,
       'klocki LEGO Duplo bardzo dobry stan; książka ''Mała Mi'' twarda oprawa; bluza H&M rozmiar 92 jak nowa'::text,
       'autko resorak; plastikowe kubki do piasku; czapka zimowa rozmiar 92'::text
     ) $$,
  'kasia-warszawa row content is byte-identical to the v1 source'
);

-- ---------------------------------------------------------------------------
-- 6. Writes are denied — no insert policy / grant on this shared table.
-- ---------------------------------------------------------------------------

set local role authenticated;

select throws_ok(
  $$ insert into public.counterparties (id, sort_order, name, give, want)
       values ('mallory', 99, 'Mallory', 'x', 'y') $$,
  '42501',
  NULL,
  'an authenticated user cannot insert into the shared read-only pool'
);

reset role;

select * from finish();

rollback;
