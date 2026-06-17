---
artifact: "DDD · Step 2 — Business Invariants & Aggregate Guardian Design"
change_id: domain-modeling
date: 2026-06-17
status: "design blueprint — NO production code written"
---

# Business Invariants & Aggregate Guardian

## 2.1 — Invariant inventory (rules that MUST always hold)

| # | Invariant | Source | Enforced today by | Enforcement strength |
| --- | --- | --- | --- | --- |
| INV-1 | **No silent item drops** — every input segment appears once, classified XOR unclassified. | FR-004 | Procedural loops in `processListStub` (evaluator.ts:100-104) **and** the LLM prompt instruction (evaluator.ts:131) — two uncoordinated enforcers | ⚠️ **WEAK** — no shared guardian; each path "remembers" on its own |
| INV-2 | **Determinism** — same inputs → byte-identical Markdown. | PRD NFR:176, conventions | `temperature:0`+`seed:42` (evaluator.ts:142-143) OR stub OR input-keyed cache | Medium (snapshot pins stub bytes) |
| INV-3 | **Single source of pricing truth** — stub & LLM value an item identically. | implied by INV-2 | **nothing** — catalog duplicated (L4/C2) | ❌ **NONE** — invisible to types |
| INV-4 | **Bidirectional match** — match only if both directions overlap. | US-01 | guarded `continue` when receiving or giving overlap is 0 (evaluator.ts:233) | Strong (single guarded branch) |
| INV-5 | **Relative fairness threshold** — FAIR iff delta ≤ X% of max(totals). | FR-009 | `computeVerdict` (evaluator.ts:254-259) | Strong |
| INV-6 | **Single counterparty per run** — best fairness, then most items. | FR-008 | sort + `candidates[0]` (evaluator.ts:247-251) | Strong |
| INV-7 | **Historical immutability** — stored Markdown stays byte-identical after pool edits. | FR-018/019 | store-verbatim, read-verbatim (evaluation-history.ts:31, 42-50) | Medium (convention, not type-locked) |
| INV-8 | **RLS per-user scoping** — no cross-account reads. | PRD §Access Control | Postgres RLS policies (SQL) | Strong (but outside the app/type layer) |

## 2.2 — Selection: highest-value, least-enforced

**INV-1 "No silent item drops."** Highest-value because it is a _must-have_ user-facing guarantee
(FR-004) and the conservation property the whole contract rests on; least-enforced _structurally_
because `ProcessedList` is an anemic interface (types.ts:18-22) that **any** caller can construct in
a drop-violating state — the rule is re-implemented in two procedures with no common guardian.

> Note: INV-3 (pricing single-source) is _even less_ enforced, but its right fix is a **Table
> Module + ACL** (L4/C2 and Step 3), not an aggregate. INV-1 is the cleanest _aggregate-guardian_
> story, so it is the blueprint here.

### Where INV-1 leaks across layers (EVIDENCE)

- **Engine layer:** conservation is enforced inline inside `processListStub` (push to `items` else
  push to `unclassified`, evaluator.ts:100-104) — correct, but private to that function.
- **LLM layer:** conservation is delegated to a _prompt sentence_ ("No silent drops",
  evaluator.ts:131) and a permissive zod schema (evaluator.ts:119-122) that does **not** assert
  input-count equals items + unclassified. A model that drops an item still produces a structurally
  valid `ProcessedList` — the invariant is on the _honor system_ on the production path.
- **Type layer:** nothing in `ProcessedList` ties `items ∪ unclassified` back to the input, nor
  `total_pln` to the sum of `estimated_pln`. The guarantee is _nowhere_ in the type system.

## 2.3 — Aggregate Root blueprint: `ListValuation`

Make the conservation rule **true by construction**: the only way to obtain a `ListValuation` is
through a factory that accounts for every input segment, so an instance _cannot_ exist in a
drop-violating state. (Design only — illustrative TypeScript, not for production yet.)

