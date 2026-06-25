import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { saveEvaluation, getEvaluationHistory, deleteEvaluation } from "@/lib/evaluation-history";
import type { EvaluateResponse } from "@/types";

interface QueryResult {
  data?: unknown;
  error?: unknown;
}

// Minimal fake of the Supabase query-builder chain used by evaluation-history.ts.
// `.from().insert()` resolves to { error }; the read chain is
// `.from().select().eq().order()` where `.order()` is the TERMINAL call that
// resolves to { data, error } (the divergence from user-lists, which terminates
// on `.maybeSingle()`). `calls` captures arguments for assertions.
// The delete chain is `.from().delete().eq("id").eq("user_id")`, terminating by
// awaiting the builder itself (supabase filter builders are thenable). So the
// builder exposes a `then` that resolves to { error } and `eq` records every
// call in `eqCalls` (the read path still reads the singular eqCol/eqVal).
function makeClient(result: QueryResult) {
  const calls: Record<string, unknown> = {};
  const eqCalls: { col: string; val: unknown }[] = [];
  calls.eqCalls = eqCalls;
  const builder = {
    insert: vi.fn((payload: unknown) => {
      calls.insertPayload = payload;
      return Promise.resolve({ error: result.error ?? null });
    }),
    delete: vi.fn(() => {
      calls.deleteCalled = true;
      return builder;
    }),
    select: vi.fn((cols: string) => {
      calls.selectCols = cols;
      return builder;
    }),
    eq: vi.fn((col: string, val: unknown) => {
      calls.eqCol = col;
      calls.eqVal = val;
      eqCalls.push({ col, val });
      return builder;
    }),
    order: vi.fn((col: string, opts: unknown) => {
      calls.orderCol = col;
      calls.orderOpts = opts;
      return Promise.resolve({ data: result.data ?? null, error: result.error ?? null });
    }),
    // Thenable terminal for the delete chain (no .order()/.maybeSingle() tail).
    then: (resolve: (v: QueryResult) => unknown) => resolve({ data: result.data ?? null, error: result.error ?? null }),
  };
  const client = {
    from: vi.fn((table: string) => {
      calls.table = table;
      return builder;
    }),
  };
  return { client: client as unknown as SupabaseClient, calls };
}

const OK_RESPONSE: EvaluateResponse = {
  contract: "# Trade contract\n\nAcme Toys ↔ you",
  counterparty_id: "acme",
  verdict: "FAIR",
  delta_pln: 10,
  threshold_pct: 20,
  source: "stub",
};

describe("saveEvaluation", () => {
  it("throws when the client is null", async () => {
    await expect(saveEvaluation(null, "user-1", OK_RESPONSE)).rejects.toThrow(/no Supabase client/);
  });

  it("inserts the evaluation with the FR-018 payload", async () => {
    const { client, calls } = makeClient({ error: null });
    await saveEvaluation(client, "user-1", OK_RESPONSE);

    expect(calls.table).toBe("evaluation_history");
    const payload = calls.insertPayload as Record<string, unknown>;
    expect(payload).toEqual({
      user_id: "user-1",
      contract: OK_RESPONSE.contract,
      counterparty_id: OK_RESPONSE.counterparty_id,
      verdict: OK_RESPONSE.verdict,
      delta_pln: OK_RESPONSE.delta_pln,
      threshold_pct: OK_RESPONSE.threshold_pct,
      source: OK_RESPONSE.source,
    });
  });

  it("records a NO-MATCH evaluation (null counterparty / verdict / delta)", async () => {
    const noMatch: EvaluateResponse = {
      contract: "# No match",
      counterparty_id: null,
      verdict: null,
      delta_pln: null,
      threshold_pct: 20,
      source: "stub",
    };
    const { client, calls } = makeClient({ error: null });
    await saveEvaluation(client, "user-1", noMatch);

    const payload = calls.insertPayload as Record<string, unknown>;
    expect(payload.counterparty_id).toBeNull();
    expect(payload.verdict).toBeNull();
    expect(payload.delta_pln).toBeNull();
  });

  it("propagates a DB error and preserves the Postgres code via cause", async () => {
    const { client } = makeClient({ error: { message: "boom", code: "42501" } });
    await expect(saveEvaluation(client, "user-1", OK_RESPONSE)).rejects.toThrow(/evaluation_history save failed: boom/);
    await expect(saveEvaluation(client, "user-1", OK_RESPONSE)).rejects.toMatchObject({ cause: { code: "42501" } });
  });
});

