---
project: "ToySwapper"
version: 2
status: draft
created: 2026-05-21
updated: 2026-05-28
context_type: greenfield
product_type: web-app
target_scale:
  users: small
  qps: low
  data_volume: small
timeline_budget:
  mvp_weeks: 1
  hard_deadline: 2026-05-26
  after_hours_only: true
---

# ToySwapper — Product Requirements Document

## Vision & Problem Statement

A parent of young children (roughly ages 0–6) is constantly drowning in outgrown clothes, gear, and toys that are perfectly usable but no longer needed. They hit the wall when storage (basement, closet) is completely full and, at the same time, they have to spend a fortune on the next stage of their child's development. Today they waste hours photographing items and arguing on local Facebook exchange groups, OLX, or Vinted — places where people haggle aggressively, ghost each other, and it takes days of messaging just to agree whether a trade of "X for Y" is actually fair and worth the drive.

ToySwapper acts on the insight that the fairness question is solvable with structured data, not haggling. The pain isn't only coordination overhead — each item's true value (brand, age, size, condition) lives only in the owner's head, with nothing to standardize it. If both sides see the same standardized number for what's being offered, the negotiation collapses. Existing platforms don't do this because they're built for buyers-versus-sellers, not for parents who are simultaneously both at once.

## User & Persona

**Primary persona — Parent of young children (~0–6).** Lives with the steady accumulation of outgrown items in basement/closet storage while also facing recurring next-stage spending for the same child. They reach for ToySwapper at the specific moment those two pressures collide: storage is full AND a near-future purchase is looming. They are already aware of Facebook exchange groups, OLX, and Vinted but find the haggling, ghosting, and unanswered fairness question expensive in time and frustrating in outcome.

## Success Criteria

### Primary
- In one session, a user can paste a freeform give-list and a freeform want-list, and receive a Markdown barter contract that names one fixture-pool counterparty, lists the items each side gives, shows an estimated value per side, and stamps a fairness verdict (e.g., FAIR / NEEDS BALANCING). The match must respect both sides' wants: the counterparty's give-list must contain at least one item the operator wants, AND the operator's give-list must contain at least one item the counterparty wants.

### Secondary
- When the fairness delta between the two sides exceeds a threshold, the contract includes a balancing suggestion (e.g., "add one more item worth ~30 PLN to balance") rather than just stamping NEEDS BALANCING.

### Guardrails
- **Deterministic for the same inputs.** Same give-list + same want-list + same fixture pool produces the same contract every time. Fairness loses meaning if the verdict drifts run-to-run. (Engineering implication: any LLM call must run at temperature 0 with a seed, or be wrapped in a cache, or be replaceable with rule-based logic.)
- **No silent item drops.** Every input item must either appear in the output contract OR be listed explicitly in a "couldn't classify" section with a reason. The standardizer is not allowed to silently discard items it doesn't understand.

## User Stories

### US-01: Fair trade contract produced from matching lists

- **Given** the operator has pasted a freeform give-list and want-list, AND at least one counterparty in the fixture pool has a give-list containing an item the operator wants AND a want-list containing an item the operator gives
- **When** the operator runs the evaluator
- **Then** they see a Markdown barter contract naming the counterparty, listing each side's items with estimated values, both side-totals, the fairness delta, and a verdict of FAIR

#### Acceptance Criteria
- Output is valid Markdown — renders cleanly in any standard renderer with no broken structure
- Both side-totals are shown explicitly in PLN
- The fairness delta is shown as an absolute value with units (e.g., `Delta: 12 PLN`)
- Verdict reads exactly `FAIR` when delta ≤ the configured threshold
- Every input item from both sides is accounted for: either appears in the trade, in the counterparty's pool, or in the "couldn't classify" appendix
- Same inputs (same give-list + want-list + same fixture pool) produce byte-identical output on re-run

### US-02: Unbalanced trade flagged with a balancing suggestion

- **Given** the operator has pasted lists and the best counterparty match has a value delta that exceeds the FAIR threshold
- **When** the operator runs the evaluator
- **Then** they see a Markdown contract stamped `NEEDS BALANCING`, showing the delta and either a named balancing item (from the heavier side's give-list, or the lighter side's option to add) with its estimated value, or an explicit note that no balancing item is available

