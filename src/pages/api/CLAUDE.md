# src/pages/api — API routes

> Global rules (PRD invariants, commands, repo-wide conventions) live in
> `context/foundation/conventions.md`. This file covers only what is specific to `src/pages/api/`.

Server-rendered Astro API endpoints. Business logic belongs in `src/lib/` (see
`src/lib/CLAUDE.md`); these handlers are thin — validate, authorize, delegate, respond.

## Route contract

- **Exports:** uppercase `GET` / `POST` handlers. Always `export const prerender = false`.
- **Validation:** validate request input with zod before doing any work.
- **Auth gating:** `/` and `POST /api/evaluate` are gated behind a Supabase session. Unauthenticated
  page visits redirect to `/auth/signin` (preserving the original target); `POST /api/evaluate`
  without a session returns HTTP `401` with body `{"error": "unauthorized"}`.
- **LLM + determinism:** `evaluate.ts` reads `OPENAI_API_KEY` via `astro:env/server`; absent the
  key it falls back to a deterministic stub (per the determinism rule in conventions.md). Any LLM
  call runs at `temperature: 0` with a seed, or is cached, or is rule-based.
- **Logging:** emit structured logs via `src/lib/log.ts` / `auth-log.ts` (request id, route, user
  id when known, outcome). Never log raw user input/output in production paths.

## Route map

- `evaluate.ts` — `POST` gated evaluator endpoint; delegates to `src/lib/evaluator.ts`, persists history + lists.
- `auth/signin.ts` — `POST` sign-in; sets the session cookie.
- `auth/signup.ts` — `POST` sign-up (email + password, Supabase defaults).
- `auth/signout.ts` — `POST` sign-out; clears the session cookie.
