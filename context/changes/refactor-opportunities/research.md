---
topic: "Refactor opportunities — structural exploration & ranking (10xArchitect)"
researcher: Claude (M4·L4 Refactoring with an Agent)
date: 2026-06-17
change_id: refactor-opportunities
status: complete
scope: "Exploration only — NO production code modified."
sources:
  - context/map/repo-map.md
  - context/archive/2026-06-11-evaluate-flow-analysis/research.md
verification: "ast-grep 0.43.0 (kind + pattern rules) cross-checked against grep + git history"
---

# Research: Refactor Opportunities (ranked)

> **Evidence convention.** **EVIDENCE** = read first-hand from source/tests/git at a cited
> `file:line` and (where structural) confirmed by ast-grep + grep. **INFERENCE** = deduction
> from that data. **UNKNOWN** = not verifiable by static analysis here.
> Every structural count below was run twice — semantically (ast-grep) and textually (grep) —
> and the two agree unless flagged.

---

## STEP 0 — Environment & isolation pre-check (gate: 100% green required)

| Check                                                      | Result   | Evidence                                                                                                                                                                                        |
| ---------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Colima running, bound to external SSD config               | ✅       | `colima status`: `macOS Virtualization.Framework`, docker socket `unix:///Volumes/KINGSTONE_SSD/.config/colima/default/docker.sock`; `colima list` → `default Running`.                         |
| Local Supabase stack live & healthy                        | ✅       | `supabase status` → "running"; `docker ps` → db/auth/kong/rest/storage/studio/realtime/pg_meta/inbucket all `Up (healthy)`.                                                                     |
| `edge_runtime` / `vector` / `logflare`(analytics) excluded | ✅       | `docker ps -a` → **0** containers each; `supabase status` lists them under "Stopped services" (matches the `-x vector,logflare` IDP profile). Zero boot-timeout surface.                        |
| Storage isolation — no `~/.colima` host-drive shadow       | ✅       | `~/.colima` **absent**; Colima state lives only on the SSD.                                                                                                                                     |
| `~/.ollama` host-drive shadow                              | ⚠️ noted | `~/.ollama` **present (140K)** — unrelated to the Colima/Supabase stack; pre-existing, not created by this work. Does not affect the clean-mac posture for this project. Flagged, non-blocking. |

**Gate verdict:** GREEN. The one ⚠️ is an unrelated 140K Ollama dir, not a stack bleed. Proceeded
to exploration.

---

## Scope of the codebase under review

`src/` = 36 source files, strictly layered (pages/API → `src/lib` services → `src/types.ts`),
**0 import cycles**, **0 layer breaches** (EVIDENCE: repo-map.md §3). The structural problems are
therefore **not** tangling or cyclic coupling — they are **intra-file responsibility smearing** in
the two hottest modules: `src/lib/evaluator.ts` (Z1 engine) and `src/pages/api/evaluate.ts` (Z1
handler). This report targets those.

---

## Enumeration — CANDIDATE vs INPUT

| ID     | Item                                                                                | Class                | One-line                                                                                                            |
| ------ | ----------------------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------- |
| **C1** | `evaluator.ts` god-module (16 fns / 7 concern-clusters in 416 lines)                | **CANDIDATE**        | One file owns catalog data + classification + LLM + cache + matching + fairness + rendering + orchestration.        |
| **C2** | Pricing/condition catalog duplicated (structured data **and** LLM prompt prose)     | **CANDIDATE**        | Same 16 prices + 5 multipliers maintained in two representations; edit one, forget the other → stub↔LLM divergence. |
| **C3** | `evaluate.ts` handler accreted dual persistence + error classification              | **CANDIDATE**        | Thin handler grew two best-effort save blocks across two later commits; fan-out 6.                                  |
| I1     | Module-level mutable `processedCache` (`evaluator.ts:160`)                          | INPUT (deliberate)   | Determinism guardrail by design; minor test-isolation smell, already worked around. Document, don't restructure.    |
| I2     | LLM + fallback path "untested" (archive TD1/TD2)                                    | INPUT (**RESOLVED**) | **Correction to the 2026-06-11 archive** — now covered by `test/evaluator-llm.test.ts` (147 lines, 4 cases).        |
| I3     | `source` of want-list dropped; response reports give-list source only (archive TD5) | INPUT (minor)        | Observability debt, not structural.                                                                                 |

The three CANDIDATEs are analyzed below. INPUTs are recorded but out of refactor scope.

---

## C1 — `evaluator.ts` is a god-module

### Current shape (where logic is smeared) — EVIDENCE

