---
project: ToySwapper
version: 1
status: draft
created: 2026-05-29
updated: 2026-06-01
prd_version: 2
main_goal: quality
top_blocker: decisions
---

# Roadmap: ToySwapper

> Derived from `context/foundation/prd.md` (v2) + auto-researched codebase baseline.
> Edit-in-place; archive when superseded.
> Slices below are listed in dependency order. The "At a glance" table is the index.

## Vision recap

ToySwapper turns two parents' freeform descriptions of items they have and want into a fair-value barter contract — a Markdown document that names one counterparty from a seeded pool, lists each side's items with estimated PLN values, and stamps a fairness verdict. v1 shipped this end-to-end in-memory and is live in production. v2 extends v1 with authenticated identity, so the operator's give-list and want-list persist across sessions and a per-account evaluation history becomes browsable. The v2 thesis: persistence is meaningless without identity, and the starter's Supabase auth scaffolding is cheaper to wire up than to keep idle.

## North star

**S-02: Returning user's lists are restored** — the smallest end-to-end slice that proves the v2 hypothesis. "North star" here means the validation milestone — the slice whose successful delivery would prove the core product hypothesis, placed as early as Prerequisites allow because everything else only matters if this works. For v2, that slice is US-04: an authenticated user re-opens the evaluator and finds their last-entered give/want lists still there, scoped by RLS to their account only.

## At a glance

| ID | Change ID | Outcome (user can …) | Prerequisites | PRD refs | Status |
|---|---|---|---|---|---|
| F-01 | postgres-rls-baseline | (foundation) Postgres reachable from the Workers runtime, first migration shipped, RLS contract for user-scoped tables documented | — | NFR (RLS), FR-016, FR-018 | done |
| F-02 | seed-counterparty-pool | (foundation) counterparty pool lives in a seeded Postgres table; evaluator reads from DB; `src/lib/fixture-pool.ts` deleted; v1 determinism preserved byte-identically | F-01 | FR-007, FR-017, NFR (determinism preserved across v1→v2) | done |
| F-03 | structured-logging-baseline | (foundation) API routes emit structured logs for auth events, RLS denials, evaluator success/failure; errors observable in production | — | NFR (quality bias) | done |
| S-01 | gated-evaluator | sign in / sign out, and have `/` plus `POST /api/evaluate` gated behind a session | F-03 | US-03, FR-012, FR-013, FR-014, FR-015 | done |
| S-02 | restore-saved-lists | return to the evaluator in a new session and find their last give/want lists pre-filled, scoped to their account | F-01, S-01 | US-04, FR-016 | done |
| S-03 | evaluation-history | browse a list of their past contracts (most recent first), expand any row to see the original Markdown verbatim | F-01, F-02, S-01 | US-05, FR-018, FR-019 | proposed |

## Streams

Navigation aid — groups items that share a Prerequisites chain. Canonical ordering still lives in the dependency graph below; this table is the proposed reading order across parallel tracks.

| Stream | Theme | Chain | Note |
|---|---|---|---|
| A | Data + persistence | `F-01` → `F-02` → `S-02` → `S-03` | The Postgres-and-RLS spine; `S-02` joins Stream B at `S-01` (needs the gate). Carries the north star. |
| B | Auth gate + observability | `F-03` → `S-01` | Observability lands before the gate so RLS denials are observable from the first authenticated request. Joins Stream A via `S-02` and `S-03`. |

## Baseline

What's already in place in the codebase as of `2026-05-29` (auto-researched + user-confirmed).
Foundations below assume these are present and do NOT re-scaffold them.

