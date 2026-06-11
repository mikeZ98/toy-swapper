# Artifact 1 — Territory Discovery (codebase churn map)

> Module 4 · Lesson 2: Project Mapping
> Generated: 2026-06-11 · Repo: ToySwapper · Branch: master
> Method: `git log` touch-frequency over the requested 12-month window, filtering
> lockfiles, `node_modules/`, `dist/`, `.astro/`, and binary assets.

## ⚠ Window caveat (read first)

The requested window is "last 12 months" with a **quarterly** trend. The repo's entire
history is **80 commits spanning 2026-05-29 → 2026-06-11** — roughly **two weeks**.

Consequences for this analysis:

- The 12-month window captures **100% of history** (all 80 commits) — no truncation.
- A **quarterly** breakdown is degenerate: every commit falls in a single bucket (Q2 2026).
  Reporting "Q2: 80, all others: 0" would be noise dressed as a trend.
- The **meaningful trend granularity is weekly** (3 ISO weeks of data). That is what the
  "Trend" section below uses. Quarterly is recorded only for completeness.

This is an after-hours, 1-week-MVP-then-v2 project (per the PRD); the compressed timeline is
expected, not an anomaly.

## Top 10 most frequently modified files

Touch count = number of commits that added/modified/renamed the file in the window.

| Rank | Touches | File                                                  | Territory                              |
| ---- | ------- | ----------------------------------------------------- | -------------------------------------- |
| 1    | 9       | `context/foundation/roadmap.md`                       | Planning / foundation                  |
| 2    | 6       | `src/pages/index.astro`                               | Evaluator UI (give/want form + output) |
| 3    | 5       | `src/pages/api/evaluate.ts`                           | Evaluator API endpoint                 |
| 4    | 5       | `src/middleware.ts`                                   | Auth gating / session resolution       |
| 5    | 5       | `package.json`                                        | Dependencies / scripts                 |
| 6    | 5       | `context/changes/testing-e2e-setup/plan.md`           | Change plan (E2E)                      |
| 7    | 5       | `context/changes/testing-auth-gate/plan.md`           | Change plan (auth gate testing)        |
| 8    | 5       | `context/changes/structured-logging-baseline/plan.md` | Change plan (F-03)                     |
| 9    | 5       | `context/changes/postgres-rls-baseline/plan.md`       | Change plan (F-01)                     |
| 10   | 5       | `context/changes/feature-evaluation-history/plan.md`  | Change plan (S-03)                     |

**Signal:** the single hottest file is the **roadmap** — replanning, not code, is the most
churned artifact. Ranks 6–10 are all `plan.md` files (each touched ~5× by the
research→plan→implement→SHA-writeback→archive loop). The hottest _application_ code is the
trio **`index.astro` / `evaluate.ts` / `middleware.ts`** — the evaluate-and-gate path, which
is exactly the product's core (PRD Business Logic + the v2 auth gate).

## Top 10 most frequently modified directories

Touch count = file-modification events attributed to the file's immediate parent directory.

| Rank | Touches | Directory                                     | Note                                                            |
| ---- | ------- | --------------------------------------------- | --------------------------------------------------------------- |
| 1    | 19      | `context/foundation`                          | roadmap + prd + tech-stack + conventions churn                  |
| 2    | 17      | `test`                                        | the test suite (10+ spec files) — heavy late-stage testing push |
| 3    | 17      | `src/lib`                                     | services/helpers: evaluator, supabase, logging, persistence     |
| 4    | 10      | `context/changes/testing-e2e-setup`           | E2E change folder                                               |
| 5    | 9       | `src`                                         | top-level (`middleware.ts`, etc.)                               |
| 6    | 9       | `context/changes/testing-auth-gate`           | auth-gate testing change                                        |
| 7    | 9       | `context/changes/structured-logging-baseline` | F-03 change                                                     |
| 8    | 9       | `context/changes/postgres-rls-baseline`       | F-01 change                                                     |
| 9    | 9       | `context/changes/feature-evaluation-history`  | S-03 change                                                     |
| 10   | 9       | `context/changes/context-architecture-m4`     | this lesson's prior change                                      |

