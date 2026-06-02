import type { SupabaseClient } from "@supabase/supabase-js";
import type { Verdict, EvaluationSource } from "@/types";

/** The fields persisted per successful evaluation (FR-018). */
export interface EvaluationInput {
  contract: string;
  verdict: Verdict | null;
  delta_pln: number | null;
  counterparty_id: string | null;
  threshold_pct: number;
  source: EvaluationSource;
}

/** A history row shaped for the /history page (FR-019). */
export interface EvaluationHistoryRow {
  id: string;
  verdict: Verdict | null;
  delta_pln: number | null;
  counterparty_id: string | null;
  counterparty_name: string | null;
  threshold_pct: number;
  source: EvaluationSource;
  created_at: string;
  contract: string;
}

/** Raw select row: the embedded `counterparties(name)` is a to-one join (or null). */
interface EvaluationRow {
  id: string;
  verdict: Verdict | null;
  delta_pln: number | null;
  counterparty_id: string | null;
  threshold_pct: number;
  source: EvaluationSource;
  created_at: string;
  contract: string;
  counterparties: { name: string } | null;
}

const HISTORY_LIMIT = 50;

/**
 * S-03 (evaluation-history): per-user append-only history of evaluations
 * (FR-018/019). Mirrors the `user-lists.ts` contract — accept a possibly null
 * client, throw on null or query error, preserve the Postgres error code via
 * `cause`. The table is append-only (select+insert only); there is no update.
 */
export async function saveEvaluation(
  client: SupabaseClient | null,
  userId: string,
  row: EvaluationInput,
): Promise<void> {
  if (!client) {
    throw new Error("evaluations save unavailable: no Supabase client (SUPABASE_URL/SUPABASE_KEY unset)");
  }

  const { error } = await client.from("evaluations").insert({ user_id: userId, ...row });

  if (error) {
    throw new Error(`evaluations save failed: ${error.message}`, { cause: { code: error.code } });
  }
}

/**
 * Reads the user's evaluation history, most-recent-first (created_at then seq,
 * both descending), capped at the 50 newest rows. Embeds the counterparty name
 * via the FK; a NO-MATCH row (null counterparty_id) maps to a null name.
 * Returns [] when the user has no history. Throws on null client or query error.
 */
export async function listEvaluations(client: SupabaseClient | null, userId: string): Promise<EvaluationHistoryRow[]> {
  if (!client) {
    throw new Error("evaluations read unavailable: no Supabase client (SUPABASE_URL/SUPABASE_KEY unset)");
  }

  const { data, error } = await client
    .from("evaluations")
    .select(
      "id, verdict, delta_pln, counterparty_id, threshold_pct, source, created_at, contract, counterparties(name)",
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .order("seq", { ascending: false })
    .limit(HISTORY_LIMIT);

  if (error) {
    throw new Error(`evaluations read failed: ${error.message}`, { cause: { code: error.code } });
  }

  return (data as unknown as EvaluationRow[]).map((r) => ({
    id: r.id,
    verdict: r.verdict,
    delta_pln: r.delta_pln,
    counterparty_id: r.counterparty_id,
    counterparty_name: r.counterparties?.name ?? null,
    threshold_pct: r.threshold_pct,
    source: r.source,
    created_at: r.created_at,
    contract: r.contract,
  }));
}
