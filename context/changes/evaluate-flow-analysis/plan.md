# Close LLM / Fallback / Validation Test Gaps — Implementation Plan

## Overview

Close the highest-risk test gaps found in `research.md` for the core evaluation pipeline:
the **LLM success path** (`source: "llm"`), the **LLM-failed-fallback path**
(`source: "llm-failed-fallback"`), and the two **400 input-validation paths** (invalid JSON,
zod failure). This is **test-only** — no production source is modified. The `ai` SDK is mocked
so no real LLM/network call occurs and determinism is preserved.

## Current State Analysis

- The test stub forces `OPENAI_API_KEY = undefined` (test/stubs/astro-env-server.ts:6), so
  `preferLLM = Boolean(opts.apiKey)` is always false in the suite (evaluator.ts:380) — the LLM
  branch (evaluator.ts:185-188) and the fallback branch (evaluator.ts:189-199) are **unreachable**
  by any current test.
- `test/evaluate.test.ts` mocks `@/lib/evaluator` wholesale (line 10), so it can only test the
  handler, never the real engine. It has **no** 400 cases (only happy path, 500, RLS-denied,
  best-effort persistence).
- `test/determinism.test.ts` uses the **real** engine but only the stub path (snapshots).
- The LLM call is `generateObject` from `ai` (evaluator.ts:139), model via `createOpenAI` from
  `@ai-sdk/openai` (evaluator.ts:135), configured `temperature: 0, seed: 42` (evaluator.ts:142-143).
- `processedCache` is a module-level `Map` keyed `llm::<text>` / `stub::<text>` with **no reset
  export** (evaluator.ts:160) — tests must use unique inputs to stay isolated.
- Runner: Vitest 4.x (`npm run test` → `vitest run`); alias `@`→`src`, `astro:env/server`→stub
  (vitest.config.ts). Existing mock idiom: hoisted `vi.mock(...)` + `vi.mocked(...)`.

## Desired End State

`npm run test` exercises, with the real evaluator and a mocked `ai` SDK:

- LLM success → `source: "llm"`, `generateObject` called with `temperature: 0` and `seed: 42`,
  and every input item appears in the result (no silent drop, FR-004).
- LLM throw → `source: "llm-failed-fallback"`, a `evaluate.llm_fallback` warn is emitted, and a
  valid contract is still produced via the stub.
- `POST /api/evaluate` with a non-JSON body → 400 `{error:"invalid JSON body"}`.
- `POST /api/evaluate` with schema-invalid input → 400 `{error:"validation failed", issues:[…]}`.

Verify: `npm run test` green with the new cases; `npm run lint` and `npx tsc --noEmit` clean;
`git diff --stat` shows changes only under `test/`.

### Key Discoveries:

- Drive the engine directly with an injected key: `evaluate(give, want, pool, {apiKey:"test-key", thresholdPct, logger})` — mirrors how determinism.test.ts calls `evaluate` (research.md §1).
- Mock the SDK at the module boundary: `vi.mock("ai", …)` returning a controllable `generateObject`; throw from it to drive the fallback branch (evaluator.ts:185-199).
- `generateObject` returns `{ object: { items, unclassified } }` shaped by `ListResultSchema`; the mock must return that shape (evaluator.ts:139-157).
- Invalid-JSON test needs a raw (non-stringified) body so `request.json()` rejects (evaluate.ts:24-29) — the existing `makeContext` helper JSON-stringifies, so a raw-body variant is needed.

## What We're NOT Doing

- **No production source changes** — `src/**` is untouched; no test-only export/reset seam added to `evaluator.ts`.
- **No real LLM/network calls** — the `ai` SDK is mocked; no API key, no live OpenAI.
- **No `vitest --coverage` gate** or coverage-threshold config change.
- **No new determinism snapshots** for the LLM path (mocked data would make them brittle — decided against "full output snapshot").
- **Not touching** the stub's `OPENAI_API_KEY = undefined` (the engine tests inject the key directly instead).
- **Not testing** `saveUserLists` failure or balancing-suggestion edge (TD5/TD6) — out of this change's scope.

## Implementation Approach

Two independent test files, each self-contained. Phase 1 adds a new engine-level spec that
mocks the `ai` SDK and injects an apiKey to reach the LLM and fallback branches. Phase 2 extends
the existing handler spec with the two 400 paths (validation runs before the mocked engine, so
the existing wholesale evaluator mock is fine). Cache isolation is achieved purely through unique
input strings per test.

## Critical Implementation Details

- **Cache isolation via unique inputs.** Because `processedCache` (evaluator.ts:160) persists for
  the module's lifetime and is keyed by raw text, every test in Phase 1 must use a distinct
  give/want string, or a later test will hit a cached `ProcessedList` and assert against the wrong
  `source`. No reset seam is added (production-change constraint).
- **Mock seam is the `ai` module, not `@ai-sdk/openai`.** `processListLLM` calls
  `generateObject` from `ai` (evaluator.ts:139); `createOpenAI` only builds the model handle.
  Mock `ai`'s `generateObject`; a no-op mock of `createOpenAI` keeps the model call from doing
  real work.

## Phase 1: LLM-path & fallback engine tests (TD1/TD2)

### Overview

Cover the real evaluator's LLM and fallback branches by mocking the `ai` SDK and injecting an
apiKey, asserting source labels, determinism config, the fallback warn, and no-silent-drop.

### Changes Required:

#### 1. New engine-level spec

**File**: `test/evaluator-llm.test.ts` (new)

**Intent**: Reach the otherwise-unreachable LLM (`source:"llm"`) and fallback
(`source:"llm-failed-fallback"`) branches of the real `evaluate()` by mocking `ai`'s
`generateObject` and calling `evaluate()` with `apiKey:"test-key"`. Assert the determinism
config and FR-004 no-drop as TD2's testable proxy.