**Signal:** `context/` (foundation + changes) dominates — this is a **process-heavy,
spec-first repo** where the 10x methodology artifacts churn as much as the code. Among code
dirs, **`src/lib` (17)** and **`test` (17)** are tied at the top: business logic and its tests
move together, with `test` reflecting a concentrated late-window testing campaign.

## Trend (weekly — the meaningful granularity)

| ISO week | Dates     | Commits | Phase of work                                              |
| -------- | --------- | ------- | ---------------------------------------------------------- |
| 2026-W22 | May 29–31 | 19      | F-01 RLS baseline, seed pool, logging foundations          |
| 2026-W23 | Jun 1–7   | 24      | gated-evaluator (S-01), restore-lists (S-02), UX polish    |
| 2026-W24 | Jun 8–11  | 37      | evaluation-history, testing campaign, context-architecture |

Daily distribution:

```
2026-05-29   3
2026-05-30  10
2026-05-31   6
2026-06-01  13
2026-06-02   4
2026-06-03   7
            (gap: 06-04 → 06-07, no commits — weekend / after-hours cadence)
2026-06-08   5
2026-06-09  17   ← peak (testing + history work)
2026-06-10   9
2026-06-11   6
```

**Signal:** monotonic weekly acceleration (19 → 24 → 37). The W24 spike is the
testing-and-history push plus the context-architecture refactor. A clean ~4-day gap
(Jun 4–7) confirms the PRD's "after-hours-only" working pattern rather than a stall.

### Quarterly (recorded for completeness — degenerate)

| Quarter | Commits   |
| ------- | --------- |
| 2026-Q2 | 80 (100%) |

Single bucket; no inter-quarter trend exists yet. Re-run this artifact once history spans
≥2 quarters for a non-trivial quarterly view.

## Raw insights

- **Replanning is the dominant activity by churn.** The roadmap (9) + five `plan.md` files
  (5 each) outrank every source file. This is a spec-first, methodology-driven repo; the map
  of "where work happens" is as much `context/` as `src/`.
- **The product's hot path is `index.astro` → `evaluate.ts` → `middleware.ts`.** These three
  are the most-churned application files and correspond exactly to the PRD core (evaluate flow)
  plus the v2 auth gate. Any future change here is high-blast-radius.
- **`src/lib` and `test` move in lockstep (17 each).** Business logic and its specs co-evolve —
  a healthy signal. The `test/` concentration is recent (W24), indicating testing was a
  deliberate late-stage campaign, not continuous from day one.
- **Cadence is after-hours and accelerating** (19 → 24 → 37 commits/week, with a weekend gap),
  consistent with the PRD's stated timeline budget.
- **Methodology overhead is visible and isolated.** Each `context/changes/<id>/` folder shows
  ~9 directory touches — the uniform research→plan→implement→archive loop. This is process
  cost, cleanly partitioned from product code.

## Reproduction

```bash
FILTER='node_modules/|dist/|\.astro/|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|\.(png|jpg|jpeg|gif|svg|ico|webp|avif|woff2?|ttf|eot|mp4|pdf|lock)$'

# Top files
git log --since='12 months ago' --diff-filter=ACMR --name-only --pretty=format: \
  | grep -vE "^$" | grep -viE "$FILTER" | sort | uniq -c | sort -rn | head -10

# Top directories
git log --since='12 months ago' --diff-filter=ACMR --name-only --pretty=format: \
  | grep -vE "^$" | grep -viE "$FILTER" | sed 's#/[^/]*$##' | sort | uniq -c | sort -rn | head -10

# Weekly trend
git log --since='12 months ago' --format='%ad' --date=format:'%Y-W%V' | sort | uniq -c
```
