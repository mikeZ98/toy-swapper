# `git-brief` Implementation Plan

> Source shape notes: `context/team/git-brief-shape.md` (determinism resolved: temp-0 + payload-hash cache).
> Opportunity: `context/team/m5l1-opportunity-matrix.md`.
> Custom location by request (normally `/10x-plan` writes to `context/changes/<id>/plan.md`).

## Overview

A throwaway, read-only local CLI that joins the current repo's commit history to its live
working-tree state and synthesizes a scan-at-a-glance Markdown brief. Built in 4 sequential
phases, each ending in a functional, locally verifiable state.

## Decisions Locked (grounded in repo + shape notes)

| Decision | Choice | Why |
|---|---|---|
| Runtime | Node 22 + TypeScript, run via `tsx` | Matches m5l2 "first agent" blueprint; `tsx` not yet installed → add in Phase 1 |
| Location | `scripts/git-brief/` | Existing `scripts/` dir; standalone CLI, not part of the Astro `src/` app |
| Git access | `execFile('git', [argv])` (no shell string) | Kills the "broken shell escape → hallucination" failure mode (shape notes §5) |
| LLM client | Vercel AI SDK (`ai` v6, already installed) + `@openrouter/ai-sdk-provider` | `ai`@^6 + `zod`@^4 already present; OpenRouter matches m5l2 |
| Synthesis call | `generateObject` (zod-typed sections) at `temperature: 0`, fixed `seed` | Header/timestamp stay deterministic; only section *bodies* come from the model |
| Determinism | SHA-256 payload-hash cache returns stored brief verbatim | Shape notes Decision #1; byte-identical on unchanged tree |
| Cache file | `.git-brief-cache.json` at repo root (gitignored) | Disposable; not a system of record |
| Model | `GIT_BRIEF_MODEL` env, default `anthropic/claude-sonnet-4.6` | Sonnet-class is the right cost/quality for a dev tool; override via env |

## What We're NOT Doing
No DB, no cron/scheduler, no network beyond the single OpenRouter call, no multi-repo, no repo
writes, no rule-based path as *primary* (stub is the no-key fallback only). Per shape-notes Non-Goals.

## File Layout (`scripts/git-brief/`)
```
types.ts       # GitPayload, FileChange, CommitInfo, DiffEntry, BriefSections
extract.ts     # Phase 1 — git subprocess wrapper → raw GitPayload
downsample.ts  # Phase 1 — 10k-token soft cap + summary-line fallback
cache.ts       # Phase 2 — canonical hash + .git-brief-cache.json read/write
template.ts    # Phase 3/4 — deterministic Markdown render (shared, _None._ placeholders)
synth.ts       # Phase 3 — OpenRouter via AI SDK, temp-0 → BriefSections
stub.ts        # Phase 4 — rule-based fallback when key is absent
index.ts       # CLI entry: arg parse (--since) → orchestrate extract→downsample→cache→synth|stub
```
Setup once (Phase 1): `npm i -D tsx` and add `"git-brief": "tsx scripts/git-brief/index.ts"` to `package.json` scripts.

---

## Phase 1: Git Data Extraction & Downsampling

### 1. Core Objective & Files Affected
Safely extract branch, status, diffs, and commit log into a typed `GitPayload`, then downsample
it under the 10k-token soft cap. **Files:** `scripts/git-brief/types.ts`, `extract.ts`,
`downsample.ts`; `package.json` (add `tsx` + script).

### 2. Step-by-step Technical Tasks (exact commands + data structures)

**Data structures (`types.ts`):**
```ts
interface FileChange { path: string; xy: string; staged: boolean; added: number; deleted: number; }
interface CommitInfo { hash: string; subject: string; isoDate: string; files: string[]; }
interface DiffEntry { path: string; staged: boolean; added: number; deleted: number;
                      patch: string | null; omitted: boolean; reason?: string; }
interface GitPayload {
  repoName: string; branch: string; window: string; resolvedSince: string;
  upstream: { ahead: number; behind: number } | null;
  commits: CommitInfo[]; status: FileChange[]; untracked: string[]; diffs: DiffEntry[];
}
```

**Raw git commands (each via `execFile('git', [...])`, exit-code checked, NO shell string):**
- Repo name: `git rev-parse --show-toplevel` → basename.
- Branch: `git rev-parse --abbrev-ref HEAD`.
- Upstream divergence (guarded — only if an upstream exists):
  - exists? `git rev-parse --abbrev-ref --symbolic-full-name @{u}` (non-zero ⇒ set `upstream: null`, skip).
  - counts: `git rev-list --left-right --count @{u}...HEAD` → `behind<TAB>ahead`.