#### Acceptance Criteria
- Verdict reads exactly `NEEDS BALANCING` with the delta amount shown
- If a balancing item exists, it is named with its estimated PLN value and the side it comes from
- If no balancing item exists, the contract states "no balancing item available — manual negotiation required" in those words or close paraphrase
- Same inputs produce the same balancing suggestion on re-run (determinism guardrail)

### US-03: Authenticated access to the evaluator

- **Given** a visitor without a Supabase session
- **When** they navigate to `/` or POST to `/api/evaluate`
- **Then** they are redirected to `/auth/signin` and the evaluator does not run; the API endpoint returns HTTP 401

- **Given** a registered user on `/auth/signin`
- **When** they sign in with valid credentials
- **Then** they land on the evaluator and a session cookie is set; subsequent page loads stay signed in

- **Given** an authenticated user
- **When** they click "Sign out"
- **Then** the session cookie is cleared and they land on a public page

#### Acceptance Criteria
- Sign-up validates email format and password minimum length (Supabase defaults).
- Sign-in errors (wrong password, unconfirmed email) are surfaced in plain text on the form, not silently swallowed.
- `POST /api/evaluate` returns 401 with a JSON `{"error": "unauthorized"}` body when called without a session cookie.
- The redirect from a gated page to `/auth/signin` preserves the original target so post-sign-in lands the user back on the evaluator.

### US-04: Returning user's lists are restored

- **Given** an authenticated user who previously ran the evaluator and entered give/want strings
- **When** they return to `/` in a new session
- **Then** the give-list and want-list textareas are pre-filled with their last entered values

#### Acceptance Criteria
- Pre-fill survives sign-out and sign-back-in on the same account.
- A different signed-in account never sees another user's saved lists (RLS-verified).
- Saved lists are updated on every successful evaluation (the exact save point — every keystroke, on submit, or on successful eval — is settled in OQ-4 during implementation).
- An account that has never run the evaluator sees empty textareas (no error, no crash on the empty state).

### US-05: Authenticated user reviews their evaluation history

- **Given** an authenticated user who has run the evaluator at least once before
- **When** they navigate to the evaluation history page
- **Then** they see a list of past contracts (most recent first) with verdict, delta, counterparty name, threshold_pct, source, and timestamp visible per row

- **Given** the user clicks/expands a history row
- **When** the row opens
- **Then** the full Markdown contract is shown verbatim, byte-identical to the original

