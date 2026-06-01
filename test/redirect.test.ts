import { describe, expect, it } from "vitest";

import { safeRedirectPath } from "@/lib/redirect";

describe("safeRedirectPath", () => {
  it("allows same-site absolute paths", () => {
    expect(safeRedirectPath("/")).toBe("/");
    expect(safeRedirectPath("/dashboard")).toBe("/dashboard");
    expect(safeRedirectPath("/a/b?x=1#h")).toBe("/a/b?x=1#h");
  });

  it("rejects protocol-relative and scheme URLs", () => {
    expect(safeRedirectPath("//evil.com")).toBe("/");
    expect(safeRedirectPath("https://evil.com")).toBe("/");
    expect(safeRedirectPath("http:/evil")).toBe("/");
    expect(safeRedirectPath("javascript:alert(1)")).toBe("/");
  });

  it("rejects backslash tricks", () => {
    expect(safeRedirectPath("/\\evil")).toBe("/");
    expect(safeRedirectPath("\\\\evil")).toBe("/");
  });

  it("rejects whitespace / control characters", () => {
    expect(safeRedirectPath("/path\ninjection")).toBe("/");
    expect(safeRedirectPath("/with space")).toBe("/");
  });

  it("rejects missing leading slash and empty/nullish input", () => {
    expect(safeRedirectPath("dashboard")).toBe("/");
    expect(safeRedirectPath("")).toBe("/");
    expect(safeRedirectPath(null)).toBe("/");
    expect(safeRedirectPath(undefined)).toBe("/");
  });

  it("honors a custom fallback", () => {
    expect(safeRedirectPath("//evil.com", "/auth/signin")).toBe("/auth/signin");
  });
});
