import { beforeEach, describe, expect, it, vi } from "vitest";

// `astro:middleware` is a build-time virtual module; defineMiddleware is the
// identity wrapper at runtime, so stub it to return the handler as-is.
vi.mock("astro:middleware", () => ({ defineMiddleware: (fn: unknown) => fn }));
// Silence the request-bound logger and pin the request id for assertions.
vi.mock("@/lib/log", () => ({
  resolveRequestId: () => "test-req-id",
  createLogger: () => {
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: () => log };
    return log;
  },
}));
vi.mock("@/lib/supabase", () => ({ createClient: vi.fn() }));

import { createClient } from "@/lib/supabase";
import { onRequest } from "@/middleware";

type Middleware = (context: unknown, next: () => Promise<Response>) => Promise<Response>;
const handler = onRequest as unknown as Middleware;

function mockUser(user: { id: string } | null): void {
  if (user) {
    vi.mocked(createClient).mockReturnValue({
      auth: { getUser: () => Promise.resolve({ data: { user } }) },
    } as unknown as ReturnType<typeof createClient>);
  } else {
    // No client configured → middleware resolves locals.user to null (anon).
    vi.mocked(createClient).mockReturnValue(null);
  }
}

function makeContext(pathname: string, search = "") {
  const url = new URL("http://localhost" + pathname + search);
  return {
    url,
    request: new Request(url, { method: pathname.startsWith("/api/") ? "POST" : "GET" }),
    cookies: {},
    locals: {} as Record<string, unknown>,
    redirect: (location: string, status = 302) => new Response(null, { status, headers: { Location: location } }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("middleware gate (S-01)", () => {
  it("redirects an anonymous page request to sign-in with the sanitized target", async () => {
    mockUser(null);
    const next = vi.fn(() => Promise.resolve(new Response("ok", { status: 200 })));
    const res = await handler(makeContext("/"), next);

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/auth/signin?redirect=%2F");
    expect(res.headers.get("x-request-id")).toBe("test-req-id");
    expect(next).not.toHaveBeenCalled();
  });

  it("preserves a deep-link page target (path + query) through the redirect param", async () => {
    mockUser(null);
    const next = vi.fn(() => Promise.resolve(new Response("ok", { status: 200 })));
    const res = await handler(makeContext("/dashboard", "?tab=history"), next);

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/auth/signin?redirect=%2Fdashboard%3Ftab%3Dhistory");
  });

  it("returns 401 JSON (not a redirect) for an anonymous API request", async () => {
    mockUser(null);
    const next = vi.fn(() => Promise.resolve(new Response("ok", { status: 200 })));
    const res = await handler(makeContext("/api/evaluate"), next);

    expect(res.status).toBe(401);
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(res.headers.get("x-request-id")).toBe("test-req-id");
    expect(await res.json()).toEqual({ error: "unauthorized" });
    expect(next).not.toHaveBeenCalled();
  });

  it("lets an authenticated request through to the route", async () => {
    mockUser({ id: "u1" });
    const next = vi.fn(() => Promise.resolve(new Response("ok", { status: 200 })));
    const res = await handler(makeContext("/"), next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).toBe(200);
    expect(res.headers.get("x-request-id")).toBe("test-req-id");
  });

  it("does not gate the sign-in page (no redirect loop)", async () => {
    mockUser(null);
    const next = vi.fn(() => Promise.resolve(new Response("ok", { status: 200 })));
    const res = await handler(makeContext("/auth/signin"), next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).toBe(200);
  });
});
