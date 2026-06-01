-- ============================================================================
-- 20260601120000_user_lists.sql
--
-- ToySwapper v2 — S-02 (restore-saved-lists): per-user most-recent give/want.
--
-- One row per authenticated user holding the give-list and want-list strings
-- from their most recent successful evaluation (FR-016). The evaluator upserts
-- this row on each success; the evaluator page pre-fills the textareas from it.
--
-- Follows the canonical four-policy-per-table RLS template from
-- migrations/20260529120000_rls_baseline.sql / supabase/README.md, with two
-- deliberate shape choices:
--   * UNIQUE(user_id) — enables upsert with onConflict: 'user_id' and enforces
--     the "one row per user / most recent only" semantics (FR-016).
--   * saved_at written explicitly by the caller (no updated_at trigger) — the
--     save point is a single domain event, not a generic mutation.
--
-- Determinism contract: once this filename lands on master, it is IMMUTABLE.
-- Fixes ship as new timestamped migrations. See supabase/README.md.
-- ============================================================================

create table public.user_lists (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null unique references auth.users (id) on delete cascade,
  give_text  text        not null,
  want_text  text        not null,
  saved_at   timestamptz not null default now()
);

comment on table public.user_lists is
  'S-02: the authenticated user''s most recent give/want lists (FR-016). '
  'One row per user (UNIQUE(user_id)); upserted on each successful evaluation.';

alter table public.user_lists enable row level security;

create policy "user_lists_select_own"
  on public.user_lists
  for select to authenticated
  using (user_id = app.current_user_id());

create policy "user_lists_insert_own"
  on public.user_lists
  for insert to authenticated
  with check (user_id = app.current_user_id());

create policy "user_lists_update_own"
  on public.user_lists
  for update to authenticated
  using      (user_id = app.current_user_id())
  with check (user_id = app.current_user_id());

create policy "user_lists_delete_own"
  on public.user_lists
  for delete to authenticated
  using (user_id = app.current_user_id());

grant select, insert, update, delete on public.user_lists to authenticated;