**Contract**: A Vitest spec that:

- `vi.mock("ai", …)` exposing a controllable `generateObject` mock; `vi.mock("@ai-sdk/openai", …)`
  returning a stub `createOpenAI`.
- Builds a minimal counterparty pool inline (or reuses the determinism fixture) so `evaluate()`
  can run end-to-end.
- **LLM success case:** mock resolves `{ object: { items:[…matching the inputs…], unclassified:[] } }`;
  assert `result.source === "llm"`; assert the `generateObject` mock was called with an args object
  containing `temperature: 0` and `seed: 42`; assert every input item is represented in the rendered
  contract or `unclassified` (no silent drop).
- **Fallback case:** mock `generateObject` rejects (throws); assert `result.source === "llm-failed-fallback"`,
  that a `evaluate.llm_fallback` warn was captured via an injected test `Logger`, and that a
  non-empty contract is still returned.
- Each case uses **unique** give/want strings to avoid `processedCache` bleed.

### Success Criteria:

#### Automated Verification:

- New file present: `test -f test/evaluator-llm.test.ts`
- Full suite green: `npm run test`
- Type check clean: `npx tsc --noEmit`
- Lint clean: `npm run lint`
- Production untouched: `git diff --name-only` lists only files under `test/`

#### Manual Verification:

- The LLM success test fails if `temperature`/`seed` are changed away from `0`/`42` (spot-check by temporarily editing the assertion or the mock expectation).
- The fallback test genuinely exercises the catch block (temporarily make the mock resolve instead of throw → `source` flips to `llm`, test fails).
- No real network call occurs (suite runs offline, no API key set).

**Implementation Note**: After automated verification passes, pause for manual confirmation before Phase 2.

---

## Phase 2: Handler 400 input-validation tests (TD3)

### Overview

Add the two missing 400 paths to the handler spec: malformed JSON and schema-invalid input.

### Changes Required:

#### 1. Extend the handler spec

**File**: `test/evaluate.test.ts` (edit)

**Intent**: Cover the input-validation error contracts (evaluate.ts:24-38) that currently have no
test. Validation runs before the (already-mocked) evaluator, so no new engine mock is needed.

**Contract**: Add cases to the existing `describe`:

- **Invalid JSON:** construct a context whose request body is a raw non-JSON string (a new
  raw-body context variant, since the existing `makeContext` JSON-stringifies); assert
  `res.status === 400` and body `{error:"invalid JSON body"}`.
- **Zod failure:** POST `{give:""}` (and/or missing `want`, and `threshold_pct` out of 1–99);
  assert `res.status === 400`, body `error === "validation failed"`, and `issues` is a non-empty
  array.
- Assert the evaluator mock was **not** called in either 400 case (validation short-circuits).

### Success Criteria:

#### Automated Verification:

- Suite green: `npm run test`
- Type check clean: `npx tsc --noEmit`
- Lint clean: `npm run lint`
- Production untouched: `git diff --name-only` lists only files under `test/`

#### Manual Verification:

- Invalid-JSON test fails if the handler's try/catch around `request.json()` is removed (spot-check).
- Zod test surfaces the real `issues` shape (inspect one assertion to confirm it matches the handler's response).

**Implementation Note**: After automated verification passes, pause for manual confirmation before closing the plan.

---

## Testing Strategy

### Unit Tests:

- LLM success + fallback branches of `evaluate()` with a mocked `ai` SDK (Phase 1).
- 400 invalid-JSON and zod-failure paths of the `POST` handler (Phase 2).

### Integration Tests:

- None — this change adds unit-level specs only; no E2E.

### Manual Testing Steps:

1. `npm run test` — confirm the new cases run and pass.
2. Temporarily flip the fallback mock to resolve → confirm the fallback test fails (proves it exercises the catch).
3. `git diff --name-only` — confirm only `test/` files changed.

## Performance Considerations

None — mocked SDK, no network, negligible added test runtime.

## Migration Notes

None — additive test-only change; no schema, data, or API change.

## References

- Research: `context/changes/evaluate-flow-analysis/research.md` (TD1/TD2/TD3, branch map)
- Engine LLM/fallback: `src/lib/evaluator.ts:134-199`
- Handler validation: `src/pages/api/evaluate.ts:14-38`
- Existing mock idiom: `test/evaluate.test.ts:8-12`, real-engine driving: `test/determinism.test.ts`
- Vitest config: `vitest.config.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: LLM-path & fallback engine tests

#### Automated

- [x] 1.1 New file present: `test -f test/evaluator-llm.test.ts`
- [x] 1.2 Full suite green: `npm run test`
- [x] 1.3 Type check clean: `npx tsc --noEmit`
- [x] 1.4 Lint clean: `npm run lint`
- [x] 1.5 Production untouched (`git diff --name-only` only under `test/`)

#### Manual

- [x] 1.6 LLM test fails if temperature/seed change away from 0/42
- [x] 1.7 Fallback test genuinely exercises the catch (flip mock → test fails)
- [x] 1.8 No real network call occurs (runs offline, no API key)

### Phase 2: Handler 400 input-validation tests

#### Automated

- [ ] 2.1 Suite green: `npm run test`
- [ ] 2.2 Type check clean: `npx tsc --noEmit`
- [ ] 2.3 Lint clean: `npm run lint`
- [ ] 2.4 Production untouched (`git diff --name-only` only under `test/`)

#### Manual

- [ ] 2.5 Invalid-JSON test fails if handler try/catch removed
- [ ] 2.6 Zod test asserts the real `issues` shape
