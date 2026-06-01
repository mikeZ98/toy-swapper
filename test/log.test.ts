import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createLogger, isRlsDenied, resolveRequestId } from "@/lib/log";

interface LogLine {
  ts: string;
  level: string;
  event: string;
  request_id: string;
  route: string;
  method: string;
  user_id: string | null;
  outcome: "success" | "failure" | null;
  duration_ms?: number;
  error?: { name: string; message: string; stack?: string };
  [key: string]: unknown;
}

const BASE = { request_id: "req-1", route: "/api/x", method: "POST", user_id: "user-9" };

const out = { log: [] as string[], warn: [] as string[], error: [] as string[] };

beforeEach(() => {
  out.log = [];
  out.warn = [];
  out.error = [];
  // The logger only ever passes a single JSON string to console.* — typing the
  // mock param as string keeps the test free of `any`.
  vi.spyOn(console, "log").mockImplementation((line: string) => void out.log.push(line));
  vi.spyOn(console, "warn").mockImplementation((line: string) => void out.warn.push(line));
  vi.spyOn(console, "error").mockImplementation((line: string) => void out.error.push(line));
});

afterEach(() => {
  vi.restoreAllMocks();
});

const last = (arr: string[]): LogLine => JSON.parse(arr.at(-1) ?? "{}") as LogLine;

describe("createLogger — envelope", () => {
  it("emits every required field with the right types", () => {
    createLogger(BASE).info("evaluate.success", { outcome: "success", duration_ms: 12 });

    expect(out.log).toHaveLength(1);
    const line = last(out.log);
    expect(line).toMatchObject({
      level: "info",
      event: "evaluate.success",
      request_id: "req-1",
      route: "/api/x",
      method: "POST",
      user_id: "user-9",
      outcome: "success",
      duration_ms: 12,
    });
    // ts is a valid round-trippable ISO timestamp.
    expect(new Date(line.ts).toISOString()).toBe(line.ts);
  });

  it("defaults outcome to null and user_id to null when unset", () => {
    createLogger({ request_id: "r", route: "/", method: "GET" }).info("x");
    const line = last(out.log);
    expect(line.outcome).toBeNull();
    expect(line.user_id).toBeNull();
  });

  it("normalizes an Error into {name,message,stack}", () => {
    createLogger(BASE).error("evaluate.failure", { outcome: "failure", error: new Error("boom") });
    const line = last(out.error);
    expect(line.error?.name).toBe("Error");
    expect(line.error?.message).toBe("boom");
    expect(typeof line.error?.stack).toBe("string");
  });

  it("child() merges base fields (e.g. user_id after sign-in)", () => {
    createLogger({ ...BASE, user_id: null })
      .child({ user_id: "u-2" })
      .info("auth.signin", { outcome: "success" });
    expect(last(out.log).user_id).toBe("u-2");
  });
});

describe("createLogger — level threshold", () => {
  it("suppresses lines below the threshold", () => {
    const log = createLogger(BASE, { level: "warn" });
    log.info("hidden");
    expect(out.log).toHaveLength(0);
    log.warn("shown");
    expect(out.warn).toHaveLength(1);
    log.error("shown");
    expect(out.error).toHaveLength(1);
  });

  it("silent suppresses every level", () => {
    const log = createLogger(BASE, { level: "silent" });
    log.info("a");
    log.warn("b");
    log.error("c");
    expect(out.log).toHaveLength(0);
    expect(out.warn).toHaveLength(0);
    expect(out.error).toHaveLength(0);
  });
});

describe("createLogger — PII redaction", () => {
  it("never lets denylisted keys reach the output", () => {
    createLogger(BASE).info("auth.signin", {
      outcome: "success",
      email: "alice@example.com",
      password: "hunter2",
      access_token: "secret-token",
    });
    const raw = out.log.at(-1) ?? "";
    expect(raw).not.toContain("alice@example.com");
    expect(raw).not.toContain("hunter2");
    expect(raw).not.toContain("secret-token");
    const line = last(out.log);
    expect(line.email).toBeUndefined();
    expect(line.password).toBeUndefined();
    expect(line.access_token).toBeUndefined();
    // Non-PII fields still pass through.
    expect(line.outcome).toBe("success");
  });
});

describe("resolveRequestId", () => {
  it("honors a non-empty inbound x-request-id", () => {
    expect(resolveRequestId(new Headers({ "x-request-id": "abc123" }))).toBe("abc123");
  });

  it("mints a uuid when the header is absent or blank", () => {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    expect(resolveRequestId(new Headers())).toMatch(uuid);
    expect(resolveRequestId(new Headers({ "x-request-id": "   " }))).toMatch(uuid);
  });
});

describe("isRlsDenied", () => {
  it("detects Postgres 42501 directly, on an Error, and via cause", () => {
    expect(isRlsDenied({ code: "42501" })).toBe(true);
    expect(isRlsDenied(Object.assign(new Error("denied"), { code: "42501" }))).toBe(true);
    expect(isRlsDenied(new Error("wrap", { cause: { code: "42501" } }))).toBe(true);
  });

  it("is false for other codes and plain errors", () => {
    expect(isRlsDenied({ code: "23505" })).toBe(false);
    expect(isRlsDenied(new Error("plain"))).toBe(false);
    expect(isRlsDenied(null)).toBe(false);
    expect(isRlsDenied(undefined)).toBe(false);
  });
});
