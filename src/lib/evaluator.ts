import { generateObject } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";

import type {
  Condition,
  Counterparty,
  EvaluateResponse,
  ProcessedList,
  StandardizedItem,
  UnclassifiedItem,
  Verdict,
} from "@/types";
import { FIXTURE_POOL } from "@/lib/fixture-pool";

const KEYWORD_MAP: { patterns: RegExp[]; category: string; base_pln: number }[] = [
  { patterns: [/\bduplo\b/i], category: "blocks-duplo", base_pln: 35 },
  { patterns: [/\blego\b/i, /\bklocki\b/i], category: "blocks-lego", base_pln: 40 },
  { patterns: [/\bksi(?:ąż|az)/i, /\bbook\b/i], category: "book", base_pln: 12 },
  { patterns: [/\bauto?ko\b/i, /\bresorak/i, /\bhot ?wheels\b/i, /\btoy ?car\b/i], category: "toy-car", base_pln: 8 },
  { patterns: [/\bbarbie\b/i, /\blalk/i, /\bdoll\b/i], category: "doll", base_pln: 25 },
  { patterns: [/\bpuzzle\b/i], category: "puzzle", base_pln: 20 },
  { patterns: [/\bkred/i, /\bcrayon/i, /\bart supplies\b/i], category: "crayons", base_pln: 18 },
  { patterns: [/\bbluza\b/i, /\bhoodie\b/i], category: "clothing-top", base_pln: 30 },
  { patterns: [/\bkombinezon\b/i, /\bsnowsuit\b/i], category: "snowsuit", base_pln: 70 },
  { patterns: [/\bczapka\b/i, /\bhat\b/i], category: "clothing-hat", base_pln: 15 },
  { patterns: [/\bgumowce\b/i, /\brain ?boots\b/i, /\bżabki\b/i], category: "rain-boots", base_pln: 25 },
  { patterns: [/\browerek\b/i, /\bbalance ?bike\b/i, /\bbiegowy\b/i], category: "balance-bike", base_pln: 180 },
  { patterns: [/\bwóz(?:ek|ka)\b/i, /\bstroller\b/i], category: "stroller", base_pln: 250 },
  { patterns: [/\bfotelik\b/i, /\bcar ?seat\b/i], category: "car-seat", base_pln: 200 },
  {
    patterns: [/\bbucket\b/i, /\bkubki?\b/i, /\bsandcastle\b/i, /\bdo piasku\b/i],
    category: "sandcastle-set",
    base_pln: 22,
  },
  { patterns: [/\bzjeżdżaln/i, /\bslide\b/i], category: "slide", base_pln: 150 },
];

const CONDITION_MAP: { patterns: RegExp[]; condition: Condition; multiplier: number }[] = [
  { patterns: [/\bjak now[aey]\b/i, /\blike ?new\b/i], condition: "like-new", multiplier: 0.85 },
  { patterns: [/\bnow[aey]\b/i, /\bnew\b/i], condition: "new", multiplier: 1.0 },
  { patterns: [/\bbardzo dobry\b/i, /\bvery good\b/i], condition: "good", multiplier: 0.75 },
  { patterns: [/\bdobry stan\b/i, /\bdobra\b/i, /\bgood\b/i], condition: "good", multiplier: 0.65 },
  { patterns: [/\bużywan/i, /\bused\b/i], condition: "used", multiplier: 0.45 },
];

const BRANDS = ["LEGO", "Duplo", "H&M", "Reima", "Puky", "Disney", "Barbie", "Hot Wheels"];

function extractSize(s: string): string | undefined {
  const m = /\b(?:rozmiar\s+|size\s+)(\d{2,3})\b/i.exec(s);
  return m ? m[1] : undefined;
}

function extractBrand(s: string): string | undefined {
  for (const b of BRANDS) {
    if (new RegExp("\\b" + b.replace("&", "\\&") + "\\b", "i").test(s)) return b;
  }
  return undefined;
}

function extractQuantity(s: string): number {
  const m = /\bx\s?(\d+)\b/i.exec(s);
  return m ? parseInt(m[1], 10) : 1;
}

