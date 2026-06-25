import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CACHE_FILENAME, canonicalize, computeHash, readCache, writeCache, type CacheStore } from "./cache.ts";
import type { GitPayload } from "./types.ts";

/** A representative, fully-populated payload; override fields to vary state. */
function payload(overrides: Partial<GitPayload> = {}): GitPayload {
  return {
    repoName: "toyswapper",
    branch: "master",
    window: "24 hours ago",
    commits: [{ hash: "abc1234", subject: "feat: x" }],
    status: [{ path: "src/a.ts", xy: " M", staged: false }],
    untracked: ["src/new.ts"],
    diffs: [{ path: "src/a.ts", staged: false, sizeBytes: 10, tokens: 3, patch: "diff", omitted: false }],
    budget: { softCapTokens: 10000, perFileCapTokens: 2000, retainedTokens: 3, omittedCount: 0 },
    ...overrides,
  };
}

describe("git-brief cache — canonicalize", () => {
  it("serializes object keys in sorted order, independent of insertion order", () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(canonicalize({ b: 1, a: 2 })).toBe(canonicalize({ a: 2, b: 1 }));
  });

  it("sorts keys recursively in nested objects", () => {
    expect(canonicalize({ a: { y: 1, x: 2 } })).toBe(canonicalize({ a: { x: 2, y: 1 } }));
  });

  it("preserves array order (arrays are position-significant)", () => {
    expect(canonicalize([3, 1, 2])).toBe("[3,1,2]");
    expect(canonicalize([1, 2])).not.toBe(canonicalize([2, 1]));
  });

  it("handles primitives and null", () => {
    expect(canonicalize(null)).toBe("null");
    expect(canonicalize("x")).toBe('"x"');
    expect(canonicalize(42)).toBe("42");
    expect(canonicalize(true)).toBe("true");
  });
});

describe("git-brief cache — computeHash", () => {
  it("returns a 64-character hex SHA-256 digest", () => {
    expect(computeHash(payload())).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is identical for identical payloads", () => {
    expect(computeHash(payload())).toBe(computeHash(payload()));
  });

  it("is independent of top-level key insertion order", () => {
    const base = payload();
    const reordered = Object.fromEntries(Object.entries(base).reverse()) as GitPayload;
    expect(computeHash(reordered)).toBe(computeHash(base));
  });

  it("changes when any meaningful field changes", () => {
    const base = computeHash(payload());
    expect(computeHash(payload({ branch: "feature" }))).not.toBe(base);
    expect(computeHash(payload({ untracked: [] }))).not.toBe(base);
    expect(
      computeHash(
        payload({
          diffs: [
            { path: "src/a.ts", staged: false, sizeBytes: 10, tokens: 3, patch: null, omitted: true, reason: "x" },
          ],
        }),
      ),
    ).not.toBe(base);
  });
});

describe("git-brief cache — read/write round-trip", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "gb-cache-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns an empty store when the file does not exist", async () => {
    expect(await readCache(join(dir, CACHE_FILENAME))).toEqual({});
  });

  it("persists and reloads a store byte-for-byte", async () => {
    const file = join(dir, CACHE_FILENAME);
    const store: CacheStore = {
      deadbeef: { brief: "# brief\n- one\n", createdAt: "2026-06-24T00:00:00.000Z" },
    };
    await writeCache(file, store);
    expect(await readCache(file)).toEqual(store);
  });

  it("recovers from a corrupt cache file by starting fresh", async () => {
    const file = join(dir, CACHE_FILENAME);
    await writeFile(file, "{ this is not valid json", "utf8");
    expect(await readCache(file)).toEqual({});
  });
});
