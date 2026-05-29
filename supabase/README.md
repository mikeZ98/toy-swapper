# Supabase / data layer

This directory holds everything Postgres-shaped for ToySwapper v2: migrations, pgTAP tests, and the RLS contract every user-scoped table must follow. Read this before authoring a new migration.

## Why RLS here

ToySwapper v2 introduces per-account persistence: each operator has their own give/want lists (FR-016) and their own evaluation history (FR-018). The NFR in [`../context/foundation/prd.md`](../context/foundation/prd.md) §Non-Functional Requirements is binding: **every user-scoped table enables Row-Level Security with explicit per-operation, per-role policies**. There is no `using (true)` escape hatch without an audit comment, and the service-role key is never used from the SSR client.

The data layer is shared infrastructure; one wrong policy quietly leaks every user's data into every other user's UI. RLS is the contract that prevents that, and the contract is enforced by SQL — not by application code.

## Helper functions

The bootstrap migration [`migrations/20260529120000_rls_baseline.sql`](migrations/20260529120000_rls_baseline.sql) ships two helpers in the `app` schema:

- **`app.current_user_id() returns uuid`** — thin wrapper over `auth.uid()`. Use in every RLS predicate as `using (user_id = app.current_user_id())`. Returns `NULL` outside an authenticated request.
- **`app.tg_set_updated_at() returns trigger`** — generic `BEFORE UPDATE` trigger function. Attach to any table with an `updated_at timestamptz` column.

Both functions are `security invoker` with `set search_path = ''`. Do not change either property — `security definer` silently bypasses RLS, and a non-empty `search_path` is exploitable via schema poisoning.

## Policy pattern (four-policy-per-table)

Every user-scoped table follows this exact shape:

```sql
create table public.notes (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null references auth.users (id) on delete cascade,
  body       text        not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.notes enable row level security;

create policy "notes_select_own"
  on public.notes
  for select to authenticated
  using (user_id = app.current_user_id());

create policy "notes_insert_own"
  on public.notes
  for insert to authenticated
  with check (user_id = app.current_user_id());

create policy "notes_update_own"
  on public.notes
  for update to authenticated
  using      (user_id = app.current_user_id())
  with check (user_id = app.current_user_id());

create policy "notes_delete_own"
  on public.notes
  for delete to authenticated
  using (user_id = app.current_user_id());

create trigger set_updated_at
  before update on public.notes
  for each row execute function app.tg_set_updated_at();
```

Four policies — one per operation (`select`, `insert`, `update`, `delete`). All scoped to the `authenticated` role only. The `with check` clauses on `insert` and `update` prevent a user from writing rows owned by someone else.

Read-only shared tables (e.g., F-02's counterparty pool) deviate: enable RLS, grant `select` to `anon, authenticated`, no per-row `user_id` scoping. Document the deviation in a comment on the policy.

## Adding a new table — 5-step checklist

1. **Name the migration** `YYYYMMDDHHmmss_<feature>.sql` (zero-padded UTC timestamp; per [`../CLAUDE.md`](../CLAUDE.md) convention).
2. **Define the table** with `user_id uuid not null references auth.users (id) on delete cascade` (unless it's a shared read-only table).
3. **`alter table … enable row level security;`** — never skip.
4. **Four policies** following the template above. Use `app.current_user_id()` — do not inline `auth.uid()`.
5. **Optional `updated_at` trigger** using `app.tg_set_updated_at()` if the table has an `updated_at` column.

Then ship a pgTAP test under `tests/<feature>.test.sql` proving cross-user reads return zero rows and cross-user writes raise `42501`. The test pattern is in [`tests/rls_template.test.sql`](tests/rls_template.test.sql) (added by F-01 Phase 2).

## Local development

```bash
# Boot the local stack (Postgres on :54322, GoTrue on :54321, Studio on :54323)
npx supabase start

# Apply all migrations + seeds from scratch
npx supabase db reset

# Run the pgTAP suite
npx supabase test db    # or: npm run db:test  (added by Phase 2)

# Stop and clean up
npx supabase stop
```

`.dev.vars` (gitignored) must carry:

```
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_KEY=<anon key printed by `supabase start`>
```

## Immutability of migrations

Once a migration filename lands on `master`, **it is never edited**. Fixes ship as new timestamped migrations. This is the determinism contract — the production database's state must be reproducible from the migration history alone, and editing a past migration silently desyncs prod from the git tree.

If a downstream migration breaks against the helpers (or against a prior schema), drop and recreate in a new migration. Do not retroactively patch `20260529120000_rls_baseline.sql`.

## Where this fits

| Concern | Location |
|---|---|
| RLS contract (executable) | `migrations/20260529120000_rls_baseline.sql` |
| RLS contract (prose) | this file |
| RLS contract (test) | `tests/rls_template.test.sql` (F-01 Phase 2) |
| CI gate | `.github/workflows/ci.yml` `db` job (F-01 Phase 3) |
| App SSR client | `../src/lib/supabase.ts` |
| Auth scaffold | `../src/pages/api/auth/*`, `../src/middleware.ts` |
