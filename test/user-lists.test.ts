import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { saveUserLists, getUserLists } from "@/lib/user-lists";

interface QueryResult {
  data?: unknown;
  error?: unknown;
}

// Minimal fake of the Supabase query-builder chain used by user-lists.ts.
// `.from().upsert()` resolves to { error }; `.from().select().eq().maybeSingle()`
// resolves to { data, error }. `calls` captures arguments for assertions.
function makeClient(result: QueryResult) {
  const calls: Record<string, unknown> = {};
  const builder = {
    upsert: vi.fn((payload: unknown, opts: unknown) => {
      calls.upsertPayload = payload;
      calls.upsertOpts = opts;
      return Promise.resolve({ error: result.error ?? null });
    }),
    select: vi.fn(() => builder),
    eq: vi.fn((col: string, val: unknown) => {
      calls.eqCol = col;
      calls.eqVal = val;
      return builder;
    }),
    maybeSingle: vi.fn(() => Promise.resolve({ data: result.data ?? null, error: result.error ?? null })),
  };
  const client = {
    from: vi.fn((table: string) => {
      calls.table = table;
      return builder;
    }),
  };
  return { client: client as unknown as SupabaseClient, calls };
}

describe("saveUserLists", () => {
  it("throws when the client is null", async () => {
    await expect(saveUserLists(null, "user-1", "g", "w")).rejects.toThrow(/no Supabase client/);
  });

  it("upserts on user_id with the correct payload", async () => {
    const { client, calls } = makeClient({ error: null });
    await saveUserLists(client, "user-1", "give-text", "want-text");

    expect(calls.table).toBe("user_lists");
    expect(calls.upsertOpts).toEqual({ onConflict: "user_id" });
    const payload = calls.upsertPayload as Record<string, unknown>;
    expect(payload.user_id).toBe("user-1");
    expect(payload.give_text).toBe("give-text");
    expect(payload.want_text).toBe("want-text");
    expect(typeof payload.saved_at).toBe("string");
  });

  it("propagates a DB error", async () => {
    const { client } = makeClient({ error: { message: "boom", code: "42501" } });
    await expect(saveUserLists(client, "user-1", "g", "w")).rejects.toThrow(/user_lists save failed: boom/);
  });
});

describe("getUserLists", () => {
  it("throws when the client is null", async () => {
    await expect(getUserLists(null, "user-1")).rejects.toThrow(/no Supabase client/);
  });

  it("returns null when the user has no saved row", async () => {
    const { client, calls } = makeClient({ data: null });
    const result = await getUserLists(client, "user-1");

    expect(result).toBeNull();
    expect(calls.eqCol).toBe("user_id");
    expect(calls.eqVal).toBe("user-1");
  });

  it("maps give_text/want_text to { give, want }", async () => {
    const { client } = makeClient({ data: { give_text: "saved-give", want_text: "saved-want" } });
    const result = await getUserLists(client, "user-1");

    expect(result).toEqual({ give: "saved-give", want: "saved-want" });
  });

  it("propagates a DB error", async () => {
    const { client } = makeClient({ error: { message: "kaboom", code: "XX000" } });
    await expect(getUserLists(client, "user-1")).rejects.toThrow(/user_lists read failed: kaboom/);
  });
});
