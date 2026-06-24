/**
 * Shared data structures for git-brief.
 * Phase 1 (extraction + downsampling) populates `GitPayload`.
 */

/** One entry from `git status --porcelain`. */
export interface FileChange {
  /** Path as reported by git (rename arrows preserved). */
  path: string;
  /** Two-character porcelain status code, e.g. " M", "A ", "??". */
  xy: string;
  /** True when the change is staged (index column is set and not untracked). */
  staged: boolean;
}

/** One commit from `git log --oneline` within the window. */
export interface CommitInfo {
  /** Abbreviated commit hash. */
  hash: string;
  /** Commit subject line. */
  subject: string;
}

/** A per-file slice of a unified diff, after the downsampling ladder runs. */
export interface DiffEntry {
  path: string;
  staged: boolean;
  /** Byte length of the original patch text for this file. */
  sizeBytes: number;
  /** Estimated token cost (~chars/4) of the original patch. */
  tokens: number;
  /** Full patch text, or null when omitted by the downsampling ladder. */
  patch: string | null;
  /** True when the patch text was dropped to summary-line only. */
  omitted: boolean;
  /** Human-readable reason for omission, present only when `omitted`. */
  reason?: string;
}

/** The three narrative sections the model produces (Phase 3) and the stub fills (Phase 4). */
export interface BriefSections {
  /** "What landed" — recent commits grouped into logical themes. */
  landed: { theme: string; summary: string; commits: number }[];
  /** "What's mid-flight" — active work streams, split by staged/unstaged. */
  inflight: { stream: string; state: "staged" | "unstaged"; detail: string }[];
  /** "Hidden risks / stale files" — drift, split-brain, forgotten untracked work. */
  risks: { kind: string; evidence: string }[];
}

/** The full processed payload — the single object Phase 1 exports. */
export interface GitPayload {
  repoName: string;
  branch: string;
  /** The raw window expression passed to `git log --since`. */
  window: string;
  commits: CommitInfo[];
  status: FileChange[];
  /** Untracked, non-ignored paths (porcelain "??"). */
  untracked: string[];
  diffs: DiffEntry[];
  /** Token-budget accounting from the downsampling pass. */
  budget: {
    softCapTokens: number;
    perFileCapTokens: number;
    /** Total estimated tokens of patches retained after downsampling. */
    retainedTokens: number;
    omittedCount: number;
  };
}
