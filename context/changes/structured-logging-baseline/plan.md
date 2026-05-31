# Structured Logging Baseline (F-03) Implementation Plan

## Overview

Introduce a hand-rolled structured-JSON logger that emits one JSON object per line to stdout (the Cloudflare Workers log sink). The logger is request-bound: middleware mints a `request_id` and attaches a pre-filled logger to `context.locals.log`, and every API route, the RLS read path, and the evaluator's existing fallback warning emit canonical events through it. The result is that auth events, RLS denials (Postgres `42501`), and evaluator success/failure become observable in production, keyed by a correlation id returned to the client as `x-request-id`.

This is roadmap slice **F-03** — a foundation that unlocks S-01 (auth/redirect/401 visibility) and the "RLS denial is observable in prod" verification path that S-02 and S-03 depend on.

## Current State Analysis

- **Runtime:** Astro 6 SSR (`output: "server"`) on Cloudflare Workers (workerd). Web Crypto (`crypto.randomUUID()`) is available; Node-oriented loggers (pino/winston) are not a safe default. `console.*` is the production sink (visible via `wrangler tail` / Workers Logs).
- **No logging today** beyond a single `console.warn` at `src/lib/evaluator.ts:188` (LLM-standardization fallback). No logging library, no `LOG_LEVEL`, no request correlation.
- **API surface:** `src/pages/api/evaluate.ts` (POST; already wraps work in try/catch → 500 JSON), and `src/pages/api/auth/{signin,signup,signout}.ts` (form-post → `context.redirect(...)`; signin/signup read raw `email`/`password` from form data — a PII source).
- **Middleware** (`src/middleware.ts`) already runs on every request, resolves the user into `context.locals.user`, and redirects anonymous users away from `PROTECTED_ROUTES` (`["/dashboard"]`). It is the natural home for request-id + logger setup.
- **RLS errors** surface from `src/lib/counterparties.ts:32` — `getCounterpartyPool` throws `new Error(\`counterparty pool unavailable: ${error.message}\`)`, **discarding `error.code`**. Postgres RLS denial is code `42501`. The current `public.counterparties` table is shared-read (`using (true)`), so a denial there is unlikely — but the *detection + logging pattern* must exist now so the user-scoped reads in S-02/S-03 reuse it.
- **Config:** env is declared via `astro:env/server` with an `envField` schema in `astro.config.mjs` (`SUPABASE_*`, `OPENAI_*`, `FAIRNESS_THRESHOLD_PCT`).
- **Types:** `App.Locals` is declared in `src/env.d.ts` and currently holds only `user`.
- **Testing:** `vitest` is installed with `"test": "vitest run"`, but there is **no vitest config and zero JS test files** (only pgTAP via `db:test`). F-03 introduces the first JS unit tests.

## Desired End State

Every request carries a `request_id` (generated in middleware, honoring an inbound `x-request-id`, echoed on the response). Each API route emits canonical structured-JSON log lines for its domain events with the agreed envelope; auth logs carry `user_id` (never email/password); RLS denials log a distinct `db.rls_denied` event; the evaluator's fallback is a structured `evaluate.llm_fallback` warning. `LOG_LEVEL` gates verbosity (default `info`; `silent` in tests). Logging never alters the evaluator's byte-identical Markdown output.

**Verification of end state:** `npm test` passes (logger shape, level filtering, redaction guarantee, request-id propagation, evaluate-route emit test); `npm run lint` and `npm run build` pass; manually, `wrangler tail` (or the dev console) shows one JSON line per domain event with a shared `request_id`, and a `curl -i` response carries an `x-request-id` header.

### Key Discoveries

- `crypto.randomUUID()` is available in workerd — no polyfill needed (`src/middleware.ts` runs in the same runtime).
- Astro middleware can set response headers by awaiting `next()` and mutating the returned `Response.headers` before returning it; this also applies to `context.redirect(...)` responses.
- `getCounterpartyPool` (`src/lib/counterparties.ts:27-37`) drops the Supabase `error.code` — to emit `db.rls_denied` the code must be preserved (attach to the thrown error) and inspected at the route.
- The evaluator is a pure lib with no access to `locals`; to keep the fallback warning correlated it must accept an optional logger (threaded from the route) and fall back to a context-less base logger.
- `App.Locals` extension point is `src/env.d.ts`; `FAIRNESS_THRESHOLD_PCT` in `astro.config.mjs:23` is the pattern to copy for the new `LOG_LEVEL` env field.

