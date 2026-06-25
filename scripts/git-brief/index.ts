/**
 * git-brief — unified CLI entry point.
 *
 * Phase 1 + Phase 2 wiring: extract & downsample the repo payload, compute its
 * stable SHA-256 cache key, and short-circuit on a cache hit.
 *
 * Markers ([CACHE HIT] / [CACHE MISS]) and diagnostics go to STDERR; the brief
 * itself goes to STDOUT so `diff` between runs proves byte-identical output.
 *
 * Phase 3 will replace `mockBrief()` with OpenRouter synthesis.
 *
 * Usage:
 *   npx tsx scripts/git-brief/index.ts [--since="24 hours ago"]
 */
import { join } from "node:path";
import { DEFAULT_SINCE, extractPayload, repoRoot } from "./extract.ts";
import { CACHE_FILENAME, computeHash, readCache, writeCache } from "./cache.ts";
import { synthesize } from "./synthesis.ts";
import { stubSections } from "./stub.ts";
import { renderBrief } from "./template.ts";
import type { BriefSections } from "./types.ts";

/** Parse `--since=...` from argv; default to the Phase-1 window. */
function parseSince(argv: string[]): string {
  const arg = argv.find((a) => a.startsWith("--since="));
  return arg ? arg.slice("--since=".length) : DEFAULT_SINCE;
}

async function main(): Promise<void> {
  const since = parseSince(process.argv);

  // Phase 1 — extract + downsample.
  const payload = await extractPayload(since);

  // Phase 2 — stable hash + cache lookup.
  const root = await repoRoot();
  const cacheFile = join(root, CACHE_FILENAME);
  const hash = computeHash(payload);
  const store = await readCache(cacheFile);

  if (hash in store) {
    process.stderr.write("[CACHE HIT] Returning byte-identical output verbatim.\n");
    process.stdout.write(store[hash].brief);
    return;
  }

  process.stderr.write("[CACHE MISS] New repository state detected.\n");

  // Phase 3/4 — choose the synthesis path. With a key, synthesize via OpenRouter;
  // without one, fall back to the deterministic rule-based stub (no model call).
  let sections: BriefSections;
  if (process.env.OPENROUTER_API_KEY) {
    // Live path. A synthesis failure (provider error, rejected schema, network)
    // must degrade to the deterministic stub, never red-fail the run — matching
    // the key-absent path. The error is surfaced on STDERR for diagnosis.
    try {
      process.stderr.write("Synthesizing via OpenRouter…\n");
      sections = await synthesize(payload);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(
        `[WARNING] OpenRouter synthesis failed (${msg}). Falling back to local rule-based stub mode.\n`,
      );
      sections = stubSections(payload);
    }
  } else {
    process.stderr.write("[WARNING] OPENROUTER_API_KEY missing. Falling back to local rule-based stub mode.\n");
    sections = stubSections(payload);
  }

  // Fit the exact Markdown schema. The ISO timestamp is frozen into both the
  // rendered header and the cache entry so later cache hits replay it verbatim.
  const createdAt = new Date().toISOString();
  const brief = renderBrief(payload, sections, createdAt);
  store[hash] = { brief, createdAt };
  await writeCache(cacheFile, store);
  process.stdout.write(brief);
}

main().catch((err: unknown) => {
  process.stderr.write(String(err instanceof Error ? err.message : err) + "\n");
  process.exit(1);
});
