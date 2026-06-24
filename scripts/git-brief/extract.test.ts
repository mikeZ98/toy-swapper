import { describe, expect, it } from "vitest";

import { parseLog, parseStatus, splitDiff } from "./extract.ts";

describe("git-brief extract — parseStatus", () => {
  it("splits tracked changes from untracked and resolves the staged flag", () => {
    // Porcelain v1: two status chars + space + path. Index col set => staged.
    const out = [
      "M  src/staged-only.ts", // staged (index M, worktree clean)
      " M src/unstaged.ts", //    unstaged (index clean, worktree M)
      "MM src/both.ts", //        staged AND further unstaged edits
      "A  src/added.ts", //       newly staged add
      "?? src/new.ts", //         untracked
      "?? docs/notes.md", //      untracked
    ].join("\n");

    const { status, untracked } = parseStatus(out);

    expect(untracked).toEqual(["src/new.ts", "docs/notes.md"]);
    expect(status).toHaveLength(4);

    const byPath = Object.fromEntries(status.map((s) => [s.path, s]));
    expect(byPath["src/staged-only.ts"]).toMatchObject({ xy: "M ", staged: true });
    expect(byPath["src/unstaged.ts"]).toMatchObject({ xy: " M", staged: false });
    expect(byPath["src/both.ts"]).toMatchObject({ xy: "MM", staged: true });
    expect(byPath["src/added.ts"]).toMatchObject({ xy: "A ", staged: true });
  });

  it("ignores blank lines", () => {
    expect(parseStatus("").status).toEqual([]);
    expect(parseStatus("\n\n").untracked).toEqual([]);
  });
});

describe("git-brief extract — parseLog", () => {
  it("parses --oneline rows into hash + subject", () => {
    const out = ["0da1cd5 chore(archive): close domain-modeling", "1833e64 docs(domain): DDD distillation"].join("\n");

    expect(parseLog(out)).toEqual([
      { hash: "0da1cd5", subject: "chore(archive): close domain-modeling" },
      { hash: "1833e64", subject: "docs(domain): DDD distillation" },
    ]);
  });

  it("handles a commit with no subject and skips blank lines", () => {
    expect(parseLog("abc1234\n\n")).toEqual([{ hash: "abc1234", subject: "" }]);
  });

  it("returns an empty list when no commits fall in the window", () => {
    expect(parseLog("")).toEqual([]);
  });
});

describe("git-brief extract — splitDiff", () => {
  const DIFF = `diff --git a/src/a.ts b/src/a.ts
index 1111111..2222222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,2 +1,2 @@
-old
+new
diff --git a/src/b.ts b/src/b.ts
index 3333333..4444444 100644
--- a/src/b.ts
+++ b/src/b.ts
@@ -1 +1 @@
-foo
+bar`;

  it("splits a multi-file diff into per-file chunks with the b-side path", () => {
    const chunks = splitDiff(DIFF, true);
    expect(chunks.map((c) => c.path)).toEqual(["src/a.ts", "src/b.ts"]);
    expect(chunks.every((c) => c.staged)).toBe(true);
    // each chunk retains its full patch text, starting at its own header
    expect(chunks[0].patch.startsWith("diff --git a/src/a.ts")).toBe(true);
    expect(chunks[1].patch).toContain("+bar");
  });

  it("returns an empty array for empty or whitespace input", () => {
    expect(splitDiff("", false)).toEqual([]);
    expect(splitDiff("   \n  ", false)).toEqual([]);
  });

  it("resolves paths that contain spaces", () => {
    const d = `diff --git a/my dir/file name.ts b/my dir/file name.ts
@@ -1 +1 @@
-a
+b`;
    expect(splitDiff(d, false)[0].path).toBe("my dir/file name.ts");
  });
});
