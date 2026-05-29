-- ============================================================================
-- 20260529120000_rls_baseline.sql
--
-- ToySwapper v2 — F-01 (postgres-rls-baseline): cross-cutting RLS contract.
--
-- This migration ships reusable SQL ONLY:
--   * the `app` schema
--   * `app.current_user_id()`  -- thin wrapper over auth.uid()
--   * `app.tg_set_updated_at()` -- generic BEFORE UPDATE trigger function
--   * a commented-out four-policy-per-table template that downstream
--     migrations (F-02, S-02, S-03) copy into their own per-table migrations.
--
-- It does NOT create any tables in `public`. App tables belong to their
-- owning slice (F-02: counterparties, S-02: user_lists, S-03: evaluations).
--
-- Determinism contract: once this filename lands on master, it is IMMUTABLE.
-- Fixes ship as new timestamped migrations. See `supabase/README.md`.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Schema
-- ---------------------------------------------------------------------------

create schema if not exists app;

comment on schema app is
  'Application-private helpers shared across RLS policies and triggers. '
  'Not exposed via PostgREST (only public + graphql_public are exposed; '
  'see supabase/config.toml [api].schemas).';

-- ---------------------------------------------------------------------------
-- Helper: current_user_id()
--
-- Thin wrapper over auth.uid(). Use in RLS policies for consistency and to
-- give us one place to change the source-of-truth if Supabase auth ever
-- shifts shape.
--
-- security invoker: function runs with the caller's privileges, so RLS is
--   not silently bypassed.
-- set search_path = '': defends against schema-poisoning when called from
--   a policy on a table owned by a different role.
-- stable: deterministic within a single statement; planner can inline.
-- ---------------------------------------------------------------------------

create or replace function app.current_user_id()
  returns uuid
  language sql
  stable
  security invoker
  set search_path = ''
as $$
  select auth.uid()
$$;

comment on function app.current_user_id() is
  'Thin wrapper over auth.uid(). Returns NULL outside an authenticated '
  'request. Use in RLS policies as: using (user_id = app.current_user_id()).';

-- ---------------------------------------------------------------------------
-- Helper: tg_set_updated_at()
--
-- Generic BEFORE UPDATE trigger function. Attach to any table with an
-- `updated_at timestamptz` column.
-- ---------------------------------------------------------------------------

create or replace function app.tg_set_updated_at()
  returns trigger
  language plpgsql
  security invoker
  set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

comment on function app.tg_set_updated_at() is
  'Generic BEFORE UPDATE trigger to maintain updated_at columns. Attach as: '
  'create trigger set_updated_at before update on <table> '
  'for each row execute function app.tg_set_updated_at();';

-- ---------------------------------------------------------------------------
-- Four-policy-per-table RLS TEMPLATE (commented; not executed)
--
-- Every user-scoped table in `public` MUST follow this shape:
--   1. user_id column references auth.users (on delete cascade)
--   2. enable row level security
--   3. four policies: select / insert / update / delete, all scoped to
--      authenticated role and the calling user's id
--   4. optional updated_at trigger
--
-- A pgTAP test in supabase/tests/rls_template.test.sql proves the contract.
--
-- ----------------------------------------------------------------------------
-- create table public.<table_name> (
--   id         uuid        primary key default gen_random_uuid(),
--   user_id    uuid        not null references auth.users (id) on delete cascade,
--   -- ... domain columns ...
--   created_at timestamptz not null default now(),
--   updated_at timestamptz not null default now()
-- );
--
-- alter table public.<table_name> enable row level security;
--
-- create policy "<table>_select_own"
--   on public.<table_name>
--   for select to authenticated
--   using (user_id = app.current_user_id());
--
-- create policy "<table>_insert_own"
--   on public.<table_name>
--   for insert to authenticated
--   with check (user_id = app.current_user_id());
--
-- create policy "<table>_update_own"
--   on public.<table_name>
--   for update to authenticated
--   using      (user_id = app.current_user_id())
--   with check (user_id = app.current_user_id());
--
-- create policy "<table>_delete_own"
--   on public.<table_name>
--   for delete to authenticated
--   using (user_id = app.current_user_id());
--
-- create trigger set_updated_at
--   before update on public.<table_name>
--   for each row execute function app.tg_set_updated_at();
-- ----------------------------------------------------------------------------
--
-- Notes for authors:
--   * Never write `using (true)` without an audit comment explaining why
--     (per CLAUDE.md / AGENTS.md migration convention).
--   * Service-role keys bypass RLS — never use them from the SSR client.
--   * Read-only shared tables (e.g., F-02 counterparties) follow a different
--     shape: enable RLS, grant select to anon + authenticated, no per-row
--     user_id scoping. Document the deviation inline.
-- ---------------------------------------------------------------------------
