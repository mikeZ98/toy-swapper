# Opportunity Map + Mom Test — Module 5 Lesson 1

> Save-path note: requested location was `/workspace/m5l1-opportunity-matrix.md`
> "inside the Docker container." This workspace is a bare macOS host on an external
> SSD — there is no Docker container and no `/workspace` directory (`/.dockerenv`
> absent). Writing there would create a root-level folder. Filename preserved;
> placed at the skill's standard `context/team/` location instead.

## Context

- **Project / context**: ToySwapper (Astro 6 + React 19 + Cloudflare Workers). Local AI-dev workflow tooling.
- **Framework**: Module 5 Lesson 1 — Opportunity Map (`10x-opportunity-map`) + The Mom Test (`10x-mom-test`).
- **Source templates scanned**: `.claude/prompts/m5l2-agent.md` (team review agent via ai-sdk), `m5l3-{cicd,promptfoo,requirements}.md` (GHA code-review CI + 6 scoring criteria + evals), `m5l4-*` + `.claude/config-templates/m5l4-*` (CodeArtifact / GitHub Packages distribution), `m5l4-shared-conventions.md` (code-review skill input). No `m5l1` template exists — that framework lives in the two skills above.
- **Data constraint**: local / read-only / non-sensitive dev metadata (git logs, working-tree state, review diffs, registry files). First versions stay lightweight — no access-control work required.
- **Date**: 2026-06-24

## Map

| Signal | Existing / default response | Thin complement | First useful version | Data risk | Direction if valuable |
|---|---|---|---|---|---|
| 1. Daily project status / git brief | `git log`/`git status`, GitHub recent-commits, standups — none JOIN commit history to live working-tree state, none narrate | Read-only script joining `git log` + `git status` + staged/unstaged diff into one Markdown brief | Local CLI prints/writes today's brief for the current repo — no server, schedule, or deploy | local / read-only / non-sensitive | Internal tool → Async / remote (scheduled poster) |
| 2. Review bottleneck & missing strict validation gate | GitHub PR reviews, ESLint/build CI, `/code-review` skill — **already blueprinted by m5l3** (GHA review, 1–10 scoring) + m5l4 shared conventions | GHA composite action wrapping the review agent; scores diff vs conventions, posts comment + pass/fail label | Run reviewer locally on a diff, emit the 1–10 scorecard as Markdown — no GHA wiring | local / read-only (diff only) | Internal tool → Review / CI gate (m5l3 in motion) |
| 3. AI registry asset duplication (skills/rules) | Manual copy, submodules, npm — **already blueprinted by m5l4** (CodeArtifact / GitHub Packages + install.js) | Read-only drift report diffing local `.claude/` assets vs a canonical manifest, before any registry exists | Local script lists which skills/rules differ from a reference checkout — no publish, Terraform, or OIDC | local / read-only / non-sensitive | Internal tool → Shared artifact registry (m5l4 in motion) |

## Recommended First Candidate

```
Candidate:   git-brief — local daily status digest
Reads:       `git log` (since last brief), `git status`, staged/unstaged diff — current repo only
Returns:     One Markdown brief: commits landed, work-in-flight (dirty/staged paths),
             untracked files, "stale branch" flag. Deterministic, throwaway.
Does not do: No server, no schedule/cron, no GitHub API, no deploy, no DB, no multi-repo.
Data risk:   local / read-only / non-sensitive — no access-control work needed first.
Direction:   Internal tool → Async / remote (scheduled poster) only if it earns daily use.
```

## Why This Candidate

Signals 2 and 3 are already covered by in-flight team blueprints — m5l3 (review CI gate) and m5l4 (registry distribution). Building thin helpers there duplicates work the delivery pipeline will ship. Signal 1 is the only one with **no existing blueprint**; it uniquely **joins two information sources** (commit history × working-tree state) that no current tool combines; it **repeats daily**; and it is trivially testable **read-only** on local git. Highest leverage, lowest risk, most disposable — the criteria the opportunity-map ranking optimizes for.

## Mom Test Validation (selected Thin Helper: `git-brief`)

### Hypotheses

- **User/role**: devs / lead on this repo reconstructing daily status.
- **Friction**: joining commit history to live working-tree state by hand, across a context gap.
- **Current workaround**: scrolling `git log` + `git status`; standups.
- **Risky assumptions**: that status is re-derived *daily*; that a generated brief beats just running the two commands; that the friction is shared, not solo+momentary.
- **Evidence already present**: thin — assumption-driven, not yet observed. Flagged as such.

### Critique (non-leading)

The core risk is **essential vs accidental** friction. `git status` already answers "what's dirty" in one keystroke, so a brief only earns its keep when status is reconstructed **repeatedly, across a gap (overnight / context-switch), and communicated to someone**. If the pain is solo and momentary, the default tools already win and this is a no-build. The questions below test for the gap and the audience through past behavior — none ask whether a brief "would be useful."

### Five questions (concrete, non-leading, past-behavior)

1. Walk me through the **last time** you came back to this repo after a day or two away — what exact commands did you run to figure out where you'd left off?
2. The **last time** you wrote or gave a status update (standup, PR description, message to a teammate), where did you get the "what changed" from, and how long did assembling it take?
3. Tell me about the **most recent time** you got caught out by uncommitted or half-staged work — what happened, and how did you eventually notice it?
4. When did you **last** scroll back through `git log` to reconstruct what landed across several commits, and what were you trying to answer that `git log --oneline` didn't answer directly?
5. Have you ever **saved or pasted** that reconstructed status anywhere (a note, a message, a doc)? Show me the last one — what did you keep in it and what did you drop?

## Decision Criteria

- **Proceed**: ≥3 of 5 interviews surface the same unprompted "reconstruct-after-a-gap" workaround **and** ≥1 mentions saving/sharing the status.
- **Narrow scope**: reconstruction is real but always solo + momentary → ship as a pure local CLI only, never a scheduled poster.
- **Do not build yet**: `git status` / `git log` already fully answer it with no gap and no audience.
- **Try existing tool/process first**: if the need is purely "what changed on the remote," GitHub's compare view / recent-commits already cover it.

## Next Direction If Valuable

Internal tool → **Async / remote** (a scheduled brief poster) — but only after the Mom Test "Proceed" bar is met. Suggested next skill (not auto-run): `/10x-shape` to turn the validated opportunity into shape-notes, or `/10x-new` to open a change folder if going straight to build.