#### Acceptance Criteria
- Each user only sees their own history (RLS-verified — a second account's history is invisible).
- History rows survive sign-out and sign-back-in on the same account.
- The expanded contract is the exact Markdown that was originally generated and persisted — no re-rendering, no re-evaluation against the current fixture pool.
- Most-recent-first ordering is stable; entries with identical timestamps tie-break by insertion order (database row id).
- An account that has never run the evaluator sees an empty-state message, not a crash.

## Functional Requirements

### Input capture
- FR-001: User can paste a freeform give-list (multiple items, one per line or comma-separated, in natural language). Priority: must-have
  > Socrates: Counter-argument considered: "force a guided form instead — freeform is too sloppy for the standardizer." Resolution: kept as freeform. Freeform paste is what differentiates ToySwapper from a guided-form FB Marketplace clone; it's also the input shape the persona actually has (a basement full of mixed items they describe in prose).
- FR-002: User can paste a freeform want-list in the same format. Priority: must-have
  > Socrates: Counter-argument considered: "merge into one paste box; LLM splits give vs want." Resolution: kept as two separate inputs. Two paste boxes keep the prompt simple and reduce another LLM determinism surface; the user explicitly knowing which list is which avoids a class of misclassification errors.

### Standardization
- FR-003: System extracts structured attributes from each freeform item (category, brand if present, age/size if present, condition if present, quantity). Priority: must-have
  > Socrates: Counter-argument considered: "LLM extraction is non-deterministic — fights the determinism guardrail." Resolution: kept, but the determinism guardrail (Success Criteria → Guardrails) is binding: standardization must run at temperature 0 with a seed, or be wrapped in a cache, or fall back to rule-based parsing. The non-determinism risk is real and is the engineering's job to control.
- FR-004: System surfaces items it could not classify in an explicit "couldn't classify" list, with a one-line reason per item. Priority: must-have
  > Socrates: Counter-argument considered: "the reason field is feature creep; just list unclassified items." Resolution: kept with reasons. The reason makes the appendix actionable — the user can fix their input and retry — rather than a dead list of failures.

### Valuation
- FR-005: System estimates a market value (in PLN) for each standardized item. Priority: must-have
  > Socrates: Counter-argument considered: "LLM 'estimate' is hallucination dressed up — use a real price source." Resolution: kept as LLM estimate for MVP. The current user alternative (haggling) is also imperfect; an LLM estimate calibrated against fixture-pool spot-checks during implementation beats nothing. Real price sources (OLX/Vinted scraping) are a v2 question.
- FR-006: System computes the total estimated value for each side of a candidate trade. Priority: must-have
  > Socrates: Counter-argument considered: "sums hide item-level mismatches — a 200 PLN item swapped for 10x20 PLN items is equal in total but lopsided in practice." Resolution: kept as written; the item-level sanity check is captured in Open Questions for v2 resolution.

### Matching
- FR-007: System scans a hardcoded fixture pool of other parents (each with their own give-list + want-list) and identifies any counterparty whose give-list overlaps with the operator's want-list AND whose want-list overlaps with the operator's give-list. Priority: must-have
  > Socrates: Counter-argument considered: "overlap detection is itself a hard problem — does 'size 92 jacket' match 'winter coat for 3yo'? Semantic matching inherits all the standardizer's failures." Resolution: kept as written; the precise definition of "overlap" (string match, category-and-size match, or LLM semantic match) is captured in Open Questions to be resolved during implementation.
- FR-008: System selects one counterparty as the proposed trade (selection criterion: best fairness score, then most items matched). Priority: must-have
  > Socrates: Counter-argument considered: "single match is the right MVP scope — ranking is the secondary feature we already rejected." Resolution: confirms the FR as scoped. Returning one counterparty is consistent with the explicit decision not to ship ranked candidates as Secondary.

### Fairness verdict
- FR-009: System computes a fairness delta (|value_A − value_B|) and stamps a verdict (FAIR if delta ≤ X% of max(side_A_total, side_B_total), NEEDS BALANCING otherwise). The percentage X is configurable; default to be set during implementation. Priority: must-have
  > Socrates: Counter-argument considered: "a single absolute threshold is arbitrary — 10 PLN delta on a 50 PLN trade is huge, on a 500 PLN trade is nothing." Resolution: **FR REVISED.** Threshold is now relative: delta ≤ X% of the larger side's total. The absolute-threshold formulation is dropped.
- FR-010: When verdict is NEEDS BALANCING, system suggests a balancing item from the appropriate side's give-list (or notes that no balancing item is available). Priority: nice-to-have
  > Socrates: Counter-argument considered: "nice-to-have prioritization is correct — if the rest works, this falls out cheaply." Resolution: confirms the priority. No change to the FR.

### Output
- FR-011: System emits the proposal as a Markdown contract: who gives what, total values, fairness verdict, balancing suggestion if any, and an "unclassified items" appendix. Priority: must-have
  > Socrates: Counter-argument considered: "Markdown is a developer format, not a parent format — should be HTML or PDF." Resolution: kept as Markdown. Markdown is copy-pasteable to email/chat, deterministic, has no rendering dependency, and renders cleanly in every modern surface a parent would actually use (messaging apps, email clients, GitHub). Rendering to PDF/HTML is a downstream concern.

### Authentication (new in v2)

- FR-012: User can sign up with email and password via Supabase auth. Priority: must-have
- FR-013: User can sign in with email and password; the session is cookie-based and persists across page reloads. Priority: must-have
- FR-014: User can sign out; signing out clears the session cookie and redirects to the public landing page. Priority: must-have
- FR-015: The evaluator page (`/`) and the `POST /api/evaluate` endpoint are gated behind sign-in. Unauthenticated visitors hitting either are redirected to `/auth/signin`; `POST /api/evaluate` without a session returns HTTP 401. Priority: must-have

### Persistence (new in v2)

- FR-016: The authenticated user's most recent give-list and want-list are persisted to Postgres on each successful evaluation. On return to the evaluator page, the form is pre-filled with the saved values. Priority: must-have
- FR-017: The fixture pool of counterparties lives in a Postgres table seeded by a database migration. The evaluator reads counterparties from the database, not from the in-memory `src/lib/fixture-pool.ts` module. The module is deleted once the migration ships. Seeded counterparty rows must contain byte-identical fields to the v1 `FIXTURE_POOL` so existing evaluations remain reproducible. Priority: must-have

### Evaluation history (new in v2)

- FR-018: Each successful evaluation is persisted to Postgres as a history row containing: the contract Markdown verbatim, the verdict, the delta in PLN, the counterparty_id, the threshold_pct used, the source (`llm` | `stub` | `llm-failed-fallback`), and a server-generated timestamp. Rows are scoped per user via RLS. Priority: must-have
- FR-019: User can view their evaluation history as a list of past contracts, most recent first. Each row shows verdict, delta, counterparty name, threshold_pct, source, and timestamp; the row expands to show the full Markdown contract verbatim (byte-identical to the original). Priority: must-have

## Non-Functional Requirements

- User-perceived end-to-end response for a typical trade evaluation (one operator give-list, one want-list, fixture pool of ≤ ~10 counterparties) ≤ 5 seconds. Slower than chat-message reading time breaks the "this beats Facebook" premise.
- For the same inputs (same operator give-list, same operator want-list, same fixture pool), the system produces byte-identical Markdown output across separate runs. Restated as an outer-boundary property in addition to the Success Criteria guardrail because it's what the user can observe and verify directly.
- The output Markdown renders correctly in mainstream surfaces — email clients, chat apps, and code-hosting renderers (e.g., GitHub) — using only CommonMark features. No extension-specific syntax, no inline HTML, no required images or external assets.
- The system accepts item descriptions in both Polish and English (the persona's likely languages) and produces a valid contract in either case. Mixed-language inputs (some items Polish, some English) also produce a valid contract.
- All user-scoped Postgres tables enable Row-Level Security with explicit per-operation, per-role policies (`select`, `insert`, `update`, `delete`). No policy is `using (true)` without an audit comment explaining why. Per `CLAUDE.md` migration convention; load-bearing for the v2 multi-account guarantee in §Access Control.
- The determinism guardrail (byte-identical Markdown for identical inputs) is preserved across the v1 → v2 transition. The seeded counterparty table (FR-017) must contain byte-identical fields to the v1 `FIXTURE_POOL` so existing fixture-based evaluations remain reproducible. Schema migrations that change seeded counterparties are explicit determinism boundaries — note them in commit messages and in the determinism test suite.
- Persisted evaluation history rows (FR-018) store the contract Markdown as it was originally rendered, not as a re-render against the current counterparty table. Historical contracts must remain byte-identical to their original output even after the fixture pool is edited or extended.

## Business Logic

**ToySwapper transforms two parents' freeform descriptions of items they have and want into a fair-value barter contract, where "fair" means the standardized market values of both sides differ by less than a configurable percentage of the larger side's total.**

The rule consumes two user-facing inputs: the operator's give-list and the operator's want-list, both in freeform natural language. Its output is a single Markdown barter contract that names one counterparty from the fixture pool, lists each side's items with estimated values, shows both side-totals, computes a relative fairness delta, stamps a verdict (`FAIR` or `NEEDS BALANCING`), and — when the delta exceeds the configured percentage — optionally suggests a balancing item.

The user encounters the rule as a single end-to-end pass: paste two lists, run the evaluator, read the contract. The rule is what makes ToySwapper non-trivial: a generic listings site can match parents on overlapping interests, but only ToySwapper turns ambiguous prose ("LEGO Duplo box about 30 pieces") into a comparable number and rules on whether the resulting swap is balanced. Without that rule, the product is a poorly differentiated second-hand classifieds clone.

## Access Control

Each user signs in via Supabase email-and-password auth. The operator's give-list, want-list, and evaluation history are scoped per account via Postgres Row-Level Security policies — a user cannot read or write another user's rows. The fixture pool of counterparties is shared and read-only, seeded into the database via migration; in v2 it ceases to be a hardcoded module. There is still no multi-user interaction — every authenticated operator runs the evaluator against the shared fixture pool, not against other users' real lists.

*v1 framing (historical, lifted 2026-05-28):* Single session; no auth; no user separation. The Module 1 MVP ran entirely in one process and one perspective with a hardcoded fixture pool and no persistence between sessions. Preserved here so future readers can trace the v1 → v2 scope shift.

## Non-Goals

Locked from the seed (still load-bearing):

- **No multi-user chat.** The output is a Markdown contract, not a conversation. No messaging UI, no async coordination between parents.
- **No maps / geolocation.** No "find parents near me" feature. Distance is not part of the matching criterion.

Added during shaping (still load-bearing):

- **No image/photo input.** Item descriptions are typed text only. No OCR, no vision model, no upload UI.
- **No multi-party / chain trades.** Only bidirectional A↔B swaps. Chains (A→B→C→A) are out of scope; matching surfaces pairs only.
- **No real OLX/Vinted price scraping.** Valuations come from the LLM/rule layer only. Live price sources remain a v2.x+ question.
- **No user reputation / reviews / verification.** Every counterparty in the seeded fixture pool is treated as equally trustworthy; no ratings, no verification step.

Lifted in v2 (was load-bearing in v1):

- ~~**No database.**~~ Lifted 2026-05-28. State now persists in a Supabase Postgres database; see §Access Control for scoping. Rationale: v1's in-memory architecture is shipped and verified (live at `https://toy-swapper.mz-apps.workers.dev`); v2 enables the operator to resume their session and to migrate the counterparty fixture pool into seeded data.
- ~~**No authentication.**~~ Lifted 2026-05-28. v2 introduces Supabase email auth; the evaluator is gated behind sign-in. Rationale: persistence is meaningless without identity, and the starter's Supabase auth scaffolding (`src/middleware.ts`, `src/pages/auth/*`, `src/lib/supabase.ts`) is already in place — using it costs less than keeping it idle.

## Open Questions

1. **Item-level fairness sanity check.** Should the fairness verdict include an item-level check that rejects trades where one side's single largest item dwarfs the other side's largest by more than Nx (even if totals match)? Owner: user. Captured from FR-006 Socrates round; v2 decision.
2. **Definition of "overlap" in matching.** How does the system decide whether a fixture-pool item matches a want-list entry — strict category-and-size rule, fuzzy string match, or LLM semantic judgment? Owner: user (resolve during implementation). Captured from FR-007 Socrates round; load-bearing for determinism.
3. **Default percentage threshold for FAIR verdict.** What value of X% in `delta ≤ X% of max(side_total)` is the right default? (e.g., 15%, 20%, 25%) Owner: user; set during implementation, may need fixture-pool calibration. *Note (2026-05-28):* the v1 implementation defaulted to 20% via `FAIRNESS_THRESHOLD_PCT` env var; treat that as a provisional answer that v2 verification should validate, not as a closed decision.
4. **Save granularity for give/want lists (FR-016).** Should the give-list / want-list persist on every keystroke (debounced), on form submit, or only on a successful evaluation? Owner: user; decide during implementation of FR-016. Load-bearing for UX (debounced typing → more DB writes; on-eval → user loses unsaved typing on tab close).
5. **Anonymous demo path.** Should there be a public, unauthenticated demo route that exercises the evaluator against a curated read-only example (no save, no history), to lower the trial barrier for new visitors who haven't signed up? Owner: user; v2.x scope decision. If "yes" — FR-015 needs an exception; if "no" — the v1 public URL becomes auth-gated and visitors must sign up first.
6. **Fixture-pool admin.** Once the fixture pool lives in the database, does the operator gain the ability to add / edit their own counterparties (turning ToySwapper into a real two-sided market) — or does the table stay seeded-and-read-only? Owner: user; load-bearing for v3 scope. If "yes" — auth posture shifts from per-user storage to per-user content authorship and RLS policies change accordingly.
