<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Evaluation History (S-03)

- **Plan**: context/changes/evaluation-history/plan.md
- **Scope**: Phases 1–3 of 3 (full plan)
- **Date**: 2026-06-02
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 4 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Automated criteria re-run live: `npm test` 42/42; `npm run lint` clean; `npm run db:test` PASS post-reset (28 tests); `npm run build` green (during implementation).

## Findings

### F1 — Topbar.astro nav link may be on a dead component

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: src/components/Topbar.astro:16-18
- **Detail**: The plan directed adding a /history link to Topbar.astro (done correctly), but the live pages (index.astro, history.astro) render their own inline nav and do not import Topbar. No current page imports Topbar, so this edit may target an unrendered component. Plan-adherent and harmless.
- **Fix**: Leave as-is (satisfies the plan). Optionally confirm whether Topbar is wired anywhere; if not, it's pre-existing dead code unrelated to this change.
- **Decision**: SKIPPED

### F2 — delta_pln stored as numeric; history pill uses DB value, live pill uses JS number

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/history.astro:107, src/lib/evaluations.ts:8
- **Detail**: delta_pln is `numeric`; PostgREST can serialize numeric as a string. The history pill interpolates the DB value while the live evaluator pill uses a JS number. Today the evaluator only emits integer-valued deltas, so both render identically. Affects only the summary pill, NOT the contract — the contract Markdown is stored/shown verbatim, so byte-identity/determinism is unaffected.
- **Fix**: No action needed now. If a future evaluator emits fractional deltas, normalize formatting so the history pill matches the live pill.
- **Decision**: SKIPPED

### F3 — pgTAP superuser assertion uses an absolute global count

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: supabase/tests/evaluations.test.sql:123-125
- **Detail**: The sanity test asserts `select count(*) from public.evaluations == 2` globally, which holds only against a freshly-reset DB. Manual verification populated the local table, making it report a higher count and fail transiently. NOT introduced by this change — the sibling user-lists.test.sql uses the identical absolute-count pattern, and the documented workflow is `db reset` before `db:test`. Confirmed green after reset.
- **Fix**: Leave as-is for consistency with the sibling. Optionally scope the count to the two test user_ids for dirty-DB idempotency (cross-cutting change to both tests; out of scope here).
- **Decision**: SKIPPED

### F4 — EvaluationInput.source/verdict typed looser than the evaluator's unions

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/lib/evaluations.ts:4-11
- **Detail**: EvaluationInput.source is `string` and verdict is `string | null`, looser than the evaluator's union types. The DB CHECK constraint (source in 'llm'|'stub'|'llm-failed-fallback') is the real guard; an out-of-domain insert fails and is swallowed by the best-effort try/catch. Acceptable; tightening is a nicety.
- **Fix**: Optionally narrow `source` to the evaluator's union type for compile-time safety.
- **Decision**: FIXED — added `EvaluationSource` named type in src/types.ts; narrowed `verdict`/`source` to `Verdict`/`EvaluationSource` across EvaluationInput, EvaluationHistoryRow, and the internal EvaluationRow in src/lib/evaluations.ts. lint + 42 tests + build green.
