/**
 * git-brief — Phase 4: degraded rule-based stub.
 *
 * A pure, deterministic mapping from GitPayload to BriefSections with NO model
 * call. Used when OPENROUTER_API_KEY is absent so the tool still produces a
 * structured brief offline. Output is shaped identically to the LLM path so it
 * flows through the same renderBrief() template and the same cache.
 */
import { basename } from "node:path";

import type { BriefSections, GitPayload } from "./types.ts";

/** Conventional-commit prefix matcher: `type`, optional `(scope)`, optional `!`, `:`. */
const CONVENTIONAL = /^(\w+)(?:\([^)]*\))?!?:/;

const KNOWN_TYPES = new Set([
  "feat",
  "fix",
  "chore",
  "docs",
  "refactor",
  "test",
  "style",
  "perf",
  "build",
  "ci",
  "revert",
]);

function commitType(subject: string): string {
  const m = CONVENTIONAL.exec(subject);
  const type = m?.[1]?.toLowerCase();
  return type && KNOWN_TYPES.has(type) ? type : "other";
}

function stripPrefix(subject: string): string {
  return subject.replace(CONVENTIONAL, "").trim() || subject;
}

/** Directory "stream" a path belongs to, e.g. "scripts/git-brief/" or "(root)". */
function streamOf(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? "(root)" : path.slice(0, idx + 1);
}

/** Map a raw payload to brief sections by deterministic rules — no LLM. */
export function stubSections(payload: GitPayload): BriefSections {
  // landed — group commits by conventional-commit type.
  const byType = new Map<string, string[]>();
  for (const c of payload.commits) {
    const type = commitType(c.subject);
    const list = byType.get(type) ?? [];
    list.push(stripPrefix(c.subject));
    byType.set(type, list);
  }
  const landed = [...byType.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([theme, subjects]) => ({
      theme,
      summary: subjects.join("; "),
      commits: subjects.length,
    }));

  // inflight — cluster status files into directory streams, split by staged state.
  const byStream = new Map<string, { stream: string; state: "staged" | "unstaged"; files: string[] }>();
  for (const f of payload.status) {
    const stream = streamOf(f.path);
    const state: "staged" | "unstaged" = f.staged ? "staged" : "unstaged";
    const key = `${stream}::${state}`;
    const entry = byStream.get(key) ?? { stream, state, files: [] };
    entry.files.push(basename(f.path));
    byStream.set(key, entry);
  }
  const inflight = [...byStream.values()]
    .sort((a, b) => a.stream.localeCompare(b.stream) || a.state.localeCompare(b.state))
    .map((s) => ({ stream: s.stream, state: s.state, detail: s.files.join(", ") }));

  // risks — basic rule-based signals.
  const risks: BriefSections["risks"] = [];
  if (payload.status.length > 0) {
    risks.push({
      kind: "dirty working tree",
      evidence: `${payload.status.length} tracked file(s) with uncommitted changes`,
    });
  }
  if (payload.untracked.length > 0) {
    const preview = payload.untracked.slice(0, 3).join(", ");
    const more = payload.untracked.length > 3 ? ` (+${payload.untracked.length - 3} more)` : "";
    risks.push({
      kind: "untracked drift",
      evidence: `${payload.untracked.length} untracked file(s): ${preview}${more}`,
    });
  }

  return { landed, inflight, risks };
}
