# src/lib — services & helpers

> Global rules (PRD invariants, commands, repo-wide conventions) live in
> `context/foundation/conventions.md`. This file covers only what is specific to `src/lib/`.

`src/lib/` holds the app's business logic, data-access helpers, and small utilities. React
components and hooks do NOT live here (hooks go in `src/components/hooks/`); API route handlers
live in `src/pages/api/` (see `src/pages/api/CLAUDE.md`).

## Conventions

- **Determinism is load-bearing here.** `evaluator.ts` is the determinism-critical path — same
  give-list + want-list + same fixture pool must produce byte-identical Markdown. Any LLM call
  runs at `temperature: 0` with a fixed seed, OR is cached on the input, OR falls back to
  rule-based parsing. See `context/foundation/conventions.md` § PRD-locked rules.
- **Never log raw user input/output** in production paths — use the structured loggers
  (`log.ts`, `auth-log.ts`), not bare `console.*`.
- **Extract growing business logic to `src/lib/services/`** when a module outgrows a single
  file. That directory does not exist yet — create it when the need arises, not pre-emptively.
- **Data access goes through the SSR Supabase client** (`supabase.ts`); RLS is the data-layer
  contract (`supabase/README.md`). The service-role key is never used from the SSR client.

## Module map

One line per module — orientation, not a substitute for reading the code.

- `evaluator.ts` — the standardize → value → match → fairness → Markdown contract pipeline (determinism-critical).
- `counterparties.ts` — reads the seeded counterparty pool from Postgres (replaced the deleted v1 `fixture-pool.ts`).
- `evaluation-history.ts` — persists and reads per-user evaluation history rows (RLS-scoped).
- `user-lists.ts` — persists and restores the operator's give/want lists (RLS-scoped).
- `supabase.ts` — `@supabase/ssr` cookie-based client; reads `SUPABASE_URL` / `SUPABASE_KEY` via `astro:env/server`.
- `log.ts` — structured JSON logger (request id, route, user id, outcome).
- `auth-log.ts` — auth-event / RLS-denial logging helpers built on `log.ts`.
- `config-status.ts` — reports presence/absence of optional config (e.g. `OPENAI_API_KEY`) to drive stub fallback.
- `redirect.ts` — post-sign-in redirect-target preservation helper.
- `utils.ts` — `cn()` (clsx + tailwind-merge) and small shared utilities.
