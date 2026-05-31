import type { SupabaseClient } from "@supabase/supabase-js";

import type { Counterparty } from "@/types";

interface CounterpartyRow {
  id: string;
  name: string;
  give: string;
  want: string;
}

/**
 * Reads the shared counterparty pool from `public.counterparties`, ordered by
 * `sort_order` so the evaluator's stable-sort tie-breaking stays byte-identical
 * to the original v1 pool ordering.
 *
 * The pool is required infrastructure: this throws on a null client, a query
 * error, or zero rows so the caller surfaces a 500 rather than silently
 * producing a wrong/empty contract. There is no in-process fallback (F-02
 * deleted the hardcoded pool).
 */
export async function getCounterpartyPool(client: SupabaseClient | null): Promise<Counterparty[]> {
  if (!client) {
    throw new Error("counterparty pool unavailable: no Supabase client (SUPABASE_URL/SUPABASE_KEY unset)");
  }

  const { data, error } = await client
    .from("counterparties")
    .select("id, name, give, want")
    .order("sort_order", { ascending: true });

  if (error) {
    // Preserve the Postgres error code (e.g. 42501 RLS denial) via `cause` so
    // callers can classify it — see isRlsDenied in @/lib/log.
    throw new Error(`counterparty pool unavailable: ${error.message}`, { cause: { code: error.code } });
  }
  if (data.length === 0) {
    throw new Error("counterparty pool unavailable: zero rows returned");
  }

  return (data as CounterpartyRow[]).map((row) => ({
    id: row.id,
    name: row.name,
    give: row.give,
    want: row.want,
  }));
}
