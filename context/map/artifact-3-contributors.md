# Artifact 3 — Contributor Discovery (hot-path ownership)

> Module 4 · Lesson 2: Project Mapping
> Generated: 2026-06-11 · Repo: ToySwapper · Window: last 2 weeks (= full history)
> Method: `git log --no-merges` author counts + `git blame --line-porcelain` line
> ownership on the product hot path. Bot/AI co-authors and merges discarded.
> Hot path (from Artifacts 1 & 2): `src/pages/index.astro`,
> `src/pages/api/evaluate.ts`, `src/middleware.ts`.

## ⚠ Headline: this is a single-maintainer repo

After discarding bot noise, **there is exactly one human contributor**, appearing under **two
git identities** (a configured repo-local identity and a day-1 machine default). There is no
team to map; domain expertise is concentrated in one person, with Claude as an AI pair.

## Identity reconciliation

| Git author            | Email                                     | Hot-path commits | Active window                  | Verdict                                                                                    |
| --------------------- | ----------------------------------------- | ---------------- | ------------------------------ | ------------------------------------------------------------------------------------------ |
| **Michał Zasiadczuk** | `m.zasiadczuk.98@gmail.com`               | 13               | 2026-05-29 → 06-11 (full span) | Canonical repo-local identity.                                                             |
| Michal_MAC            | `michal_mac@MacBook-Air-Michal-MAC.local` | 2                | 2026-05-29 only                | **Same human** — hostname-default email from day 1 before the repo-local identity was set. |

The two names are **one person**. The `Michal_MAC` identity is the un-configured machine
default (`user@hostname.local`) used only on the first day; commits after 2026-05-29 all carry
the proper `Michał Zasiadczuk <…gmail.com>` identity. (Consistent with the known repo note that
no machine-wide git identity was set, only a repo-local one.)

## Bot / noise discarded

| Discarded                                      | Count (hot path) | Reason                                          |
| ---------------------------------------------- | ---------------- | ----------------------------------------------- |
| `Co-Authored-By: Claude Opus 4.8`              | 10               | AI co-author trailer — not a human contributor. |
| `Co-Authored-By: Claude Opus 4.7 (1M context)` | 3                | AI co-author trailer.                           |
| `Co-Authored-By: Claude Opus 4.7`              | 2                | AI co-author trailer.                           |
| Merge commits                                  | 0                | None touched the hot path (linear history).     |

**Read:** 15 of the hot-path commits were AI-assisted (Claude). The repo is built with an
AI-pair workflow, but all authorship/decision ownership is human-singular.

## Hot-path commit authorship (human, no merges)

| File                        | Michał Zasiadczuk | Michal_MAC (day-1 self) | Total human commits |
| --------------------------- | ----------------- | ----------------------- | ------------------- |
| `src/pages/index.astro`     | 5                 | 1                       | 6                   |
| `src/pages/api/evaluate.ts` | 4                 | 1                       | 5                   |
| `src/middleware.ts`         | 4                 | 1                       | 5                   |
| **Combined**                | **13**            | **2**                   | **15**              |

## Current line ownership (`git blame`)

Surviving lines in the working tree, by authoring identity:

| File                        | Lines | Michal_MAC (day-1) | Michał Zasiadczuk (later) |
| --------------------------- | ----- | ------------------ | ------------------------- |
| `src/pages/index.astro`     | 280   | 172 (61%)          | 108 (39%)                 |
| `src/pages/api/evaluate.ts` | 88    | 51 (58%)           | 37 (42%)                  |
| `src/middleware.ts`         | 67    | 20 (30%)           | 47 (70%)                  |

**Read:** the _foundational scaffolding_ of `index.astro` and `evaluate.ts` was written on day 1
(and still survives as the majority of current lines), while `middleware.ts` is mostly later
work (the v2 auth-gate, S-01). Either way the author is the same human — the split is temporal
(day-1 vs. later), not interpersonal.

## Who to ask (de facto)

| Domain            | Expert                                              | Notes                                                                                                        |
| ----------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Everything        | **Michał Zasiadczuk** (`m.zasiadczuk.98@gmail.com`) | Sole maintainer; wrote/owns 100% of the hot path across both identities.                                     |
| AI-assist context | Commit `Co-Authored-By` trailers                    | Decisions were AI-paired; the change folders under `context/changes/**` carry the reasoning (plan/research). |

There is **no second human** to escalate to. For onboarding purposes, the durable "expert" is
the `context/` methodology trail (PRD, roadmap, per-change plans), not a roster of people.

## Raw insights

- **Bus factor = 1.** Single human across the entire codebase; the only redundancy is the
  documented `context/` decision trail, not a co-maintainer.
- **Two identities are one person** — collapse `Michal_MAC` → `Michał Zasiadczuk` in any
  ownership rollup (a `.mailmap` would formalize this).
- **AI-pair workflow is pervasive** (15 Claude-co-authored hot-path commits) but does not
  change human ownership.
- **Ownership is temporal, not territorial** — day-1 scaffolding vs. later v2 work, same author.

## Reproduction

```bash
HOT="src/pages/index.astro src/pages/api/evaluate.ts src/middleware.ts"
# author counts (zsh: list paths explicitly, $VAR does not word-split)
git log --since='2 weeks ago' --no-merges --pretty='%an <%ae>' -- $HOT | sort | uniq -c | sort -rn
# bot trailers
git log --since='2 weeks ago' --pretty='%b' -- $HOT | grep -i 'co-authored-by' | sort | uniq -c
# line ownership
for f in $HOT; do git blame --line-porcelain "$f" | grep '^author ' | sort | uniq -c | sort -rn; done
```
