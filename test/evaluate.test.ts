import type { AstroCookies } from "astro";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Logger, LogFields } from "@/lib/log";
import type { EvaluateResponse } from "@/types";

// Mocks are hoisted by Vitest above the imports below.
vi.mock("@/lib/supabase", () => ({ createClient: vi.fn(() => ({})) }));
vi.mock("@/lib/counterparties", () => ({ getCounterpartyPool: vi.fn() }));
vi.mock("@/lib/evaluator", () => ({ evaluate: vi.fn() }));

import { getCounterpartyPool } from "@/lib/counterparties";
import { evaluate } from "@/lib/evaluator";
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

function makeContext(body: unknown, log: Logger): Parameters<typeof POST>[0] {
  const ctx = {
    request: new Request("http://localhost/api/evaluate", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }),
    cookies: {} as AstroCookies,
    locals: { log, requestId: "test-req", user: null },
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
});
