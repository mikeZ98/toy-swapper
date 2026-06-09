export type Condition = "new" | "like-new" | "good" | "used";

export interface StandardizedItem {
  raw: string;
  category: string;
  brand?: string;
  size?: string;
  condition?: Condition;
  quantity: number;
  estimated_pln: number;
}

export interface UnclassifiedItem {
  raw: string;
  reason: string;
}

export interface ProcessedList {
  items: StandardizedItem[];
  unclassified: UnclassifiedItem[];
  total_pln: number;
}

export interface Counterparty {
  id: string;
  name: string;
  give: string;
  want: string;
}

export type Verdict = "FAIR" | "NEEDS BALANCING";

export interface EvaluateRequest {
  give: string;
  want: string;
}

export type EvaluationSource = "llm" | "stub" | "llm-failed-fallback";

export interface EvaluateResponse {
  contract: string;
  counterparty_id: string | null;
  verdict: Verdict | null;
  delta_pln: number | null;
  threshold_pct: number;
  source: EvaluationSource;
}

/**
 * A persisted evaluation-history row as shown on `/history` (S-03 / FR-019):
 * the FR-018 fields plus the resolved counterparty name (joined at read from
 * `counterparties`, null for NO-MATCH rows) and the row id / server timestamp.
 */
export interface EvaluationHistoryItem {
  id: string;
  contract: string;
  counterparty_id: string | null;
  counterparty_name: string | null;
  verdict: Verdict | null;
  delta_pln: number | null;
  threshold_pct: number;
  source: EvaluationSource;
  created_at: string;
}
