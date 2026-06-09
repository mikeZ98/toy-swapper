import type { AstroCookies } from "astro";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Logger } from "@/lib/log";

// Mock the Supabase boundary only (§7).
vi.mock("@/lib/supabase", () => ({ createClient: vi.fn() }));

import { createClient } from "@/lib/supabase";
import { POST } from "@/pages/api/auth/signup";

function makeLog(): Logger {
  const log: Logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: () => log,
  };
  return log;
}

function makeContext(fields: Record<string, string>): Parameters<typeof POST>[0] {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  const ctx = {
    request: new Request("http://localhost/api/auth/signup", { method: "POST", body: form }),
    cookies: {} as AstroCookies,
    locals: { log: makeLog(), requestId: "test-req", user: null },
    redirect: (location: string, status = 302) => new Response(null, { status, headers: { Location: location } }),
  };
  return ctx as unknown as Parameters<typeof POST>[0];
}

function location(res: Response): URL {
  return new URL(res.headers.get("Location") ?? "", "http://localhost");
}

function mockAuth(impl: { signUp: () => Promise<unknown> } | null): void {
  vi.mocked(createClient).mockReturnValue((impl ? { auth: impl } : null) as unknown as ReturnType<typeof createClient>);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/auth/signup (R4 — endpoint)", () => {
  it("routes a successful signup to the confirm-email page", async () => {
    mockAuth({
      signUp: () => Promise.resolve({ data: { user: { id: "u1" } }, error: null }),
    });

    const res = await POST(makeContext({ email: "a@b.com", password: "secret6" }));

    expect(res.headers.get("Location")).toBe("/auth/confirm-email");
  });

  it("bounces a signup error back to the signup form with the message", async () => {
    mockAuth({
      signUp: () => Promise.resolve({ data: null, error: { message: "User already registered" } }),
    });

    const res = await POST(makeContext({ email: "a@b.com", password: "secret6" }));
    const loc = location(res);

    expect(loc.pathname).toBe("/auth/signup");
    expect(loc.searchParams.get("error")).toBe("User already registered");
  });

  it("bounces with a 'not configured' error when Supabase is unavailable", async () => {
    mockAuth(null);

    const res = await POST(makeContext({ email: "a@b.com", password: "secret6" }));
    const loc = location(res);

    expect(loc.pathname).toBe("/auth/signup");
    expect(loc.searchParams.get("error")).toBe("Supabase is not configured");
  });
});
