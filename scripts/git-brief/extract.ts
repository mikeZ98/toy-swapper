/**
 * git-brief — Phase 1: Git Data Extraction & Downsampling.
 *
 * Reads local repository state via `execFile('git', [...])` (argv array, never a
 * shell string — no interpolation, no escape bugs) and returns a typed, processed
 * `GitPayload`. Every git subprocess is exit-code checked; on any failure we throw
 * rather than emit a partial payload, so downstream synthesis never runs on
 * garbled input.
 *
 * Run directly to print the payload as JSON:
 *   npx tsx scripts/git-brief/extract.ts
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { basename } from "node:path";
import type { CommitInfo, FileChange, GitPayload } from "./types.ts";
import { downsample, type RawDiff, SOFT_CAP_TOKENS, PER_FILE_CAP_TOKENS } from "./downsample.ts";

const execFileP = promisify(execFile);

/** Window expression handed to `git log --since`. */
export const DEFAULT_SINCE = "24 hours ago";

/** Run a git command via argv (no shell). Throws with context on non-zero exit. */
async function git(args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileP("git", args, {
      maxBuffer: 64 * 1024 * 1024, // large diffs must not overflow the default 1MB
      encoding: "utf8",
    });
    return stdout;
  } catch (err: unknown) {
    const e = err as { stderr?: string; code?: number; message?: string };
    throw new Error(
      `git ${args.join(" ")} failed (exit ${e.code ?? "?"}): ${(e.stderr ?? e.message ?? "unknown error").trim()}`,
    );
  }
}

/** Absolute path to the repository root (`git rev-parse --show-toplevel`). */
export async function repoRoot(): Promise<string> {
  return (await git(["rev-parse", "--show-toplevel"])).trim();
}

/** Split a unified diff into per-file chunks, tagging each as staged/unstaged. */
export function splitDiff(diffText: string, staged: boolean): RawDiff[] {
  if (!diffText.trim()) return [];
  return diffText
    .split(/(?=^diff --git )/m)
    .filter((chunk) => chunk.startsWith("diff --git "))
    .map((chunk) => {
      const header = chunk.slice(0, chunk.indexOf("\n"));
      const m = /^diff --git a\/(.+?) b\/(.+)$/.exec(header);
      const path = m ? m[2] : header.replace("diff --git ", "").trim();
      return { path, staged, patch: chunk };
    });
}

/** Parse `git status --porcelain` into staged/dirty file changes + untracked paths. */
export function parseStatus(out: string): { status: FileChange[]; untracked: string[] } {
  const status: FileChange[] = [];
  const untracked: string[] = [];
  for (const line of out.split("\n")) {
    if (!line) continue;
    const xy = line.slice(0, 2);
    const path = line.slice(3);
    if (xy === "??") {
      untracked.push(path);
      continue;
    }
    const indexCol = xy[0];
    status.push({ path, xy, staged: indexCol !== " " && indexCol !== "?" });
  }
  return { status, untracked };
}

/** Parse `git log --oneline` into commit hash + subject pairs. */
export function parseLog(out: string): CommitInfo[] {
  const commits: CommitInfo[] = [];
  for (const line of out.split("\n")) {
    if (!line.trim()) continue;
    const sp = line.indexOf(" ");
    commits.push({
      hash: sp === -1 ? line : line.slice(0, sp),
      subject: sp === -1 ? "" : line.slice(sp + 1),
    });
  }
  return commits;
}

/**
 * Extract and downsample the current repository's state.
 * @param since window expression for `git log --since` (default "24 hours ago").
 */
export async function extractPayload(since: string = DEFAULT_SINCE): Promise<GitPayload> {
  // Run the read-only git commands. Each throws on failure (no partial payloads).
  const [toplevel, branchRaw, statusRaw, stagedDiff, unstagedDiff, logRaw] = await Promise.all([
    git(["rev-parse", "--show-toplevel"]),
    git(["rev-parse", "--abbrev-ref", "HEAD"]),
    git(["status", "--porcelain"]),
    git(["diff", "--staged"]),
    git(["diff"]),
    git(["log", `--since=${since}`, "--oneline"]),
  ]);

  const { status, untracked } = parseStatus(statusRaw);
  const rawDiffs: RawDiff[] = [...splitDiff(stagedDiff, true), ...splitDiff(unstagedDiff, false)];
  const { diffs, retainedTokens, omittedCount } = downsample(rawDiffs);

  return {
    repoName: basename(toplevel.trim()),
    branch: branchRaw.trim(),
    window: since,
    commits: parseLog(logRaw),
    status,
    untracked,
    diffs,
    budget: {
      softCapTokens: SOFT_CAP_TOKENS,
      perFileCapTokens: PER_FILE_CAP_TOKENS,
      retainedTokens,
      omittedCount,
    },
  };
}

// Run directly (tsx scripts/git-brief/extract.ts) -> print the processed payload.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  extractPayload()
    .then((payload) => process.stdout.write(JSON.stringify(payload, null, 2) + "\n"))
    .catch((err: unknown) => {
      process.stderr.write(String(err instanceof Error ? err.message : err) + "\n");
      process.exit(1);
    });
}
