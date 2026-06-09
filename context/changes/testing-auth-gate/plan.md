# Auth Gate + Signin/Signup Form Path — Test Coverage Implementation Plan

## Overview

Phase 2 of the project test rollout (`context/foundation/test-plan.md` §3). Prove the **R4** signin/signup form path — the genuine coverage gap — and **harden R3**, the auth gate, which is already substantially covered. R4 splits into two layers: the auth **endpoints** (integration, no new deps) and the auth **form components** (component, needs a jsdom + React Testing Library toolchain that is not yet installed). The work closes with the rollout's bookkeeping: filling the two cookbook recipes the phase is responsible for and advancing the test-plan's status ledger.

## Current State Analysis

- **R3 (gate) is already well-covered.** `test/middleware.test.ts:48-99` exercises anon page → 302 to `/auth/signin` with the sanitized target, deep-link target preservation (path + query), anon `POST /api/evaluate` → 401 JSON, authenticated passthrough, and no redirect-loop on `/auth/signin`. The unauthenticated branch — the test-plan's named anti-pattern — is exercised. `safeRedirectPath` has its own unit suite (`test/redirect.test.ts`). Genuine residual gaps: `isGated`'s sub-path matching (`pathname.startsWith(route + "/")`, `src/middleware.ts:11`) is untested — `/api/evaluate/x` and `/dashboard/x` are never asserted, and `/` matching _exactly_ (not catching `/foo`) is implicit only.
- **R4 (form path) has zero coverage.** Two untested layers:
  - **Endpoints** `src/pages/api/auth/signin.ts`, `signup.ts` — bad-creds bounce, success redirect, `not_configured` branch. The boundary is `createClient` from `@/lib/supabase`; `test/evaluate.test.ts:8` already establishes the mock-at-the-boundary pattern.
  - **Form components** `SignInForm.tsx`, `SignUpForm.tsx` — client-side validation, inline field errors, `ServerError` rendering, the hidden `redirect` field. These are native `method="POST"` forms (`SignInForm.tsx:44`) with no `fetch`; the server error returns via page reload + the `serverError` prop, so there is no in-component network call to mock.
- **Toolchain gap.** `package.json` devDependencies have Vitest **4.1.7** but no jsdom, no `@testing-library/*`. `vitest.config.ts` runs everything in the default node environment and includes `test/**/*.test.ts`.
- **§7 exclusion is binding.** Do not test Supabase's own auth mechanics; mock at the boundary (`createClient` for endpoints; the native POST _is_ the boundary for the component — assert our wiring only).

## Desired End State

`npm test` runs green with new coverage proving: (1) the auth endpoints bounce errors while preserving the redirect target, redirect only to sanitized same-site paths on success, handle the unconfigured-Supabase branch, and route signup to confirm-email; (2) the signin/signup form components gate invalid submits, surface inline and server errors, and carry the redirect field; (3) the gate's sub-path matching is asserted. The component tests run under jsdom while existing node tests are untouched and unslowed. `test-plan.md` §6.2/§6.3 read as real recipes (not "TBD"), §4 reflects the installed toolchain, and §3 marks Phase 2 complete.

### Key Discoveries:

- `isGated` sub-path branch untested — `src/middleware.ts:11`.
- `signin.ts:13,33` sanitizes the success target via `safeRedirectPath`; `signin.ts:17-18` preserves `redirect` across the error bounce; `signin.ts:21-24` handles `not_configured`.
- `signup.ts` has **no** `redirect` param — success always → `/auth/confirm-email` (`signup.ts:24`); error → `/auth/signup?error=…` (`signup.ts:20`). `signup.astro` passes only `serverError`, no `redirect`. `SignUpForm` takes only `serverError`.
- Native-POST forms: `onSubmit` only runs client validation and `preventDefault()`s on invalid (`SignInForm.tsx:37-41`); valid submits proceed to a full POST. jsdom does not navigate on submit.
- `categorizeAuthError` (`src/lib/auth-log.ts`) maps raw messages to PII-free reason categories used in logs — endpoint tests can assert the user-facing `error` query param without asserting log internals.
- Vitest **4.1.7**: `environmentMatchGlobs` is removed. Per-file `// @vitest-environment jsdom` docblock is the stable, version-correct way to keep node as the global default while only component tests opt into jsdom.

