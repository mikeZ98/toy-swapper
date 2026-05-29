---
bootstrapped_at: 2026-05-21T11:23:39Z
starter_id: 10x-astro-starter
starter_name: "10x Astro Starter (Astro + Supabase + Cloudflare)"
project_name: toy-swapper
language_family: js
package_manager: npm
cwd_strategy: git-clone
bootstrapper_confidence: first-class
phase_3_status: ok
audit_command: "npm audit --json"
---

## Hand-off

Verbatim copy of `context/foundation/tech-stack.md` frontmatter:

```yaml
starter_id: 10x-astro-starter
package_manager: npm
project_name: toy-swapper
hints:
  language_family: js
  team_size: solo
  deployment_target: cloudflare-pages
  ci_provider: github-actions
  ci_default_flow: auto-deploy-on-merge
  bootstrapper_confidence: first-class
  path_taken: standard
  quality_override: false
  self_check_answers: null
  has_auth: false
  has_payments: false
  has_realtime: false
  has_ai: true
  has_background_jobs: false
```

### Why this stack (from hand-off body)

Solo builder shipping ToySwapper as a 1-week after-hours MVP with a hard
deadline of 2026-05-26. The product is a web-app in JS/TS with one
load-bearing AI step (LLM-based standardization and valuation in FR-003 and
FR-005) and explicit Non-Goals against database, authentication, realtime
chat, and image input. 10x-astro-starter is the recommended default for
`(web, js)` and clears all four agent-friendly gates — TypeScript-first,
convention-based, popular in training data, well-documented — which matters
because most build time will be after-hours with agent assistance. Astro 6
plus React 19 plus Tailwind 4 on Cloudflare Pages/Workers gives the fastest
path from scaffold to first deploy; the starter's bundled Supabase is
installed but unused since the PRD pins state in memory over a hardcoded
fixture pool. CI runs on GitHub Actions with auto-deploy-on-merge — the
starter's default shape and the lowest-friction choice for a solo
1-week build. Bootstrapper confidence is first-class.

## Pre-scaffold verification

| Signal       | Value                                                                  | Severity | Notes                                                              |
| ------------ | ---------------------------------------------------------------------- | -------- | ------------------------------------------------------------------ |
| npm package  | not run                                                                | n/a      | cmd_template starts with `git clone` — npm view step is skipped    |
| GitHub repo  | przeprogramowani/10x-astro-starter last pushed 2026-05-17T10:33:39Z (4 days ago) | fresh    | from card.docs_url; queried via direct GitHub API (gh CLI unavailable, fell back to curl) |

## Scaffold log

