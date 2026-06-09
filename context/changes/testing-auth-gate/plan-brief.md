# Auth Gate + Signin/Signup Form Path — Plan Brief

> Full plan: `context/changes/testing-auth-gate/plan.md`

## What & Why

Phase 2 of the project test rollout (`context/foundation/test-plan.md` §3). It protects two risks: **R3** — the auth gate regresses (`/` or `POST /api/evaluate` stops redirecting / 401-ing unauthenticated callers) — and **R4** — the signin/signup form path breaks silently (bad-credential error not surfaced, or a successful signin not landing on the gated target). R3 is already largely covered; R4 has no coverage at all and is the real work.

## Starting Point

`test/middleware.test.ts` already proves the gate's redirect / 401 / target-preservation / passthrough contract — R3 is "harden, not bootstrap." The auth endpoints (`api/auth/signin.ts`, `signup.ts`) and form components (`SignInForm.tsx`, `SignUpForm.tsx`) have zero tests. The component-test toolchain (jsdom + React Testing Library) is not installed; Vitest 4.1.7 runs everything in node.

## Desired End State

`npm test` proves the endpoints bounce errors while preserving the redirect target, redirect only to sanitized same-site paths on success, handle the unconfigured branch, and route signup to confirm-email; the form components gate invalid submits, show inline + server errors, and carry the redirect field; the gate's sub-path matching is asserted. Component tests run under jsdom without slowing the node suite. The test-plan's two cookbook recipes and status ledger are updated.

## Key Decisions Made

| Decision                  | Choice                                                              | Why (1 sentence)                                                                 | Source |
| ------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------- | ------ |
| R3 investment             | Minimal hardening (sub-path matching), focus budget on R4          | Existing middleware suite already proves the gate contract — don't re-test it.   | Plan   |
| Component toolchain        | jsdom + @testing-library/react (+ jest-dom, user-event)            | Matches test-plan §4's named tool; widest React 19 support.                      | Plan / Frame (§4) |
| DOM isolation mechanism    | Per-file `// @vitest-environment jsdom` docblock                   | `environmentMatchGlobs` is removed in Vitest 4.1.7; docblock keeps node global.  | Plan   |
| Component test boundary    | Validation + error render + submit gating; no network/submit mock  | Native-POST forms have no in-component fetch — the POST is the boundary (§7).     | Plan / Frame (§7) |
| Endpoint assertions        | All four: bad-creds bounce, sanitized success, not_configured, signup→confirm-email | These are the reachable branches that prove R4's endpoint half.                  | Plan   |

## Scope

**In scope:** auth-endpoint integration tests (signin/signup); R3 gate sub-path hardening; component-test toolchain + signin/signup form component tests; test-plan §6.2/§6.3/§4/§5/§3/§8 bookkeeping.

**Out of scope:** testing Supabase internals (§7); Playwright / e2e; exhaustive R3 gate matrix; production-code changes; GitHub branch-protection settings.

## Architecture / Approach

Four `/10x-implement`-driven phases (tests against existing code, so not TDD). Integration tests reuse the `createClient`-boundary mock pattern from `test/evaluate.test.ts`; component tests use `@testing-library/react` render + `user-event` under a per-file jsdom env, with node staying the global default so existing suites are untouched.

## Phases at a Glance

| Phase                                         | What it delivers                                              | Key risk                                                        |
| --------------------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------- |
| 1. Component test infrastructure              | jsdom + RTL installed, Vitest setup file, smoke render        | jsdom leaking into / slowing node tests                        |
| 2. Endpoint integration + R3 hardening        | signin/signup endpoint tests + gate sub-path cases            | mocking too deep (Supabase internals) instead of the boundary |
| 3. Auth form component tests                  | SignInForm/SignUpForm validation + error + redirect-field     | asserting framework behavior instead of our wiring            |
| 4. Cookbook + test-plan bookkeeping           | §6.2/§6.3 recipes + §4/§5/§3/§8 ledger updates                | docs drifting from what actually landed                        |

**Prerequisites:** none beyond the repo; Phase 3 depends on Phase 1.
**Estimated effort:** ~2–3 sessions across 4 phases.

## Open Risks & Assumptions

- Assumes `@testing-library/react` v16 cleanly supports React 19.2 under jsdom (expected; verify at install in Phase 1).
- Assumes the existing middleware suite is trustworthy as-is (basis for the "minimal R3" choice).
- jsdom does not navigate on native form submit — the valid-submit→redirect path is deliberately proven at the endpoint layer, not in the component.

## Success Criteria (Summary)

- A bad signin shows the error and keeps the user's intended destination; a good signin lands on a sanitized same-site target.
- The signin/signup forms block invalid input and display inline + server errors.
- The gate 401s/redirects unauthenticated callers on sub-paths too — and none of it relies on testing Supabase itself.
