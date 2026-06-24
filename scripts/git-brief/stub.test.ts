import { describe, expect, it } from "vitest";

import { stubSections } from "./stub.ts";
import type { GitPayload } from "./types.ts";

function payload(overrides: Partial<GitPayload> = {}): GitPayload {
  return {
    repoName: "toyswapper",
    branch: "master",
    window: "24 hours ago",
    commits: [],
    status: [],
    untracked: [],
    diffs: [],
    budget: { softCapTokens: 10000, perFileCapTokens: 2000, retainedTokens: 0, omittedCount: 0 },
    ...overrides,
  };
}

describe("git-brief stub — landed (commit grouping)", () => {
  it("groups commits by conventional-commit prefix and counts them", () => {
    const { landed } = stubSections(
      payload({
        commits: [
          { hash: "a1", subject: "feat(api): add route" },
          { hash: "a2", subject: "fix: null guard" },
          { hash: "a3", subject: "feat: second feature" },
          { hash: "a4", subject: "chore!: bump deps" },
        ],
      }),
    );
    // alphabetical by theme: chore, feat, fix
    expect(landed.map((l) => [l.theme, l.commits])).toEqual([
      ["chore", 1],
      ["feat", 2],
      ["fix", 1],
    ]);
    // prefix is stripped from the summary
    const feat = landed.find((l) => l.theme === "feat");
    expect(feat?.summary).toBe("add route; second feature");
  });

  it("buckets non-conventional subjects under 'other'", () => {
    const { landed } = stubSections(payload({ commits: [{ hash: "z1", subject: "WIP random stuff" }] }));
    expect(landed).toEqual([{ theme: "other", summary: "WIP random stuff", commits: 1 }]);
  });
});

describe("git-brief stub — inflight (directory streams)", () => {
  it("clusters files by directory and splits staged vs unstaged", () => {
    const { inflight } = stubSections(
      payload({
        status: [
          { path: "scripts/git-brief/stub.ts", xy: "A ", staged: true },
          { path: "scripts/git-brief/index.ts", xy: "M ", staged: true },
          { path: "scripts/git-brief/notes.md", xy: " M", staged: false },
          { path: "README.md", xy: " M", staged: false },
        ],
      }),
    );
    expect(inflight).toEqual([
      { stream: "(root)", state: "unstaged", detail: "README.md" },
      { stream: "scripts/git-brief/", state: "staged", detail: "stub.ts, index.ts" },
      { stream: "scripts/git-brief/", state: "unstaged", detail: "notes.md" },
    ]);
  });
});

describe("git-brief stub — risks", () => {
  it("flags a dirty working tree and untracked drift with counts", () => {
    const { risks } = stubSections(
      payload({
        status: [{ path: "src/a.ts", xy: " M", staged: false }],
        untracked: ["a", "b", "c", "d"],
      }),
    );
    expect(risks).toEqual([
      { kind: "dirty working tree", evidence: "1 tracked file(s) with uncommitted changes" },
      { kind: "untracked drift", evidence: "4 untracked file(s): a, b, c (+1 more)" },
    ]);
  });

  it("reports no risks on a clean tree", () => {
    expect(stubSections(payload()).risks).toEqual([]);
  });
});

describe("git-brief stub — determinism & empty input", () => {
  it("returns all-empty sections for an empty payload", () => {
    expect(stubSections(payload())).toEqual({ landed: [], inflight: [], risks: [] });
  });

  it("is a pure function — identical input yields identical output", () => {
    const p = payload({
      commits: [{ hash: "a1", subject: "feat: x" }],
      status: [{ path: "src/a.ts", xy: " M", staged: false }],
      untracked: ["scratch.ts"],
    });
    expect(stubSections(p)).toEqual(stubSections(p));
  });
});