One 416-line file (`wc -l`) holds **16 `function_declaration` nodes** — verified two ways:
ast-grep kind-rule `kind: function_declaration` → **16**; grep `^(export )?(async )?function` → **16**
(agree). They cluster into **seven distinct responsibilities**:

| Concern cluster                                                                       | `file:line`            | Tag      |
| ------------------------------------------------------------------------------------- | ---------------------- | -------- |
| Catalog / pricing data (`KEYWORD_MAP`, `CONDITION_MAP`, `BRANDS`)                     | `evaluator.ts:16-47`   | EVIDENCE |
| Stub classifier (`extractSize/Brand/Quantity`, `classifyItemStub`, `processListStub`) | `evaluator.ts:49-107`  | EVIDENCE |
| LLM processing (schemas, `LLM_SYSTEM`, `processListLLM`)                              | `evaluator.ts:109-158` | EVIDENCE |
| Cache + strategy dispatch (`processedCache`, `processList`)                           | `evaluator.ts:160-200` | EVIDENCE |
| Matching (`MatchCandidate`, `categorySet`, `findBestMatch`)                           | `evaluator.ts:202-252` | EVIDENCE |
| Fairness (`computeVerdict`, `balancingSuggestion`)                                    | `evaluator.ts:254-284` | EVIDENCE |
| Rendering (`renderItemRow/Unclassified/NoMatchContract/Contract`)                     | `evaluator.ts:286-364` | EVIDENCE |
| Orchestration (`evaluate`)                                                            | `evaluator.ts:374-416` | EVIDENCE |

Public surface is tiny: only **3 exports** (`processListStub`, `EvaluateOptions`, `evaluate` —
grep `^export`), so the 13 other functions are private implementation detail trapped in one file.

### History & intentionality — EVIDENCE → INFERENCE

- Born at **409 lines with all 16 functions** in `bf21952` (`feat(postgres-rls-baseline) p1`):
  `git show bf21952:src/lib/evaluator.ts | wc -l` → 409; function count at birth → 16.
- Today 416 lines; net change since birth **+15 / −8** across just two later commits
  (`git log --numstat --follow`).
- **INFERENCE:** the module shape is **as-born** — the v1 in-memory MVP engine was ported whole
  into the v2 baseline. This is **accidental complexity inherited from a 1-week MVP**, _not_ a
  deliberate design/performance constraint. The genuinely deliberate part is _determinism by
  construction_ (pure functions, `temperature:0`+`seed:42` at `evaluator.ts:142-143`, input-keyed
  cache) — that property is orthogonal to file layout and must be preserved by any split.

### Migration feasibility — blast radius, safety nets, protocol

- **Blast radius (small):** production fan-in = **1** — only `evaluate.ts:5` imports
  `{ evaluate }` (`grep -rn 'from "@/lib/evaluator"' src/` → 1 hit). Splitting internals behind an
  unchanged `evaluate()` signature touches **no** caller.
- **Existing safety nets (strong):**
  - `test/determinism.test.ts` → **golden snapshot** (`determinism.test.ts.snap`, 2099 B) pinning
    byte-identical Markdown for FAIR / NEEDS BALANCING / NO MATCH against `GOLDEN_POOL`
    (stub path). This is the exact characterization guard a structural refactor needs.
  - `test/evaluator-llm.test.ts` (147 lines) → LLM `source:"llm"` + `temperature:0/seed:42`
    assertion, FR-004 no-silent-drop, and the `llm-failed-fallback` branch + warn.
  - `test/evaluate.test.ts` (187 lines) → handler contract.
- **Characterization protocol (guard first, change second):**
  1. **Guard:** before moving any code, widen `determinism.test.ts` with 1–2 snapshot cases that
     exercise the rendering + balancing-suggestion branch (`evaluator.ts:261-283`) and the
     `## Couldn't classify` appendix, so the byte-pinned surface covers all renderers. Run green.
  2. **Change:** extract clusters into sibling modules under `src/lib/` (or `src/lib/services/`,
     the dir `src/lib/CLAUDE.md` sanctions but which does **not** yet exist — confirmed
     `ls src/lib/services` → No such file) — `catalog.ts`, `classify.ts`, `llm.ts`, `match.ts`,
     `fairness.ts`, `render.ts` — re-exported through `evaluator.ts`, signature unchanged.
  3. **Verify:** re-run the snapshot + LLM suites. **Byte-identical = success criterion** (PRD
     determinism contract). Any `.snap` diff means the refactor changed behavior — stop and revert.

---

## C2 — Pricing/condition catalog has two sources of truth

### Current shape — EVIDENCE

The valuation catalog is encoded **twice in the same file, in two representations**:

