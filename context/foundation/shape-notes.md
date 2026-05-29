---
project: "ToySwapper"
context_type: greenfield
created: 2026-05-20
updated: 2026-05-20
product_type: web-app
target_scale:
  users: small
  qps: low
  data_volume: small
timeline_budget:
  mvp_weeks: 1
  hard_deadline: 2026-05-26
  after_hours_only: true
checkpoint:
  current_phase: 8
  phases_completed: [1, 2, 3, 4, 5, 6, 7]
  gray_areas_resolved:
    - topic: "pain category"
      decision: "Primary: fairness paralysis. Co-existing: coordination overhead, data-trapped value."
    - topic: "core insight"
      decision: "Fairness is solvable with structured data, not haggling — if both sides see the same standardized number, negotiation collapses."
    - topic: "persona scope"
      decision: "Individuals, broad geography — any parent of a 0–6 child. Matching does the work of finding overlap."
    - topic: "access control (MVP)"
      decision: "N/A — single session, no auth, no separation. Matches seed's NO-auth constraint."
    - topic: "identity model (MVP)"
      decision: "Single-user perspective. The user pastes their own give-list and want-list; evaluator runs against a hardcoded/fixture pool of 'other parents' generated for the demo."
    - topic: "MVP timeline"
      decision: "1 week, after-hours only. Three-week ceiling not approached; no Timeline acknowledgment needed."
    - topic: "secondary success"
      decision: "Balancing suggestions when fairness delta exceeds threshold."
    - topic: "guardrails"
      decision: "Deterministic for same inputs; no silent item drops."
  frs_drafted: 11
  quality_check_status: accepted
---

# ToySwapper — Shape Notes

## Seed idea

> I want to build ToySwapper. It is a peer-to-peer platform for parents to exchange used children's toys and clothes. The core business logic for this Module 1 MVP is an "Intelligent Trade Package Evaluator" that reads raw descriptions of items a parent wants to give away, standardizes them, estimates market value, and matches them against what they are looking for to create a fair barter contract in Markdown.
>
> Non-Goals for this week: NO database, NO auth, NO multi-user chat, NO maps. Everything runs in-memory.

## Vision & Problem Statement

A parent of young children (roughly ages 0–6) is constantly drowning in outgrown clothes, gear, and toys that are perfectly usable but no longer needed. They hit the wall when storage (basement, closet) is completely full and, at the same time, they have to spend a fortune on the next stage of their child's development. Today they waste hours photographing items and arguing on local Facebook exchange groups, OLX, or Vinted — places where people haggle aggressively, ghost each other, and it takes days of messaging just to agree whether a trade of "X for Y" is actually fair and worth the drive.

ToySwapper acts on the insight that the fairness question is solvable with structured data, not haggling. The pain isn't only coordination overhead — each item's true value (brand, age, size, condition) lives only in the owner's head, with nothing to standardize it. If both sides see the same standardized number for what's being offered, the negotiation collapses. Existing platforms don't do this because they're built for buyers-versus-sellers, not for parents who are simultaneously both at once.

## User & Persona

**Primary persona — Parent of young children (~0–6).** Lives with the steady accumulation of outgrown items in basement/closet storage while also facing recurring next-stage spending for the same child. They reach for ToySwapper at the specific moment those two pressures collide: storage is full AND a near-future purchase is looming. They are already aware of Facebook exchange groups, OLX, and Vinted but find the haggling, ghosting, and unanswered fairness question expensive in time and frustrating in outcome.

## Access Control

Single session; no auth; no user separation. The Module 1 MVP runs entirely in one process and one perspective: a single user (the operator) supplies their own give-list and want-list, and the evaluator searches a hardcoded fixture pool of "other parents" (each with their own give/want bundle) to surface fair barter candidates. No persistence between sessions; identity is conceptual, not authenticated. Roles are flat — there is only the operator and the fixture pool they evaluate against.

## Success Criteria

### Primary
- In one session, a user can paste a freeform give-list and a freeform want-list, and receive a Markdown barter contract that names one fixture-pool counterparty, lists the items each side gives, shows an estimated value per side, and stamps a fairness verdict (e.g., FAIR / NEEDS BALANCING). The match must respect both sides' wants: the counterparty's give-list must contain at least one item the operator wants, AND the operator's give-list must contain at least one item the counterparty wants.

### Secondary
- When the fairness delta between the two sides exceeds a threshold, the contract includes a balancing suggestion (e.g., "add one more item worth ~30 PLN to balance") rather than just stamping NEEDS BALANCING.