## What We're NOT Doing

- Not testing Supabase's auth library (sign-in/up/session mechanics) — §7.
- Not adding Playwright / any e2e layer — test-plan §4 keeps it deliberately out of scope.
- Not broadening R3 into an exhaustive gate matrix or dedicated `isGated` unit tests — the user chose minimal hardening; existing middleware coverage is trusted.
- Not mocking form submission / faking navigation in component tests — the native POST is the boundary; the valid-submit→redirect path is owned by the endpoint integration test.
- Not refactoring any production code under `src/` — this phase adds tests and test infrastructure only.
- Not flipping GitHub branch-protection required-checks (a repo setting outside the git tree; noted in §5 already).

## Implementation Approach

Four phases, ordered so the no-deps integration work and the isolated toolchain setup can land independently, with the component tests depending only on the toolchain phase. All phases are **`/10x-implement`-driven**, not TDD: the production code already exists, so each phase writes tests against existing behavior (red-green-refactor does not apply to retroactive test authoring). The boundary-mock pattern from `test/evaluate.test.ts` and `test/middleware.test.ts` is the template for the integration phase; `@testing-library/react` render + `user-event` is the template for the component phase.

## Critical Implementation Details

- **Vitest 4 environment selection.** Do not use `environmentMatchGlobs` (removed in v4). Put `// @vitest-environment jsdom` as the first line of each component test file. Keep `vitest.config.ts`'s global environment as the implicit node default so middleware/endpoint/RLS-adjacent tests stay in node. A shared setup file (jest-dom matchers) is registered via `test.setupFiles` — that is global, but only adds matchers, not an environment, so node tests are unaffected.
- **42501 / redirect sanitization parity with the unit test.** The success-redirect assertion must prove the _endpoint_ honors `safeRedirectPath`, not just that the unit function works: feed a crafted `redirect` form field (`//evil.com`) and assert the `Location` collapses to `/`. This is the integration-boundary proof the unit test can't give.

## Phase 1: Component Test Infrastructure

### Overview

Install and wire a jsdom + React Testing Library toolchain so the form components can be rendered and asserted, without disturbing the existing node-environment test suite.

### Changes Required:

#### 1. Toolchain dependencies

**File**: `package.json`

**Intent**: Add the dev dependencies needed to render React 19 components in a DOM and assert against them. No production deps change.

**Contract**: Add devDependencies `jsdom`, `@testing-library/react` (v16+, React 19-compatible), `@testing-library/dom` (RTL peer), `@testing-library/jest-dom`, `@testing-library/user-event`. Install pinned to the lockfile.

#### 2. Shared test setup

**File**: `test/setup-dom.ts` (new)

**Intent**: Register jest-dom matchers (`toBeInTheDocument`, etc.) and any per-test cleanup so component specs read cleanly.

**Contract**: Imports `@testing-library/jest-dom/vitest`. Referenced from `vitest.config.ts` via `test.setupFiles`.

#### 3. Vitest wiring

**File**: `vitest.config.ts`

**Intent**: Register the setup file globally while leaving the global test environment as node. Component files opt into jsdom per-file.

**Contract**: Add `test.setupFiles: ["./test/setup-dom.ts"]`. Do **not** set a global `environment` and do **not** use `environmentMatchGlobs`. `include` already matches `test/**/*.test.ts`; no change needed.

#### 4. Smoke render

**File**: `test/auth-form-smoke.test.tsx` (new, temporary or kept minimal)

**Intent**: Prove the toolchain renders a component under jsdom before the real form tests are written.

**Contract**: First line `// @vitest-environment jsdom`. Renders `SignInForm` and asserts a known label (e.g. the "Sign in" submit text) is in the document. Confirms jsdom + RTL + jest-dom + the `.tsx` include path all resolve.

### Success Criteria:

#### Automated Verification:

- Dependencies install cleanly: `npm install`
- The smoke test passes under jsdom: `npm test`
- Existing node tests still pass and stay in node env (no jsdom leakage): `npm test`
- Type checking passes: `npx astro check` (or `npm run lint` if it type-checks)
- Linting passes: `npm run lint`

