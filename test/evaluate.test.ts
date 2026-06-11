import type { AstroCookies } from "astro";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Logger, LogFields } from "@/lib/log";
import type { EvaluateResponse } from "@/types";

// Mocks are hoisted by Vitest above the imports below.
vi.mock("@/lib/supabase", () => ({ createClient: vi.fn(() => ({})) }));
vi.mock("@/lib/counterparties", () => ({ getCounterpartyPool: vi.fn() }));
vi.mock("@/lib/evaluator", () => ({ evaluate: vi.fn() }));
vi.mock("@/lib/user-lists", () => ({ saveUserLists: vi.fn() }));
vi.mock("@/lib/evaluation-history", () => ({ saveEvaluation: vi.fn() }));

import { getCounterpartyPool } from "@/lib/counterparties";
import { evaluate } from "@/lib/evaluator";
import { saveEvaluation } from "@/lib/evaluation-history";
import { POST } from "@/pages/api/evaluate";

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

function makeContext(body: unknown, log: Logger, user: { id: string } | null = null): Parameters<typeof POST>[0] {
  const ctx = {
    request: new Request("http://localhost/api/evaluate", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }),
    cookies: {} as AstroCookies,
    locals: { log, requestId: "test-req", user },
  };
  return ctx as unknown as Parameters<typeof POST>[0];
}

// Variant of makeContext that sends a RAW (non-JSON-stringified) body, so
// `request.json()` rejects — needed to exercise the invalid-JSON 400 path.
function makeRawContext(rawBody: string, log: Logger, user: { id: string } | null = null): Parameters<typeof POST>[0] {
  const ctx = {
    request: new Request("http://localhost/api/evaluate", {
      method: "POST",
      body: rawBody,
      headers: { "content-type": "application/json" },
    }),
    cookies: {} as AstroCookies,
    locals: { log, requestId: "test-req", user },
  };
  return ctx as unknown as Parameters<typeof POST>[0];
}

const OK_RESPONSE: EvaluateResponse = {
  contract: "# contract",
  counterparty_id: null,
  verdict: null,
  delta_pln: null,
  threshold_pct: 20,
  source: "stub",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/evaluate — structured logging", () => {
  it("logs evaluate.success on the happy path", async () => {
    vi.mocked(getCounterpartyPool).mockResolvedValue([]);
    vi.mocked(evaluate).mockResolvedValue(OK_RESPONSE);

    const { log, events } = makeLog();
    const res = await POST(makeContext({ give: "a", want: "b" }, log));

    expect(res.status).toBe(200);
    const success = events.find((e) => e.event === "evaluate.success");
    expect(success?.fields?.outcome).toBe("success");
    expect(typeof success?.fields?.duration_ms).toBe("number");
    expect(events.some((e) => e.event === "evaluate.failure")).toBe(false);
  });

  it("logs evaluate.failure (not db.rls_denied) when the evaluator throws a generic error", async () => {
    vi.mocked(getCounterpartyPool).mockResolvedValue([]);
    vi.mocked(evaluate).mockRejectedValue(new Error("boom"));

    const { log, events } = makeLog();
    const res = await POST(makeContext({ give: "a", want: "b" }, log));

    expect(res.status).toBe(500);
    expect(events.some((e) => e.event === "evaluate.failure")).toBe(true);
    expect(events.some((e) => e.event === "db.rls_denied")).toBe(false);
  });

  it("logs db.rls_denied when the pool read is RLS-denied (42501)", async () => {
    vi.mocked(getCounterpartyPool).mockRejectedValue(new Error("pool unavailable", { cause: { code: "42501" } }));

    const { log, events } = makeLog();
    const res = await POST(makeContext({ give: "a", want: "b" }, log));

    expect(res.status).toBe(500);
    expect(events.some((e) => e.event === "db.rls_denied")).toBe(true);
    expect(events.some((e) => e.event === "evaluate.failure")).toBe(false);
  });

  it("never logs give/want contents", async () => {
    vi.mocked(getCounterpartyPool).mockResolvedValue([]);
    vi.mocked(evaluate).mockResolvedValue(OK_RESPONSE);

    const { log, events } = makeLog();
    await POST(makeContext({ give: "SECRET_GIVE_LIST", want: "SECRET_WANT_LIST" }, log));

    const blob = JSON.stringify(events);
    expect(blob).not.toContain("SECRET_GIVE_LIST");
    expect(blob).not.toContain("SECRET_WANT_LIST");
  });

  it("persists evaluation history (best-effort) when a user is present", async () => {
    vi.mocked(getCounterpartyPool).mockResolvedValue([]);
    vi.mocked(evaluate).mockResolvedValue(OK_RESPONSE);

    const { log } = makeLog();
    const res = await POST(makeContext({ give: "a", want: "b" }, log, { id: "u1" }));

    expect(res.status).toBe(200);
    expect(vi.mocked(saveEvaluation)).toHaveBeenCalledOnce();
  });

  it("does not fail the response when the history save throws (best-effort)", async () => {
    vi.mocked(getCounterpartyPool).mockResolvedValue([]);
    vi.mocked(evaluate).mockResolvedValue(OK_RESPONSE);
    vi.mocked(saveEvaluation).mockRejectedValue(new Error("history db down"));

    const { log, events } = makeLog();
    const res = await POST(makeContext({ give: "a", want: "b" }, log, { id: "u1" }));

    expect(res.status).toBe(200);
    expect(events.some((e) => e.event === "evaluation_history.save_failed")).toBe(true);
  });
});

describe("POST /api/evaluate — input validation (400)", () => {
  it("returns 400 'invalid JSON body' on a malformed request body", async () => {
    const { log } = makeLog();
    const res = await POST(makeRawContext("{ not valid json", log));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid JSON body" });
    // Validation short-circuits before the engine and pool are reached.
    expect(vi.mocked(evaluate)).not.toHaveBeenCalled();
    expect(vi.mocked(getCounterpartyPool)).not.toHaveBeenCalled();
  });

  it("returns 400 'validation failed' with issues when give/want are missing or empty", async () => {
    const { log } = makeLog();
    const res = await POST(makeContext({ give: "" }, log)); // empty give, missing want

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; issues: unknown[] };
    expect(body.error).toBe("validation failed");
    expect(Array.isArray(body.issues)).toBe(true);
    expect(body.issues.length).toBeGreaterThan(0);
    expect(vi.mocked(evaluate)).not.toHaveBeenCalled();
  });

  it("returns 400 when threshold_pct is out of the 1–99 range", async () => {
    const { log } = makeLog();
    const res = await POST(makeContext({ give: "a", want: "b", threshold_pct: 100 }, log));

    expect(res.status).toBe(400);
    expect(vi.mocked(evaluate)).not.toHaveBeenCalled();
  });
});
