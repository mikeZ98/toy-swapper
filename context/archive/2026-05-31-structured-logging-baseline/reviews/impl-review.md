<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Structured Logging Baseline (F-03)

- **Plan**: context/changes/structured-logging-baseline/plan.md
- **Scope**: All 3 phases
- **Date**: 2026-05-31
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 4 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — Unplanned helper file + test-only logger option

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: src/lib/auth-log.ts; src/lib/log.ts:86 (opts.level)
- **Detail**: Plan said the auth error→category map should be inline in the routes; extracted to a shared src/lib/auth-log.ts to avoid duplication. createLogger also gained a test-only `opts.level` override for testable level filtering. Both benign, undocumented scope.
- **Fix**: Note both in the plan as an addendum; no code change needed.
- **Decision**: FIXED — documented in plan.md "Implementation Addenda" section.

### F2 — PII redaction backstop is shallow

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/log.ts:71-83 (sanitize)
- **Detail**: sanitize() drops denylist keys only at the top level; a nested { actor: { email } } would slip through. No current caller nests PII, so the guarantee holds today.
- **Fix**: Recurse the denylist into nested objects, or add a comment stating the backstop is intentionally shallow and call sites must pass flat fields.
- **Decision**: FIXED — added shallow-redaction contract comment to sanitize() in src/lib/log.ts.

### F3 — evaluate.llm_fallback emits once per processList call

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (reliability/noise)
- **Location**: src/lib/evaluator.ts:190
- **Detail**: When the LLM path is enabled but failing, every processList call logs a fallback line (~2N+2 for a pool of N). Same frequency as the pre-existing console.warn — not a regression. Silent in prod with a working key.
- **Fix**: Out of scope for baseline; dedupe per-request as a follow-up if volume becomes a concern.
- **Decision**: SKIPPED — not a regression; revisit only if log volume becomes a concern.

### F4 — Middleware header-set assumes mutable response headers

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (reliability)
- **Location**: src/middleware.ts:41
- **Detail**: response.headers.set on next()'s return assumes mutable headers. Verified working for SSR pages, the API route, and the redirect in dev; rare immutable-header responses (HEAD/304) untested.
- **Fix**: Optional — wrap the set in try/catch or guard on mutability.
- **Decision**: FIXED — wrapped response.headers.set in try/catch in src/middleware.ts.

### F5 — auth.signout not logged if signOut() rejects

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (reliability)
- **Location**: src/pages/api/auth/signout.ts:7-11
- **Detail**: `await supabase.auth.signOut()` is unguarded; a rejection throws before the success log line and returns 500 with no auth event. Pre-existing shape — not a regression.
- **Fix**: Optional — wrap signOut in try/catch and emit auth.signout with the correct outcome.
- **Decision**: FIXED — guarded signOut and emit auth.signout success/failure in src/pages/api/auth/signout.ts.