#### Manual Verification:

- `test/**/*.test.ts` (node) specs are not measurably slowed — spot-check that middleware/evaluate tests didn't pick up a DOM global.
- `.tsx` test files are discovered by Vitest (include glob covers them).

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 2: Auth-Endpoint Integration Tests + R3 Gate Hardening

### Overview

Cover the endpoint half of R4 and close the small residual R3 gate gaps. Pure node environment; `createClient` mocked at the boundary, mirroring `test/evaluate.test.ts`.

### Changes Required:

#### 1. Signin endpoint integration tests

**File**: `test/auth-signin.test.ts` (new)

**Intent**: Prove `POST /api/auth/signin` surfaces errors while preserving the redirect target, redirects only to sanitized same-site paths on success, and handles the unconfigured branch.

**Contract**: Mock `@/lib/supabase` `createClient`. Import `POST` from `@/pages/api/auth/signin`. Build a context with a `formData`-bearing `Request` and a captured `locals.log` (reuse the `makeLog` shape from `test/evaluate.test.ts:22-36`). Assert on the redirect `Location`:

- bad creds (`signInWithPassword` returns `{ error }`) → `Location` is `/auth/signin?error=…&redirect=…` with the original `redirect` field preserved (URL-decoded comparison).
- success (`{ data: { user } }`) with a benign `redirect` field → `Location` equals that sanitized target; with a crafted `redirect=//evil.com` → `Location` collapses to `/`.
- `createClient` returns `null` → `Location` is the `Supabase is not configured` bounce.

#### 2. Signup endpoint integration tests

**File**: `test/auth-signup.test.ts` (new)

**Intent**: Prove `POST /api/auth/signup` routes success to confirm-email and bounces errors to the signup page.

**Contract**: Same mock/context harness. Assert:

- success (`signUp` returns `{ data: { user } }`) → `Location` is `/auth/confirm-email`.
- error → `Location` is `/auth/signup?error=…`.
- `createClient` null → `not_configured` bounce to `/auth/signup?error=…`. Note signup has **no** `redirect` param — do not assert one.

#### 3. R3 gate sub-path hardening

**File**: `test/middleware.test.ts` (extend existing suite)

**Intent**: Assert the `isGated` sub-path branch that the current suite skips, the minimal hardening the user chose.

**Contract**: Add cases to the existing `describe`: anon `POST /api/evaluate/anything` → 401 JSON; anon `GET /dashboard/settings` → 302 redirect; anon `GET /foo` (ungated) → passthrough to `next()` (proving `/` matches exactly, not as a prefix). Reuse the file's existing `makeContext`/`mockUser` helpers — no new harness.

### Success Criteria:

#### Automated Verification:

- New endpoint tests pass: `npm test`
- Extended middleware tests pass: `npm test`
- No `give`/`want`-style secret leakage pattern needed here, but assert the user-facing `error` param exists without asserting raw log internals.
- Type checking passes: `npx astro check`
- Linting passes: `npm run lint`

#### Manual Verification:

- The success-redirect sanitization case genuinely exercises `safeRedirectPath` through the endpoint (crafted `//evil.com` → `/`), not just the unit function.
- Endpoint tests mock only `createClient` — no reach into Supabase internals (§7 respected).

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 3: Auth Form Component Tests

### Overview

Cover the form half of R4 under jsdom: client validation, inline error display, server-error rendering, and the redirect field. No network mock — the native POST is the boundary.

### Changes Required:

#### 1. SignInForm component tests

**File**: `test/SignInForm.test.tsx` (new)

**Intent**: Prove the signin form gates invalid submits, surfaces inline and server errors, and carries the redirect target into its hidden field.

**Contract**: First line `// @vitest-environment jsdom`. Render `SignInForm` with `@testing-library/react`; drive input with `user-event`. Assert:

- submitting empty → inline "Email is required" / "Password is required" appear and the submit is prevented (the form's `onSubmit` `preventDefault`s; assert via a captured submit event's `defaultPrevented`, or that no navigation/error-free state results).
- invalid email format → "Enter a valid email address".
- typing into a field clears its error (`clearError`).
- `serverError` prop set → `ServerError` renders the message text.
- hidden `redirect` input has the passed `redirect` value (and defaults to `/` when omitted — `SignInForm.tsx:45`).