function classifyItemStub(raw: string): { item?: StandardizedItem; reason?: string } {
  const cleaned = raw.trim();
  if (!cleaned) return { reason: "empty entry" };

  const matched = KEYWORD_MAP.find((e) => e.patterns.some((p) => p.test(cleaned)));
  if (!matched) return { reason: "no known category keyword matched" };

  const condEntry = CONDITION_MAP.find((e) => e.patterns.some((p) => p.test(cleaned)));
  const multiplier = condEntry?.multiplier ?? 0.65;
  const condition = condEntry?.condition ?? "good";
  const quantity = extractQuantity(cleaned);
  const estimated_pln = Math.round(matched.base_pln * multiplier * quantity);

  return {
    item: {
      raw: cleaned,
      category: matched.category,
      brand: extractBrand(cleaned),
      size: extractSize(cleaned),
      condition,
      quantity,
      estimated_pln,
    },
  };
}

export function processListStub(text: string): ProcessedList {
  const splitter = text.includes(";") || text.includes("\n") ? /[;\n]+/ : /[,;\n]+/;
  const segments = text
    .split(splitter)
    .map((s) => s.trim())
    .filter(Boolean);
  const items: StandardizedItem[] = [];
  const unclassified: UnclassifiedItem[] = [];
  for (const seg of segments) {
    const r = classifyItemStub(seg);
    if (r.item) items.push(r.item);
    else unclassified.push({ raw: seg, reason: r.reason ?? "unknown" });
  }
  const total_pln = items.reduce((acc, it) => acc + it.estimated_pln, 0);
  return { items, unclassified, total_pln };
}

const LLMItemSchema = z.object({
  raw: z.string(),
  category: z.string(),
  brand: z.string().nullable(),
  size: z.string().nullable(),
  condition: z.enum(["new", "like-new", "good", "used"]).nullable(),
  quantity: z.number().int().min(1),
  estimated_pln: z.number().nonnegative(),
});

const ListResultSchema = z.object({
  items: z.array(LLMItemSchema),
  unclassified: z.array(z.object({ raw: z.string(), reason: z.string() })),
});

const LLM_SYSTEM = [
  "You are a deterministic catalog of children/toddler items.",
  "Given freeform Polish or English item descriptions, output structured JSON with PLN value estimates.",
  "Be byte-identical for the same input.",
  "Categories (use exactly these slugs): blocks-lego, blocks-duplo, book, toy-car, doll, puzzle, crayons, clothing-top, clothing-hat, snowsuit, rain-boots, balance-bike, stroller, car-seat, sandcastle-set, slide.",
  "Base prices PLN at condition=new: blocks-lego 40, blocks-duplo 35, book 12, toy-car 8, doll 25, puzzle 20, crayons 18, clothing-top 30, clothing-hat 15, snowsuit 70, rain-boots 25, balance-bike 180, stroller 250, car-seat 200, sandcastle-set 22, slide 150.",
  "Condition multipliers: new=1.0, like-new=0.85, good=0.65, used=0.45. Default to good if unspecified.",
  "Every input item appears exactly once in items OR unclassified with a one-line reason. No silent drops.",
].join(" ");

async function processListLLM(text: string, apiKey: string, baseURL?: string): Promise<ProcessedList> {
  const openai = createOpenAI(baseURL ? { apiKey, baseURL } : { apiKey });
  // TODO(v2.x): migrate to generateText with output schema; preserving v1 call shape
  // for byte-identical determinism until the migration is verified against the fixture pool.
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  const { object } = await generateObject({
    model: openai("gpt-4o-mini"),
    schema: ListResultSchema,
    temperature: 0,
    seed: 42,
    system: LLM_SYSTEM,
    prompt: `Items (one per line or separated by semicolons/commas):\n${text}`,
  });
  const items: StandardizedItem[] = object.items.map((it) => ({
    raw: it.raw,
    category: it.category,
    brand: it.brand ?? undefined,
    size: it.size ?? undefined,
    condition: it.condition ?? undefined,
    quantity: it.quantity,
    estimated_pln: it.estimated_pln,
  }));
  const total_pln = items.reduce((acc, it) => acc + it.estimated_pln, 0);
  return { items, unclassified: object.unclassified, total_pln };
}

const processedCache = new Map<string, ProcessedList>();

interface ProcessOptions {
  apiKey?: string;
  baseURL?: string;
  preferLLM: boolean;
}

type Source = "llm" | "stub" | "llm-failed-fallback";