## What We're NOT Doing

- No external logging/APM service, no Logpush configuration, no log shipping, no sampling, no alerting (deferred per the roadmap's anti-scope-drift risk note).
- No per-request access log (`request.completed`) for ordinary/static requests — only domain events + the `auth_required` redirect event.
- No email/password (or hashed email) in any log line.
- No pretty-printing branch — JSON always, in dev and prod, so the shape can't drift.
- No change to the evaluator's output, the fairness logic, or any migration/schema.
- No new user-scoped tables — `db.rls_denied` is wired at the existing counterparty read as the reusable pattern; S-02/S-03 consume it later.

## Implementation Approach

Build the logger as a small standalone module first (Phase 1), with its schema and PII guarantee locked by unit tests, because that schema is inherited by every downstream slice. Then plumb a request-bound instance through middleware (Phase 2). Finally emit the domain events at each call site (Phase 3). Phases are independently verifiable; Phases 1–2 change no user-visible behavior.

## Critical Implementation Details

- **Determinism boundary:** the logger must never feed into evaluator output. `request_id`, `ts`, and `duration_ms` are non-deterministic and belong only in log lines — never passed into `evaluate(...)` inputs or the Markdown contract. The existing determinism tests must still pass unchanged.
- **Response-header timing in middleware:** to echo `x-request-id`, capture `const response = await next();` then `response.headers.set("x-request-id", id)` before returning — and set it on the early `context.redirect(...)` response too. Setting it only on `locals` would not surface it to clients.
- **Redaction is by construction *and* enforced:** call sites pass `user_id`, not email — but `log.ts` also strips a denylist of keys (`email`, `password`, `token`, `access_token`, `refresh_token`) from any `fields` object as a backstop, and a unit test asserts an email passed in never appears in output.

## Phase 1: Logger core + config + types

### Overview

Create the logger module, declare the `LOG_LEVEL` env field, extend `App.Locals`, and bootstrap vitest with the tests that lock the envelope schema and the redaction guarantee. No route behavior changes.

### Changes Required:

#### 1. Logger module

**File**: `src/lib/log.ts` (new)

**Intent**: The single source of the log envelope, level filtering, PII redaction, request-id resolution, and RLS-denial detection. Exposes a request-bound logger factory plus a context-less base logger for libs.

**Contract**:
- `type LogLevel = "info" | "warn" | "error"` with ordering `info < warn < error`; threshold read once from `LOG_LEVEL` (`astro:env/server`, default `"info"`), with the extra accepted value `"silent"` suppressing all output.
- Envelope (one JSON object per line): `{ ts: string (ISO), level: LogLevel, event: string, request_id: string, route: string, method: string, user_id: string | null, outcome: "success" | "failure" | null, duration_ms?: number, error?: { name: string; message: string; stack?: string } }`. Extra structured fields from the call merge in after redaction.
- `interface Logger { info(event, fields?); warn(event, fields?); error(event, fields?); child(extra): Logger }`. Each method serializes via `JSON.stringify` to the matching console method (`info`→`console.log`, `warn`→`console.warn`, `error`→`console.error`), gated by the threshold.
- `createLogger(base: { request_id; route; method; user_id?: string | null }): Logger` — pre-fills the base fields; `child(extra)` returns a logger with merged base (used by auth routes to add `user_id` post-sign-in).
- `baseLogger: Logger` — context-less instance (`request_id: "-"`, `route: "-"`, `method: "-"`) for code with no request context (e.g. the evaluator fallback).
- `resolveRequestId(headers: Headers): string` — returns a trimmed inbound `x-request-id` if present and non-empty, else `crypto.randomUUID()`.
- `isRlsDenied(error: unknown): boolean` — true when the error (or its attached cause) carries Postgres code `"42501"`.
- A private `redact(fields)` that drops the PII denylist keys before merge.

#### 2. LOG_LEVEL env field

**File**: `astro.config.mjs`

**Intent**: Declare `LOG_LEVEL` so the logger can read it via `astro:env/server` and tests/prod can tune verbosity without code edits.

**Contract**: add `LOG_LEVEL: envField.string({ context: "server", access: "public", optional: true, default: "info" })` alongside the existing fields (mirror `FAIRNESS_THRESHOLD_PCT` at line 23).

#### 3. Locals type extension

**File**: `src/env.d.ts`

**Intent**: Type the request-bound logger and id that middleware attaches.

**Contract**: add `log: import("@/lib/log").Logger` and `requestId: string` to `App.Locals` (keep existing `user`).

#### 4. Vitest bootstrap + logger tests

**File**: `vitest.config.ts` (new), `src/lib/log.test.ts` (new)

**Intent**: Stand up the first JS test setup and lock the load-bearing schema + PII guarantee.

**Contract**: minimal `vitest.config.ts` (node environment; resolve the `@/*` alias to `./src/*` to match tsconfig). `log.test.ts` covers: (a) envelope contains all required keys with correct types; (b) level threshold filters (`info` hidden when `LOG_LEVEL=warn`; nothing emitted when `silent`); (c) redaction — an `email`/`password` field passed in never appears in the serialized output; (d) `resolveRequestId` honors a non-empty inbound `x-request-id` and otherwise returns a uuid; (e) `isRlsDenied` is true for a `{ code: "42501" }` error and false otherwise. Tests spy on `console.log/warn/error`. Env access is mocked via a `vi.mock("astro:env/server", ...)`.

### Success Criteria:

#### Automated Verification:
- Type checking passes: `npm run build` (Astro type-checks on build)
- Linting passes: `npm run lint`
- Logger unit tests pass: `npm test`

#### Manual Verification:
- `src/lib/log.ts` exports `createLogger`, `baseLogger`, `resolveRequestId`, `isRlsDenied`, `Logger`, `LogLevel`.
- A scratch call to `createLogger({...}).info("x", { email: "a@b.com" })` prints a single JSON line with no `email` key.

**Implementation Note**: After completing this phase and all automated verification passes, pause for human confirmation that manual testing succeeded before proceeding.

---

## Phase 2: Middleware integration

### Overview

Resolve/generate the `request_id`, build the request-bound logger onto `locals`, echo `x-request-id` on the response, and emit the `auth_required` event on protected-route redirects.

### Changes Required:

#### 1. Request-id + logger wiring

**File**: `src/middleware.ts`

**Intent**: Make every request carry a correlation id and a pre-filled logger, and make redirects/ids observable.

**Contract**:
- Compute `const requestId = resolveRequestId(context.request.headers)`; set `context.locals.requestId = requestId`.
- After resolving `user`, build `context.locals.log = createLogger({ request_id: requestId, route: context.url.pathname, method: context.request.method, user_id: context.locals.user?.id ?? null })`.
- On protected-route redirect, before returning, call `context.locals.log.warn("auth_required", { outcome: "failure" })` (then redirect).
- Echo the id on the response: capture `const response = await next(); response.headers.set("x-request-id", requestId); return response;` — and also set the header on the redirect `Response` returned for the protected-route case.
- Ordering: logger must be built after `user` is resolved so `user_id` is populated.

### Success Criteria:

#### Automated Verification:
- Type checking passes: `npm run build`
- Linting passes: `npm run lint`
- Existing tests still pass: `npm test`

#### Manual Verification:
- `curl -i http://localhost:4321/` (dev) returns an `x-request-id` header.
- Visiting `/dashboard` while signed out logs one `auth_required` JSON line and redirects to `/auth/signin`.
- Supplying `-H "x-request-id: abc123"` echoes `abc123` back in the response header.

**Implementation Note**: After automated verification passes, pause for human confirmation before proceeding.

---

## Phase 3: Route + lib instrumentation

### Overview

Emit the domain events at each call site using `locals.log`, detect RLS denials, and convert the evaluator's `console.warn` into a structured event.

### Changes Required:

#### 1. Evaluate route

**File**: `src/pages/api/evaluate.ts`

**Intent**: Emit success/failure (with timing) and distinguish RLS denials from generic failures.

**Contract**: read `locals.log` (add `locals` to the handler signature). Record `const t0 = Date.now()` before evaluation; on success emit `locals.log.info("evaluate.success", { outcome: "success", duration_ms: Date.now() - t0 })` (do not log give/want contents). In the catch, if `isRlsDenied(err)` emit `locals.log.error("db.rls_denied", { outcome: "failure", error })` else `locals.log.error("evaluate.failure", { outcome: "failure", duration_ms: Date.now() - t0, error })`. HTTP responses are unchanged. Thread `locals.log` into the `evaluate(...)` options so the evaluator's fallback stays correlated.

#### 2. Preserve the Postgres error code

**File**: `src/lib/counterparties.ts`

**Intent**: Let the route detect `42501` (the current code-dropping prevents `db.rls_denied`).

**Contract**: when `error` is set, throw an `Error` whose `cause` (or an attached `.code` property) carries the original Supabase `error.code`, so `isRlsDenied` can read it. Keep the existing message text and the zero-rows/null-client throws unchanged.

#### 3. Auth routes

**File**: `src/pages/api/auth/signin.ts`, `src/pages/api/auth/signup.ts`, `src/pages/api/auth/signout.ts`

**Intent**: Emit auth events with `user_id` only and a coarse failure reason — never email/password.

**Contract**:
- `signin.ts`: on success `context.locals.log.child({ user_id: data.user?.id ?? null }).info("auth.signin", { outcome: "success" })`; on error `...warn("auth.signin", { outcome: "failure", reason: categorize(error) })` (a small map of Supabase error message → category such as `invalid_credentials`, `email_not_confirmed`, `unknown`). Capture `data` from `signInWithPassword`.
- `signup.ts`: same shape with `auth.signup` (success `user_id` from the `signUp` result when present; reason categories e.g. `user_exists`, `weak_password`, `unknown`).
- `signout.ts`: `auth.signout` `outcome: "success"` (use the `user_id` already on `locals` from middleware).
- The `!supabase` ("Supabase is not configured") branches emit `...error("auth.signin"/"auth.signup", { outcome: "failure", reason: "not_configured" })` before redirecting.

#### 4. Evaluator fallback → structured

**File**: `src/lib/evaluator.ts`

**Intent**: Fold the lone `console.warn` (line 188) into the structured logger, correlated when a logger is threaded in.

**Contract**: `evaluate(...)`/`ProcessOptions` accept an optional `logger?: Logger` (defaulting to `baseLogger`); replace the `console.warn(...)` with `logger.warn("evaluate.llm_fallback", { reason: err instanceof Error ? err.message : String(err) })`. No change to caching, sources, or output.

#### 5. Evaluate-route emit test

**File**: `src/pages/api/evaluate.test.ts` (new)

**Intent**: Prove the route emits the right events on both paths.

**Contract**: mock `@/lib/evaluator`, `@/lib/counterparties`, `@/lib/supabase`; invoke `POST` with a fake context (`request` with a valid JSON body, `cookies`, and a `locals.log` spy). Assert `evaluate.success` is logged on the happy path; assert `evaluate.failure` (or `db.rls_denied` when the mocked error carries code `42501`) on the error path. Assert no give/want content appears in logged fields.

### Success Criteria:

#### Automated Verification:
- Type checking passes: `npm run build`
- Linting passes: `npm run lint`
- All tests pass: `npm test`
- Determinism unaffected: existing evaluator/determinism tests still pass (`npm test`)

#### Manual Verification:
- A successful `POST /api/evaluate` logs one `evaluate.success` line with `duration_ms` and the shared `request_id`; give/want contents are absent.
- A failing sign-in logs one `auth.signin` line with `outcome: "failure"`, a `reason`, and **no email**.
- A successful sign-in/sign-out logs `auth.signin`/`auth.signout` with a `user_id`.
- Forcing the evaluator's LLM path to fail logs `evaluate.llm_fallback` carrying the request's `request_id`.

**Implementation Note**: After automated verification passes, pause for human confirmation that manual testing succeeded.

---

## Testing Strategy

### Unit Tests:
- Logger: envelope keys/types, level threshold (`info`/`warn`/`error`/`silent`), redaction of PII denylist keys, `resolveRequestId` inbound-vs-generated, `isRlsDenied` on code `42501`.
- Evaluate route: emits `evaluate.success` (happy path), `evaluate.failure`/`db.rls_denied` (error path), and never logs give/want contents.

### Integration Tests:
- None automated for this slice (no external sink). Cross-cutting behavior is verified manually via the dev console / `wrangler tail`.

### Manual Testing Steps:
1. `npm run dev`; `curl -i localhost:4321/` → response carries `x-request-id`; passing an inbound `x-request-id` is echoed.
2. POST a valid give/want body → one `evaluate.success` JSON line, shared `request_id`, no list contents, with `duration_ms`.
3. Sign in with bad credentials → `auth.signin` `failure` line with a `reason` and no email; sign in successfully → `success` with `user_id`; sign out → `auth.signout`.
4. Visit `/dashboard` signed out → `auth_required` line + redirect.
5. Confirm the evaluator's determinism output is byte-identical to before (logging is side-channel only).

## Performance Considerations

Negligible: one `JSON.stringify` + `console.*` per domain event, no per-request access log, no I/O beyond stdout. Level threshold avoids serialization work below the configured level.

## Migration Notes

No schema or data migration. `LOG_LEVEL` is optional (default `info`); add it to `.env.example` / `.dev.vars` documentation only if a non-default is desired locally.

## References

- Roadmap slice: `context/foundation/roadmap.md` § F-03 (lines 88–99)
- Change identity: `context/changes/structured-logging-baseline/change.md`
- RLS / `42501` context: `supabase/README.md`, `supabase/migrations/20260529120000_rls_baseline.sql`
- Env-field pattern to copy: `astro.config.mjs:23` (`FAIRNESS_THRESHOLD_PCT`)
- Existing log site to fold in: `src/lib/evaluator.ts:188`
- Locals extension point: `src/env.d.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Logger core + config + types

#### Automated
- [x] 1.1 Type checking passes: `npm run build` — 00e9d63
- [x] 1.2 Linting passes: `npm run lint` — 00e9d63
- [x] 1.3 Logger unit tests pass: `npm test` — 00e9d63

#### Manual
- [x] 1.4 `src/lib/log.ts` exports `createLogger`, `baseLogger`, `resolveRequestId`, `isRlsDenied`, `Logger`, `LogLevel` — 00e9d63
- [x] 1.5 A scratch `createLogger(...).info("x", { email })` prints a JSON line with no `email` key — 00e9d63

### Phase 2: Middleware integration

#### Automated
- [x] 2.1 Type checking passes: `npm run build`
- [x] 2.2 Linting passes: `npm run lint`
- [x] 2.3 Existing tests still pass: `npm test`

#### Manual
- [x] 2.4 `curl -i` to `/` returns an `x-request-id` header
- [x] 2.5 `/dashboard` while signed out logs one `auth_required` line and redirects
- [x] 2.6 Inbound `x-request-id` is echoed back unchanged

### Phase 3: Route + lib instrumentation

#### Automated
- [ ] 3.1 Type checking passes: `npm run build`
- [ ] 3.2 Linting passes: `npm run lint`
- [ ] 3.3 All tests pass: `npm test`
- [ ] 3.4 Existing evaluator/determinism tests still pass: `npm test`

#### Manual
- [ ] 3.5 Successful `POST /api/evaluate` logs one `evaluate.success` line with `duration_ms` + shared `request_id`, no give/want contents
- [ ] 3.6 Failing sign-in logs `auth.signin` `failure` with a `reason` and no email
- [ ] 3.7 Successful sign-in/sign-out log `auth.signin`/`auth.signout` with a `user_id`
- [ ] 3.8 Forced LLM-path failure logs `evaluate.llm_fallback` with the request's `request_id`
