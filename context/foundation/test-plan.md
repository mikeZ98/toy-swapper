# Test Plan

> Phased test rollout for this project. Strategy is frozen at the top
> (§1–§5); cookbook patterns at the bottom (§6) fill in as phases ship.
> Read before writing any new test.
>
> Refresh: re-run `/10x-test-plan --refresh` when stale (see §8).
>
> Last updated: 2026-06-08 (§3 Phase 1 → negative controls landed; §6.1 recipe + §5 gate note filled)

## 1. Strategy

Tests follow three non-negotiable principles for this project:

1. **Cost × signal.** The cheapest test that gives a real signal for the
   risk wins. Do not promote to e2e because e2e "feels safer." Do not put a
   vision model on top of a deterministic visual diff that already catches
   the regression. For ToySwapper this means: RLS isolation is proven at the
   pgTAP layer (not a browser flow), the auth gate is proven at the
   integration layer, and determinism is proven by a byte-comparison, not a
   re-run heuristic.
2. **User concerns are first-class evidence.** Risks anchored in "the team
   is worried about X, and the failure would surface somewhere in `<area>`"
   carry the same weight as PRD lines or hot-spot data. Two of the top risks
   here (RLS leak in history, false-green RLS test) come straight from the
   interview, not the PRD.
3. **Risks are scenarios, not code locations.** This plan documents _what
   could fail_ and _why we believe it's likely_ — drawn from documents,
   interview, and codebase _signal_ (churn, structure, test base). It does
   NOT claim to know which line owns the failure. That knowledge is
   produced by `/10x-research` during each rollout phase. If the plan and
   research disagree about where the failure lives, research is the
   ground truth.

Hot-spot scope used for likelihood weighting: `src/`, `supabase/` (docs,
archive, and build output excluded).

## 2. Risk Map

