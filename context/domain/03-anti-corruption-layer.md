---
artifact: "DDD · Step 3 — Anti-Corruption Layer (ACL) Blueprint"
change_id: domain-modeling
date: 2026-06-17
status: "design blueprint — NO production code written"
---

# Anti-Corruption Layer (ACL)

## 3.1 — External SDK leak scan (EVIDENCE)

`grep -rnE 'from "(@supabase|@ai-sdk|ai)"' src/` (verified 2026-06-17):

| External package        | Symbol leaked           | Into module                                                         | Layer it pollutes                | Severity                                                         |
| ----------------------- | ----------------------- | ------------------------------------------------------------------- | -------------------------------- | ---------------------------------------------------------------- |
| `ai`                    | `generateObject`        | `evaluator.ts:1`                                                    | **CORE engine**                  | 🔴 High — SDK call sits inside the determinism-critical pipeline |
| `@ai-sdk/openai`        | `createOpenAI`          | `evaluator.ts:2`                                                    | **CORE engine**                  | 🔴 High — provider handle constructed in Core                    |
| `@supabase/supabase-js` | `SupabaseClient` (type) | `counterparties.ts:1`, `evaluation-history.ts:1`, `user-lists.ts:1` | Supporting (persistence)         | 🟠 Medium — DB client shape is the param type of every repo fn   |
| `@supabase/ssr`         | `createServerClient`    | `supabase.ts:1`                                                     | Infra adapter (already isolated) | 🟢 OK — this _is_ the adapter; leave it                          |

**Leak counts (ground truth):** AI SDK in **1** file (2 imports); `SupabaseClient` type in **3**
files. Small surface → the ACL is achievable in a contained refactor.

The 🔴 cases are the real corruption: the **Generic** LLM SDK (Step 1 classification) reaches
straight into the **Core** domain. A provider swap, a `generateObject`→`generateText` migration
(already a `TODO` at evaluator.ts:136), or an SDK breaking change forces edits _inside the Core
pipeline_. That is exactly what an ACL prevents.

## 3.2 — Design: Port / Adapter + a Value Object for the foreign contract

### Port (domain-owned interface — zero SDK types)

```ts
// domain/ports/list-processor.ts
export interface ListProcessor {
  /** Standardize + value one freeform list into a domain aggregate.
   *  Returns a ListValuation (Step 2) — never an SDK response shape. */
  process(text: string): Promise<ListValuation>;
}
```

### Value Object encapsulating the external LLM contract

The SDK's response must be _translated at the boundary_ and never escape. The zod-validated draft
is mapped to the domain `StandardizedItem`; the `ai`/`@ai-sdk` types die inside the adapter:

```ts
// adapters/openai/llm-item-draft.ts  (the ONLY place the foreign shape is named)
const LlmItemSchema = z.object({
  /* raw, category, brand, size, condition, quantity, estimated_pln */
});
type LlmItemDraft = z.infer<typeof LlmItemSchema>;
function toDomain(d: LlmItemDraft): StandardizedItem {
  /* null→undefined, clamp, CategorySlug guard */
}
```

### Adapters (the ONLY modules importing the SDKs)

```ts
// adapters/openai/openai-list-processor.ts   ← imports "ai" + "@ai-sdk/openai" (allowed here only)
export class OpenAiListProcessor implements ListProcessor {
  constructor(private readonly cfg: { apiKey: string; baseURL?: string }) {}
  async process(text: string): Promise<ListValuation> {
    const { object } = await generateObject({ model, schema: LlmItemSchema, temperature: 0, seed: 42, ... });
    return ListValuation.fromSegments(splitSegments(text), seg => classifyFromDraft(seg, object)); // INV-1 enforced by aggregate
  }
}

// adapters/stub/stub-list-processor.ts       ← pure, no imports; reads the Pricing Catalog (Table Module)
export class StubListProcessor implements ListProcessor { /* regex/keyword classify → ListValuation */ }

// adapters/fallback-list-processor.ts        ← decorator: try LLM, on throw warn + delegate to stub
export class FallbackListProcessor implements ListProcessor {
  constructor(private primary: ListProcessor, private fallback: ListProcessor, private log: Logger) {}
}
```

The Core `evaluate()` now depends on `ListProcessor` (a domain port), not on `ai`. Strategy
selection (`preferLLM`, the `source` union) moves to a composition root in `evaluate.ts` that wires
the adapters — Core no longer knows OpenAI exists.

### Repository Ports for Supabase (the 🟠 leaks)

Mirror the same pattern so `SupabaseClient` stops being a domain parameter type:

```ts
// domain/ports/repositories.ts
export interface CounterpartyRepository {
  pool(): Promise<ReadonlyArray<Counterparty>>;
}
export interface UserListsRepository {
  save(op: OperatorId, give: string, want: string): Promise<void>;
  load(op: OperatorId): Promise<{ give: string; want: string } | null>;
}
export interface EvaluationHistoryRepository {
  append(op: OperatorId, e: Evaluation): Promise<void>;
  listFor(op: OperatorId): Promise<ReadonlyArray<Evaluation>>;
}
// adapters/supabase/*-repository.ts          ← the ONLY modules importing SupabaseClient
```

## 3.3 — Verification rule (the zero-leak gate)

After the refactor, these MUST hold (run in CI / pre-commit). An adapter allow-list is the only
place a foreign import may appear:

```sh
# LLM SDK must not appear outside the OpenAI adapter
grep -rnE 'from "(ai|@ai-sdk/openai)"' src/ --include='*.ts' \
  | grep -v 'src/lib/adapters/openai/' ; test $? -eq 1   # exit 1 == zero matches == PASS

# Supabase client must not appear outside the supabase adapters + the SSR client wrapper
grep -rn '@supabase/supabase-js' src/ --include='*.ts' \
  | grep -vE 'src/lib/adapters/supabase/' ; test $? -eq 1
```

ast-grep equivalent (semantic, drift-proof):

```sh
sg -p 'import $$$ from "ai"' src/ --json | jq 'map(select(.file|test("adapters/openai")|not)) | length'  # must be 0
sg -p 'import $$$ from "@ai-sdk/openai"' src/ --json | jq '… | length'                                   # must be 0
```

**Baseline today (pre-ACL):** the first grep returns **2** matches (evaluator.ts:1-2) and the
second returns **3** (the data helpers) — i.e. the gate currently FAILS by 2 + 3. The ACL's success
criterion is driving both to **0 outside the adapter allow-list**.

## 3.4 — Feasibility & limits

- **Blast radius:** Core engine fan-in = 1 (evaluate.ts); the SDK leak is 1 file. The Supabase
  repos are 3 small files with a uniform `(client, …)` signature → mechanical to wrap.
- **Safety net:** determinism snapshot + `evaluator-llm.test.ts` (which already mocks `ai` —
  proving the seam is testable) pin behavior across the extraction.
- **Determinism caveat:** `temperature:0`+`seed:42` must move _with_ the call into the adapter
  unchanged (INV-2). The golden snapshot is the regression guard.
- Design only; no production code written. Counts are static `grep` truth as of 2026-06-17.
