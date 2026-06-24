import { describe, expect, it } from "vitest";

import { downsample, estimateTokens, PER_FILE_CAP_TOKENS, SOFT_CAP_TOKENS, type RawDiff } from "./downsample.ts";

/** Build a raw diff whose patch is `tokens`-ish in estimated size (~4 chars/token). */
const rawOfTokens = (path: string, tokens: number, staged = false): RawDiff => ({
  path,
  staged,
  patch: "x".repeat(tokens * 4),
});

describe("git-brief downsample — token estimate", () => {
  it("estimates ~1 token per 4 characters, rounding up", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
  });
});

describe("git-brief downsample — retention under budget", () => {
  it("keeps small, non-noise diffs with their patch text intact", () => {
    const { diffs, retainedTokens, omittedCount } = downsample([
      rawOfTokens("src/a.ts", 100, true),
      rawOfTokens("src/b.ts", 50),
    ]);
    expect(omittedCount).toBe(0);
    expect(retainedTokens).toBe(150);
    expect(diffs.every((d) => d.patch !== null && !d.omitted)).toBe(true);
    // staged flag is preserved through the ladder
    expect(diffs.find((d) => d.path === "src/a.ts")?.staged).toBe(true);
  });
});

describe("git-brief downsample — known-noise allowlist", () => {
  it.each([
    "package-lock.json",
    "pnpm-lock.yaml",
    "yarn.lock",
    "some/nested-lock.json",
    "Cargo.lock",
    "dist/bundle.js",
    "vendor/app.min.js",
  ])("omits %s to summary-line regardless of size", (path) => {
    // Tiny patch — well under every numeric cap; only the allowlist can omit it.
    const { diffs } = downsample([rawOfTokens(path, 5)]);
    const entry = diffs[0];
    expect(entry.omitted).toBe(true);
    expect(entry.patch).toBeNull();
    expect(entry.reason).toContain("known-noise");
    expect(entry.reason).toContain(path);
  });
});

describe("git-brief downsample — per-file cap", () => {
  it("omits a single oversized non-noise file", () => {
    const { diffs } = downsample([rawOfTokens("src/huge.ts", PER_FILE_CAP_TOKENS + 1)]);
    expect(diffs[0].omitted).toBe(true);
    expect(diffs[0].patch).toBeNull();
    expect(diffs[0].reason).toContain("per-file cap");
  });

  it("keeps a file exactly at the per-file cap", () => {
    const { diffs } = downsample([rawOfTokens("src/edge.ts", PER_FILE_CAP_TOKENS)]);
    expect(diffs[0].omitted).toBe(false);
    expect(diffs[0].patch).not.toBeNull();
  });
});

describe("git-brief downsample — global soft cap", () => {
  it("trims largest retained patches until total is under the soft cap", () => {
    // Six files, each under the per-file cap but summing well over the soft cap.
    const raw = Array.from({ length: 6 }, (_, i) => rawOfTokens(`src/f${i}.ts`, PER_FILE_CAP_TOKENS - 100));
    const { diffs, retainedTokens, omittedCount } = downsample(raw);
    expect(retainedTokens).toBeLessThanOrEqual(SOFT_CAP_TOKENS);
    expect(omittedCount).toBeGreaterThan(0);
    expect(diffs.some((d) => d.reason?.includes("global"))).toBe(true);
  });
});

describe("git-brief downsample — no silent drops invariant", () => {
  it("preserves array length and gives every omitted entry a reason + null patch", () => {
    const raw: RawDiff[] = [
      rawOfTokens("src/keep.ts", 100),
      rawOfTokens("package-lock.json", 5),
      rawOfTokens("src/huge.ts", PER_FILE_CAP_TOKENS + 500),
    ];
    const { diffs } = downsample(raw);
    expect(diffs).toHaveLength(raw.length); // nothing vanished
    for (const d of diffs) {
      if (d.omitted) {
        expect(d.patch).toBeNull();
        expect(d.reason).toBeTruthy();
      } else {
        expect(d.patch).not.toBeNull();
        expect(d.reason).toBeUndefined();
      }
    }
  });
});
