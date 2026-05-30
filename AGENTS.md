# Repository Guidelines

ToySwapper is an Astro 6 + React 19 + Cloudflare-Workers app that turns two parents' freeform give/want lists into a Markdown barter contract with an LLM-estimated fairness verdict. v1 shipped as an in-memory MVP and is live; v2 (PRD updated 2026-05-28) adds Supabase auth, RLS-scoped persistence, and per-account history. See @context/foundation/prd.md, @context/foundation/tech-stack.md, and @context/foundation/roadmap.md for the locked product, stack, and sequencing decisions.

## PRD-locked rules (do not violate)

- **No realtime, no images, no multi-party chains, no real OLX/Vinted scraping** (PRD § Non-Goals — still load-bearing). v2 lifted the v1 "no database, no auth" rules on 2026-05-28; persistence and gating ARE now in scope.
- **RLS is the data-layer contract.** Every user-scoped Postgres table enables Row-Level Security with explicit per-operation, per-role policies (no `using (true)` without an audit comment). The pattern, helpers, and policy template live in @supabase/README.md. Service-role keys are never used from the SSR client.
- **Determinism is binding.** Same give-list + want-list + fixture pool must produce byte-identical Markdown. Any LLM call runs at temperature 0 with a fixed seed, OR is wrapped in a cache, OR falls back to rule-based parsing (PRD § Success Criteria → Guardrails). Persisted historical contracts (FR-018) and seeded counterparty rows (FR-017) also remain byte-identical to their original output.
- **Migrations are immutable.** Once a `supabase/migrations/<timestamp>_*.sql` filename lands on master, never edit it — fixes ship as new timestamped migrations.
- **No silent item drops.** Every input item appears in the contract OR in a "couldn't classify" appendix with a one-line reason (FR-004).
- **Fairness threshold is relative**, not absolute: `delta ≤ X% of max(side_total)`, X configurable (FR-009). Do not reintroduce absolute thresholds — the FR was revised during shaping.
- **Bilingual (PL + EN), mixed-language inputs supported.** End-to-end response ≤ 5s for ≤ 10 counterparties. Output is CommonMark — no inline HTML, no extension syntax, no required external assets.

## Build, Test, and Development Commands

- `npm run dev` — Astro dev server on `http://localhost:4321`.
- `npm run build` — production build (SSR via `@astrojs/cloudflare`).
- `npm run lint` / `npm run lint:fix` — ESLint with type-checked rules.
- `npm run format` — Prettier.
- Husky + lint-staged auto-runs `eslint --fix` and `prettier --write` on commit (see @package.json `lint-staged`).

## Project Structure & Conventions

- `src/pages/api/*.ts` — API routes; export uppercase `GET` / `POST`, set `export const prerender = false`, validate input with zod.
- `src/lib/` — services, helpers, fixture pool, evaluator. `src/lib/utils.ts` exposes `cn()` for Tailwind class merging; use it, do not concatenate class strings.
- `src/components/ui/` — shadcn/ui (new-york variant); add via `npx shadcn@latest add <name>`.
- React only when interactivity is required; Astro for static layout. Hooks live in `src/components/hooks/`.
- Path alias `@/*` → `./src/*` (see @tsconfig.json).
- Shared types in `src/types.ts`.

## Commits & CI

- Commit prefix style: not yet established (initial commit pending). When deciding, prefer Conventional Commits.
- CI gate: GitHub Actions runs two parallel jobs on push/PR to `master` (see @.github/workflows/ci.yml) — `ci` (`lint + build`, needs `SUPABASE_URL` / `SUPABASE_KEY` repo secrets) and `db` (boots local Postgres, runs `supabase db lint` + `supabase test db`).
- Migrations: every PR runs `supabase db lint` + `supabase test db`; merge to `master` runs `supabase db push` against prod (needs `SUPABASE_PROJECT_REF` / `SUPABASE_ACCESS_TOKEN` / `SUPABASE_DB_PASSWORD` secrets — see README "CI"). New migration files MUST follow @supabase/README.md and ship with a pgTAP test under `supabase/tests/`.
- LLM endpoint reads `OPENAI_API_KEY` via `astro:env/server`. Absent the key, the evaluator falls back to a deterministic stub (per the PRD determinism rule). Do not log raw user input/output in production paths.

For depth on Astro / Supabase / shadcn conventions inherited from the starter, see @CLAUDE.md.