- **Frontend:** present — Astro 6 + React 19 + Tailwind 4 (per `tech-stack.md`); `src/pages/index.astro`, `src/pages/dashboard.astro`, and `src/pages/auth/*.astro` wired.
- **Backend / API:** present — Astro SSR API routes; `src/pages/api/evaluate.ts` is the v1 evaluator (Vercel-AI-SDK-based, with deterministic stub fallback); `src/pages/api/auth/{signin,signup,signout}.ts` from the starter.
- **Data:** absent — `supabase/` contains only `config.toml`; `supabase/migrations/` does not exist. v1 state is in-memory over `src/lib/fixture-pool.ts`. v2 must-haves (FR-016/017/018) require a Postgres schema.
- **Auth:** partial — Supabase auth scaffold present (`src/middleware.ts`, `src/lib/supabase.ts`, `src/pages/auth/*`, `src/pages/api/auth/*`), but `PROTECTED_ROUTES = ["/dashboard"]` only — `/` and `/api/evaluate` are NOT gated. FR-015 closes that gap.
- **Deploy / infra:** present — Cloudflare Workers via `@astrojs/cloudflare` + `wrangler ^4.90`; v1 live at `https://toy-swapper.mz-apps.workers.dev`.
- **Observability:** absent — only a single `console.warn` in `src/lib/evaluator.ts`; no structured logger, no Sentry / OTel / Datadog.
- **CI:** present — `.github/workflows/ci.yml` runs lint + build on push/PR to master with `SUPABASE_URL`/`SUPABASE_KEY` secrets wired.
- **v1 features shipped:** US-01, US-02, FR-001 through FR-011 are present in production. This roadmap covers only the v2 additions; the v1 surface is not re-planned.

## Foundations

### F-01: Postgres + RLS baseline

- **Outcome:** (foundation) Postgres is reachable from the Cloudflare Workers runtime; `supabase/migrations/` exists with the first migration shipped; the RLS contract for user-scoped tables (per-operation, per-role policies with no `using (true)` bypass) is documented and enforced.
- **Change ID:** postgres-rls-baseline
- **PRD refs:** NFR ("All user-scoped Postgres tables enable Row-Level Security with explicit per-operation, per-role policies"), FR-016, FR-018, §Access Control
- **Unlocks:** F-02 (needs a Postgres table to seed), S-02 (give/want list persistence rides on this RLS contract), S-03 (history rows ride on this RLS contract), plus the named verification path "RLS denial is observable in prod" used by every downstream slice
- **Prerequisites:** —
- **Parallel with:** F-03
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Sequenced first because every persistence slice depends on it AND because quality bias makes the RLS contract the load-bearing safety property. Risk: getting the RLS policy shape wrong here forces re-migrations later; mitigated by landing only the cross-cutting policy template first and per-table migrations in their owning slice.
- **Status:** done

### F-02: Counterparty pool migrated to seeded table

