# Gated Evaluator (S-01) Implementation Plan

## Overview

Gate the evaluator behind a Supabase session. Anonymous requests to `/` (and `/dashboard`) are redirected to `/auth/signin?redirect=<original target>`; `POST /api/evaluate` without a session returns HTTP 401 JSON. The original target is carried through sign-in via a sanitized `?redirect=` query param (open-redirect-safe), so a user who signed in lands back where they were headed. Gating is enforced in one place — middleware — and every gate decision is observable via the F-03 logger.

This is roadmap slice **S-01** (FR-012–015, US-03). Its prerequisite **F-03** is done. OQ-5 is resolved: **no anonymous demo path — `/` is fully gated.**

## Current State Analysis

- **Only `/dashboard` is gated.** `src/middleware.ts` resolves `context.locals.user` on every request and redirects to `/auth/signin` only for `PROTECTED_ROUTES = ["/dashboard"]`. `/` and `/api/evaluate` are fully public today.
- **`/` is the evaluator** (`src/pages/index.astro`): the give/want form + inline `<script is:inline>` that POSTs JSON to `/api/evaluate` and renders the contract. On a non-OK response it shows `"Error: " + (json.error ?? status)` (line 172-174) — no auth-aware handling. The page does not render `Topbar` (no sign-out affordance).
- **`POST /api/evaluate`** (`src/pages/api/evaluate.ts`) has no session check; it runs for anyone. F-03 already wired `locals.log` and `evaluate.success`/`failure` there.
- **Sign-in is a native form POST.** `SignInForm.tsx` is `<form method="POST" action="/api/auth/signin">` (full-page submit). `src/pages/auth/signin.astro` reads `?error=` and passes it to the form. `POST /api/auth/signin` (`src/pages/api/auth/signin.ts`) **hardcodes `context.redirect("/")`** on success — no target preservation. F-03 logs `auth.signin` there.
- **Middleware redirect for protected routes** already emits `auth_required` (F-03) and returns `context.redirect("/auth/signin")` with the `x-request-id` header set.
- **Auth scaffold** is otherwise complete: `Topbar.astro` (user email + sign-out form), `signup.astro`, `confirm-email.astro`, `dashboard.astro`.
- **Testing**: vitest harness exists (`test/`, `vitest.config.ts` with `@`/`astro:env/server` aliases). Middleware/route code reads `astro:*` virtual modules.

### Key Discoveries

- The gate must branch **page vs API**: a page request redirects (302), an `/api/*` request returns 401 JSON. Middleware sees `context.url.pathname` and can distinguish `/api/` prefixes.
- Open-redirect risk: the `?redirect=` value is attacker-controllable. It must be validated to a **local path only** before being used in any `Location`/redirect. This is the security-critical core, isolated in Phase 1.
- `SignInForm` is a plain form POST, so redirect preservation is a hidden `<input name="redirect">` fed from `signin.astro`'s `?redirect=` param — no client fetch logic involved.
- F-03's `auth_required` event already fires on the middleware redirect path; extending the gated set reuses it for free.
- Astro middleware can both `context.redirect(...)` and return a `new Response(JSON, { status: 401 })`; the existing `x-request-id` header logic in middleware must apply to both.

## Desired End State

An anonymous visitor to `/` is redirected to `/auth/signin?redirect=/`; after signing in they land on `/`. A deep link (e.g. `/dashboard`) preserves through sign-in. `POST /api/evaluate` without a session returns `401 {"error":"unauthorized"}` and does not run the evaluator. A signed-in user uses the evaluator normally and can sign out from `/`. If their session expires mid-use, the page sends them to `/auth/signin?redirect=/`. A crafted `?redirect=//evil.com` (or `http://…`, `\…`) is ignored and falls back to `/`.

**Verification:** `npm test` (sanitizer + gate tests) passes; `npm run lint`/`npm run build` green; manually, anon `/` → signin → back to `/`; anon `curl POST /api/evaluate` → 401; open-redirect payloads rejected.

## What We're NOT Doing