async function processList(text: string, opts: ProcessOptions): Promise<{ processed: ProcessedList; source: Source }> {
  if (!(opts.preferLLM && opts.apiKey)) {
    const key = `stub::${text}`;
    const cached = processedCache.get(key);
    if (cached) return { processed: cached, source: "stub" };
    const processed = processListStub(text);
    processedCache.set(key, processed);
    return { processed, source: "stub" };
  }

  const llmKey = `llm::${text}`;
  const llmCached = processedCache.get(llmKey);
  if (llmCached) return { processed: llmCached, source: "llm" };

  try {
    const processed = await processListLLM(text, opts.apiKey, opts.baseURL);
    processedCache.set(llmKey, processed);
    return { processed, source: "llm" };
  } catch (err) {
    console.warn(
      "[evaluator] LLM standardization failed; falling back to stub:",
      err instanceof Error ? err.message : err,
    );
    const fbKey = `stub::${text}`;
    const fbCached = processedCache.get(fbKey);
    if (fbCached) return { processed: fbCached, source: "llm-failed-fallback" };
    const processed = processListStub(text);
    processedCache.set(fbKey, processed);
    return { processed, source: "llm-failed-fallback" };
  }
}

interface MatchCandidate {
  counterparty: Counterparty;
  cp_give: ProcessedList;
  cp_want: ProcessedList;
  matched_giving: number;
  matched_receiving: number;
  delta_pln: number;
}

function categorySet(list: ProcessedList): Set<string> {
  return new Set(list.items.map((i) => i.category));
}

async function findBestMatch(
  op_give: ProcessedList,
  op_want: ProcessedList,
  pool: Counterparty[],
  opts: ProcessOptions,
): Promise<MatchCandidate | null> {
  const op_give_cats = categorySet(op_give);
  const op_want_cats = categorySet(op_want);

  const candidates: MatchCandidate[] = [];
  for (const cp of pool) {
    const cpGive = (await processList(cp.give, opts)).processed;
    const cpWant = (await processList(cp.want, opts)).processed;
    const cpGiveCats = categorySet(cpGive);
    const cpWantCats = categorySet(cpWant);

    const receiving = [...op_want_cats].filter((c) => cpGiveCats.has(c)).length;
    const giving = [...op_give_cats].filter((c) => cpWantCats.has(c)).length;
    if (receiving === 0 || giving === 0) continue;

    const delta_pln = Math.abs(op_give.total_pln - cpGive.total_pln);
    candidates.push({
      counterparty: cp,
      cp_give: cpGive,
      cp_want: cpWant,
      matched_giving: giving,
      matched_receiving: receiving,
      delta_pln,
    });
  }

  if (candidates.length === 0) return null;
  candidates.sort(
    (a, b) =>
      a.delta_pln - b.delta_pln || b.matched_giving + b.matched_receiving - (a.matched_giving + a.matched_receiving),
  );
  return candidates[0];
}

function computeVerdict(totalA: number, totalB: number, thresholdPct: number): { verdict: Verdict; delta: number } {
  const delta = Math.abs(totalA - totalB);
  const maxTotal = Math.max(totalA, totalB);
  const ratio = maxTotal === 0 ? 0 : delta / maxTotal;
  return { verdict: ratio <= thresholdPct / 100 ? "FAIR" : "NEEDS BALANCING", delta };
}

function balancingSuggestion(
  op_give: ProcessedList,
  cp_give: ProcessedList,
  delta: number,
  thresholdPct: number,
): string {
  const heavier = op_give.total_pln >= cp_give.total_pln ? op_give : cp_give;
  const heavierLabel = op_give.total_pln >= cp_give.total_pln ? "operator" : "counterparty";
  if (heavier.items.length === 0) return "no balancing item available — manual negotiation required";
  const targetMax = Math.max(op_give.total_pln, cp_give.total_pln);
  const candidate = [...heavier.items]
    .sort((a, b) => Math.abs(a.estimated_pln - delta) - Math.abs(b.estimated_pln - delta))
    .find((it) => {
      const newHeavier = heavier.total_pln - it.estimated_pln;
      const otherTotal = heavier === op_give ? cp_give.total_pln : op_give.total_pln;
      const newDelta = Math.abs(newHeavier - otherTotal);
      const newMax = Math.max(newHeavier, otherTotal);
      const newRatio = newMax === 0 ? 0 : newDelta / newMax;
      return newRatio <= thresholdPct / 100;
    });
  if (!candidate)
    return `no balancing item available — manual negotiation required (delta ${delta} PLN on max ${targetMax} PLN)`;
  return `remove **${candidate.raw}** (~${candidate.estimated_pln} PLN) from the ${heavierLabel}'s side`;
}

