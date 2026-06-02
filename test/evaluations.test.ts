import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { saveEvaluation, listEvaluations } from "@/lib/evaluations";

interface QueryResult {
  data?: unknown;
  error?: unknown;
}

// Minimal fake of the Supabase query-builder chain used by evaluations.ts.
// save: .from().insert() resolves to { error }.
// list: .from().select().eq().order().order().limit() resolves to { data, error }.
function makeClient(result: QueryResult) {
  const calls: Record<string, unknown> = {};
  const orders: { col: string; opts: unknown }[] = [];
  const builder = {
    insert: vi.fn((payload: unknown) => {
      calls.insertPayload = payload;
      return Promise.resolve({ error: result.error ?? null });
    }),
    select: vi.fn(() => builder),
    eq: vi.fn((col: string, val: unknown) => {
      calls.eqCol = col;
      calls.eqVal = val;
      return builder;
    }),
    order: vi.fn((col: string, opts: unknown) => {
      orders.push({ col, opts });
      return builder;
    }),
    limit: vi.fn((n: number) => {
      calls.limit = n;
      return Promise.resolve({ data: result.data ?? null, error: result.error ?? null });
    }),
  };
  const client = {
    from: vi.fn((table: string) => {
      calls.table = table;
      return builder;
    }),
  };
  return { client: client as unknown as SupabaseClient, calls, orders };
}

describe("saveEvaluation", () => {
  const row = {
    contract: "# contract",
    verdict: "FAIR" as string | null,
    delta_pln: 12 as number | null,
    counterparty_id: "kasia-warszawa" as string | null,
    threshold_pct: 20,
    source: "stub",
  };

  it("throws when the client is null", async () => {
    await expect(saveEvaluation(null, "user-1", row)).rejects.toThrow(/no Supabase client/);
  });

  it("inserts the row with user_id and all evaluation fields", async () => {
    const { client, calls } = makeClient({ error: null });
    await saveEvaluation(client, "user-1", row);

    expect(calls.table).toBe("evaluations");
    expect(calls.insertPayload).toEqual({ user_id: "user-1", ...row });
  });

  it("propagates a DB error", async () => {
    const { client } = makeClient({ error: { message: "boom", code: "23514" } });
    await expect(saveEvaluation(client, "user-1", row)).rejects.toThrow(/evaluations save failed: boom/);
  });
});

describe("listEvaluations", () => {
  it("throws when the client is null", async () => {
    await expect(listEvaluations(null, "user-1")).rejects.toThrow(/no Supabase client/);
  });

  it("orders newest-first, limits to 50, and maps the embedded counterparty name", async () => {
    const { client, calls, orders } = makeClient({
      data: [
        {
          id: "e1",
          verdict: "FAIR",
          delta_pln: 0,
          counterparty_id: "kasia-warszawa",
          threshold_pct: 20,
          source: "stub",
          created_at: "2026-06-01T10:00:00Z",
          contract: "# c1",
          counterparties: { name: "Kasia (Warszawa)" },
        },
        {
          id: "e2",
          verdict: null,
          delta_pln: null,
          counterparty_id: null,
          threshold_pct: 20,
          source: "stub",
          created_at: "2026-06-01T09:00:00Z",
          contract: "# c2",
          counterparties: null,
        },
      ],
    });

    const rows = await listEvaluations(client, "user-1");

    expect(calls.table).toBe("evaluations");
    expect(calls.eqCol).toBe("user_id");
    expect(calls.eqVal).toBe("user-1");
    expect(orders).toEqual([
      { col: "created_at", opts: { ascending: false } },
      { col: "seq", opts: { ascending: false } },
    ]);
    expect(calls.limit).toBe(50);

    expect(rows[0].counterparty_name).toBe("Kasia (Warszawa)");
    expect(rows[1].counterparty_name).toBeNull();
    expect(rows[1].counterparty_id).toBeNull();
    expect(rows[0].contract).toBe("# c1");
  });

  it("propagates a query error", async () => {
    const { client } = makeClient({ error: { message: "kaboom", code: "XX000" } });
    await expect(listEvaluations(client, "user-1")).rejects.toThrow(/evaluations read failed: kaboom/);
  });
});
