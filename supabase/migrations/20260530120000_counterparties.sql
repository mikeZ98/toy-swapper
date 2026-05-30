-- ============================================================================
-- 20260530120000_counterparties.sql
--
-- ToySwapper v2 — F-02 (seed-counterparty-pool): the counterparty pool table.
--
-- Moves the v1 hardcoded FIXTURE_POOL (src/lib/fixture-pool.ts) into a seeded,
-- RLS-protected table that the evaluator reads at request time. This is a
-- SHARED READ-ONLY table — it deviates from the four-policy-per-table template
-- (see supabase/README.md): RLS on, SELECT granted to anon + authenticated,
-- NO per-row user_id scoping and NO write policies.
--
-- Determinism contract (PRD FR-017, NFR):
--   * The 5 rows are byte-identical to the v1 FIXTURE_POOL.
--   * `sort_order` preserves the exact v1 array order so the evaluator's
--     stable-sort tie-breaking (findBestMatch) yields byte-identical output.
--   * This filename is IMMUTABLE once on master. A future pool edit ships as a
--     new timestamped migration — an explicit determinism boundary.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------

create table public.counterparties (
  id         text        primary key,
  sort_order smallint    not null unique,
  name       text        not null,
  give       text        not null,
  want       text        not null,
  created_at timestamptz not null default now()
);

comment on table public.counterparties is
  'Shared read-only counterparty pool (v1 FIXTURE_POOL). Seeded by migration; '
  'read by the evaluator ordered by sort_order. No per-user scoping by design.';

comment on column public.counterparties.sort_order is
  'Preserves the v1 FIXTURE_POOL array order. The evaluator reads ORDER BY '
  'sort_order so stable-sort tie-breaking stays byte-identical to v1.';

-- ---------------------------------------------------------------------------
-- RLS — shared read-only deviation (see supabase/README.md "read-only shared")
-- ---------------------------------------------------------------------------

alter table public.counterparties enable row level security;

create policy "counterparties_select_all"
  on public.counterparties
  for select to anon, authenticated
  using (true);

comment on policy "counterparties_select_all" on public.counterparties is
  'AUDIT: intentional using(true). This is a shared, read-only seeded reference '
  'table with no user-owned rows — every role may read every row. There are no '
  'insert/update/delete policies, so the table is immutable at runtime; only '
  'migrations (run as table owner, which bypasses RLS) may change its contents.';

grant select on public.counterparties to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Seed — byte-identical to src/lib/fixture-pool.ts, sort_order in array order
-- ---------------------------------------------------------------------------

insert into public.counterparties (id, sort_order, name, give, want) values
  ('kasia-warszawa', 1, 'Kasia (Warszawa)',
   'klocki LEGO Duplo bardzo dobry stan; książka ''Mała Mi'' twarda oprawa; bluza H&M rozmiar 92 jak nowa',
   'autko resorak; plastikowe kubki do piasku; czapka zimowa rozmiar 92'),
  ('tom-krakow', 2, 'Tom (Kraków)',
   'Toy car Hot Wheels x3 like new; LEGO Classic 200 pieces good condition; Winter hat size 92 used',
   'LEGO Duplo any set; kids book Polish or English; hoodie size 92'),
  ('ania-wroclaw', 3, 'Ania (Wrocław)',
   'lalka Barbie z domkiem dobry stan; puzzle 100 elementów Disney nowe; zestaw kredek 24 szt jak nowy',
   'klocki LEGO Duplo; plastikowa zjeżdżalnia; książki dla dzieci'),
  ('piotr-gdansk', 4, 'Piotr (Gdańsk)',
   'rowerek biegowy Puky używany dobry stan; kombinezon zimowy Reima rozmiar 98; gumowce żabki rozmiar 24',
   'wózek spacerowy; fotelik samochodowy 9-18kg'),
  ('mira-poznan', 5, 'Mira (Poznań)',
   'Plastic sandcastle bucket set new; H&M hoodie size 92 like new; children book set 5 books used',
   'LEGO Duplo; art supplies; Barbie doll');
