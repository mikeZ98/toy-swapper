/**
 * Context-window mitigation ladder for git-brief diffs.
 *
 * Order (shape-notes §2):
 *   1. Estimate tokens per file (~chars / 4).
 *   2. Known-noise allowlist (lockfiles, vendored, minified) -> filename-only.
 *   3. Per-file cap: any single file over PER_FILE_CAP_TOKENS -> filename-only.
 *   4. Global soft cap: while total > SOFT_CAP_TOKENS, omit the largest remaining
 *      patch until under budget.
 *   5. Never silently drop: omitted files stay in the array with a `reason`.
 */
import type { DiffEntry } from "./types.ts";

export const SOFT_CAP_TOKENS = 10_000;
export const PER_FILE_CAP_TOKENS = 2_000;

/** Patterns whose diffs carry no narrative value and are dropped regardless of size. */
const KNOWN_NOISE = [
  /(^|\/)package-lock\.json$/,
  /(^|\/)pnpm-lock\.yaml$/,
  /(^|\/)yarn\.lock$/,
  /-lock\.json$/,
  /\.lock$/,
  /(^|\/)dist\//,
  /\.min\.[^/]+$/,
];

/** Rough token estimate: ~4 characters per token. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function isKnownNoise(path: string): boolean {
  return KNOWN_NOISE.some((re) => re.test(path));
}

function kb(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

/** A raw, pre-ladder per-file diff slice (patch text still attached). */
export interface RawDiff {
  path: string;
  staged: boolean;
  patch: string;
}

/**
 * Apply the downsampling ladder. Pure: takes raw per-file diffs, returns
 * `DiffEntry[]` with omissions flagged, plus the budget accounting.
 */
export function downsample(raw: RawDiff[]): {
  diffs: DiffEntry[];
  retainedTokens: number;
  omittedCount: number;
} {
  // Step 1 — measure every file.
  const entries: DiffEntry[] = raw.map((d) => {
    const sizeBytes = Buffer.byteLength(d.patch, "utf8");
    const tokens = estimateTokens(d.patch);
    return {
      path: d.path,
      staged: d.staged,
      sizeBytes,
      tokens,
      patch: d.patch,
      omitted: false,
    };
  });

  const omit = (e: DiffEntry, reason: string) => {
    e.patch = null;
    e.omitted = true;
    e.reason = reason;
  };

  // Steps 2 & 3 — allowlist, then per-file cap.
  for (const e of entries) {
    if (isKnownNoise(e.path)) {
      omit(e, `[diff omitted: ${e.path}] (known-noise, ${kb(e.sizeBytes)})`);
    } else if (e.tokens > PER_FILE_CAP_TOKENS) {
      omit(e, `[diff omitted: ${e.path}] (${e.tokens} tok > per-file cap ${PER_FILE_CAP_TOKENS}, ${kb(e.sizeBytes)})`);
    }
  }

  // Step 4 — global soft cap: drop largest retained patches until under budget.
  const retainedTokens = () => entries.reduce((sum, e) => (e.omitted ? sum : sum + e.tokens), 0);

  while (retainedTokens() > SOFT_CAP_TOKENS) {
    const retained = entries.filter((e) => !e.omitted).sort((a, b) => b.tokens - a.tokens);
    if (retained.length === 0) break; // nothing left to trim
    const largest = retained[0];
    omit(
      largest,
      `[diff omitted: ${largest.path}] (trimmed for global ${SOFT_CAP_TOKENS}-tok cap, ${kb(largest.sizeBytes)})`,
    );
  }

  return {
    diffs: entries,
    retainedTokens: retainedTokens(),
    omittedCount: entries.filter((e) => e.omitted).length,
  };
}