- **No anonymous demo path** (OQ-5 resolved: fully gated). No public landing/marketing page; anon `/` redirects straight to sign-in.
- **No list persistence (S-02) or history (S-03).** Signed-in users still don't get saved give/want lists yet.
- **No change to the email-confirmation flow.** The gate treats "no session" uniformly; an unconfirmed user is just anonymous and sees the normal sign-in page. No tailored unconfirmed messaging.
- **No rate-limiting, no new auth providers, no route restructure** (`/` stays the evaluator).
- No change to the evaluator pipeline, fairness logic, or determinism.

## Implementation Approach

Build the open-redirect sanitizer first and lock it with tests (Phase 1), because both the middleware (producing the `redirect` param) and the sign-in handler (consuming it) depend on it and it's the security boundary. Then centralize the gate in middleware (Phase 2). Then wire redirect-honoring through sign-in and the client-side 401 path + sign-out affordance (Phase 3). Each phase is independently verifiable.

## Critical Implementation Details

- **Open-redirect validation (Phase 1) is load-bearing.** `safeRedirectPath` must accept only same-site absolute paths: require a leading `/`, reject a second leading `/` or `\` (protocol-relative `//evil.com`), reject any value containing `://` or a control char, and reject paths not starting with `/`. Everything else collapses to `/`. Every redirect target in this plan flows through this function — middleware when building the param and the sign-in handler when consuming it.
- **Middleware page-vs-API branch.** Gated `/api/*` paths must return `new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers })` — never a 302 (an HTML redirect to a JSON fetch is a silent failure on the client). Gated page paths `context.redirect(\`/auth/signin?redirect=${encodeURIComponent(safe)}\`)`. Both must still receive the `x-request-id` response header the middleware already sets.

## Phase 1: Redirect-path sanitizer + tests

### Overview

A pure, well-tested helper that reduces any caller-supplied redirect value to a safe local path. No wiring yet.

### Changes Required:

#### 1. Sanitizer helper

**File**: `src/lib/redirect.ts` (new)

**Intent**: Single source of truth for "is this redirect target safe", preventing open redirects wherever a `redirect` value is honored.

