/**
 * git-brief — Phase 3: OpenRouter LLM synthesis.
 *
 * Turns the downsampled GitPayload into the three narrative sections via the
 * Vercel AI SDK (`generateText` + `Output.object`) routed through OpenRouter. Runs at
 * `temperature: 0` with a fixed seed; determinism across runs is ultimately
 * guaranteed by the Phase-2 cache, not the model.
 */
import { Output, generateText } from "ai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { z } from "zod";

import type { BriefSections, GitPayload } from "./types.ts";

export const DEFAULT_MODEL = "anthropic/claude-sonnet-4.6";
const SEED = 42;

/** zod schema for the structured brief — keeps the output shape deterministic. */
const sectionsSchema = z.object({
  landed: z
    .array(
      z.object({
        theme: z.string().describe("logical theme of the work"),
        summary: z.string().describe("one-line summary grounded in commit subjects"),
        // Plain number, NOT z.number().int(): the integer constraint serializes
        // to a JSON schema with safe-integer minimum/maximum bounds, which some
        // OpenRouter-routed providers (e.g. Azure) reject on `integer` types.
        // temperature:0 + the description keep the value a whole count.
        commits: z.number().describe("number of commits in this theme (a whole integer count)"),
      }),
    )
    .describe("What landed: recent commits grouped into logical themes. Empty if no commits."),
  inflight: z
    .array(
      z.object({
        stream: z.string().describe("work-in-progress stream, inferred from changed paths"),
        state: z.enum(["staged", "unstaged"]),
        detail: z.string().describe("which files / what is being changed"),
      }),
    )
    .describe("What's mid-flight: dirty/staged files clustered into streams. Empty if tree is clean."),
  risks: z
    .array(
      z.object({
        kind: z.string().describe("risk type, e.g. split-brain, forgotten untracked, stale dirty"),
        evidence: z.string().describe("the concrete signal from the payload"),
      }),
    )
    .describe("Hidden risks / stale files. Empty if none detected."),
});

const SYSTEM_PROMPT = `You are git-brief, a tool that turns a repository's git state into a terse daily status brief.
You receive a JSON payload describing the current branch, recent commits, working-tree status, untracked files, and per-file diffs.

Produce three sections by these heuristics:

a) "landed" — WHAT LANDED. Group the recent commits into logical themes (infer from commit subjects and touched paths). Collapse trivial/chore commits. One entry per logical unit of work, not one per commit.

b) "inflight" — WHAT'S MID-FLIGHT. Cluster the dirty/staged files into work-in-progress streams by directory/feature affinity. Distinguish staged (intent to commit) from unstaged (still being edited) using each file's 'staged' flag.

c) "risks" — HIDDEN RISKS / STALE FILES. Flag: split-brain / heavy divergence from upstream; forgotten untracked files that look like real source/config work; long-lived dirty state.

HARD RULES:
- Ground every statement in the provided data. Never invent commits, files, or facts not present in the payload.
- If a section has no supporting input, return an EMPTY array for it. Do not pad with filler.
- A diff with "omitted": true means its text was dropped for size — reason about it by filename only, do not fabricate its contents.`;

/** Build the user message: a readable serialization of the payload for the model. */
function buildUserMessage(p: GitPayload): string {
  const commits = p.commits.map((c) => `- ${c.hash} ${c.subject}`).join("\n") || "(none)";
  const status =
    p.status.map((s) => `- [${s.staged ? "staged" : "unstaged"}] ${s.xy} ${s.path}`).join("\n") || "(clean)";
  const untracked = p.untracked.map((u) => `- ${u}`).join("\n") || "(none)";
  const diffs = p.diffs
    .map((d) =>
      d.omitted
        ? `### ${d.path} [${d.staged ? "staged" : "unstaged"}] — ${d.reason}`
        : `### ${d.path} [${d.staged ? "staged" : "unstaged"}]\n${d.patch}`,
    )
    .join("\n\n");
  return [
    `Repository: ${p.repoName}`,
    `Branch: ${p.branch}`,
    `Window: ${p.window}`,
    ``,
    `## Commits in window\n${commits}`,
    ``,
    `## Working-tree status\n${status}`,
    ``,
    `## Untracked files\n${untracked}`,
    ``,
    `## Diffs\n${diffs || "(none)"}`,
  ].join("\n");
}

/**
 * Synthesize the three brief sections from a payload via OpenRouter.
 * @throws a clear, actionable error when OPENROUTER_API_KEY is absent.
 */
export async function synthesize(payload: GitPayload): Promise<BriefSections> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENROUTER_API_KEY is not set. Set it to use live synthesis " +
        "(e.g. `OPENROUTER_API_KEY=sk-or-... npm run git-brief`). " +
        "Phase 4 adds a key-free rule-based fallback.",
    );
  }

  const openrouter = createOpenRouter({ apiKey });
  const modelId = process.env.GIT_BRIEF_MODEL ?? DEFAULT_MODEL;

  const { output } = await generateText({
    model: openrouter(modelId),
    output: Output.object({ schema: sectionsSchema }),
    temperature: 0,
    seed: SEED,
    system: SYSTEM_PROMPT,
    prompt: buildUserMessage(payload),
  });

  return output;
}
