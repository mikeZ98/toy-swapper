# E2E (Browser) Test Setup — Plan Brief

> Full plan: `context/changes/testing-e2e-setup/plan.md`
> Frame brief: `context/changes/testing-e2e-setup/frame.md`

## What & Why

Stand up a minimal, honest Playwright e2e layer. The driver is an **external/learning requirement**, not a risk gap — every risk in the test-plan's risk map is already covered more cheaply (that's why §4 excluded e2e). So the layer is aimed only at the two surfaces no cheaper layer can reach: the real **signin → cookie → gate → redirect round-trip**, and the **`index.astro` inline evaluator script** (vanilla `is:inline` JS, not a React island). It is documented as externally-motivated so it doesn't read as a reversal of the cost×signal strategy.

## Starting Point

No e2e infra exists (no Playwright, no `e2e/`). The uncovered surface — the inline evaluator script at `index.astro:168-279` — sits behind the auth gate, and `createClient` is null without `SUPABASE_URL/KEY`, so reaching it in a browser needs local Supabase + a real session. The evaluator's deterministic stub path triggers when `OPENAI_API_KEY` is unset (`evaluator.ts:172-178`); local Supabase has email confirmations off (`config.toml:209`).

## Desired End State

`npx playwright test` (local Supabase up, `OPENAI_API_KEY` unset) runs green against the production-built worker, proving in a real browser: anonymous `/` → signin redirect; signin form errors-inline / success-lands-on-gated-`/`; an authenticated operator runs an evaluation and sees the rendered contract with `source: stub`. The session token never lands in git; `test-plan.md` §4/§6/§7 reflect the layer and its rationale.

## Key Decisions Made

| Decision         | Choice                                  | Why (1 sentence)                                                    | Source |
| ---------------- | --------------------------------------- | ------------------------------------------------------------------- | ------ |
| Why e2e at all   | External/learning requirement, not risk | Risk map is already covered cheaper; e2e is the deliverable itself. | Frame  |
| Coverage / infra | Full: sign in + run evaluator           | Covers both genuinely browser-only surfaces; the honest target.     | Plan   |
| Session strategy | storageState + dedicated auth spec      | Fast authenticated specs + one real form round-trip assertion.      | Plan   |
| App boot         | `build` + `preview` (production-like)   | Tests the real cloudflare worker output, not the dev server.        | Plan   |
| Determinism      | Assert `source: stub` (no OPENAI key)   | Turns the stub assumption into a loud failure if a key leaks in.    | Plan   |
| CI wiring        | Local-only, documented deferral         | CI is in startup_failure (billing); don't add an unverifiable job.  | Plan   |

## Scope

**In scope:** Playwright + chromium, `playwright.config.ts` (build+preview boot), `test:e2e` script, `.gitignore` entries; specs for gate-redirect (unauth), signin round-trip, and the evaluator inline script; global-setup storageState; test-plan §4/§6/§7 docs.

**Out of scope:** CI wiring; cross-browser matrix; programmatic-session-only auth (must drive the real form once); copy-to-clipboard and 401-bounce specs (optional follow-ups); any `src/` production change; re-testing auth-form client validation (jsdom already owns it).

## Architecture / Approach

Playwright boots the production-built worker via `build`+`preview` (reads `.dev.vars` for Supabase). `global-setup` ensures a test user (idempotent signUp, confirmations off) and captures `storageState`; an "authenticated" project reuses it for the evaluator spec, while the gate-redirect spec runs anonymous and `auth.spec.ts` drives the real signin form. Determinism is pinned by running with `OPENAI_API_KEY` unset and asserting `source: stub`.

## Phases at a Glance

| Phase                            | What it delivers                                     | Key risk                                                    |
| -------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------- |
| 1. Harness + boot + unauth smoke | Playwright config, gitignore, gate-redirect spec     | slow/timed-out build+preview boot; artifacts leaking to git |
| 2. Auth infra + auth spec        | global-setup storageState + signin round-trip spec   | session not crossing the gate; non-idempotent seeding       |
| 3. Evaluator inline-script spec  | authenticated evaluation → contract renders (`stub`) | a leaked OPENAI key making output non-deterministic         |
| 4. Documentation                 | test-plan §4/§6/§7 + CI deferral                     | docs reading as a silent strategy reversal                  |

**Prerequisites:** local Supabase (`supabase start`, Colima/Docker) for phases 2–3; `OPENAI_API_KEY` unset; `.dev.vars` with local Supabase creds.
**Estimated effort:** ~2–3 sessions across 4 phases.

## Open Risks & Assumptions

- Assumes `astro preview` (cloudflare adapter via wrangler) serves the gated app correctly with `.dev.vars` creds — verify at Phase 1 boot.
- `build`+`preview` boot time must fit Playwright's `webServer.timeout`.
- E2E is local-only until the CI `startup_failure` (billing) is resolved; the high-value coverage won't gate PRs until then.

## Success Criteria (Summary)

- A real browser confirms: anonymous `/` redirects to signin; the signin form errors inline and a good signin lands on the gated `/`.
- An authenticated operator runs an evaluation and sees the deterministic stub contract rendered by the inline script.
- The e2e layer exists without contradicting the test-plan's cost×signal strategy, and its session token stays out of git.
