---
artifact: shape-notes
project: git-brief
context_type: internal-tool (new CLI utility shaped inside the ToySwapper repo)
source_opportunity: context/team/m5l1-opportunity-matrix.md
date: 2026-06-24
status: draft — pre-PRD / pre-plan
---

# Shape Notes — `git-brief`

> Discovery input for `/10x-prd` (or directly `/10x-plan`, since this is a small
> single-utility scope). Shaped from the selected Thin Helper in the Module 5 L1
> opportunity map. Content below is the user's; the skill's role here was to impose
> scope discipline, force the non-goals explicit, and surface the determinism tension.

## Vision & Problem Statement

**One-sentence rule:** `git-brief` reads the current repo's local state and *synthesizes*
a single scan-at-a-glance Markdown brief that joins commit history to live working-tree
state — the join no built-in git command performs.

- **Person:** a developer / lead on this repo, returning after a context gap.
- **Moment:** start of a work session, or assembling a status update.
- **Cost today:** manual `git log` + `git status` scrolling and mental reconstruction.

## 1. Boundaries & Scope Discipline

### Strictly IN scope
- Reading **local** repository state for the **current working directory only**:
  - `git log` (commits within a user-defined window).
  - `git status` (dirty / staged / untracked).
  - Staged diff (`git diff --staged`) and unstaged diff (`git diff`).
- Synthesizing those into one Markdown brief.

### Strictly OUT of scope (MVP)
- ❌ No external database / persistence layer.
- ❌ No automated cron / scheduler (run on demand only).
- ❌ No network requests to the GitHub API (or any remote).
- ❌ No multi-repo / monorepo-workspace fan-out.
- ❌ No write operations to the repo (read-only; never commits, stages, or stashes).

It remains a **throwaway local CLI utility**. Disposable, single-repo, no state of its own.

> **Scope guardrail:** the moment a feature needs the network, a schedule, or a second repo,
> it has left the MVP and belongs in the "Direction if valuable" (async/remote poster) phase,
> not here.

## 2. Data Inputs & Context Window

### Input fields
| Field | Source command | Notes |
|---|---|---|
| Current branch name | `git rev-parse --abbrev-ref HEAD` | header context |
| Uncommitted / dirty files | `git status --porcelain` | parse status codes |
| Staged diff (full text) | `git diff --staged` | may be large |
| Unstaged diff (full text) | `git diff` | may be large |
| Commit log since threshold | `git log --since="<window>"` | window is user-defined |

- **Threshold flag:** `--since="24 hours ago"` (default) or a `--since="last brief"` semantic
  (resolved from a locally cached last-run timestamp — note: this is the *one* allowed crumb of
  local state; if even that is unwanted, default purely to a time window and drop "last brief").

### Context-window mitigation (token budget)
Diffs are the unbounded input. A lockfile or generated-file change can blow the budget alone.
**Downsample before the model sees it**, in this order:

1. **Per-file budget check.** Compute approximate token size per diff hunk.
2. **Soft cap ~10k tokens** on total diff payload.
3. **Graceful degradation when a file exceeds budget** — replace its full diff with a
   **summary line only**: `path`, extension, `+N/-M` line counts, and a `[diff omitted: NN KB]`
   marker. The model reasons over the *shape* of the change, not its literal text.
4. **Known-noise allowlist** — files matching lockfile / vendored / generated patterns
   (`*-lock.json`, `*.lock`, `dist/`, `*.min.*`) are **filename-only by default**, regardless
   of size. They rarely carry narrative meaning.
5. **Never silently drop.** Every omitted/truncated file is still *listed* (filename + reason),
   mirroring the repo's "no silent item drops" convention. An item is summarized, never vanished.

## 3. Core Reasoning Logic

The model receives the (downsampled) git payload and synthesizes a narrative under three
heuristics. Prompt instructs it to ground every statement in the provided data and to emit
**nothing** for a section that has no supporting input (no filler). Per Decisions #1, the
downsampled payload is first hashed and looked up in the local cache; the model (at
`temperature: 0`, fixed seed) is only invoked on a cache miss, and its result is then stored.

**a) "What landed"** — summarize recent commits.
- Group commits by theme (infer from messages + touched paths); collapse trivial/chore commits.
- One bullet per logical unit of work, not one per commit. Cite the conventional-commit type
  where present (feat/fix/chore/docs).

**b) "What's mid-flight"** — categorize dirty/staged files into work-in-progress streams.
- Cluster changed paths into *streams* by directory / feature affinity
  (e.g. `src/lib/*` → "evaluator changes"; `supabase/migrations/*` → "schema work").
- Distinguish **staged** (intent to commit) from **unstaged** (still being edited) within a stream.

**c) "Risks / stale states"** — detect drift and forgotten state.
- **Split-brain / heavily diverged:** local branch far ahead/behind its tracked upstream
  (`git rev-list --left-right --count @{u}...HEAD` if an upstream exists; skip silently if none).
- **Forgotten untracked files:** flag untracked non-ignored files that look like real work
  (source/config), de-emphasize scratch artifacts.
