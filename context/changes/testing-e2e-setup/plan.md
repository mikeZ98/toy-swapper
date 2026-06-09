# E2E (Browser) Test Setup Implementation Plan

## Overview

Stand up a minimal, **honest** Playwright e2e layer for ToySwapper. The driver is an external/learning requirement (per `frame.md`), not a risk gap — every risk in the test-plan's risk map is already covered more cheaply. So this layer is aimed at the two surfaces that genuinely cannot be tested below a real browser: the **signin → cookie → gate → redirect round-trip**, and the **`index.astro` inline evaluator script** (`<script is:inline>` driving fetch → contract render). It runs production-like (`build` + `preview`) against local Supabase, is local-only for now (CI is in `startup_failure` due to account billing), and is documented in `test-plan.md` §4/§7 as externally-motivated so it is not mistaken for a reversal of the cost×signal strategy.

## Current State Analysis

- **No e2e infra exists.** No `@playwright/test` dependency, no `playwright.config.*`, no `e2e/` dir. `test-plan.md` §4 lists e2e as `none` — a deliberate exclusion, not an oversight.
- **The uncovered surface is gated.** The inline evaluator script (`src/pages/index.astro:168-279`) is the only client behavior no current layer reaches (it is vanilla `is:inline` JS, not a React island, so jsdom component tests don't touch it). It lives on `/`, which the middleware gates. `createClient` returns `null` when `SUPABASE_URL/KEY` are unset (`astro.config.mjs` env is `optional`), so `locals.user` is always null and `/` always redirects to signin. **Reaching the evaluator in a browser therefore requires local Supabase running + a real session** — there is no cookie-injection shortcut without a configured Supabase.
- **Determinism anchor.** The evaluator takes a deterministic `stub` path whenever `OPENAI_API_KEY` is absent (`src/lib/evaluator.ts:172-178`, `source: "stub"`). With no key, output is byte-stable (PRD determinism NFR).
- **Local auth is e2e-friendly.** `supabase/config.toml:209` has `enable_confirmations = false`, so a signed-up test user can sign in immediately — no email-confirmation step to automate.
- **App boot.** Adapter is `@astrojs/cloudflare`; `npm run preview` (`astro preview`) serves the built worker via wrangler (already a devDep, `^4.90.0`) and reads `.dev.vars` (exists, gitignored) for `SUPABASE_URL/KEY`.
- **Gitignore gap.** `.gitignore` covers `node_modules/` and `.dev.vars` but not Playwright artifacts or the storageState file (which holds a real session token).

## Desired End State

`npx playwright test` (with local Supabase up and `OPENAI_API_KEY` unset) runs green against the production-built worker, proving in a real browser: (1) an anonymous visit to `/` redirects to `/auth/signin`; (2) the signin form surfaces an inline error on bad credentials and lands on the gated `/` on success; (3) an authenticated operator can run an evaluation and see the rendered contract with `source: stub`. The storageState/session token never lands in git. `test-plan.md` §4/§7/§6 reflect the new layer and its externally-motivated rationale, and the CI-wiring deferral is recorded.

### Key Discoveries:

- Inline evaluator script + 401 bounce: `src/pages/index.astro:210-261` (submit→fetch→render), `:232-235` (401→`window.location='/auth/signin?redirect=/'`).
- Stub determinism trigger: `src/lib/evaluator.ts:172-178`.
- Local auth has confirmations off: `supabase/config.toml:209`.
- The only React islands (already jsdom-covered) are the auth forms: `src/pages/auth/signin.astro:23`, `signup.astro:21`.
- Frame brief (authoritative): `context/changes/testing-e2e-setup/frame.md` — reframed problem + the "avoid theater / pin determinism / document in §4-§7" constraints.

## What We're NOT Doing

- **Not** justifying e2e as risk-driven — it is external/learning-driven (frame). The risk map stays covered at its cheaper layers.
- **Not** wiring e2e into CI now — CI is in `startup_failure` (billing). Captured as a documented follow-up instead.
- **Not** a broad e2e suite or cross-browser matrix — chromium only, a handful of specs.
- **Not** seeding the session programmatically in a way that skips the form — at least one spec drives the real signin form in a browser (that round-trip is the point).
- **Not** testing Supabase internals (§7) — we drive our own UI and endpoints; Supabase is the live dependency, not the subject.
- **Not** changing any `src/` production code — additive test infra + docs only.
- **Not** re-testing the auth forms' client validation exhaustively — that is Phase-2 jsdom coverage of the prior change; the e2e asserts only the browser-only round-trip.

## Implementation Approach

Four phases, ordered so the harness lands and self-verifies before taking on the Supabase-dependent specs. Phase 1 is runnable with zero Supabase (the gate-redirect smoke needs no session). Phases 2–3 require `supabase start`. The authenticated specs share one `storageState` captured once in `global-setup` (fast), while a dedicated `auth.spec.ts` drives the signin form explicitly (the honest round-trip). Phase 4 records the rationale and run steps. All phases are `/10x-implement`-driven (test infra against existing app behavior).

## Critical Implementation Details

- **Determinism is an assertion, not just an env assumption.** The evaluator spec asserts the rendered `source` pill reads `stub`. If `OPENAI_API_KEY` is set in `.dev.vars`, the evaluator takes the LLM path and the assertion fails loudly — which is the correct signal that the run is non-deterministic. Document "unset OPENAI_API_KEY for e2e" as a prerequisite.
- **storageState holds a live token.** The captured session file (e.g. `e2e/.auth/user.json`) must be gitignored before it is ever generated — add the ignore entry in Phase 1, not Phase 2.
- **`build` + `preview` boot is slow.** Playwright's `webServer.timeout` must allow for a full `astro build` before the suite starts; set a generous timeout and `reuseExistingServer: !process.env.CI`.
- **Gate vs session ordering.** `global-setup` must ensure the test user exists (idempotent signUp, tolerating "already registered") _before_ driving the signin form, or the form bounce will have no valid credentials to succeed with.

## Phase 1: Playwright Harness + App Boot + Unauth Smoke

### Overview

Install Playwright, configure it to boot the production-built worker, wire the run script and gitignore, and prove the harness with a Supabase-free smoke spec.

### Changes Required:

#### 1. Playwright dependency + browser

**File**: `package.json`

**Intent**: Add the e2e runner and a `test:e2e` script. Chromium browser binary installed via `npx playwright install chromium`.

**Contract**: devDependency `@playwright/test`; script `"test:e2e": "playwright test"`. Browser binary is machine-local (not committed).

#### 2. Playwright config

**File**: `playwright.config.ts` (new)

**Intent**: Boot the production-like app and point tests at it; define the chromium project and artifact locations.

**Contract**: `testDir: "e2e"`; `webServer` runs `npm run build && npm run preview` with the preview URL as `webServer.url`, `reuseExistingServer: !process.env.CI`, and a build-tolerant `timeout`; `use.baseURL` set to the preview origin; chromium project. (storageState/project dependencies are added in Phase 2.)

#### 3. Gitignore e2e artifacts + session token

**File**: `.gitignore`

**Intent**: Keep Playwright output and the live-session storageState out of git.

**Contract**: add `test-results/`, `playwright-report/`, `playwright/.cache/`, and `e2e/.auth/` (the storageState dir).

#### 4. Unauthenticated smoke spec

**File**: `e2e/gate.spec.ts` (new)

**Intent**: Prove the harness boots the built worker and the gate works in a real browser, with no Supabase session required.

**Contract**: navigate to `/`; assert the browser ends on `/auth/signin` (redirected by middleware). No login, no Supabase session needed (anonymous → redirect is the asserted behavior).

### Success Criteria:

#### Automated Verification:

- Playwright + chromium install cleanly: `npm install` + `npx playwright install chromium`
- The smoke spec passes against the built worker: `npx playwright test gate.spec.ts`
- Existing suites unaffected: `npm test`
- Linting passes: `npm run lint`
- Type checking passes: `npx astro check`

#### Manual Verification:

- `webServer` completes `build` then serves `preview` without a timeout; the run is hermetic (no pre-running server assumed in CI mode).
- `git status` shows no `test-results/`, `playwright-report/`, or `e2e/.auth/` candidates staged.

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 2: Auth Session Infra + Dedicated Auth Spec

### Overview

Capture a reusable authenticated `storageState` once, and add the spec that drives the real signin form in a browser — the auth round-trip coverage that justifies e2e.

### Changes Required:

#### 1. Global setup — seed user + capture storageState

**File**: `e2e/global-setup.ts` (new)

**Intent**: Ensure a known test user exists locally, then sign in through the app to persist an authenticated browser state for reuse.

**Contract**: idempotently ensure the test user exists (supabase-js `signUp` against the local stack using `.dev.vars` URL/anon key; tolerate an "already registered" error — confirmations are off locally so the user is immediately usable); then drive the signin form in a browser context and save storageState to `e2e/.auth/user.json`. Wired via `playwright.config.ts` `globalSetup` (or a setup project dependency).

#### 2. Authenticated project wiring

**File**: `playwright.config.ts`

**Intent**: Make authenticated specs reuse the captured storageState; keep the gate smoke unauthenticated.

**Contract**: add an "authenticated" project with `use.storageState: "e2e/.auth/user.json"` depending on the setup step; the Phase-1 `gate.spec.ts` stays on a no-storageState project (it asserts the anonymous redirect).

#### 3. Auth round-trip spec

**File**: `e2e/auth.spec.ts` (new)

**Intent**: Prove the signin form's browser round-trip: errors surface, success crosses the gate.

**Contract**: bad credentials → the page shows the inline `ServerError` text and stays on `/auth/signin`; valid credentials → the browser lands on the gated `/` (no redirect back to signin). Drives the real form (not a programmatic session).

### Success Criteria:

#### Automated Verification:

- With local Supabase up, global-setup captures storageState: `npx playwright test` (setup runs)
- Auth spec passes: `npx playwright test auth.spec.ts`
- Linting passes: `npm run lint`
- Type checking passes: `npx astro check`

#### Manual Verification:

- `e2e/.auth/user.json` is generated and is NOT tracked by git.
- The success case genuinely lands on `/` (the gated evaluator page), confirming the cookie/session crossed the middleware.
- Re-running the suite reuses the user (idempotent signUp does not error on the second run).

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 3: Evaluator Inline-Script E2E

### Overview

Test the one surface no cheaper layer reaches: the `index.astro` inline script driving an evaluation, asserted against the deterministic stub.

### Changes Required:

#### 1. Evaluator happy-path spec

**File**: `e2e/evaluate.spec.ts` (new)

**Intent**: Drive a full evaluation in the browser and assert the rendered contract, pinned to the deterministic stub path.

**Contract**: authenticated (storageState project); on `/`, fill the `#give` / `#want` textareas and submit `#evaluate-form`; assert the result card (`#result`) reveals, the `source` pill reads `stub` (determinism guard — fails if `OPENAI_API_KEY` is set), the verdict and delta pills are populated, and the contract `<pre id="contract-md">` is non-empty. Assert the clear button (`#clear-btn`) resets the form and hides the result. Copy-to-clipboard and the 401-bounce are out of scope (noted as optional follow-ups).

### Success Criteria:

#### Automated Verification:

- With local Supabase up and `OPENAI_API_KEY` unset, the evaluator spec passes: `npx playwright test evaluate.spec.ts`
- Full e2e suite green in one run: `npx playwright test`
- Linting passes: `npm run lint`
- Type checking passes: `npx astro check`

#### Manual Verification:

- The rendered contract is the deterministic stub output (`source: stub`), reproducible across re-runs.
- The spec exercises the real inline script (network fetch to `/api/evaluate`, pill rendering, contract display) — not a mocked surface.
- The clear action returns the page to its initial state.

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 4: Documentation

### Overview

Record the new layer and its externally-motivated rationale in the test strategy, add a run recipe, and capture the CI deferral — so the e2e layer does not read as a silent reversal of §1/§4.

### Changes Required:

#### 1. Stack row + exclusion boundary

**File**: `context/foundation/test-plan.md`

**Intent**: Reflect that an e2e layer now exists, why, and how it relates to the cost×signal strategy.

**Contract**: §4 — change the `e2e` row from `none` to Playwright (chromium), with a note that it is **externally/learning-motivated** (not risk-driven) and a `checked:` date. §7 — add/adjust a line stating the boundary: e2e exists for the external requirement and the two browser-only surfaces (auth round-trip + inline evaluator script), NOT because any of R1–R5 stopped being provable at a cheaper layer. Bump the top-of-file "Last updated" line and §8 freshness dates.

#### 2. Cookbook recipe

**File**: `context/foundation/test-plan.md`

**Intent**: Make the e2e layer runnable by someone who wasn't here.

**Contract**: add a §6 sub-section "Adding an e2e test": prerequisites (`supabase start`; `OPENAI_API_KEY` unset for determinism), run command (`npx playwright test` / `npm run test:e2e`), the boot model (`build`+`preview`), the storageState pattern (global-setup signs in once; authenticated specs reuse `e2e/.auth/user.json`), and the stub-determinism guard (assert `source: stub`). Cite `e2e/gate.spec.ts`, `e2e/auth.spec.ts`, `e2e/evaluate.spec.ts`.

#### 3. CI deferral note

**File**: `context/foundation/test-plan.md`

**Intent**: Record that e2e is intentionally local-only for now and what would wire it into CI.

**Contract**: in §5 (or the §6 recipe), note the e2e layer is local-only pending the CI `startup_failure` (account-billing) being resolved; wiring it later needs a browser + local Supabase in the CI job. No `ci.yml` change in this plan.

### Success Criteria:

#### Automated Verification:

- Markdown formats cleanly: `npm run format`
- No stale "e2e | none" / "out of scope" claim remains in §4 that contradicts the new layer: `grep -n "e2e" context/foundation/test-plan.md`

#### Manual Verification:

- §4/§7 read coherently: an e2e layer exists AND the cost×signal strategy is intact (external motivation stated, risk map unchanged).
- The §6 recipe is actionable: prerequisites, run command, determinism guard all present.
- The CI deferral is explicit, not silent.

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation.

---

## Testing Strategy

### Unit / Integration / Component (unchanged):

- Existing Vitest + pgTAP suites continue to own R1–R5; this plan adds nothing there.

### E2E (new, chromium, local Supabase + stub):

- `gate.spec.ts` — anonymous `/` → `/auth/signin` redirect (no session).
- `auth.spec.ts` — signin form: bad creds → inline error; success → gated `/`.
- `evaluate.spec.ts` — authenticated evaluation → contract renders, `source: stub`, clear resets.

### Manual Testing Steps:

1. `supabase start`; ensure `.dev.vars` has local `SUPABASE_URL/KEY` and **no** `OPENAI_API_KEY`.
2. `npx playwright test` — all three specs green against the built worker.
3. Re-run to confirm determinism (same stub contract) and idempotent user seeding.
4. `git status` — no storageState/artifacts tracked.

## Performance Considerations

`build` + `preview` adds a one-time build before the suite; acceptable for a local, production-like run. Authenticated specs reuse a single storageState rather than signing in per test, keeping the suite fast.

## Migration Notes

None — additive dev tooling, new `e2e/` specs, and docs. No schema, no production code, no migrations.

## References

- Frame brief: `context/changes/testing-e2e-setup/frame.md`
- Inline evaluator surface: `src/pages/index.astro:168-279`
- Stub determinism: `src/lib/evaluator.ts:172-178`; endpoint `src/pages/api/evaluate.ts`
- Local auth config: `supabase/config.toml:209`
- Strategy doc to update: `context/foundation/test-plan.md` §4, §5, §6, §7, §8
- Local Supabase boot: see memory `local-supabase-colima` and `supabase/README.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Playwright Harness + App Boot + Unauth Smoke

#### Automated

- [x] 1.1 Playwright + chromium install cleanly: `npm install` + `npx playwright install chromium` — f8d5719
- [x] 1.2 Smoke spec passes against the built worker: `npx playwright test gate.spec.ts` — f8d5719
- [x] 1.3 Existing suites unaffected: `npm test` — f8d5719
- [x] 1.4 Linting passes: `npm run lint` — f8d5719
- [x] 1.5 Type checking passes: `npx astro check` — f8d5719

#### Manual

- [x] 1.6 webServer builds then serves preview without timeout; run is hermetic — f8d5719
- [x] 1.7 No test-results/report/.auth artifacts staged in git — f8d5719

### Phase 2: Auth Session Infra + Dedicated Auth Spec

#### Automated

- [x] 2.1 Global-setup captures storageState with local Supabase up: `npx playwright test` — 3026df6
- [x] 2.2 Auth spec passes: `npx playwright test auth.spec.ts` — 3026df6
- [x] 2.3 Linting passes: `npm run lint` — 3026df6
- [x] 2.4 Type checking passes: `npx astro check` — 3026df6

#### Manual

- [x] 2.5 `e2e/.auth/user.json` generated and NOT tracked by git — 3026df6
- [x] 2.6 Success case lands on gated `/` (session crossed middleware) — 3026df6
- [x] 2.7 Re-run reuses the user (idempotent signUp does not error) — 3026df6

### Phase 3: Evaluator Inline-Script E2E

#### Automated

- [x] 3.1 Evaluator spec passes (Supabase up, OPENAI_API_KEY unset): `npx playwright test evaluate.spec.ts` — 82bafc6
- [x] 3.2 Full e2e suite green in one run: `npx playwright test` — 82bafc6
- [x] 3.3 Linting passes: `npm run lint` — 82bafc6
- [x] 3.4 Type checking passes: `npx astro check` — 82bafc6

#### Manual

- [x] 3.5 Rendered contract is deterministic stub output (`source: stub`), reproducible — 82bafc6
- [x] 3.6 Spec exercises the real inline script (fetch + render), not a mock — 82bafc6
- [x] 3.7 Clear action resets the page to initial state — 82bafc6

### Phase 4: Documentation

#### Automated

- [x] 4.1 Markdown formats cleanly: `npm run format`
- [x] 4.2 No stale "e2e | none" claim remains that contradicts the new layer

#### Manual

- [x] 4.3 §4/§7 read coherently (layer exists AND cost×signal strategy intact)
- [x] 4.4 §6 recipe is actionable (prereqs, run command, determinism guard)
- [x] 4.5 CI deferral is explicit, not silent