describe("getEvaluationHistory", () => {
  it("throws when the client is null", async () => {
    await expect(getEvaluationHistory(null, "user-1")).rejects.toThrow(/no Supabase client/);
  });

  it("queries evaluation_history filtered by user, most-recent-first", async () => {
    const { client, calls } = makeClient({ data: [] });
    await getEvaluationHistory(client, "user-1");

    expect(calls.table).toBe("evaluation_history");
    expect(calls.eqCol).toBe("user_id");
    expect(calls.eqVal).toBe("user-1");
    expect(calls.orderCol).toBe("created_at");
    expect(calls.orderOpts).toEqual({ ascending: false });
  });

  it("returns an empty array for an account with no history", async () => {
    const { client } = makeClient({ data: [] });
    expect(await getEvaluationHistory(client, "user-1")).toEqual([]);
  });

  it("maps a matched row and a NO-MATCH row, resolving the joined counterparty name", async () => {
    const { client } = makeClient({
      data: [
        {
          id: "row-1",
          contract: "# matched",
          counterparty_id: "acme",
          verdict: "FAIR",
          delta_pln: 10,
          threshold_pct: 20,
          source: "stub",
          created_at: "2026-06-10T10:00:00Z",
          counterparties: { name: "Acme Toys" },
        },
        {
          id: "row-2",
          contract: "# no match",
          counterparty_id: null,
          verdict: null,
          delta_pln: null,
          threshold_pct: 20,
          source: "stub",
          created_at: "2026-06-10T09:00:00Z",
          counterparties: null,
        },
      ],
    });

    const result = await getEvaluationHistory(client, "user-1");
    expect(result).toEqual([
      {
        id: "row-1",
        contract: "# matched",
        counterparty_id: "acme",
        counterparty_name: "Acme Toys",
        verdict: "FAIR",
        delta_pln: 10,
        threshold_pct: 20,
        source: "stub",
        created_at: "2026-06-10T10:00:00Z",
      },
      {
        id: "row-2",
        contract: "# no match",
        counterparty_id: null,
        counterparty_name: null,
        verdict: null,
        delta_pln: null,
        threshold_pct: 20,
        source: "stub",
        created_at: "2026-06-10T09:00:00Z",
      },
    ]);
  });

  it("propagates a DB error and preserves the Postgres code via cause", async () => {
    const { client } = makeClient({ error: { message: "kaboom", code: "XX000" } });
    await expect(getEvaluationHistory(client, "user-1")).rejects.toThrow(/evaluation_history read failed: kaboom/);
    await expect(getEvaluationHistory(client, "user-1")).rejects.toMatchObject({ cause: { code: "XX000" } });
  });

  // R5 (PRD FR-018/FR-019, NFR): the stored contract blob is the FROZEN source
  // of truth — served byte-identical, never re-rendered from live pool data. We
  // prove this by storing a contract that embeds a counterparty's name at save
  // time, then having the live counterparties(name) join return a DIFFERENT
  // (renamed) value. The returned contract must still match the stored bytes
  // verbatim, while counterparty_name reflects the live join.
  it("serves the stored contract byte-identical even when the live counterparty was renamed", async () => {
    const STORED_CONTRACT = "# Trade with Alice's Toys\n\n- Lego ↔ Brio\n\nVerdict: FAIR (delta 5 PLN)";
    const { client } = makeClient({
      data: [
        {
          id: "row-1",
          contract: STORED_CONTRACT,
          counterparty_id: "alices-toys",
          verdict: "FAIR",
          delta_pln: 5,
          threshold_pct: 20,
          source: "stub",
          created_at: "2026-06-10T10:00:00Z",
          // The pool was edited after the evaluation was persisted: the live
          // join now resolves a renamed name.
          counterparties: { name: "Renamed Co" },
        },
      ],
    });

    const [item] = await getEvaluationHistory(client, "user-1");

    // Byte-identical: the contract still embeds the ORIGINAL name, untouched by
    // the live rename — proving it is not reconstructed from counterparty_id.
    expect(item.contract).toBe(STORED_CONTRACT);
    expect(item.contract).toContain("Alice's Toys");
    // The list label, by contrast, reflects the live join.
    expect(item.counterparty_name).toBe("Renamed Co");
  });
});

describe("deleteEvaluation", () => {
  it("throws when the client is null", async () => {
    await expect(deleteEvaluation(null, "user-1", "row-1")).rejects.toThrow(/no Supabase client/);
  });

  it("deletes the row scoped by BOTH id and user_id (defense-in-depth)", async () => {
    const { client, calls } = makeClient({ error: null });
    await deleteEvaluation(client, "user-1", "row-1");

    expect(calls.table).toBe("evaluation_history");
    expect(calls.deleteCalled).toBe(true);
    expect(calls.eqCalls).toEqual([
      { col: "id", val: "row-1" },
      { col: "user_id", val: "user-1" },
    ]);
  });

  it("propagates a DB error and preserves the Postgres code via cause", async () => {
    const { client } = makeClient({ error: { message: "nope", code: "42501" } });
    await expect(deleteEvaluation(client, "user-1", "row-1")).rejects.toThrow(/evaluation_history delete failed: nope/);
    await expect(deleteEvaluation(client, "user-1", "row-1")).rejects.toMatchObject({ cause: { code: "42501" } });
  });
});
