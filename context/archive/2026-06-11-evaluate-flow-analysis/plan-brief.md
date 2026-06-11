# Close LLM / Fallback / Validation Test Gaps — Plan Brief

> Full plan: `context/changes/evaluate-flow-analysis/plan.md`
> Research: `context/changes/evaluate-flow-analysis/research.md`

## What & Why

The Deep Focus research (M4·L3) found that the evaluation pipeline's riskiest branches are
completely untested: the test stub forces `OPENAI_API_KEY = undefined`, so the **LLM path** and
its **failure fallback** are unreachable by any test, and the handler's two **400 input-validation
paths** have no coverage. This change adds test-only coverage for all three, with no production
behavior change.

## Starting Point

`test/evaluate.test.ts` mocks the whole evaluator (handler-only, no 400 cases);
`test/determinism.test.ts` runs the real engine but only the stub path. The LLM call is
`generateObject` from the `ai` SDK at `temperature:0, seed:42` (evaluator.ts:139-143); the
module-level `processedCache` has no reset seam.

## Desired End State

`npm run test` exercises — with the real evaluator and a mocked `ai` SDK — LLM success
(`source:"llm"`), LLM-failed-fallback (`source:"llm-failed-fallback"` + `evaluate.llm_fallback`
warn), and both 400 paths (invalid JSON, zod failure). The LLM test also pins `temperature:0`/`seed:42`
and FR-004 no-drop. Production source is untouched.

## Key Decisions Made

| Decision            | Choice                                                          | Why                                                                                            | Source   |
| ------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | -------- |
| LLM-test location   | New `test/evaluator-llm.test.ts`                                | Needs real engine + mocked `ai`; incompatible with evaluate.test.ts's wholesale evaluator mock | Plan     |
| No-LLM in CI        | Mock `ai`'s `generateObject`, inject `apiKey` into `evaluate()` | Reaches LLM/fallback branches offline, deterministically                                       | Research |
| Cache isolation     | Unique input strings per test                                   | Zero production touch (honors constraint); avoids `processedCache` bleed                       | Plan     |
| LLM assertion depth | Source + `temperature:0`/`seed:42` + no-drop                    | Closes TD1 and TD2's testable proxy; guards PRD determinism + FR-004                           | Plan     |
| 400-test location   | Extend `test/evaluate.test.ts`                                  | Validation precedes the mocked engine — fits the existing handler spec                         | Plan     |

## Scope

**In scope:** LLM success test, LLM-failed-fallback test, invalid-JSON 400 test, zod-failure 400 test.

**Out of scope:** any `src/**` change, a cache-reset export, real LLM calls, coverage gates,
LLM-path snapshots, `saveUserLists`-failure / balancing-suggestion tests (TD5/TD6).

## Architecture / Approach

Two self-contained spec files. Phase 1: new engine spec mocks `ai` + injects a key to drive the
LLM and fallback branches. Phase 2: extend the handler spec with the two 400 paths (a raw-body
context variant for the invalid-JSON case). Isolation via unique inputs only.

## Phases at a Glance

| Phase                          | Delivers                                                                           | Key risk                                                                                          |
| ------------------------------ | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 1. LLM & fallback engine tests | `test/evaluator-llm.test.ts` covering source labels + determinism config + no-drop | Getting the `ai` mock shape (`{object:{items,unclassified}}`) right; cache bleed if inputs reused |
| 2. Handler 400 tests           | invalid-JSON + zod-failure cases in `test/evaluate.test.ts`                        | Raw-body request construction so `request.json()` actually rejects                                |

**Prerequisites:** none — research complete, decisions settled.
**Estimated effort:** ~1 session, 2 phases.

## Open Risks & Assumptions

- Assumes the `ai` SDK mocks cleanly at the module boundary under Vitest (no transitive ESM snag).
- TD2 is closed only by proxy (config assertion); a real LLM is still never exercised in CI — by design.
- `processedCache` isolation depends on test discipline (unique inputs), not an enforced seam.

## Success Criteria (Summary)

- `npm run test` green with 4 new cases; `tsc --noEmit` + `npm run lint` clean.
- `git diff --name-only` shows changes only under `test/`.
- Flipping the fallback mock or the seed/temperature makes the relevant test fail (proves real coverage).
