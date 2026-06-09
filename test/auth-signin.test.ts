import type { AstroCookies } from "astro";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Logger } from "@/lib/log";

// Mock the Supabase boundary only — never reach into the auth library itself
// (§7). createClient is configured per-test to a fake auth client, a null
// (unconfigured) client, or an error-returning client.
vi.mock("@/lib/supabase", () => ({ createClient: vi.fn() }));

import { createClient } from "@/lib/supabase";
import { POST } from "@/pages/api/auth/signin";

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
    request: new Request("http://localhost/api/auth/signin", { method: "POST", body: form }),
    cookies: {} as AstroCookies,
    locals: { log: makeLog(), requestId: "test-req", user: null },
    redirect: (location: string, status = 302) => new Response(null, { status, headers: { Location: location } }),
  };
  return ctx as unknown as Parameters<typeof POST>[0];
}

/** Parse the `Location` header of a redirect Response into a URL. */
function location(res: Response): URL {
  return new URL(res.headers.get("Location") ?? "", "http://localhost");
}

function mockAuth(impl: { signInWithPassword: () => Promise<unknown> } | null): void {
  vi.mocked(createClient).mockReturnValue((impl ? { auth: impl } : null) as unknown as ReturnType<typeof createClient>);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/auth/signin (R4 — endpoint)", () => {
  it("bounces bad credentials back to the form, preserving the redirect target", async () => {
    mockAuth({
      signInWithPassword: () => Promise.resolve({ data: null, error: { message: "Invalid login credentials" } }),
    });

    const res = await POST(makeContext({ email: "a@b.com", password: "wrong", redirect: "/dashboard" }));
    const loc = location(res);

    expect(loc.pathname).toBe("/auth/signin");
    expect(loc.searchParams.get("error")).toBe("Invalid login credentials");
    // The original destination survives the error bounce.
    expect(loc.searchParams.get("redirect")).toBe("/dashboard");
  });

  it("redirects a successful signin to the requested (sanitized) target", async () => {
    mockAuth({
      signInWithPassword: () => Promise.resolve({ data: { user: { id: "u1" } }, error: null }),
    });

    const res = await POST(makeContext({ email: "a@b.com", password: "ok", redirect: "/dashboard?tab=history" }));

    expect(res.headers.get("Location")).toBe("/dashboard?tab=history");
  });

  it("collapses a crafted off-site redirect to `/` on success (open-redirect guard at the endpoint)", async () => {
    mockAuth({
      signInWithPassword: () => Promise.resolve({ data: { user: { id: "u1" } }, error: null }),
    });

    const res = await POST(makeContext({ email: "a@b.com", password: "ok", redirect: "//evil.com" }));

    // safeRedirectPath rejects the protocol-relative URL; the endpoint honors it,
    // not just the unit function.
    expect(res.headers.get("Location")).toBe("/");
  });

  it("bounces with a 'not configured' error when Supabase is unavailable", async () => {
    mockAuth(null);

    const res = await POST(makeContext({ email: "a@b.com", password: "ok" }));
    const loc = location(res);

    expect(loc.pathname).toBe("/auth/signin");
    expect(loc.searchParams.get("error")).toBe("Supabase is not configured");
    // No redirect field supplied → defaults to the safe fallback.
    expect(loc.searchParams.get("redirect")).toBe("/");
  });
});