- Status (stable porcelain v1): `git status --porcelain=v1` → parse `XY path`; staged = `X != ' '`;
  untracked = lines starting `??`.
- Per-file change sizes (cheap, drives downsampling *before* pulling full text):
  - `git diff --staged --numstat` and `git diff --numstat` → `added<TAB>deleted<TAB>path`.
- Commit log within window (record-separated for safe parsing):
  `git log --since="<resolvedSince>" --numstat --pretty=format:'%x1e%H%x1f%s%x1f%aI'`
  (0x1e separates records, 0x1f separates fields; numstat lines follow each header).
- Full diff text (only for files that survive the budget check, Phase-1 downsample step):
  `git diff --staged -- <path>` / `git diff -- <path>`.

**`--since` resolution (`index.ts` arg):** default `"24 hours ago"`; `--since="last brief"` resolves
from the cache's stored timestamp if present (Phase 2), else falls back to `"24 hours ago"`.

**Downsampling (`downsample.ts`) — applied to `diffs[]`:**
1. Estimate tokens ≈ `chars / 4`. Soft cap = 10_000 tokens (~40k chars) across all patches.
2. **Known-noise allowlist → filename-only regardless of size:** `package-lock.json`,
   `pnpm-lock.yaml`, `yarn.lock`, `*-lock.json`, `*.lock`, `dist/**`, `*.min.*`.
3. **Per-file cap:** any single file > ~2k tokens → `patch=null, omitted=true,
   reason="diff omitted: <NN> KB"`.
4. **Global cap:** if total still > 10k tokens, omit largest remaining patches (by numstat) until under.
5. **Never silently drop:** every omitted file stays in `diffs[]` with its `reason` (shape-notes rule).

### 3. Explicit Verification Command (local, on SSD)
```bash
# Prints the typed payload for THIS repo; asserts dirty-file count matches git itself.
npx tsx scripts/git-brief/extract.ts | tee /tmp/gb-payload.json | jq '.branch, (.status|length), (.diffs|length)'
test "$(jq '.status|length' /tmp/gb-payload.json)" = "$(git status --porcelain=v1 | wc -l | tr -d ' ')" \
  && echo "PASS: status count matches" || echo "FAIL"
# Force-omit check: stage a large lockfile change, re-run, confirm it is filename-only:
jq '.diffs[] | select(.omitted==true) | {path, reason}' /tmp/gb-payload.json
```
**Automated:** `npm test` (vitest unit tests for porcelain parsing, numstat parsing, downsample cap/allowlist).

---

## Phase 2: Local Payload-Hash Caching Engine

### 1. Core Objective & Files Affected
Guarantee byte-identical output on identical repo state via a content-addressed cache.
**Files:** `scripts/git-brief/cache.ts`, `index.ts` (wire cache lookup/store); `.gitignore`.

