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

export type EvaluationSource = "llm" | "stub" | "llm-failed-fallback";

export interface EvaluateRequest {
  give: string;
  want: string;
}

export interface EvaluateResponse {
  contract: string;
  counterparty_id: string | null;
  verdict: Verdict | null;
  delta_pln: number | null;
  threshold_pct: number;
  source: EvaluationSource;
}