**Contract**: `export function safeRedirectPath(raw: string | null | undefined, fallback = "/"): string`. Returns `raw` only when it is a local path: starts with exactly one `/` (not `//` or `/\`), contains no `://`, no backslashes, no control characters, and no whitespace; otherwise returns `fallback`. Pure function, no I/O.

#### 2. Sanitizer tests

**File**: `test/redirect.test.ts` (new)

**Intent**: Lock the open-redirect guarantee.

**Contract**: assert allowed: `/`, `/dashboard`, `/a/b?x=1#h`. Assert rejected→fallback: `//evil.com`, `https://evil.com`, `http:/evil`, `/\evil`, `\\evil`, `javascript:alert(1)`, `""`, `null`, `undefined`, a value with a newline, and a bare `dashboard` (no leading slash).

### Success Criteria:

#### Automated Verification:
- Sanitizer tests pass: `npm test`
- Type checking passes: `npm run build`
- Linting passes: `npm run lint`

#### Manual Verification:
- `safeRedirectPath("//evil.com")` returns `/`; `safeRedirectPath("/dashboard")` returns `/dashboard`.

**Implementation Note**: After automated verification passes, pause for human confirmation before proceeding.

---

## Phase 2: Centralized middleware gate

### Overview

Gate `/`, `/dashboard`, and `/api/evaluate` in middleware: pages redirect to sign-in with a preserved target, APIs return 401 JSON.

### Changes Required:

#### 1. Gate logic

**File**: `src/middleware.ts`

**Intent**: Enforce the session requirement in one place, branching page-vs-API, preserving the original target, and keeping the gate observable.

**Contract**: define the gated set (`/`, `/dashboard`, `/api/evaluate`) — exact match for `/`, prefix match for the others as appropriate. When `!context.locals.user` and the path is gated:
- **`/api/*`** → return `new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "content-type": "application/json" } })`, after emitting `locals.log.warn("auth_required", { outcome: "failure" })`; ensure the `x-request-id` header is set on this response too.
- **page** → `context.locals.log.warn("auth_required", { outcome: "failure" })` then redirect to `/auth/signin?redirect=${encodeURIComponent(safeRedirectPath(context.url.pathname + context.url.search))}` with `x-request-id` set.

Keep the existing logger/`requestId` setup. The `/` match must be exact so it doesn't accidentally gate `/auth/*` or static paths.

### Success Criteria:

#### Automated Verification:
- Gate tests pass: `npm test` — anon page (`/`) → 302 to `/auth/signin?redirect=%2F`; anon `POST /api/evaluate` → 401 JSON `{"error":"unauthorized"}`; authed request (mocked `locals.user`) passes through; `/auth/signin` is NOT gated.
- Type checking passes: `npm run build`
- Linting passes: `npm run lint`

#### Manual Verification:
- Signed out, visiting `/` redirects to `/auth/signin?redirect=%2F`.
- Signed out, `curl -i -X POST /api/evaluate` returns 401 with JSON body and an `x-request-id` header.
- `/auth/signin` and `/auth/signup` remain reachable while signed out (no redirect loop).

**Implementation Note**: After automated verification passes, pause for human confirmation before proceeding.

---

## Phase 3: Sign-in redirect honoring + client 401 + sign-out on `/`

### Overview

Carry the preserved target through sign-in, send expired sessions back to sign-in from the evaluator, and let signed-in users sign out from `/`.

### Changes Required:

#### 1. Sign-in page passes the redirect param

**File**: `src/pages/auth/signin.astro`

**Intent**: Read `?redirect=` and hand it to the form so it can be submitted.

**Contract**: `const redirect = safeRedirectPath(Astro.url.searchParams.get("redirect"))`; pass `redirect` as a prop to `SignInForm`.

#### 2. Sign-in form carries the redirect as a hidden field

**File**: `src/components/auth/SignInForm.tsx`

**Intent**: Submit the redirect target alongside credentials (native form POST).

**Contract**: add an optional `redirect?: string` prop; render `<input type="hidden" name="redirect" value={redirect ?? "/"} />` inside the form. No change to validation/submit behavior.

#### 3. Sign-in handler honors the redirect

**File**: `src/pages/api/auth/signin.ts`

**Intent**: On success, return the user to their original target instead of always `/`.

**Contract**: read `form.get("redirect")`, pass through `safeRedirectPath(...)` (default `/`), and `context.redirect(<safe>)` on success. The error path still redirects back to `/auth/signin` — preserve the `redirect` param on that bounce so a failed attempt doesn't lose the target. F-03's `auth.signin` logging is unchanged.

#### 4. Evaluator handles 401 and offers sign-out

**File**: `src/pages/index.astro`

**Intent**: On an expired session the in-page fetch gets 401 → send the user to sign-in; give signed-in users a way out.

**Contract**: in the inline script's fetch handler, when `res.status === 401`, set `window.location.href = "/auth/signin?redirect=/"` instead of showing a generic error. Surface sign-out on the page — either render `Topbar` (it already has the sign-out form + reads `Astro.locals.user`) or add an equivalent sign-out control; the evaluator only renders for authed users now, so `user` is always present.

### Success Criteria:

#### Automated Verification:
- All tests pass: `npm test`
- Type checking passes: `npm run build`
- Linting passes: `npm run lint`

#### Manual Verification:
- Signed out → visit `/dashboard` → sign in → land on `/dashboard` (target preserved).
- Signed out → visit `/` → sign in → land on `/`.
- A failed sign-in attempt keeps the `redirect` target across the error bounce.
- `?redirect=//evil.com` on the sign-in URL results in landing on `/`, not the external site.
- While signed in, sign-out from `/` works and returns to the public landing (which redirects to sign-in).
- Simulated 401 from `/api/evaluate` (e.g. after clearing the session cookie) navigates the page to `/auth/signin?redirect=/`.

**Implementation Note**: After automated verification passes, pause for human confirmation.

---

## Testing Strategy

### Unit Tests:
- `safeRedirectPath`: allow local paths (incl. query/hash); reject `//host`, scheme URLs, backslash/control-char tricks, missing leading slash, empty/null.
- Middleware gate: anon page → 302 with `redirect` param; anon `/api/evaluate` → 401 JSON; authed → pass; `/auth/*` not gated.

### Integration Tests:
- None beyond the route-level gate test; full sign-in→redirect is covered manually (form POST + Supabase session is awkward to automate hermetically).

### Manual Testing Steps:
1. Signed out, GET `/` → redirected to `/auth/signin?redirect=%2F`.
2. Sign in → land on `/`; reload stays signed in (cookie persists).
3. Signed out, GET `/dashboard` → sign in → land on `/dashboard`.
4. `curl -i -X POST /api/evaluate -d '{...}'` with no cookie → 401 JSON.
5. Visit `/auth/signin?redirect=//evil.com`, sign in → land on `/` (not evil.com).
6. Clear cookie in devtools, submit the evaluator form → page navigates to `/auth/signin?redirect=/`.

## Performance Considerations

Negligible — one extra exact/prefix path check and (when unauthenticated) one redirect/401 in middleware, which already resolves the user on every request.

## Migration Notes

No schema or data migration. Behavioral change only: `/` and `/api/evaluate` now require a session. Communicate that the public URL is now auth-gated (per OQ-5).

## References

- Roadmap slice: `context/foundation/roadmap.md` § S-01
- PRD: US-03 (§ User Stories), FR-012–FR-015, OQ-5 (§ Open Questions)
- Prereq (logging, now done): `context/archive/2026-05-31-structured-logging-baseline/`
- Existing gate pattern: `src/middleware.ts` (`PROTECTED_ROUTES`, `auth_required`)
- Sign-in flow: `src/pages/auth/signin.astro`, `src/components/auth/SignInForm.tsx`, `src/pages/api/auth/signin.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Redirect-path sanitizer + tests

#### Automated
- [x] 1.1 Sanitizer tests pass: `npm test` — cdbf9ad
- [x] 1.2 Type checking passes: `npm run build` — cdbf9ad
- [x] 1.3 Linting passes: `npm run lint` — cdbf9ad

#### Manual
- [x] 1.4 `safeRedirectPath("//evil.com")` → `/`; `safeRedirectPath("/dashboard")` → `/dashboard` — cdbf9ad

### Phase 2: Centralized middleware gate

#### Automated
- [x] 2.1 Gate tests pass (anon page→302+redirect param, anon API→401 JSON, authed→pass, /auth/* not gated): `npm test` — 79f6ce6
- [x] 2.2 Type checking passes: `npm run build` — 79f6ce6
- [x] 2.3 Linting passes: `npm run lint` — 79f6ce6

#### Manual
- [x] 2.4 Signed out, `/` redirects to `/auth/signin?redirect=%2F` — 79f6ce6
- [x] 2.5 Signed out, `POST /api/evaluate` returns 401 JSON with an `x-request-id` header — 79f6ce6
- [x] 2.6 `/auth/signin` and `/auth/signup` remain reachable while signed out (no redirect loop) — 79f6ce6

### Phase 3: Sign-in redirect honoring + client 401 + sign-out on `/`

#### Automated
- [x] 3.1 All tests pass: `npm test` — 726af09
- [x] 3.2 Type checking passes: `npm run build` — 726af09
- [x] 3.3 Linting passes: `npm run lint` — 726af09

#### Manual
- [x] 3.4 Deep link `/dashboard` preserved through sign-in (land on `/dashboard`) — 726af09
- [x] 3.5 Anon `/` → sign in → land on `/` — 726af09
- [x] 3.6 Failed sign-in keeps the `redirect` target across the error bounce — 726af09
- [x] 3.7 `?redirect=//evil.com` results in landing on `/`, not the external site — 726af09
- [x] 3.8 Sign-out from `/` works; expired-session 401 navigates the page to `/auth/signin?redirect=/` — 726af09