- **Outcome:** (foundation) counterparties live in a Postgres table seeded by a database migration with byte-identical fields to the v1 `FIXTURE_POOL`; the evaluator reads counterparties from the database, not from `src/lib/fixture-pool.ts`; the module is deleted; v1 determinism is preserved (same operator inputs produce byte-identical Markdown contracts).
- **Change ID:** seed-counterparty-pool
- **PRD refs:** FR-007 (matching reads from the new source-of-truth), FR-017, NFR (determinism preserved across v1→v2; schema migrations that change seeded counterparties are explicit determinism boundaries)
- **Unlocks:** S-03 (`history.counterparty_id` only exists once the counterparty table exists), plus the named verification path "v1 fixture-pool determinism test re-passes after the read flip"
- **Prerequisites:** F-01
- **Parallel with:** F-03, S-01 (S-01 doesn't touch the data layer)
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Sequenced before S-03 because history rows reference `counterparty_id`. Risk: silent drift between the seeded rows and the v1 module breaks determinism; mitigated by a determinism regression test that runs the v1 fixture-based evaluations against the new read path before deleting the module.
- **Status:** done

### F-03: Structured logging baseline

- **Outcome:** (foundation) API routes emit structured logs (request id, route, user id when known, outcome) for auth events, RLS denials, and evaluator success/failure; errors are observable in production via the chosen sink.
- **Change ID:** structured-logging-baseline
- **PRD refs:** NFR (quality bias from §Success Criteria → Guardrails; informs verifiability of RLS NFR)
- **Unlocks:** S-01 (auth/redirect/401 events become observable), plus the named verification path "RLS denial is observable in prod" required by S-02 and S-03
- **Prerequisites:** —
- **Parallel with:** F-01, F-02
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Promoted to a foundation (instead of folded into the first slice) because main_goal is quality and observability is genuinely cross-cutting. Risk: scope drift into a full APM build; mitigated by keeping this to structured `console.log` JSON shapes plus one error capture, deferring richer tooling to a later iteration if needed.
- **Status:** done

## Slices

### S-01: Authenticated access to the evaluator

- **Outcome:** user can sign up, sign in, and sign out; `/` and `POST /api/evaluate` are gated behind a session (redirect to `/auth/signin` for the page, HTTP 401 JSON for the API); the post-sign-in redirect preserves the original target.
- **Change ID:** gated-evaluator
- **PRD refs:** US-03, FR-012, FR-013, FR-014, FR-015
- **Prerequisites:** F-03
- **Parallel with:** F-01, F-02
- **Blockers:** —
- **Unknowns:**
  - OQ-5 (anonymous demo path): if yes, FR-015 needs an exception route and S-01's gating shape changes; if no, the v1 public URL goes fully gated. Owner: user. Block: yes.
- **Risk:** Promoted before S-02 because the north star requires an authenticated session to write user-scoped rows. Risk: OQ-5 resolved late forces a re-architecture of the gating; mitigated by surfacing it as the per-slice unknown and not pre-deciding.
- **Status:** done

### S-02: Returning user's lists are restored — **north star**

- **Outcome:** user can return to the evaluator in a new session (after sign-out and sign-back-in) and find their last-entered give-list and want-list pre-filled; a different signed-in account never sees another user's saved lists; an account that has never run the evaluator sees empty textareas with no error.
- **Change ID:** restore-saved-lists
- **PRD refs:** US-04, FR-016, NFR (RLS scoping, multi-account isolation)
- **Prerequisites:** F-01, S-01
- **Parallel with:** F-02 (F-02 doesn't gate this slice; only S-03 needs F-02)
- **Blockers:** —
- **Unknowns:**
  - OQ-4 (save granularity — every keystroke debounced vs on submit vs on successful eval): determines the write path and the user-visible "did my draft survive a tab close" property. Owner: user. Block: yes.
- **Risk:** This is the validation milestone — first slice to exercise RLS write+read on user-scoped data end-to-end. Risk: OQ-4 resolved as "on every keystroke" inflates write load and changes the schema choice (state vs event row); mitigated by treating OQ-4 as a hard blocker rather than guessing.
- **Status:** done

### S-03: Evaluation history

- **Outcome:** user can browse a list of their past contracts (most recent first; per row: verdict, delta, counterparty name, threshold_pct, source, timestamp); expanding a row shows the full Markdown contract verbatim, byte-identical to the original; each user only sees their own history; a never-ran account sees an empty state, not a crash.
- **Change ID:** evaluation-history
- **PRD refs:** US-05, FR-018, FR-019, NFR (persisted contracts remain byte-identical even after the fixture pool is edited)
- **Prerequisites:** F-01, F-02, S-01
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Sequenced after S-02 because S-02 is the cheaper RLS-on-user-data validation. Risk: the byte-identical-after-fixture-edits NFR is easy to violate by storing structured data and re-rendering on read; mitigated by storing the Markdown blob verbatim per FR-018 and verifying with a re-seed determinism test.
- **Status:** proposed

## Backlog Handoff

| Roadmap ID | Change ID | Suggested issue title | Ready for `/10x-plan` | Notes |
|---|---|---|---|---|
| F-01 | postgres-rls-baseline | Land Postgres + RLS baseline | yes | Run `/10x-plan postgres-rls-baseline` |
| F-02 | seed-counterparty-pool | Migrate counterparty pool to seeded Postgres table | no | Prereq F-01 not yet done |
| F-03 | structured-logging-baseline | Wire structured logging for API routes | yes | Run `/10x-plan structured-logging-baseline` |
| S-01 | gated-evaluator | Gate `/` and `/api/evaluate` behind Supabase auth | no | Blocked on OQ-5 (anonymous demo path) |
| S-02 | restore-saved-lists | Persist and restore user's give/want lists | no | Blocked on OQ-4 (save granularity) + prereqs |
| S-03 | evaluation-history | Persist evaluations and surface history list | no | Prereqs F-01, F-02, S-01 not yet done |

## Open Roadmap Questions

1. **Item-level fairness sanity check (PRD OQ-1).** Should the fairness verdict include an item-level check that rejects trades where one side's single largest item dwarfs the other side's by more than Nx (even if totals match)? Owner: user. Block: roadmap-wide (would add a new slice if adopted; v2.x decision).
2. **Definition of "overlap" in matching (PRD OQ-2).** Strict category-and-size rule, fuzzy string match, or LLM semantic judgment? Owner: user (resolve during implementation). Block: F-02 (the read-source flip preserves whatever the current overlap rule is — does v2 want to change it?). Not currently planning-blocking; flagged because it sits underneath F-02's determinism guarantee.
3. **Default percentage threshold for FAIR verdict (PRD OQ-3).** v1 defaults to 20% via `FAIRNESS_THRESHOLD_PCT`. Should v2 close this as 20% or revisit? Owner: user. Block: none (current value is a defensible default).
4. **Fixture-pool admin (PRD OQ-6).** Once the fixture pool is in the database, does the operator gain the ability to add / edit their own counterparties? Owner: user. Block: roadmap-wide for v3 scope (would shift RLS posture from per-user storage to per-user content authorship).

## Parked

- **No multi-user chat** — Why parked: PRD §Non-Goals (locked from seed). The output is a Markdown contract, not a conversation.
- **No maps / geolocation** — Why parked: PRD §Non-Goals (locked from seed). Distance is not part of the matching criterion.
- **No image / photo input** — Why parked: PRD §Non-Goals (added during shaping). Item descriptions are typed text only; no OCR, no vision model, no upload UI.
- **No multi-party / chain trades** — Why parked: PRD §Non-Goals. Only bidirectional A↔B swaps; matching surfaces pairs only.
- **No real OLX / Vinted price scraping** — Why parked: PRD §Non-Goals. Valuations come from the LLM / rule layer only.
- **No user reputation / reviews / verification** — Why parked: PRD §Non-Goals. Every counterparty in the seeded fixture pool is treated as equally trustworthy.

## Done

(Empty on first generation. `/10x-archive` appends an entry here — and flips that item's `Status` to `done` — when a change whose `Change ID` matches the item is archived.)

- **F-01: (foundation) Postgres reachable from the Workers runtime, first migration shipped, RLS contract for user-scoped tables documented and enforced** — Archived 2026-05-30 → `context/archive/2026-05-29-postgres-rls-baseline/`. Lesson: —.
- **F-02: (foundation) counterparties live in a Postgres table seeded by a database migration with byte-identical fields to the v1 `FIXTURE_POOL`; the evaluator reads counterparties from the database, not from `src/lib/fixture-pool.ts`; the module is deleted; v1 determinism is preserved (same operator inputs produce byte-identical Markdown contracts).** — Archived 2026-05-30 → `context/archive/2026-05-30-seed-counterparty-pool/`. Lesson: —.
- **F-03: (foundation) API routes emit structured logs (request id, route, user id when known, outcome) for auth events, RLS denials, and evaluator success/failure; errors are observable in production via the chosen sink.** — Archived 2026-05-31 → `context/archive/2026-05-31-structured-logging-baseline/`. Lesson: —.
- **S-01: user can sign up, sign in, and sign out; `/` and `POST /api/evaluate` are gated behind a session (redirect to `/auth/signin` for the page, HTTP 401 JSON for the API); the post-sign-in redirect preserves the original target.** — Archived 2026-06-01 → `context/archive/2026-05-31-gated-evaluator/`. Lesson: —.
- **S-02: user can return to the evaluator in a new session (after sign-out and sign-back-in) and find their last-entered give-list and want-list pre-filled; a different signed-in account never sees another user's saved lists; an account that has never run the evaluator sees empty textareas with no error.** — Archived 2026-06-01 → `context/archive/2026-06-01-restore-saved-lists/`. Lesson: —.