#### 2. SignUpForm component tests

**File**: `test/SignUpForm.test.tsx` (new)

**Intent**: Prove the signup form's richer validation (password length, confirm-match) and server-error rendering.

**Contract**: First line `// @vitest-environment jsdom`. Assert:

- empty submit → required errors for email/password/confirm.
- password shorter than 6 → length error; the "N more characters needed" hint renders while typing (`SignUpForm.tsx:57-63`).
- mismatched confirm → "Passwords do not match".
- `serverError` prop set → `ServerError` renders. SignUpForm has **no** `redirect` field — do not assert one.

### Success Criteria:

#### Automated Verification:

- Component tests pass under jsdom: `npm test`
- All suites (node + jsdom) green in one run: `npm test`
- Type checking passes: `npx astro check`
- Linting passes: `npm run lint`

#### Manual Verification:

- Tests assert our wiring only (validation, error render, redirect field) — no Supabase, no faked navigation (§7 respected).
- The valid-submit→redirect path is intentionally absent here (owned by Phase 2's endpoint test) — confirm that boundary split reads clearly.

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 4: Cookbook + Test-Plan Bookkeeping

### Overview

Turn the two cookbook recipes this phase owns into real instructions and advance the rollout ledger, so the next reader and the next phase inherit accurate state.

### Changes Required:

#### 1. Integration recipe (§6.2)

**File**: `context/foundation/test-plan.md`

**Intent**: Replace the "TBD — see §3 Phase 2" placeholder in §6.2 with the boundary-mock recipe for API-route / middleware integration tests.

**Contract**: §6.2 documents: mock `createClient` at `@/lib/supabase`; build a `formData`/JSON `Request` context with a captured `locals.log`; assert on `Location` / status / JSON body; redirect-sanitization is proven by feeding a crafted target through the endpoint. Cite `test/auth-signin.test.ts`, `test/auth-signup.test.ts`, `test/middleware.test.ts`, `test/evaluate.test.ts` as worked examples. Run: `npm test`.

#### 2. Component recipe (§6.3)

**File**: `context/foundation/test-plan.md`

**Intent**: Replace the §6.3 placeholder with the jsdom + RTL recipe for auth-form component tests.

**Contract**: §6.3 documents: `// @vitest-environment jsdom` docblock per file (Vitest 4 — no `environmentMatchGlobs`); render with `@testing-library/react`, drive with `user-event`, matchers from `@testing-library/jest-dom` via `test/setup-dom.ts`; assert validation / inline errors / `ServerError` / hidden `redirect` field; the native POST is the boundary — do not mock submission or Supabase (§7). Cite `test/SignInForm.test.tsx`, `test/SignUpForm.test.tsx`.

#### 3. Stack, gate, status, and freshness updates

**File**: `context/foundation/test-plan.md`

**Intent**: Reflect that the component toolchain is now installed and Phase 2 has landed.

**Contract**: §4 — change the `component` and `API mocking` rows from "none yet — see Phase 2" to the installed tools with a `checked:` date. §5 — note the "unit + integration (Vitest)" gate's Phase-2 dependency is now satisfied. §3 — set Phase 2 Status to `complete`. §8 — bump the freshness dates. Update the top-of-file "Last updated" line.

#### 4. Change status

**File**: `context/changes/testing-auth-gate/change.md`

**Intent**: Reflect the change's progression; the rollout orchestrator reads status from disk.

**Contract**: Set `status` and `updated` per the rollout vocabulary as the phase closes (this plan sets `planned` on write; Phase 4 advances it toward `complete` when the rollout closes).

### Success Criteria:

#### Automated Verification:

- Markdown lint/format passes on the edited docs: `npm run format`
- No "TBD — see §3 Phase 2" strings remain in §6.2/§6.3: `grep -n "TBD" context/foundation/test-plan.md` returns nothing for those sections.
- Full test suite still green: `npm test`

#### Manual Verification:

- §6.2/§6.3 recipes are actionable by a contributor who wasn't here — they name the files, the mock boundary, and the run command.
- §3 status and §4 stack rows match what actually landed on disk.

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation.

---

## Testing Strategy

### Unit Tests:

- (Existing) `safeRedirectPath` edge cases — unchanged.

### Integration Tests:

- Auth endpoints (signin/signup) via boundary-mocked `createClient` — error bounce + redirect preservation, sanitized success target, `not_configured`, signup → confirm-email.
- Middleware gate sub-path matching — `/api/evaluate/x` → 401, `/dashboard/x` → redirect, ungated path → passthrough.

### Component Tests (new layer, jsdom):

- SignInForm / SignUpForm validation, inline errors, error-clear-on-edit, `ServerError` render, hidden `redirect` field.

### Manual Testing Steps:

1. `npm test` — all suites green in one run (node + jsdom).
2. Confirm node-environment tests did not silently gain a DOM global.
3. Review §6.2/§6.3 recipes against the actual new test files.

## Performance Considerations

jsdom is heavier than node; the per-file `// @vitest-environment jsdom` docblock confines that cost to the two component specs, leaving the existing node suite fast. No production-path performance impact.

## Migration Notes

None — additive test coverage and dev-only tooling. No schema, no production code, no migrations.

## References

- Test rollout: `context/foundation/test-plan.md` (§2 R3/R4, §3 Phase 2, §6.2/§6.3, §7)
- Boundary-mock pattern: `test/evaluate.test.ts`, `test/middleware.test.ts`
- Endpoints under test: `src/pages/api/auth/signin.ts`, `src/pages/api/auth/signup.ts`
- Forms under test: `src/components/auth/SignInForm.tsx`, `src/components/auth/SignUpForm.tsx`
- Redirect guard: `src/lib/redirect.ts` + `test/redirect.test.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Component Test Infrastructure

#### Automated

- [x] 1.1 Dependencies install cleanly: `npm install` — 8226a04
- [x] 1.2 The smoke test passes under jsdom: `npm test` — 8226a04
- [x] 1.3 Existing node tests still pass and stay in node env: `npm test` — 8226a04
- [x] 1.4 Type checking passes: `npx astro check` — 8226a04
- [x] 1.5 Linting passes: `npm run lint` — 8226a04

#### Manual

- [x] 1.6 Node specs are not measurably slowed (no DOM global leakage) — 8226a04
- [x] 1.7 `.tsx` test files are discovered by Vitest — 8226a04

### Phase 2: Auth-Endpoint Integration Tests + R3 Gate Hardening

#### Automated

- [x] 2.1 New endpoint tests pass: `npm test` — 8125d35
- [x] 2.2 Extended middleware tests pass: `npm test` — 8125d35
- [x] 2.3 User-facing `error` param asserted without raw log internals — 8125d35
- [x] 2.4 Type checking passes: `npx astro check` — 8125d35
- [x] 2.5 Linting passes: `npm run lint` — 8125d35

#### Manual

- [x] 2.6 Success-redirect sanitization exercised through the endpoint (`//evil.com` → `/`) — 8125d35
- [x] 2.7 Endpoint tests mock only `createClient` (§7 respected) — 8125d35

### Phase 3: Auth Form Component Tests

#### Automated

- [x] 3.1 Component tests pass under jsdom: `npm test` — f3ff148
- [x] 3.2 All suites (node + jsdom) green in one run: `npm test` — f3ff148
- [x] 3.3 Type checking passes: `npx astro check` — f3ff148
- [x] 3.4 Linting passes: `npm run lint` — f3ff148

#### Manual

- [x] 3.5 Tests assert our wiring only — no Supabase, no faked navigation (§7) — f3ff148
- [x] 3.6 Valid-submit→redirect intentionally absent (owned by Phase 2) — boundary split reads clearly — f3ff148

### Phase 4: Cookbook + Test-Plan Bookkeeping

#### Automated

- [x] 4.1 Markdown format passes: `npm run format` — 237f576
- [x] 4.2 No "TBD — see §3 Phase 2" strings remain in §6.2/§6.3 — 237f576
- [x] 4.3 Full test suite still green: `npm test` — 237f576

#### Manual

- [x] 4.4 §6.2/§6.3 recipes are actionable by a contributor who wasn't here — 237f576
- [x] 4.5 §3 status and §4 stack rows match what landed on disk — 237f576