The top failure scenarios this project must protect against, ordered by
risk = impact × likelihood. Risks are failure scenarios in user / business
terms, not test names. The Source column cites the _evidence that surfaced
this risk_ — never a specific file as "where the failure lives" (that is
research's job, see §1 principle #3).

| #   | Risk (failure scenario)                                                                                                                          | Impact | Likelihood | Source (evidence — not anchor)                                                                                                                                         |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------ | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | A signed-in user reads another account's evaluation-history contracts (cross-account leak)                                                       | High   | High       | PRD US-05 / FR-018 ("RLS-verified"), NFR (RLS per-operation/per-role); interview Q1; roadmap S-03 `proposed` (being built now)                                         |
| 2   | An RLS pgTAP test passes green while the policy is actually broken — a false safety net                                                          | High   | High       | interview Q2 (already happened); existing `supabase/tests/` suite                                                                                                      |
| 3   | The auth gate regresses — `/` or `POST /api/evaluate` stops redirecting / 401-ing unauthenticated callers, or loses redirect-target preservation | High   | Medium     | PRD FR-015 / US-03; hot-spot dir `src/pages/api/auth/` (8 commits/30d); interview Q3                                                                                   |
| 4   | The signin/signup form path breaks silently — bad-credential error not surfaced inline, or successful signin does not land on the gated target   | High   | High       | PRD US-03 AC ("errors surfaced in plain text, not silently swallowed"); interview Q3 + Q4; hot-spot dirs `src/components/auth/` (7), `src/pages/auth/` (7 commits/30d) |
| 5   | A persisted history contract is re-rendered on read instead of stored verbatim → not byte-identical after the pool is edited                     | Medium | Medium     | PRD FR-018 / FR-019, NFR (persisted contracts stay byte-identical)                                                                                                     |

Risk ordering note: R1 and R2 are the High × High pair and are protected
first. R4 is High × High on likelihood-of-active-churn but lower blast
radius than a data leak, so it follows the RLS work. R3 and R5 are real but
partly covered today (R3 by `middleware`/`redirect` integration tests; R5 by
the determinism test) — they are hardened, not bootstrapped.

Abuse / security lens: satisfied by R1 (authorization / IDOR-ownership — the
endpoint must check _this row is yours_, not merely _you are logged in_) and
R3 (access control — the gate is the security boundary; the unauthenticated
`POST /api/evaluate` → 401 case is the realizable abuse test). A speculative
"rate-limit bypass burns the OpenAI key" risk was considered and dropped:
no rate-limit feature exists, so a test would assert absent implementation;
the access-control half is captured in R3 instead.

### Risk Response Guidance

| Risk | What would prove protection                                                                                                                                    | Must challenge                                                                           | Context `/10x-research` must ground                                                              | Likely cheapest layer                                          | Anti-pattern to avoid                                                                                        |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| #1   | A second account's query for history returns zero rows; a cross-account write raises `42501`                                                                   | "User-lists RLS works ⇒ history RLS works" — history is a different, not-yet-built table | The S-03 history table's four policies and that the test runs _as the second authenticated user_ | integration (pgTAP)                                            | Running the test as table owner / service-role, which bypasses RLS entirely                                  |
| #2   | The RLS test _fails_ when its policy is dropped (negative control / mutation)                                                                                  | "Test is green ⇒ policy is correct"                                                      | Whether existing tests set `request.jwt.claims` / `auth.uid()` and switch role before asserting  | integration (pgTAP)                                            | Asserting only own-rows-visible without proving other-rows-invisible _and_ without proving the test can fail |
| #3   | Unauthenticated `GET /` → redirect to `/auth/signin` (target preserved); unauthenticated `POST /api/evaluate` → 401 JSON; authenticated request passes through | "Happy-path signin works ⇒ the gate works"                                               | The middleware protected-route contract and the 401-vs-redirect branch                           | integration                                                    | Happy-path-authenticated only; never exercising the unauthenticated branch                                   |
| #4   | Bad credentials render inline error text; a successful signin redirects to the original target                                                                 | "An endpoint test ⇒ the form path works"                                                 | The form submit → response → error-display / redirect wiring                                     | component / integration (auth endpoint mocked at the boundary) | Testing Supabase itself (Q5); deep-mocking internals; styling snapshots                                      |
| #5   | A stored contract read back is byte-identical, and stays identical after the pool is re-seeded or edited                                                       | "Verdict correct ⇒ stored blob correct"                                                  | Whether history stores the Markdown blob verbatim vs re-renders on read                          | integration / determinism                                      | Re-rendering on read; asserting against a fresh re-evaluation                                                |

## 3. Phased Rollout

Each row is a discrete rollout phase that will open its own change folder
via `/10x-new`. Status moves left-to-right through the values below; the
orchestrator updates Status as artifacts appear on disk.

| #   | Phase name                           | Goal (one line)                                                                                                               | Risks covered | Test types                            | Status        | Change folder                               |
| --- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- | ------------- | ------------------------------------- | ------------- | ------------------------------------------- |
| 1   | RLS test integrity + isolation proof | Make every RLS test provably fail when its policy is removed, and lock cross-account isolation on existing user-scoped tables | #2, #1        | integration (pgTAP, negative-control) | change opened | context/changes/testing-rls-test-integrity/ |
| 2   | Auth gate + signin/signup form path  | Prove the gate contract (redirect / 401 / target) holds and the form surfaces errors and redirects correctly                  | #3, #4        | integration + component               | not started   | —                                           |
| 3   | Evaluation-history coverage          | Prove history rows are per-account isolated and stored byte-identical                                                         | #1, #5        | integration (pgTAP) + integration     | not started   | —                                           |

Status vocabulary (fixed): `not started` → `change opened` → `researched` →
`planned` → `implementing` → `complete`.

Phase 3 note: R1 and R5 partly depend on S-03 (`proposed` in the roadmap, not
yet built). Phase 3's `/10x-research` step must confirm the history feature
exists before driving tests, or flag it as a build prerequisite. Phase 3
reuses the proven RLS-test pattern that Phase 1 establishes.

## 4. Stack

The classic test base for this project. AI-native tools (if any) carry a
`checked:` date so future readers can see which lines need re-verification.
Recommendations in this section are grounded in local manifests/configs plus
the MCP/tools actually exposed in the current session.

| Layer              | Tool                           | Version                      | Notes                                                                                                                    |
| ------------------ | ------------------------------ | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| unit + integration | Vitest                         | (per `package.json`)         | `npm test` → `vitest run`; 6 tests in `test/` (`determinism`, `evaluate`, `middleware`, `redirect`, `user-lists`, `log`) |
| DB / RLS           | pgTAP via Supabase CLI         | (per `supabase/config.toml`) | `npm run db:test` → `supabase test db`; 3 tests in `supabase/tests/`                                                     |
| component          | @testing-library/react + jsdom | none yet — see Phase 2       | Required for the signin/signup form path (R4); not currently installed                                                   |
| API mocking        | none yet — see Phase 2         | n/a                          | R4 form tests mock the auth endpoint at the boundary, not Supabase internals (respects §7)                               |
| e2e                | none                           | n/a                          | No Playwright; deliberately out of scope — RLS and gate are cheaper to prove below the browser                           |

**Stack grounding tools (current session):**

- Docs: none (no Context7 or framework docs MCP exposed) — relied on local `package.json`, `supabase/config.toml`, and existing test files; checked: 2026-06-08
- Search: built-in web search / fetch available — not needed; stack is fully determinable from local config; checked: 2026-06-08
- Runtime/browser: none (no Playwright MCP) — not used; no e2e layer in this rollout; checked: 2026-06-08
- Provider/platform: none (no Supabase or GitHub MCP exposed) — not used; RLS verified locally via `supabase test db`; checked: 2026-06-08

## 5. Quality Gates

The full set of gates that must pass before a change reaches production.
"Required for §3 Phase N" means the gate is enforced once that rollout phase
lands; before that, the gate is `planned`.

| Gate                        | Where                                   | Required?                                       | Catches                                                 |
| --------------------------- | --------------------------------------- | ----------------------------------------------- | ------------------------------------------------------- |
| lint + typecheck            | local + CI (`.github/workflows/ci.yml`) | required (already wired)                        | syntactic / type drift                                  |
| unit + integration (Vitest) | local + CI                              | required after §3 Phase 2                       | logic regressions in gate + form paths                  |
| RLS suite (pgTAP)           | local + CI                              | required after §3 Phase 1                       | cross-account data leaks; broken / false-green policies |
| determinism check           | local + CI                              | required (already wired via `determinism` test) | byte-identical output drift                             |

The pgTAP RLS suite already runs in CI via the `db` job in
`.github/workflows/ci.yml` (`supabase test db` + `supabase db lint --level
warning`) on every push and PR to master. Phase 1 of this rollout hardened it
with negative controls — each isolation assertion now provably fails when its
policy is broken. The only residual to make it strictly blocking is marking the
`db` job a required status check in GitHub branch protection, a repo setting
outside the git tree. No aspirational gates are listed — every row maps to an
existing test or a named rollout phase.

## 6. Cookbook Patterns

How to add new tests in this project. Each sub-section is filled in once the
relevant rollout phase ships; before that, it reads "TBD — see §3 Phase N."

### 6.1 Adding an RLS / pgTAP test

Every user-scoped table ships a pgTAP test under
`supabase/tests/<feature>.test.sql` that proves isolation in BOTH directions
AND proves the test itself can fail. The whole test runs inside `begin … rollback`.

**Positive assertions (isolation holds):**

- Seed two users in `auth.users`; insert one row each, spoofing each user's JWT
  with BOTH GUCs at every identity switch — `set local "request.jwt.claims"`
  (JSON) AND the legacy `set local "request.jwt.claim.sub"` — for image-version
  portability.
- `select` as user A returns exactly A's rows, B hidden (`results_eq … count = 1`).
- A cross-account write raises `42501` (`throws_ok(…, '42501')`).
- After `reset role`, the superuser sees all rows — confirms RLS (not data
  absence) is the filter.

**Negative control (the test can fail — closes R2):** prove each assertion is
causally bound to its policy by mutating the policy IN-TRANSACTION and showing
the behavior flip. Policy DDL is transactional (rolls back with the test) and
MUST run as the table OWNER — `reset role` to the superuser first; running
`alter/create policy` under `anon`/`authenticated` raises `must be owner of
table`.

- SELECT control: `alter policy "<t>_select_own" … using (true);` then re-assert
  user A now sees BOTH rows.
- INSERT control (42501 disambiguation): a missing grant and a WITH CHECK
  violation BOTH raise `42501`. Relax only the policy — `alter policy
"<t>_insert_own" … with check (true);` — leaving the GRANT intact, then show
  the previously-denied cross-account write now SUCCEEDS (`lives_ok`). That pins
  the denial to RLS, not a missing grant. If the table has `UNIQUE(user_id)`,
  target a THIRD seeded user (no row yet) so the relaxed write does not trip a
  unique violation (`23505`) instead of succeeding.

**Shared read-only tables (e.g. counterparties) — inverted control:** there is
no write policy by design, so invert the proof. As the owner, `grant insert` +
add a permissive insert policy in-txn, confirm the seeded read-path is unchanged
(anon still sees all seeded rows), and show the previously-`42501` write now
succeeds — proving the denial was the absent write policy.

Bump `select plan(N)` to the new assertion count, or pgTAP reports a plan
mismatch (not a per-assertion failure).

- Worked examples: `supabase/tests/rls_template.test.sql` (canonical four-policy
  template + both controls), `supabase/tests/user-lists.test.sql` (real
  user-scoped table; third-user trick for `UNIQUE(user_id)`),
  `supabase/tests/counterparties.test.sql` (inverted shared-read control).
- Run locally: `npm run db:test`. In CI the `db` job in
  `.github/workflows/ci.yml` runs `supabase test db` on every push/PR.

### 6.2 Adding an integration test for an API route / middleware

- TBD — see §3 Phase 2 (auth-gate contract: redirect, 401, target
  preservation).
- Existing references until then: `test/middleware.test.ts`,
  `test/redirect.test.ts`, `test/evaluate.test.ts`.
- Run locally: `npm test`.

### 6.3 Adding a component test for an auth form

- TBD — see §3 Phase 2 (form submit → inline error display → redirect, with
  the auth endpoint mocked at the boundary, not Supabase itself).

### 6.4 Adding a determinism test

- Pattern: assert byte-identical output for identical inputs; for persisted
  contracts, store-then-read-back and assert the blob is unchanged after the
  counterparty pool is edited.
- Reference test: `test/determinism.test.ts`.
- Run locally: `npm test`.

### 6.5 Per-rollout-phase notes

(Optional. After each phase lands, `/10x-implement` appends a 2–3 line note
here capturing anything surprising the phase taught.)

## 7. What We Deliberately Don't Test

Exclusions agreed during the rollout (Phase 2 interview, Q5). Future
contributors should respect these unless the underlying assumption changes.

- **Supabase's auth library itself** — sign-up/sign-in/session mechanics are
  the vendor's responsibility, not ours. Test _our_ wiring around it (gate,
  error display, redirect), and mock the auth endpoint at the boundary rather
  than reaching into Supabase internals. Re-evaluate if we fork or heavily
  customize the auth flow. (Source: Phase 2 interview Q5.)

## 8. Freshness Ledger

- Strategy (§1–§5) last reviewed: 2026-06-08
- Stack versions last verified: 2026-06-08
- AI-native tool references last verified: 2026-06-08

Refresh (`/10x-test-plan --refresh`) when:

- a new top-3 risk surfaces from the roadmap or archive,
- a recommended tool's `checked:` date is older than three months,
- the project's tech stack changes (new framework, new test runner),
- §7 negative-space no longer matches what the team believes.