- **Structured** (machine-read by the stub): `KEYWORD_MAP` with **16 `base_pln:` entries**
  (`evaluator.ts:16-37`, grep `base_pln: [0-9]+` → 16) + `CONDITION_MAP` with 5 multipliers
  (`evaluator.ts:39-45`).
- **Prose** (hand-written into the LLM prompt): the **same 16 prices** restated as English in
  `LLM_SYSTEM` at `evaluator.ts:129` ("…blocks-lego 40, … balance-bike 180, stroller 250,
  car-seat 200, …") and the **same multipliers** at `evaluator.ts:130`
  ("new=1.0, like-new=0.85, good=0.65, used=0.45").

### History & intentionality — EVIDENCE → INFERENCE

- The prompt-prose duplication was present **from birth** (`git show bf21952:…` → the "Base prices
  PLN at condition" line exists at the first commit).
- **INFERENCE:** this is **accidental complexity** (MVP shortcut: hard-code the catalog in two
  places rather than generate one from the other). It is _invisible to the type-checker_ — nothing
  fails if the two drift. A single forgotten price edit makes the **stub and LLM value the same
  item differently**, silently breaking valuation consistency across the strategy boundary and
  undermining the determinism/seed-fixture guarantees (conventions.md § determinism, FR-017/018).

### Migration feasibility

- **Blast radius (smallest):** entirely internal to `evaluator.ts`; zero external callers affected.
- **Safety nets:** `determinism.test.ts` pins the stub valuations; `evaluator-llm.test.ts` can
  assert the generated prompt contains catalog-derived lines.
- **Protocol:** lift one `CATALOG` constant (category → `{ base_pln, patterns }`) + one
  `CONDITIONS` constant; have **both** the stub lookups _and_ a `buildSystemPrompt()` read from it
  (generate the price/multiplier sentences). Guard: snapshot stays byte-identical; add an assertion
  that `LLM_SYSTEM` text is derived (no literal price drift). Low cost, high protection.

---

## C3 — `evaluate.ts` handler accreted persistence + error classification

### Current shape — EVIDENCE

88-line handler (`wc -l`) with internal fan-out **6** (grep `^import .* from "@/"` → 6:
`evaluator`, `supabase`, `counterparties`, `user-lists`, `evaluation-history`, `log`). It performs,
in one function body: JSON parse → 400 (`evaluate.ts:24-29`), zod → 400 (`32-38`), threshold
resolution (`40`), client create (`44`), pool load (`45`), engine call (`46-51`), **best-effort
`saveUserLists`** (`58-63`), **best-effort `saveEvaluation`** (`68-72`), success log (`53`), and
RLS-vs-generic error classification (`isRlsDenied`, `80-86`).

### History & intentionality — EVIDENCE → INFERENCE

- `git log --follow` (5 commits): the handler was born thin in `bf21952` (p1); **`saveUserLists`
  was added later** in `773ab3d feat(restore-saved-lists) p2`; **`saveEvaluation` added later
  still** in `5ff2cda feat(feature-evaluation-history) p3`.
- **INFERENCE:** unlike C1, this is **accidental complexity by accretion** — each vertical slice
  bolted its persistence directly into the handler. The `src/pages/api/CLAUDE.md` contract says
  handlers should be "thin — validate, authorize, delegate, respond"; the two persistence blocks
  violate that. This corroborates archive TD4 (coupling+churn hub).

### Migration feasibility

- **Blast radius (low):** extract a `persistEvaluation(supabase, userId, give, want, result, log)`
  into `src/lib/services/` that owns both best-effort saves + their warn-logging. Handler drops to
  validate → delegate → persist → respond. Affected: `evaluate.ts` + new service + `evaluate.test.ts`
  (mocks `saveUserLists`/`saveEvaluation` — re-point to the service).
- **Safety nets:** `evaluate.test.ts` already covers 200 / 500-generic / 500-RLS / save-failure.
- **Protocol:** guard the existing handler tests green; extract the service preserving the
  best-effort semantics ("a save failure must never hide the result" — `evaluate.ts:56`); re-run.

---

## Semantic verification loop (ast-grep ⇄ grep)

ast-grep 0.43.0 via `npx --package @ast-grep/cli ast-grep`. (Tool note: not installed globally;
the pattern `function $NAME(...) { ... }` returned **0** due to TS return-type annotations breaking
the literal pattern — _pattern drift_ — so structural counts use a `kind:` rule and are
cross-checked textually, per protocol.)

| Claim                                | ast-grep                          | grep                                | Agree?            |
| ------------------------------------ | --------------------------------- | ----------------------------------- | ----------------- |
| `evaluator.ts` function declarations | 16 (`kind: function_declaration`) | 16 (`^(export )?(async )?function`) | ✅                |
| `processedCache` references          | 7 (`-p 'processedCache'`)         | 7                                   | ✅                |
| `evaluator.ts` exports               | —                                 | 3 (`^export`)                       | grep ground-truth |
| `evaluate.ts` internal fan-out       | —                                 | 6 (`^import .* from "@/"`)          | grep ground-truth |
| `evaluator.ts` production fan-in     | —                                 | 1 (`from "@/lib/evaluator"` in src) | grep ground-truth |
| `base_pln` catalog entries           | —                                 | 16                                  | grep ground-truth |
| Prices restated in `LLM_SYSTEM`      | —                                 | line 129 (16 prices)                | grep ground-truth |
| `src/lib/services/` exists           | —                                 | No (`ls` → not found)               | grep ground-truth |
| `evaluator.ts` born size / fns       | —                                 | 409 lines / 16 fns @ `bf21952`      | git ground-truth  |

---

## Refactor opportunities (ranked)

Ranked by **(value to determinism/maintainability) ÷ (cost × risk)**. All three are guarded by the
existing snapshot + LLM characterization suites, so all are "guard-first" safe.

### #1 — Catalog → single source of truth _(C2)_

- **Current archetype:** duplicated literals — a _Transaction Script_ carrying its reference data
  inline, twice (structured + prose).
- **Target archetype:** **Table Module** — one `CATALOG` keyed by category that both the stub
  lookup and the LLM-prompt builder read; prompt text is _generated_, never hand-edited.
- **Trade-off:** **lowest cost, highest protection.** ~30 lines moved, zero API change, zero new
  caller risk. Directly defends the PRD determinism contract by making stub↔LLM divergence
  _structurally impossible_. **Do this first** — it also de-risks #2 by isolating the data.
- **Cost:** S. **Benefit:** High (correctness/determinism). **Blast radius:** in-file only.

### #2 — Split the evaluator god-module _(C1)_

- **Current archetype:** **Transaction Script** — one 416-line procedural pipeline with 16
  functions spanning 7 responsibilities.
- **Target archetype:** a **modular Transaction Script trending to a thin Domain Model** —
  `catalog.ts` (Table Module) · `classify.ts` · `llm.ts` · `match.ts` · `fairness.ts` ·
  `render.ts`, re-exported behind the unchanged `evaluate()` facade. (Full Domain Model with rich
  entity behavior would be over-engineering at this size — stop at cohesive pure-function modules.)
- **Trade-off:** medium cost (mechanical file moves), **low risk** because fan-in = 1 and the
  golden snapshot byte-pins output. Big readability/testability win: each concern becomes unit-
  testable in isolation and the determinism-critical path is no longer buried among renderers.
- **Cost:** M. **Benefit:** High (maintainability, onboarding, Z1 risk reduction).
  **Blast radius:** 1 importer + 2 test suites; output must stay byte-identical.

### #3 — Extract persistence from the evaluate handler _(C3)_

- **Current archetype:** a _Transaction Script_ doing too much — orchestration + two best-effort
  persistence side-effects + error classification, accreted across p2/p3.
- **Target archetype:** **clean Transaction Script** (validate → delegate → persist → respond) +
  a `persistEvaluation()` **service** in the sanctioned-but-missing `src/lib/services/`.
- **Trade-off:** low cost, low-to-medium benefit. Restores the `api/CLAUDE.md` "thin handler"
  contract and shrinks the repo's highest-fan-out module, but it's organizational rather than
  correctness-critical (unlike #1). Best done _after_ #1/#2 or opportunistically.
- **Cost:** S–M. **Benefit:** Medium (contract compliance, Z1 churn-hub relief).
  **Blast radius:** handler + new service + `evaluate.test.ts`.

---

## Limits (UNKNOWN / not covered)

- **No code executed, no production code modified** — exploration only. Snapshot "byte-identical"
  claims describe the _guard that exists_, not a refactor that was run.
- **`supabase/` (SQL/RLS) untouched** — not a structural-refactor target; correctness is pgTAP's
  job (`supabase/README.md`).
- Archive TD3 (400-validation tests) and TD6 (`saveUserLists` failure) status not re-confirmed
  line-by-line here; `evaluate.test.ts` grew 139→187 lines since the archive, so some may now be
  closed — verify before treating as open INPUTs.
- ast-grep was run ad-hoc via `npx`; structural counts that the literal pattern missed were
  resolved with `kind:` rules + grep, all cross-checked. No persistent `sgconfig.yml` was added.
