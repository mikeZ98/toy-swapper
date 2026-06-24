import { describe, expect, it } from "vitest";

import { renderBrief } from "./template.ts";
import type { BriefSections, GitPayload } from "./types.ts";

const TS = "2026-06-24T12:00:00.000Z";

const basePayload: GitPayload = {
  repoName: "toyswapper",
  branch: "master",
  window: "24 hours ago",
  commits: [],
  status: [],
  untracked: [],
  diffs: [],
  budget: { softCapTokens: 10000, perFileCapTokens: 2000, retainedTokens: 0, omittedCount: 0 },
};

const emptySections: BriefSections = { landed: [], inflight: [], risks: [] };

describe("git-brief template — header", () => {
  it("renders repo, branch, window, and the frozen timestamp", () => {
    const out = renderBrief(basePayload, emptySections, TS);
    expect(out).toContain("# git-brief — toyswapper @ master");
    expect(out).toContain(`_Window: 24 hours ago · generated ${TS}_`);
  });
});

describe("git-brief template — exact section schema", () => {
  it("always emits the three headings in order", () => {
    const out = renderBrief(basePayload, emptySections, TS);
    const order = [
      out.indexOf("### Completed Yesterday"),
      out.indexOf("### In-Flight Streams"),
      out.indexOf("### Hidden Risks / Stale Files"),
    ];
    expect(order.every((i) => i >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b)); // strictly increasing
  });

  it("renders _None._ under every empty section", () => {
    const out = renderBrief(basePayload, emptySections, TS);
    expect(out.match(/_None\._/g)).toHaveLength(3);
  });

  it("renders populated sections as grounded bullets", () => {
    const sections: BriefSections = {
      landed: [{ theme: "evaluator", summary: "tightened fairness math", commits: 3 }],
      inflight: [
        { stream: "git-brief", state: "staged", detail: "synthesis.ts, template.ts" },
        { stream: "docs", state: "unstaged", detail: "plan notes" },
      ],
      risks: [{ kind: "forgotten untracked", evidence: "scripts/git-brief/scratch.ts" }],
    };
    const out = renderBrief(basePayload, sections, TS);
    expect(out).toContain("- evaluator: tightened fairness math (3 commits)");
    expect(out).toContain("- **git-brief** (staged): synthesis.ts, template.ts");
    expect(out).toContain("- **docs** (unstaged): plan notes");
    expect(out).toContain("- ⚠️ forgotten untracked: scripts/git-brief/scratch.ts");
    expect(out).not.toContain("_None._"); // no empty sections here
  });

  it("singularizes the commit count label", () => {
    const sections: BriefSections = {
      landed: [{ theme: "fix", summary: "one-off patch", commits: 1 }],
      inflight: [],
      risks: [],
    };
    expect(renderBrief(basePayload, sections, TS)).toContain("(1 commit)");
  });

  it("emits CommonMark only — no inline HTML tags", () => {
    const out = renderBrief(basePayload, emptySections, TS);
    expect(out).not.toMatch(/<[a-zA-Z/][^>]*>/);
  });
});