### Guardrails
- **Deterministic for the same inputs.** Same give-list + same want-list + same fixture pool produces the same contract every time. Fairness loses meaning if the verdict drifts run-to-run. (Engineering implication: any LLM call must run at temperature 0 with a seed, or be wrapped in a cache, or be replaceable with rule-based logic.)
- **No silent item drops.** Every input item must either appear in the output contract OR be listed explicitly in a "couldn't classify" section with a reason. The standardizer is not allowed to silently discard items it doesn't understand.

## Timeline budget

- MVP weeks: 1
- After-hours only: yes
- Hard deadline: 2026-05-26 (end of week, accepted per seed's "this week" framing)

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

## Business Logic

**ToySwapper transforms two parents' freeform descriptions of items they have and want into a fair-value barter contract, where "fair" means the standardized market values of both sides differ by less than a configurable percentage of the larger side's total.**

The rule consumes two user-facing inputs: the operator's give-list and the operator's want-list, both in freeform natural language. Its output is a single Markdown barter contract that names one counterparty from the fixture pool, lists each side's items with estimated values, shows both side-totals, computes a relative fairness delta, stamps a verdict (`FAIR` or `NEEDS BALANCING`), and — when the delta exceeds the configured percentage — optionally suggests a balancing item.

The user encounters the rule as a single end-to-end pass: paste two lists, run the evaluator, read the contract. The rule is what makes ToySwapper non-trivial: a generic listings site can match parents on overlapping interests, but only ToySwapper turns ambiguous prose ("LEGO Duplo box about 30 pieces") into a comparable number and rules on whether the resulting swap is balanced. Without that rule, the product is a poorly differentiated second-hand classifieds clone.

## Non-Functional Requirements

- User-perceived end-to-end response for a typical trade evaluation (one operator give-list, one want-list, fixture pool of ≤ ~10 counterparties) ≤ 5 seconds. Slower than chat-message reading time breaks the "this beats Facebook" premise.
- For the same inputs (same operator give-list, same operator want-list, same fixture pool), the system produces byte-identical Markdown output across separate runs. Restated as an outer-boundary property in addition to the Success Criteria guardrail because it's what the user can observe and verify directly.
- The output Markdown renders correctly in mainstream surfaces — email clients, chat apps, and code-hosting renderers (e.g., GitHub) — using only CommonMark features. No extension-specific syntax, no inline HTML, no required images or external assets.
- The system accepts item descriptions in both Polish and English (the persona's likely languages) and produces a valid contract in either case. Mixed-language inputs (some items Polish, some English) also produce a valid contract.

## Non-Goals

Locked from the seed (load-bearing):

- **No database.** All state lives in memory for the duration of one session. No persistence, no schema, no migrations. Forces the architecture toward pure functions over fixture data.
- **No authentication.** Single session, single operator perspective. No login, no signup, no user accounts.
- **No multi-user chat.** The output is a Markdown contract, not a conversation. No messaging UI, no async coordination between parents.
- **No maps / geolocation.** No "find parents near me" feature. Distance is not part of the matching criterion.

Added during shaping:

- **No image/photo input.** Item descriptions are typed text only. No OCR, no vision model, no upload UI. Keeps standardization scope tractable for one week.
- **No multi-party / chain trades.** Only bidirectional A↔B swaps. Chains (A→B→C→A) are explicitly out of scope; matching surfaces pairs only.
- **No real OLX/Vinted price scraping.** Valuations come from the LLM/rule layer only. Live price sources are a v2 question; the MVP does not try to ground prices in real listings.
- **No user reputation / reviews / verification.** The MVP does not model trust between parents. Every fixture-pool counterparty is treated as equally trustworthy; no ratings, no verification step.

## Open Questions

1. **Item-level fairness sanity check.** Should the fairness verdict include an item-level check that rejects trades where one side's single largest item dwarfs the other side's largest by more than Nx (even if totals match)? Owner: user. Captured from FR-006 Socrates round; v2 decision.
2. **Definition of "overlap" in matching.** How does the system decide whether a fixture-pool item matches a want-list entry — strict category-and-size rule, fuzzy string match, or LLM semantic judgment? Owner: user (resolve during implementation). Captured from FR-007 Socrates round; load-bearing for determinism.
3. **Default percentage threshold for FAIR verdict.** What value of X% in `delta ≤ X% of max(side_total)` is the right default? (e.g., 15%, 20%, 25%) Owner: user; set during implementation, may need fixture-pool calibration.

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
