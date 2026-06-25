/**
 * git-brief — Markdown template fitting (Phase 3, shared with Phase 4 stub).
 *
 * Pure & deterministic: given a payload, the synthesized sections, and a fixed
 * timestamp, render the exact CommonMark schema. The timestamp is passed in (not
 * read from the clock here) so the caller can freeze it into the cache and replay
 * the brief verbatim. CommonMark only — no inline HTML.
 */
import type { BriefSections, GitPayload } from "./types.ts";

/** Literal placeholder for an empty section — distinguishes true-empty from a broken run. */
const NONE = "_None._";

function renderSection(heading: string, lines: string[]): string {
  const body = lines.length > 0 ? lines.join("\n") : NONE;
  return `${heading}\n${body}`;
}

/**
 * Render the complete brief.
 * @param isoTimestamp ISO string frozen into the header (and the cache entry).
 */
export function renderBrief(payload: GitPayload, sections: BriefSections, isoTimestamp: string): string {
  const landed = sections.landed.map(
    (l) => `- ${l.theme}: ${l.summary} (${l.commits} commit${l.commits === 1 ? "" : "s"})`,
  );
  const inflight = sections.inflight.map((s) => `- **${s.stream}** (${s.state}): ${s.detail}`);
  const risks = sections.risks.map((r) => `- ⚠️ ${r.kind}: ${r.evidence}`);

  return (
    [
      `# git-brief — ${payload.repoName} @ ${payload.branch}`,
      `_Window: ${payload.window} · generated ${isoTimestamp}_`,
      ``,
      renderSection("### Completed Yesterday", landed),
      ``,
      renderSection("### In-Flight Streams", inflight),
      ``,
      renderSection("### Hidden Risks / Stale Files", risks),
    ].join("\n") + "\n"
  );
}
