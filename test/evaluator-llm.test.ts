/* eslint-disable @typescript-eslint/no-deprecated --
   This spec must reference the deprecated `ai` `generateObject` export in order
   to mock it; the production evaluator still calls it (see the inline disable +
   TODO at src/lib/evaluator.ts) until the generateText migration is verified. */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Logger, LogFields } from "@/lib/log";
import type { Counterparty } from "@/types";

// Hoisted SDK mocks: the real evaluator imports `generateObject` from "ai"
// (the LLM call) and `createOpenAI` from "@ai-sdk/openai" (the model handle).
// Mocking both lets us drive the LLM and fallback branches with NO network /
// API key, so determinism is preserved and the suite stays hermetic.
vi.mock("ai", () => ({ generateObject: vi.fn() }));
vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: vi.fn(() => (modelId: string) => ({ modelId })),
}));

import { generateObject } from "ai";

import { evaluate } from "@/lib/evaluator";

// Empty pool ⇒ findBestMatch returns null ⇒ no counterparty processList calls,
// so generateObject is invoked exactly twice per evaluate() (give + want).
const EMPTY_POOL: Counterparty[] = [];
const THRESHOLD_PCT = 20;

interface Captured {
  level: "info" | "warn" | "error";
  event: string;
  fields?: LogFields;
}

function makeLog(): { log: Logger; events: Captured[] } {
  const events: Captured[] = [];
  const record =
    (level: Captured["level"]) =>
    (event: string, fields?: LogFields): void => {
      events.push({ level, event, fields });
    };
  const log: Logger = {
    info: record("info"),
    warn: record("warn"),
    error: record("error"),
    child: () => log,
  };
  return { log, events };
}

beforeEach(() => {
  vi.mocked(generateObject).mockReset();
});

describe("evaluator — LLM path", () => {
  it("returns source 'llm' and calls the model with temperature 0 + seed 42", async () => {
    // Unique inputs keep the module-level processedCache from bleeding across tests.
    vi.mocked(generateObject).mockResolvedValue({
      object: {
        items: [
          {
            raw: "llm-stroller-A1",
            category: "stroller",
            brand: null,
            size: null,
            condition: "good",
            quantity: 1,
            estimated_pln: 160,
          },
        ],
        unclassified: [],
      },
    } as unknown as Awaited<ReturnType<typeof generateObject>>);

    const result = await evaluate("llm-stroller-A1", "llm-bike-A1", EMPTY_POOL, {
      apiKey: "test-key",
      thresholdPct: THRESHOLD_PCT,
    });

    expect(result.source).toBe("llm");
    // TD2 proxy: determinism config is pinned on the LLM call.
    expect(generateObject).toHaveBeenCalledWith(expect.objectContaining({ temperature: 0, seed: 42 }));
  });

  it("does not silently drop items — classified and unclassified both surface (FR-004)", async () => {
    vi.mocked(generateObject).mockResolvedValue({
      object: {
        items: [
          {
            raw: "llm-doll-B2",
            category: "doll",
            brand: null,
            size: null,
            condition: "good",
            quantity: 1,
            estimated_pln: 16,
          },
        ],
        unclassified: [{ raw: "llm-mystery-B2", reason: "unrecognized by model" }],
      },
    } as unknown as Awaited<ReturnType<typeof generateObject>>);

    const result = await evaluate("llm-doll-B2; llm-mystery-B2", "llm-want-B2", EMPTY_POOL, {
      apiKey: "test-key",
      thresholdPct: THRESHOLD_PCT,
    });

    expect(result.source).toBe("llm");
    // Classified item is rendered, and the unrecognized one lands in the appendix.
    expect(result.contract).toContain("llm-doll-B2");
    expect(result.contract).toContain("## Couldn't classify");
    expect(result.contract).toContain("llm-mystery-B2");
    expect(result.contract).toContain("unrecognized by model");
  });
});

describe("evaluator — LLM failure fallback", () => {
  it("falls back to the stub with source 'llm-failed-fallback' and warns", async () => {
    vi.mocked(generateObject).mockRejectedValue(new Error("LLM upstream 503"));
    const { log, events } = makeLog();

    const result = await evaluate("llm-fail-stroller-C3", "llm-fail-want-C3", EMPTY_POOL, {
      apiKey: "test-key",
      thresholdPct: THRESHOLD_PCT,
      logger: log,
    });

    expect(result.source).toBe("llm-failed-fallback");
    expect(events.some((e) => e.level === "warn" && e.event === "evaluate.llm_fallback")).toBe(true);
    // Fallback still produces a valid (non-empty) contract via the stub path.
    expect(result.contract.length).toBeGreaterThan(0);
    expect(result.contract).toContain("ToySwapper Barter Contract");
  });

  it("does not leak the raw LLM error message into the warn fields verbatim as input", async () => {
    vi.mocked(generateObject).mockRejectedValue(new Error("boom"));
    const { log, events } = makeLog();

    await evaluate("llm-fail-bike-D4", "llm-fail-want-D4", EMPTY_POOL, {
      apiKey: "test-key",
      thresholdPct: THRESHOLD_PCT,
      logger: log,
    });

    const fallback = events.find((e) => e.event === "evaluate.llm_fallback");
    expect(fallback?.fields?.reason).toBe("boom");
  });
});
