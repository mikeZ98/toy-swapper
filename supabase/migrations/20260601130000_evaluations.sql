-- ============================================================================
-- 20260601130000_evaluations.sql
--
-- ToySwapper v2 — S-03 (evaluation-history): per-user append-only history of
-- successful evaluations (FR-018, FR-019).
--
-- Each successful evaluation persists one row: the contract Markdown verbatim
-- plus verdict, delta_pln, counterparty_id, threshold_pct, source, and a
-- server timestamp. Rows are read back most-recent-first for the /history page.
--
-- Deliberate shape choices vs the canonical four-policy template
-- (migrations/20260529120000_rls_baseline.sql / supabase/README.md):
--   * APPEND-ONLY — only select + insert policies (and grants). History is an
--     immutable audit log; there is no edit/delete requirement (FR-018/019),
--     and update on an audit row is semantically wrong. Omitting the
--     update/delete policies+grants makes the table append-only at runtime.
--   * counterparty_id is a NULLABLE FK to public.counterparties(id) — this is
--     what lets the read query embed counterparties(name) for the row's
--     display name. The evaluator only ever emits a pool id or NULL (NO MATCH),
--     so the FK never blocks an insert. on delete set null is defensive only;
--     counterparties is immutable seeded data.
--   * seq (identity) gives a monotonic insertion-order tie-break so ordering by
--     (created_at desc, seq desc) is stable — the uuid PK is not ordered
--     (FR-019: tie-break by database row id / insertion order).
--   * delta_pln is numeric (not integer) to store the evaluator's delta
--     losslessly regardless of integer/fractional PLN; NULL for NO MATCH.
--
-- Determinism contract: once this filename lands on master, it is IMMUTABLE.
-- Fixes ship as new timestamped migrations. See supabase/README.md.
-- ============================================================================

create table public.evaluations (
  id              uuid        primary key default gen_random_uuid(),
  seq             bigint      generated always as identity,
  user_id         uuid        not null references auth.users (id) on delete cascade,
  contract        text        not null,
  verdict         text,
  delta_pln       numeric,
  counterparty_id text        references public.counterparties (id) on delete set null,
  threshold_pct   smallint    not null,
  source          text        not null check (source in ('llm', 'stub', 'llm-failed-fallback')),
  created_at      timestamptz not null default now()
);

comment on table public.evaluations is
  'S-03: per-user append-only history of successful evaluations (FR-018/019). '
  'select+insert RLS only — immutable audit log, no edit/delete.';

-- Read path: own rows, most-recent-first with a stable insertion-order tie-break.
create index evaluations_user_recent_idx
  on public.evaluations (user_id, created_at desc, seq desc);

alter table public.evaluations enable row level security;

-- Strip the broad default-privilege grants Supabase applies to anon/authenticated
-- at table creation, then grant back exactly select+insert. This makes the
-- append-only guarantee privilege-level (UPDATE/DELETE raise 42501), not merely
-- RLS-filtered — defense in depth, and the auditable shape the contract wants.
revoke all on public.evaluations from anon, authenticated;

create policy "evaluations_select_own"
  on public.evaluations
  for select to authenticated
  using (user_id = app.current_user_id());

create policy "evaluations_insert_own"
  on public.evaluations
  for insert to authenticated
  with check (user_id = app.current_user_id());

-- APPEND-ONLY: intentionally no update/delete policies or grants. History rows
-- are immutable once written; only select + insert are permitted at runtime.
grant select, insert on public.evaluations to authenticated;