**Resolved invocation**: `git clone https://github.com/przeprogramowani/10x-astro-starter .bootstrap-scaffold && cd .bootstrap-scaffold && npm install`
**Strategy**: git-clone
**Exit code**: 0
**Files moved**: 21 top-level entries (`.env.example`, `.github/`, `.gitignore`, `.husky/`, `.nvmrc`, `.prettierrc.json`, `.vscode/`, `astro.config.mjs`, `CLAUDE.md`, `components.json`, `eslint.config.js`, `node_modules/`, `package-lock.json`, `package.json`, `public/`, `README.md`, `src/`, `supabase/`, `tsconfig.json`, `wrangler.jsonc`, plus `.DS_Store` sidelined as conflict)
**Conflicts (.scaffold siblings)**: `.DS_Store.scaffold`
**.gitignore handling**: moved silently (no prior `.gitignore` in cwd)
**.bootstrap-scaffold cleanup**: deleted (`.git/` removed first; remaining tree moved up; temp dir empty and rmdir'd)

Additional notes:
- 773 npm packages installed during `npm install` (audited 774).
- `context/` was not present in the upstream scaffold, so the special-case "drop context/**" rule did not need to fire — cwd `context/` is untouched.
- `.claude/`, `claude-code/`, `.git/`, and the cwd `.DS_Store` predated the scaffold and were preserved by the conflict matrix.

## Post-scaffold audit

**Tool**: `npm audit --json`
**Summary**: 0 CRITICAL, 1 HIGH, 10 MODERATE, 0 LOW (total 11; 895 dependencies scanned — 449 prod, 316 dev)
**Direct vs transitive**: 0/0/3/0 direct of total 0/1/10/0 — the high-severity finding is transitive; 3 of the 10 moderates are direct dependencies.

#### CRITICAL findings

None.

#### HIGH findings

- **devalue** (range `5.6.3 - 5.8.0`, transitive)
  - Advisory: *Svelte devalue: DoS via sparse array deserialization* — GHSA-77vg-94rm-hx3p
  - Fix available: yes (direct dependency update will pull a patched `devalue`).

#### MODERATE findings

Direct dependencies (3):
- **@astrojs/check** (range `>=0.9.3`) — fix available via downgrade to `0.9.2` (semver-major).
- **@astrojs/cloudflare** (range `>=12.2.4`) — fix available via downgrade to `12.6.13` (semver-major).
- **wrangler** (range `<=0.0.0-kickoff-demo || >=3.108.0`) — fix available via downgrade to `3.107.3` (semver-major).

Transitive dependencies (7):
- **@astrojs/language-server** (`>=2.14.0`) — fixed by updating `@astrojs/check`.
- **@cloudflare/vite-plugin** (`<=0.0.0-fff677e35 || >=0.0.7`) — fixed by updating `@astrojs/cloudflare`.
- **miniflare** (`<=0.0.0-fff677e35 || >=3.20250204.0`) — fixed by updating `wrangler`.
- **volar-service-yaml** (`<=0.0.70`) — fixed by updating `@astrojs/check`.
- **ws** (`8.0.0 - 8.20.0`) — *ws: Uninitialized memory disclosure* — GHSA-58qx-3vcg-4xpx — fixed by updating `wrangler`.
- **yaml** (`2.0.0 - 2.8.2`) — *yaml: Stack Overflow via deeply nested YAML collections* — GHSA-48c2-rrv3-qjmp — fixed by updating `@astrojs/check`.
- **yaml-language-server** (multiple ranges) — fixed by updating `@astrojs/check`.

#### LOW / INFO findings

None.

## Hints recorded but not acted on

| Hint                       | Value                  |
| -------------------------- | ---------------------- |
| bootstrapper_confidence    | first-class            |
| quality_override           | false                  |
| path_taken                 | standard               |
| self_check_answers         | null                   |
| team_size                  | solo                   |
| deployment_target          | cloudflare-pages       |
| ci_provider                | github-actions         |
| ci_default_flow            | auto-deploy-on-merge   |
| has_auth                   | false                  |
| has_payments               | false                  |
| has_realtime               | false                  |
| has_ai                     | true                   |
| has_background_jobs        | false                  |

v1 surfaces these values for the audit trail but does not act on them — no CI/CD scaffolding, no AGENTS.md/CLAUDE.md generation, no feature-flag-driven scaffold variation. The future M1L4 ("Memory Architecture") skill is expected to consume them.

## Next steps

Next: a future skill will set up agent context (CLAUDE.md, AGENTS.md). For now, your project is scaffolded and verified — happy hacking.

Useful manual steps in the meantime:
- `git init` (if you have not already) to start your own repo history. *Note*: a `.git/` already exists in cwd and was preserved by the conflict matrix; the scaffold's upstream `.git/` was deleted before move-up so no upstream history leaked in.
- Review the one `.scaffold` sibling: `.DS_Store.scaffold` is the macOS Finder cache from the upstream repo and can safely be deleted (`rm .DS_Store.scaffold`).
- The starter shipped its own `CLAUDE.md`. Treat it as the starter's defaults; expect M1L4 to either supersede or merge it.
- Address audit findings per your project's risk tolerance — the full breakdown is above. Note that the suggested fixes for the 3 direct moderate findings are semver-major downgrades, which is unusual; verify before running `npm audit fix --force`. The single HIGH (`devalue`) is transitive and pulled in by a Svelte dependency that the Astro starter does not directly use at runtime; impact for this project's MVP is likely low.
- `.env.example` ships from the starter; copy it to `.env` and fill in your Supabase + Cloudflare values when you need them (or ignore for the in-memory MVP — Supabase is unused per PRD Non-Goals).