### 2. Step-by-step Technical Tasks (exact structures)
- **Canonical key:** `sha256(canonicalJSON(downsampledPayload))` using Node `crypto.createHash('sha256')`.
  `canonicalJSON` = stable stringify with **recursively sorted keys** so the hash is order-independent.
  Hash the *post-downsample* payload (so a re-run that truncates a lockfile to the same summary line
  still hits — shape-notes Decision #1).
- **Store file** `.git-brief-cache.json` (repo root):
  ```json
  { "<sha256>": { "brief": "<rendered markdown>", "createdAt": "<ISO>" } }
  ```
- **Flow in `index.ts`:** compute key → read cache → **hit:** print stored `brief` verbatim, exit 0
  (no model call) → **miss:** proceed to synth (Phase 3) / stub (Phase 4), then write `{brief, createdAt}`
  back under the key. Stored brief (incl. its original timestamp) is returned verbatim on later hits.
- **`--since="last brief"`** reads the newest `createdAt` to resolve the window (the one allowed local crumb).
- Add `.git-brief-cache.json` to `.gitignore`.

### 3. Explicit Verification Command (local, on SSD)
```bash
rm -f .git-brief-cache.json
npx tsx scripts/git-brief/index.ts > /tmp/gb1.md          # miss → computes + stores
npx tsx scripts/git-brief/index.ts > /tmp/gb2.md          # hit  → verbatim
diff /tmp/gb1.md /tmp/gb2.md && echo "PASS: byte-identical on unchanged tree"
grep -q . .git-brief-cache.json && echo "PASS: cache written"
# Mutate state → expect a NEW key / cache miss:
echo "x" >> README.md
npx tsx scripts/git-brief/index.ts > /tmp/gb3.md
test "$(jq 'keys|length' .git-brief-cache.json)" -ge 2 && echo "PASS: new state → new cache entry"
git checkout -- README.md
```
**Automated:** `npm test` (vitest: canonicalJSON sorts keys; identical payload→same hash; field reorder→same hash; mutated payload→different hash).

---

## Phase 3: OpenRouter LLM Synthesis & Template Fitting

### 1. Core Objective & Files Affected
On a cache miss, synthesize the three narrative sections via OpenRouter at `temperature: 0` and
render them into the fixed Markdown template. **Files:** `scripts/git-brief/synth.ts`,
`template.ts`, `index.ts`; `package.json` (add `@openrouter/ai-sdk-provider`).

### 2. Step-by-step Technical Tasks
- Add dep: `npm i @openrouter/ai-sdk-provider` (`ai`@^6 + `zod`@^4 already present).
- **`synth.ts`** — AI SDK `generateObject`:
  - `const openrouter = createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY })`.
  - `model: openrouter(process.env.GIT_BRIEF_MODEL ?? 'anthropic/claude-sonnet-4.6')`,
    `temperature: 0`, `seed: 42`.
  - **zod output schema** `BriefSections` (deterministic shape the template renders):
    ```ts
    z.object({
      landed:   z.array(z.object({ theme: z.string(), summary: z.string(), commits: z.number() })),
      inflight: z.array(z.object({ stream: z.string(), state: z.enum(['staged','unstaged']), detail: z.string() })),
      risks:    z.array(z.object({ kind: z.string(), evidence: z.string() })),
    })
    ```
  - **System prompt** encodes the 3 heuristics (shape-notes §3): (a) group commits by theme, collapse
    chores; (b) cluster dirty/staged paths into WIP streams, distinguish staged vs unstaged; (c) flag
    split-brain (`upstream.ahead/behind`), forgotten untracked source files, long-lived dirty state.
    Hard rule: **ground every item in provided data; return empty arrays for absent input — never invent.**
  - User message = `canonicalJSON(downsampledPayload)`.
- **`template.ts`** — pure, deterministic renderer (CommonMark only, no HTML):
  - Header: `# git-brief — <repo> @ <branch>` + `_Window: <resolvedSince> · generated <ISO>_`.
  - `### Completed Yesterday`, `### In-Flight Streams`, `### Hidden Risks / Stale Files`.
  - Empty array → literal `_None._` (distinguishes true-empty from broken run, shape-notes §5).
- **`index.ts`**: miss → `synth()` → `template.render()` → cache.store → print.

### 3. Explicit Verification Command (local, on SSD)
```bash
export OPENROUTER_API_KEY=sk-or-...        # real key required for this phase
rm -f .git-brief-cache.json
time npx tsx scripts/git-brief/index.ts | tee /tmp/gb.md
# Structure assertions:
grep -q '^### Completed Yesterday' /tmp/gb.md \
 && grep -q '^### In-Flight Streams' /tmp/gb.md \
 && grep -q '^### Hidden Risks / Stale Files' /tmp/gb.md && echo "PASS: all 3 sections present"
# Determinism guard: a non-empty working tree must NOT render an all-_None._ body:
! ( grep -c '_None._' /tmp/gb.md | grep -q '^3$' ) && echo "PASS: not empty-boilerplate"
# Speed: the `time` line above should report < 5s (shape-notes success criterion).
```
**Automated:** `npm test` (vitest: `template.render` snapshot for fixed `BriefSections`; `_None._` on empty arrays; CommonMark — no `<` tags).
**Manual:** read the brief on a real dirty repo; confirm streams/risks are faithful and not hallucinated.

---

## Phase 4: Degraded Rule-Based Stub Mode

### 1. Core Objective & Files Affected
When `OPENROUTER_API_KEY` is absent, deterministically template-fill a basic report with **no model
call** — never fail, never hallucinate. **Files:** `scripts/git-brief/stub.ts`, `index.ts`.

### 2. Step-by-step Technical Tasks
- **`index.ts` branch:** if `!process.env.OPENROUTER_API_KEY` → call `stub()` instead of `synth()`.
- **`stub.ts`** builds `BriefSections` by pure rules over `GitPayload` (no LLM):
  - `landed`: one entry per commit subject (chores collapsed by conventional-commit prefix).
  - `inflight`: group `status[]`/`diffs[]` by **top-level directory**; `state` from staged flag.
  - `risks`: `upstream.ahead/behind` if diverged; untracked non-ignored source files; nothing invented.
- Reuse `template.ts` so output shape is identical to Phase 3; prepend `_[stub mode — no API key]_`
  under the header so the degraded path is visible.
- Stub output is fully deterministic by construction (no model, no timestamp variance beyond header)
  — and still flows through the Phase-2 cache.

### 3. Explicit Verification Command (local, on SSD)
```bash
rm -f .git-brief-cache.json
env -u OPENROUTER_API_KEY npx tsx scripts/git-brief/index.ts | tee /tmp/gb-stub1.md
grep -q '_\[stub mode' /tmp/gb-stub1.md && echo "PASS: stub marker present"
grep -q '^### Completed Yesterday' /tmp/gb-stub1.md && echo "PASS: template shape preserved"
# Determinism WITHOUT cache (delete cache between runs, must still be byte-identical):
rm -f .git-brief-cache.json
env -u OPENROUTER_API_KEY npx tsx scripts/git-brief/index.ts > /tmp/gb-stub2.md
diff <(grep -v '^_Window' /tmp/gb-stub1.md) <(grep -v '^_Window' /tmp/gb-stub2.md) \
  && echo "PASS: stub body deterministic without cache"
```
**Automated:** `npm test` (vitest: stub clusters paths by top-level dir; collapses chore commits; emits no section absent from payload).

---

## Testing Strategy
- **Unit (vitest):** porcelain/numstat parsing, downsample cap + allowlist + never-drop, canonicalJSON
  key-sorting + hash stability, template `_None._` + CommonMark, stub clustering.
- **Integration (manual, real repo):** Phase 3 with a live key on a dirty tree; Phase 2 hit/miss cycle;
  Phase 4 with key unset.
- **Risk-weighted:** the highest-risk paths (shell-escape safety → use `execFile`; hallucination →
  validate git exit codes before synth; empty-boilerplate → `_None._` vs broken-run guard) each have an
  explicit assertion above.

## Open Risks & Assumptions
- `GIT_BRIEF_MODEL` default slug (`anthropic/claude-sonnet-4.6`) should be confirmed against OpenRouter's
  live catalog on first run; it is env-overridable, so a wrong default is a one-line fix, not a redesign.
- `seed` support is best-effort per model; the **cache** — not the seed — is the determinism guarantee.

## References
- Shape notes: `context/team/git-brief-shape.md`
- Opportunity map: `context/team/m5l1-opportunity-matrix.md`
- Team agent blueprint (ai-sdk + OpenRouter): `.claude/prompts/m5l2-agent.md`

## Progress

> `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands.

> Items 3.2 / 3.3 / 3.5 remain unchecked: they require a live OpenRouter call,
> which is blocked on `OPENROUTER_API_KEY` (absent in this environment). All
> deterministic work is verified; the stub path (Phase 4) covers the keyless case.

### Phase 1: Git Data Extraction & Downsampling
#### Automated
- [x] 1.1 Payload prints; `.status` count matches `git status --porcelain | wc -l`
- [x] 1.2 Large lockfile change appears as filename-only (omitted+reason)
- [x] 1.3 `npm test` — parsing + downsample unit tests pass
#### Manual
- [x] 1.4 Spot-check payload faithfully reflects current tree

### Phase 2: Local Payload-Hash Caching Engine
#### Automated
- [x] 2.1 Two runs on unchanged tree are byte-identical (`diff` empty)
- [x] 2.2 Cache file written; mutated state yields a new entry
- [x] 2.3 `npm test` — hash stability / key-sorting tests pass
#### Manual
- [x] 2.4 `.git-brief-cache.json` confirmed gitignored

### Phase 3: OpenRouter LLM Synthesis & Template Fitting
#### Automated
- [x] 3.1 All three section headings present in output
- [ ] 3.2 Non-empty tree does not render all-`_None._` (empty-boilerplate guard)
- [ ] 3.3 Run completes < 5s
- [x] 3.4 `npm test` — template snapshot + CommonMark tests pass
#### Manual
- [ ] 3.5 Brief is faithful, not hallucinated, on a real dirty repo

### Phase 4: Degraded Rule-Based Stub Mode
#### Automated
- [x] 4.1 Stub marker present when key unset
- [x] 4.2 Template shape preserved in stub output
- [x] 4.3 Stub body byte-identical across runs without cache
- [x] 4.4 `npm test` — stub clustering tests pass
#### Manual
- [x] 4.5 Confirm no model call occurs in stub mode (offline check)