function renderItemRow(it: StandardizedItem): string {
  const tags = [it.category, it.condition ?? "good", it.size ? `size ${it.size}` : null, it.brand ?? null]
    .filter((x): x is string => Boolean(x))
    .join(", ");
  const qty = it.quantity > 1 ? ` × ${it.quantity}` : "";
  return `- ${it.raw}${qty} — *(${tags})* — **${it.estimated_pln} PLN**`;
}

function renderUnclassified(items: UnclassifiedItem[]): string {
  if (items.length === 0) return "";
  const rows = items.map((u) => `- \`${u.raw}\` — ${u.reason}`).join("\n");
  return `\n## Couldn't classify\n\n${rows}\n`;
}

function renderNoMatchContract(op_give: ProcessedList, op_want: ProcessedList): string {
  const giveRows = op_give.items.map(renderItemRow).join("\n");
  const wantRows = op_want.items.map(renderItemRow).join("\n");
  return [
    "# ToySwapper Barter Contract",
    "",
    "**Verdict:** NO MATCH",
    "",
    "No counterparty in the fixture pool overlaps with your give-list **and** your want-list. Try widening either list.",
    "",
    "## Your give-list",
    "",
    giveRows || "*(no items classified)*",
    "",
    "## Your want-list",
    "",
    wantRows || "*(no items classified)*",
    renderUnclassified([...op_give.unclassified, ...op_want.unclassified]),
  ].join("\n");
}

interface RenderInput {
  operator_give: ProcessedList;
  operator_want: ProcessedList;
  counterparty: Counterparty;
  cp_give: ProcessedList;
  verdict: Verdict;
  delta_pln: number;
  threshold_pct: number;
}

function renderContract(input: RenderInput): string {
  const opGiveRows = input.operator_give.items.map(renderItemRow).join("\n");
  const cpGiveRows = input.cp_give.items.map(renderItemRow).join("\n");

  const lines: string[] = [
    "# ToySwapper Barter Contract",
    "",
    `**Counterparty:** ${input.counterparty.name} (\`${input.counterparty.id}\`)`,
    `**Verdict:** ${input.verdict}`,
    `**Delta:** ${input.delta_pln} PLN  (threshold: ${input.threshold_pct}% of larger side's total)`,
    "",
    "## Operator gives",
    "",
    opGiveRows || "*(no items classified)*",
    "",
    `**Operator total:** ${input.operator_give.total_pln} PLN`,
    "",
    `## ${input.counterparty.name} gives`,
    "",
    cpGiveRows || "*(no items classified)*",
    "",
    `**Counterparty total:** ${input.cp_give.total_pln} PLN`,
  ];

  if (input.verdict === "NEEDS BALANCING") {
    const suggestion = balancingSuggestion(input.operator_give, input.cp_give, input.delta_pln, input.threshold_pct);
    lines.push("", "## Balancing suggestion", "", suggestion);
  }

  const unclass = [...input.operator_give.unclassified, ...input.operator_want.unclassified];
  lines.push(renderUnclassified(unclass));

  return lines.join("\n");
}

export interface EvaluateOptions {
  apiKey?: string;
  baseURL?: string;
  thresholdPct: number;
}

export async function evaluate(give: string, want: string, opts: EvaluateOptions): Promise<EvaluateResponse> {
  const preferLLM = Boolean(opts.apiKey);
  const processOpts: ProcessOptions = { apiKey: opts.apiKey, baseURL: opts.baseURL, preferLLM };
  const { processed: op_give, source } = await processList(give, processOpts);
  const { processed: op_want } = await processList(want, processOpts);

  const match = await findBestMatch(op_give, op_want, FIXTURE_POOL, processOpts);
  if (!match) {
    return {
      contract: renderNoMatchContract(op_give, op_want),
      counterparty_id: null,
      verdict: null,
      delta_pln: null,
      threshold_pct: opts.thresholdPct,
      source,
    };
  }

  const { verdict, delta } = computeVerdict(op_give.total_pln, match.cp_give.total_pln, opts.thresholdPct);
  const contract = renderContract({
    operator_give: op_give,
    operator_want: op_want,
    counterparty: match.counterparty,
    cp_give: match.cp_give,
    verdict,
    delta_pln: delta,
    threshold_pct: opts.thresholdPct,
  });

  return {
    contract,
    counterparty_id: match.counterparty.id,
    verdict,
    delta_pln: delta,
    threshold_pct: opts.thresholdPct,
    source,
  };
}
