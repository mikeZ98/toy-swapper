# Structured Logging Baseline (F-03) — Plan Brief

> Full plan: `context/changes/structured-logging-baseline/plan.md`

## What & Why

Wire a hand-rolled structured-JSON logger through the app so API routes emit observable events — auth, RLS denials, and evaluator success/failure — keyed by a per-request correlation id. This is roadmap foundation **F-03**: observability is cross-cutting and `main_goal` is quality, so it lands before the auth gate (S-01) and the user-data slices (S-02/S-03), which inherit the log schema and the "RLS denial is observable in prod" capability.

## Starting Point

The app (Astro 6 SSR on Cloudflare Workers) has essentially no logging — one `console.warn` in `evaluator.ts`, no logging library, no request correlation, no `LOG_LEVEL`. Middleware already resolves the user per request; `evaluate.ts` already catches errors into a 500; `counterparties.ts` throws on RLS/query errors but drops the Postgres code. `vitest` is installed but unconfigured with zero JS tests.

## Desired End State

Every request carries a `request_id` (generated in middleware, honoring an inbound `x-request-id`, echoed on the response). Routes emit one canonical JSON line per domain event via a request-bound `locals.log`; auth logs carry `user_id` only (never email/password); RLS denials log a distinct `db.rls_denied`; the evaluator fallback becomes a structured `evaluate.llm_fallback`. Logging is a pure side-channel — the evaluator's byte-identical Markdown output is unchanged.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Mechanism / sink | Hand-rolled JSON to `console.*` (Workers logs) | Roadmap pre-decided this and warned against APM scope drift | Roadmap |
| Log envelope | Pragmatic set (`ts, level, event, request_id, route, method, user_id, outcome, duration_ms?, error?`) | Covers the roadmap's four required fields + the minimum to debug prod | Plan |
| Request id | `crypto.randomUUID()` in middleware; honor inbound, echo `x-request-id` | One shared id per request, controllable, works in workerd + dev | Plan |
| Redaction | `user_id` only; failure `reason` categories; never email/password | PII-free by construction; safe for any sink | Plan |
| Event coverage | Domain events + middleware `auth_required` redirect; no blanket access log | Exactly the required events + S-01's redirect visibility, no asset noise | Plan |
| Levels | `info/warn/error` + `LOG_LEVEL` env (default `info`, `silent` in tests) | Quiet tests, tunable prod, always-JSON shape | Plan |
| Logger API | Request-bound logger on `locals.log` (`createLogger(ctx)`) | Auto-injects request_id/user_id — no call site can forget them | Plan |
| Testing | New vitest config + logger/redaction unit tests + evaluate-route emit test | Locks the inherited schema + PII guarantee; bootstraps JS tests | Plan |

## Scope

**In scope:** `src/lib/log.ts`; `LOG_LEVEL` env field; `App.Locals` extension; middleware request-id + logger + `auth_required` + `x-request-id` header; instrument `evaluate.ts`, `auth/{signin,signup,signout}.ts`, `counterparties.ts` (preserve `42501`), `evaluator.ts` (fold the `console.warn`); first vitest setup + tests.

**Out of scope:** external sink/Logpush/alerting/sampling; per-request access log; email (even hashed) in logs; dev pretty-printing; any schema/migration or new user-scoped table; changes to evaluator output or fairness logic.

## Architecture / Approach

`src/lib/log.ts` owns the envelope, level filtering, PII redaction backstop, `resolveRequestId`, `isRlsDenied(42501)`, a `createLogger(base)` factory, and a context-less `baseLogger`. Middleware mints the id, builds the request-bound logger onto `locals.log`, and echoes `x-request-id`. Call sites emit events through `locals.log`; the evaluator receives an optional logger threaded from the route (else `baseLogger`).

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Logger core + config + types | `log.ts`, `LOG_LEVEL` env, `Locals` types, vitest + logger tests | Getting the inherited schema wrong → downstream churn (mitigated by tests) |
| 2. Middleware integration | request_id, `locals.log`, `x-request-id` header, `auth_required` event | Response-header wiring on `next()` + redirect responses |
| 3. Route + lib instrumentation | event emission across routes, `42501` detection, evaluator fold-in, route emit test | Accidentally logging PII or list contents; preserving determinism |

**Prerequisites:** none (F-03 has no upstream deps; local Supabase stack already green).
**Estimated effort:** ~1–2 sessions across 3 phases; Phase 1 is the bulk (new module + first test harness).

## Open Risks & Assumptions

- Assumes workerd exposes `crypto.randomUUID()` and Web `Headers` (verified for the runtime).
- `db.rls_denied` is wired at the shared counterparty read (rarely denies today) purely to establish the reusable pattern S-02/S-03 consume.
- Mocking `astro:env/server` in vitest is the one new test-harness wrinkle (first JS tests in the repo).

## Success Criteria (Summary)

- `npm test`, `npm run lint`, `npm run build` all pass; existing determinism output unchanged.
- Live logs show one JSON line per domain event sharing a `request_id`; responses carry `x-request-id`.
- No email/password (or give/want contents) appears in any log line.
