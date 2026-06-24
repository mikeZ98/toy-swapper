/**
 * git-brief — Phase 2: Local Payload-Hash Caching Engine.
 *
 * Determinism guarantee (shape-notes Decision #1): a content-addressed cache keyed
 * on a SHA-256 over the *post-downsample* GitPayload. Identical repo state ⇒
 * identical hash ⇒ the stored brief is returned byte-for-byte, with no model call.
 *
 * The cache file is local and disposable — not a system of record. Deleting it only
 * forces a recompute; it never affects correctness.
 */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import type { GitPayload } from "./types.ts";

export const CACHE_FILENAME = ".git-brief-cache.json";

export interface CacheEntry {
  /** The rendered brief, stored verbatim and returned unchanged on a hit. */
  brief: string;
  /** ISO timestamp of first computation (metadata only — not part of the brief). */
  createdAt: string;
}

export type CacheStore = Record<string, CacheEntry>;

/**
 * Deterministic serialization: recursively sort object keys so the byte string is
 * independent of property insertion order. Arrays keep their order (the payload's
 * arrays are already in a stable, git-determined order).
 */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalize).join(",") + "]";
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalize(obj[k])).join(",") + "}";
}

/** SHA-256 (hex) over the canonical serialization of the downsampled payload. */
export function computeHash(payload: GitPayload): string {
  return createHash("sha256").update(canonicalize(payload)).digest("hex");
}

/** Read the cache store. Missing file ⇒ empty store; corrupt file ⇒ warn + empty. */
export async function readCache(cacheFile: string): Promise<CacheStore> {
  try {
    return JSON.parse(await readFile(cacheFile, "utf8")) as CacheStore;
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOENT") return {}; // first run — no cache yet
    // Disposable cache: a corrupt file must not break the tool.
    process.stderr.write(`[git-brief] warning: cache unreadable (${e.message}); starting fresh\n`);
    return {};
  }
}

/** Persist the cache store as pretty JSON with a trailing newline. */
export async function writeCache(cacheFile: string, store: CacheStore): Promise<void> {
  await writeFile(cacheFile, JSON.stringify(store, null, 2) + "\n", "utf8");
}
