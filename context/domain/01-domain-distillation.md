---
artifact: "DDD · Step 1 — Strategic Domain Distillation (Ubiquitous Language)"
change_id: domain-modeling
date: 2026-06-17
sources: [context/foundation/prd.md, src/types.ts, src/lib/evaluator.ts, src/pages/api/evaluate.ts, src/lib/*.ts]
convention: "EVIDENCE = read at file:line · INFERENCE = deduced · UNKNOWN = not derivable from static reading"
---

# Strategic Domain Distillation

## STEP 0 recall (consistency gate)

Env re-checked GREEN (Colima on `/Volumes/KINGSTONE_SSD/.config/colima`; 9 Supabase containers
`Up`; `edge_runtime`/`vector`/`logflare` = 0). Prior context re-read for 100% consistency:
`context/map/repo-map.md` (L2), `context/archive/2026-06-11-evaluate-flow-analysis/` (L3),
`context/archive/2026-06-17-refactor-opportunities/` (L4). This artifact is L5 and reuses their
verified facts (36 src files, 0 cycles, evaluator.ts born 409→416 lines, double-catalog C2).

## Ubiquitous Language matrix

| Domain concept | Definition (canonical) | Where it lives in code | Naming match? | Tag |
| --- | --- | --- | --- | --- |
| **Operator** | The authenticated user running the evaluator against the shared pool. | No type; implicit as `locals.user.id` / `userId: string` (evaluate.ts:58, user-lists.ts:18) | ❌ narrative-only; anonymous in code | EVIDENCE (absence) |
| **Give-list / Want-list** | The operator's two freeform NL inputs. | `EvaluateRequest {give,want}` (types.ts:33); `user_lists.give_text/want_text` | ⚠️ split naming (`give` vs `give_text`) | EVIDENCE |
| **Standardized Item** | A freeform entry parsed to category/brand/size/condition/quantity/estimated_pln. | `StandardizedItem` (types.ts:3-11) | ✅ | EVIDENCE |
| **Unclassified Item** | An entry that matched no category, with a one-line reason (FR-004). | `UnclassifiedItem` (types.ts:13-16) | ✅ | EVIDENCE |
| **Processed List** | One side's items + unclassified + total_pln. | `ProcessedList` (types.ts:18-22) | ⚠️ anemic data bag, no behavior | EVIDENCE |
| **Pricing Catalog** | category → base PLN + condition multipliers; the valuation reference data. | `KEYWORD_MAP`/`CONDITION_MAP` literals (evaluator.ts:16-45) **and again** as prose in `LLM_SYSTEM` (evaluator.ts:129-130) | ❌ unnamed + duplicated (L4 / C2) | EVIDENCE |
| **Counterparty** | A parent in the shared, read-only seeded pool, with their own give/want. | `Counterparty` (types.ts:24-29); `public.counterparties` | ✅ | EVIDENCE |
| **Fixture / Counterparty / Valuation Pool** | The set of counterparties matched against. | `getCounterpartyPool` (counterparties.ts:22); PRD "fixture pool"; repo-map "valuation pool" | ❌ three names, one concept | EVIDENCE |
| **Match Candidate** | A counterparty with bidirectional category overlap + delta. | `MatchCandidate` (evaluator.ts:202-209); `findBestMatch` | ✅ | EVIDENCE |
| **Fairness Delta / Verdict / Threshold** | `abs(A−B)`; `FAIR` / `NEEDS BALANCING`; X% of the larger side's total. | `computeVerdict` (evaluator.ts:254); `Verdict` (types.ts:31); `threshold_pct` | ✅ | EVIDENCE |
| **Balancing Suggestion** | Item to drop from heavier side to reach FAIR (FR-010). | `balancingSuggestion` (evaluator.ts:261-284) | ✅ | EVIDENCE |
| **Barter Contract** | The CommonMark output naming counterparty, totals, verdict, appendix. | `renderContract` (evaluator.ts:331); `EvaluateResponse.contract` (types.ts:41) | ✅ | EVIDENCE |
| **Evaluation Source** | Which strategy produced the values: `llm` / `stub` / `llm-failed-fallback`. | `EvaluationSource` (types.ts:38); `Source` (evaluator.ts:169) | ⚠️ two definitions of same union | EVIDENCE |
| **Evaluation (record)** | A persisted, immutable history row (contract verbatim + verdict + delta + source). | `EvaluationHistoryItem` (types.ts:54); `saveEvaluation` (evaluation-history.ts:33) | ✅ | EVIDENCE |

### Ubiquitous-language mismatches (the actionable findings)

1. **The Pricing Catalog has no name and no home** → it got duplicated (the L4/C2 hotspot). A
   concept the domain clearly has, but the code never _names_, is the one that drifted. Textbook DDD
   symptom: missing language → structural defect.
2. **One pool, three names** (fixture / counterparty / valuation) — onboarding friction and a sign
   the bounded-context boundary was never drawn. (INFERENCE)
3. **The Operator is anonymous** — passed as a bare `userId: string` across four call sites; there
   is no `Operator` entity owning the give/want lists + history. (EVIDENCE: absence)
4. **`ProcessedList` is anemic** — a data bag with no guardian of its own conservation invariant
   (see Step 2). (EVIDENCE: types.ts:18 is a plain interface)
5. **`Source`/`EvaluationSource` is defined twice** (types.ts:38 and evaluator.ts:169) — minor, but
   the same disease as the catalog. (EVIDENCE)

## Subdomain classification

| Subdomain | Type | Rationale | Evidence |
| --- | --- | --- | --- |
| **Standardize → Value → Match → Fairness → Render pipeline** | **CORE** | The differentiator: "turns ambiguous prose into a comparable number and rules on whether the swap is balanced… without it the product is a poorly differentiated classifieds clone." | PRD §Business Logic:189 |
| Pricing Catalog (valuation reference data) | **Supporting** | Feeds Core valuation; product-specific but not the algorithm itself. | evaluator.ts:16-45 |
| Counterparty pool sourcing / persistence (lists, history) | **Supporting** | RLS-scoped storage; necessary, replaceable, not differentiating. | counterparties/user-lists/evaluation-history.ts |
| Authentication (Supabase email/password) | **Generic** | Commodity; bought, not built (starter scaffolding). | middleware.ts, supabase.ts; PRD FR-012..015 |
| Markdown/CommonMark rendering mechanics | **Generic** | Standard output format; no domain IP in the string-building. | evaluator.ts:286-364 |
| LLM SDK plumbing (`ai`, `@ai-sdk/openai`) | **Generic** | Interchangeable provider mechanics — the _strategy_ is Core, the _SDK_ is Generic. | evaluator.ts:1-2 |
| Structured logging | **Generic** | Cross-cutting infra. | log.ts, auth-log.ts |

**Core-domain protection principle:** the Core pipeline currently _imports Generic concerns
directly_ (LLM SDK at evaluator.ts:1-2). Steps 2–3 design the guardrails (an aggregate guardian for
the Core conservation invariant, and an ACL to keep Generic SDKs out of Core).

## Limits

- No code executed; classifications are static-reading judgments.
- "Operator anonymous" / "anemic ProcessedList" are design observations, not defects that fail any
  test today — the invariants hold _procedurally_, just without a structural guardian (Step 2).
