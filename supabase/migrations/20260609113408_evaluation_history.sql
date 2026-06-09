-- ============================================================================
-- 20260609113408_evaluation_history.sql
--
-- ToySwapper v2 — S-03 (evaluation-history): per-user, append-only history of
-- successful evaluations (FR-018 / FR-019 / US-05).
--
-- One row PER successful evaluation (append-only event log) holding the contract
-- Markdown verbatim plus the evaluation metadata. The evaluator inserts a row on
-- each success; the /history page lists them most-recent-first and expands any
-- row to the stored contract — shown byte-identical to the original, never
-- re-rendered or re-evaluated against the live counterparty pool (PRD NFR).
--
-- Follows the canonical four-policy RLS template from
-- migrations/20260529120000_rls_baseline.sql / supabase/README.md, with two
-- deliberate shape choices that DIVERGE from the user_lists analog:
--   * NO UNIQUE(user_id) and NO upsert — this is an append-only log (many rows
--     per user), not a one-row-per-user store. A plain insert per evaluation.
--   * NO update policy — rows are immutable once written. select / insert /
--     delete only (delete ships for a future "clear my history"; no UI yet).
--
-- counterparty_id is a nullable FK to the immutable, migration-seeded
-- counterparties pool (NO MATCH → null). The FK lets the read path embed
-- counterparties(name) for the FR-019 list label.
--
-- Determinism contract: once this filename lands on master, it is IMMUTABLE.
-- Fixes ship as new timestamped migrations. See supabase/README.md.
-- ============================================================================

create table public.evaluation_history (
  id              uuid        primary key default gen_random_uuid(),
  user_id         uuid        not null references auth.users (id) on delete cascade,
  contract        text        not null,
  counterparty_id text        references public.counterparties (id),
  verdict         text,
  delta_pln       numeric,
  threshold_pct   numeric     not null,
  source          text        not null,
  created_at      timestamptz not null default now()
);

comment on table public.evaluation_history is
  'S-03: per-user append-only history of successful evaluations (FR-018). One '
  'row per evaluation; contract stored verbatim and read back byte-identical '
  '(no re-render). No UNIQUE(user_id), no update policy — immutable event log.';

-- Most-recent-first list read, scoped per user (FR-019).
create index evaluation_history_user_created_idx
  on public.evaluation_history (user_id, created_at desc);

alter table public.evaluation_history enable row level security;

create policy "evaluation_history_select_own"
  on public.evaluation_history
  for select to authenticated
  using (user_id = app.current_user_id());

create policy "evaluation_history_insert_own"
  on public.evaluation_history
  for insert to authenticated
  with check (user_id = app.current_user_id());

create policy "evaluation_history_delete_own"
  on public.evaluation_history
  for delete to authenticated
  using (user_id = app.current_user_id());

-- No update policy: history rows are immutable once written (append-only log).
grant select, insert, delete on public.evaluation_history to authenticated;
