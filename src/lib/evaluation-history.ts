import type { SupabaseClient } from "@supabase/supabase-js";

import type { EvaluateResponse, EvaluationHistoryItem, Verdict, EvaluationSource } from "@/types";

/**
 * S-03 (evaluation-history): per-user, append-only history of successful
 * evaluations (FR-018 / FR-019). One row per evaluation — `public.evaluation_history`
 * has no UNIQUE(user_id), so each save is a plain insert (not an upsert).
 *
 * Both functions follow the `user-lists.ts` / `counterparties.ts` contract: accept
 * a possibly null client (SUPABASE_URL/SUPABASE_KEY unset → null), throw on null or
 * query error, and preserve the Postgres error code via `cause` for classification.
 */

/** Shape of the read select, including the embedded counterparty name. */
interface HistoryRow {
  id: string;
  contract: string;
  counterparty_id: string | null;
  verdict: Verdict | null;
  delta_pln: number | null;
  threshold_pct: number;
  source: EvaluationSource;
  created_at: string;
  counterparties: { name: string } | null;
}

/**
 * Persist a successful evaluation verbatim (FR-018). Records every success,
 * including NO MATCH (counterparty_id/verdict/delta null). The contract is stored
 * exactly as generated — read back byte-identical, never re-rendered (PRD NFR).
 */
export async function saveEvaluation(
  client: SupabaseClient | null,
  userId: string,
  result: EvaluateResponse,
): Promise<void> {
  if (!client) {
    throw new Error("evaluation_history save unavailable: no Supabase client (SUPABASE_URL/SUPABASE_KEY unset)");
  }

  const { error } = await client.from("evaluation_history").insert({
    user_id: userId,
    contract: result.contract,
    counterparty_id: result.counterparty_id,
    verdict: result.verdict,
    delta_pln: result.delta_pln,
    threshold_pct: result.threshold_pct,
    source: result.source,
  });

  if (error) {
    throw new Error(`evaluation_history save failed: ${error.message}`, { cause: { code: error.code } });
  }
}

/**
 * Delete a single history row the user owns ("clear my history" entry). Scopes
 * the delete by BOTH `id` AND `user_id`: RLS already restricts deletes to the
 * caller's own rows (`evaluation_history_delete_own`), but the explicit
 * `user_id` filter is defense-in-depth mirroring the read path. A delete that
 * matches no row (wrong id, or someone else's row hidden by RLS) is a silent
 * no-op — not an error. Throws on a null client or a query error.
 */
export async function deleteEvaluation(client: SupabaseClient | null, userId: string, id: string): Promise<void> {
  if (!client) {
    throw new Error("evaluation_history delete unavailable: no Supabase client (SUPABASE_URL/SUPABASE_KEY unset)");
  }

  const { error } = await client.from("evaluation_history").delete().eq("id", id).eq("user_id", userId);

  if (error) {
    throw new Error(`evaluation_history delete failed: ${error.message}`, { cause: { code: error.code } });
  }
}

/**
 * Read the user's evaluation history, most recent first (FR-019). Resolves the
 * counterparty name via the embedded `counterparties(name)` join (null for
 * NO-MATCH rows). Returns an empty array for an account with no history. Throws
 * on a null client or a query error.
 */
export async function getEvaluationHistory(
  client: SupabaseClient | null,
  userId: string,
): Promise<EvaluationHistoryItem[]> {
  if (!client) {
    throw new Error("evaluation_history read unavailable: no Supabase client (SUPABASE_URL/SUPABASE_KEY unset)");
  }

  const { data, error } = await client
    .from("evaluation_history")
    .select(
      "id, contract, counterparty_id, verdict, delta_pln, threshold_pct, source, created_at, counterparties(name)",
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`evaluation_history read failed: ${error.message}`, { cause: { code: error.code } });
  }

  return (data as unknown as HistoryRow[]).map((row) => ({
    id: row.id,
    contract: row.contract,
    counterparty_id: row.counterparty_id,
    counterparty_name: row.counterparties?.name ?? null,
    verdict: row.verdict,
    delta_pln: row.delta_pln,
    threshold_pct: row.threshold_pct,
    source: row.source,
    created_at: row.created_at,
  }));
}