- **Long-lived dirty state:** files dirty but untouched relative to the commit window — possible
  abandoned work.

## 4. Output Schema (Markdown template)

CommonMark only — no inline HTML, no extension syntax (consistent with repo output rules).
Empty sections render the literal `_None._` placeholder so a real empty state is distinguishable
from a broken run (see Failure Modes).

```markdown
# git-brief — <repo name> @ <branch>
_Window: <resolved since-window> · generated <ISO timestamp>_

### Completed Yesterday
- <theme>: <one-line summary> (<n commits>)
_None._   ← when window has no commits

### In-Flight Streams
- **<stream name>** (staged): <files / intent>
- **<stream name>** (unstaged): <files / intent>
_None._   ← when working tree is clean

### Hidden Risks / Stale Files
- ⚠️ <risk>: <evidence>
_None._   ← when no risk detected
```

> Heading-accuracy note: `### Completed Yesterday` is a fixed label, but the window is
> configurable (`--since`). Either keep the friendly label or template it to the actual window
> (`### Landed in last 24h`). Flagged as a minor open question, not a blocker.

## 5. Success Criteria vs. Failure Modes

### Success
- **Speed:** end-to-end run **< 5 s** on this repo's scale.
- **Fidelity:** the brief is a comprehensive narrative that *faithfully* reflects current git
  state — every in-flight stream and landed theme present in the data appears in the brief.
- **Determinism (binding — see Decisions #1):** same repo state ⇒ **byte-identical** brief,
  guaranteed by the payload-hash cache (temp-0 on cache miss). Re-running on an unchanged tree
  must reproduce the prior output exactly.

### Failure modes (the ones that must be caught, not just "errors")
- **Silent-success / empty boilerplate:** script exits 0 but the body is empty template text.
  → **Guard:** a brief with content sections but zero grounded bullets while git state is
  *non-empty* is a hard failure, not a clean "_None._".
- **Hallucination from broken shell escape:** a mis-quoted/escaped git invocation returns empty
  or garbled output, and the model invents plausible-but-fictional commits/files.
  → **Guard:** validate each git subprocess (exit code + non-empty-where-expected) *before* the
  model call; on any git failure, abort with a non-zero exit and a diagnostic — never proceed to
  synthesis on degraded input. Prefer passing git output via argv/stdin over string-interpolated
  shell.
- **Token overflow → truncated mid-payload:** mitigated by Dimension 2 downsampling; an
  over-budget payload that *can't* be downsampled below cap fails loudly rather than truncating
  arbitrarily.

## Non-Goals (explicit scope avoids)
- Building our own diff-summarization model — use the existing model endpoint.
- Real-time / watch mode — single on-demand invocation only.
- Cross-repo or team-wide aggregation — single working directory.
- Any remote/GitHub state — local git is the only source of truth.

## Decisions
1. **Determinism — RESOLVED (2026-06-24): temp-0 + payload-hash cache (paths a+b).**
   The opportunity map labeled this tool "deterministic, throwaway," but Dimension 3 synthesizes
   via a model. An LLM brief is not byte-identical across runs, and this repo treats determinism
   as binding. **Chosen mechanism:**
   - **Cache (primary determinism guarantee).** Key a content-addressed cache on a hash of the
     *exact, post-downsample* model input (branch + resolved window + commit set + the
     diff-or-summary-line payload after Dimension 2 mitigation). On a cache hit, return the stored
     brief verbatim — identical git state ⇒ byte-identical output, no model call, and faster.
   - **temp-0 (best-effort on cache miss).** When the hash is unseen, call the model at
     `temperature: 0` with a fixed seed to minimize cross-run drift before caching the result.
   - **Hash over the downsampled payload, not raw git** — so a re-run that truncates a large
     lockfile to the same summary line still hits cache. The cache file is local and disposable
     (a sibling to the `--since="last brief"` timestamp crumb in OQ #2); it is not a system of
     record and may be deleted at any time without affecting correctness.
   - Rejected: path (c) rule-based fallback — discarded as the *primary* path because it loses
     the narrative synthesis that is the tool's whole value. It remains available only as the
     no-API-key degraded mode, mirroring the repo's evaluator stub.

## Open Questions (carry into PRD/plan)
2. **`--since="last brief"` local crumb.** Requires one cached timestamp = a sliver of local
   state, which brushes the "no DB / stateless" boundary. Keep, or default to pure time-window?
3. **Heading label vs. window** (Dimension 4 note) — fixed "Yesterday" vs. templated window.

## Direction If Valuable
Internal tool → **Async / remote** (a scheduled brief poster) — only after it earns daily use.
That phase is where cron, network, and persistence legitimately re-enter; none belong in this MVP.

---

### Handoff
- This scope is a single small utility — `/10x-plan` directly is reasonable.
- If a fuller spec is wanted first: `/10x-prd` consumes these notes.
- Determinism is **resolved** (Decisions #1: temp-0 + payload-hash cache) — planning is unblocked.