```ts
// domain/value-objects.ts — Value Objects (immutable, self-validating)
export class Pln {
  // non-negative integer PLN
  private constructor(readonly amount: number) {}
  static of(n: number): Pln {
    if (!Number.isInteger(n) || n < 0) throw new InvalidPlnError(n);
    return new Pln(n);
  }
}

// closed set — the 16 catalog categories (Step 3 Table Module)
export type CategorySlug =
  | "blocks-lego" | "blocks-duplo" | "book" | "toy-car" | "doll" | "puzzle"
  | "crayons" | "clothing-top" | "clothing-hat" | "snowsuit" | "rain-boots"
  | "balance-bike" | "stroller" | "car-seat" | "sandcastle-set" | "slide";

// domain/list-valuation.ts — Aggregate Root + guardian of INV-1
export type Classification =
  | { kind: "item"; item: StandardizedItem }
  | { kind: "unclassified"; reason: string };

export class ListValuation {
  private constructor(
    private readonly _items: ReadonlyArray<StandardizedItem>,
    private readonly _unclassified: ReadonlyArray<UnclassifiedItem>,
    private readonly _total: Pln,
  ) {}

  /** The ONLY constructor. Guarantees INV-1 (segment count === items + unclassified)
   *  and total === sum(estimated_pln). Throws a domain error otherwise. */
  static fromSegments(
    segments: ReadonlyArray<string>,
    classify: (segment: string) => Classification,
  ): ListValuation {
    const items: StandardizedItem[] = [];
    const unclassified: UnclassifiedItem[] = [];
    for (const seg of segments) {
      const c = classify(seg);
      if (c.kind === "item") items.push(c.item);
      else unclassified.push({ raw: seg, reason: c.reason });
    }
    const accounted = items.length + unclassified.length;
    if (accounted !== segments.length) throw new ItemConservationError(segments.length, accounted);
    const total = items.reduce((s, it) => s + it.estimated_pln, 0);
    return new ListValuation(items, unclassified, Pln.of(total));
  }

  items(): ReadonlyArray<StandardizedItem> { return this._items; }
  unclassified(): ReadonlyArray<UnclassifiedItem> { return this._unclassified; }
  total(): Pln { return this._total; }
  categories(): ReadonlySet<CategorySlug> { /* Set of item categories — for matching */ }
}
```

```ts
// domain/errors.ts — custom domain error types (not generic Error)
export class ItemConservationError extends Error {
  // INV-1 breach
  constructor(expected: number, accounted: number) {
    super(`item conservation breach: ${expected} segments in, ${accounted} accounted for`);
  }
}
export class ValuationTotalMismatchError extends Error {} // total != sum(items)
export class InvalidPlnError extends Error {} // VO guard
```

### Persistence boundary (Repository)

- `ListValuation` is a **transient** aggregate — computed per request, never persisted. It owns no
  identity and no DB row.
- The **persisted** aggregate is `Evaluation` (contract Markdown + verdict + delta + source +
  threshold) — the guardian of **INV-7 (historical immutability)**. Its repository exposes only
  append + read-verbatim, never update:

```ts
export interface EvaluationHistoryRepository {
  append(operatorId: OperatorId, evaluation: Evaluation): Promise<void>; // insert-only (FR-018)
  listFor(operatorId: OperatorId): Promise<ReadonlyArray<Evaluation>>; // most-recent-first, verbatim (FR-019)
}
```

The interface is **domain-typed** (no `SupabaseClient`) — the adapter that satisfies it lives in
Step 3's ACL. Insert-only + verbatim read makes INV-7 a _structural_ property of the port, not a
comment in `evaluation-history.ts:31`.

## 2.4 — Migration feasibility (guard first, change second)

- **Blast radius:** `ListValuation` replaces the `ProcessedList` interface internally; production
  fan-in of the engine is **1** (evaluate.ts) — the public `evaluate()` signature need not change.
- **Safety net:** `test/determinism.test.ts` (golden snapshot) + `test/evaluator-llm.test.ts` pin
  current bytes. Protocol: (1) add a characterization test asserting items + unclassified equals the
  input segment count for a drop-prone input on **both** stub and (mocked) LLM paths — it passes for
  stub and _exposes_ the LLM honor-system gap; (2) introduce `ListValuation.fromSegments` behind the
  unchanged engine; (3) re-run snapshot — must stay byte-identical.
- **Net effect:** INV-1 moves from "two procedures + a prompt sentence" to "impossible to construct
  a violating instance," and INV-7 from a doc comment to an insert-only port.
